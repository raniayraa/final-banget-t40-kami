# Turbo Mode — Throughput Optimization Guide

Dokumentasi perubahan yang dilakukan untuk membuat `xdp-go-optimized` mencapai
throughput setara dengan `combine-firewall-forwarder`.

---

## Diagnosis: Kenapa Throughput Awalnya Lebih Kecil

Setelah investigasi, ditemukan **tiga root cause** secara berurutan:

### Root Cause 1 — Ring Buffer Overhead di Hot Path

**Masalah:** Setiap paket yang diproses melakukan:
1. `bpf_map_lookup_elem(&sample_counter, &key)` + increment — terjadi di **setiap** paket
2. `bpf_ktime_get_ns()` + `bpf_ringbuf_output(..., BPF_RB_FORCE_WAKEUP)` — di setiap DROP,
   trigger context switch ke userspace untuk wake up Go consumer
3. `bpf_ringbuf_output(..., BPF_RB_NO_WAKEUP)` — setiap 1:1000 paket di-forward

`combine-firewall-forwarder` tidak punya satupun dari overhead ini.

### Root Cause 2 — XDP Generic Mode (SKB Mode)

**Masalah:** XDP dipasang dengan `link.XDPGenericMode` (software fallback).

Dalam generic mode:
- Kernel sudah mengalokasikan `sk_buff` untuk setiap paket **sebelum** XDP jalan
- XDP tidak bisa bypass memory allocator kernel
- Terlihat di `ip link show`: **`xdpgeneric`** (bukan `xdp`)

`combine-firewall-forwarder` via `libxdp` default ke **native driver mode** — XDP intercept
langsung di level driver NIC, sebelum kernel menyentuh paket.

Dampak: generic mode bisa **5–10× lebih lambat** dari driver mode.

### Root Cause 3 — Tidak Ada System Tuning

**Masalah:** `combine-firewall-forwarder` menjalankan `xdp_pin_cpus.sh` sebelum XDP jalan,
yang melakukan:
- Stop `irqbalance` → mencegah IRQ bermigrasi antar CPU
- CPU governor → `performance` → matikan CPU frequency throttling
- Pin tiap RX queue IRQ ke CPU dedicated → eliminasi cache thrashing antar CPU
- XPS per TX queue → matching queue-CPU untuk transmit

Tanpa tuning ini, ketika driver mode diaktifkan, semua NIC queue berebut CPU
tanpa koordinasi → throughput justru **turun**.

---

## Perubahan yang Dilakukan

### 1. Tambah `FW_CFG_EVENTS_ENABLED` Flag

**File:** [`bpf/common_kern_user.h`](bpf/common_kern_user.h)

```c
enum fw_config_key {
    // ... flag lama (0-6) ...
    FW_CFG_EVENTS_ENABLED = 7,  /* Emit ring buffer events (0=off/turbo) */
    FW_CFG_MAX                  /* sekarang = 8 */
};
```

Runtime toggle untuk seluruh infrastruktur ring buffer. Ketika `0` (turbo mode):
- Tidak ada `sample_counter` map lookup
- Tidak ada `bpf_ringbuf_output()` call
- Tidak ada `bpf_ktime_get_ns()` call
- Hot path identik dengan `combine-firewall-forwarder`

---

### 2. Gate Semua Event Calls di Kernel Program

**File:** [`bpf/xdp_prog_kern.c`](bpf/xdp_prog_kern.c)

Check `events_enabled` **sekali** di awal program, simpan di local variable,
lalu semua emit calls dibungkus conditional:

```c
SEC("xdp")
int xdp_firewall_fwd(struct xdp_md *ctx)
{
    // ...
    /* Cek SEKALI — kalau 0, zero ring buffer overhead di seluruh hot path */
    int events_enabled = fw_cfg_enabled(FW_CFG_EVENTS_ENABLED);

    // ...
    if (fw_cfg_enabled(FW_CFG_BLOCK_IP_FRAGMENTS) && ...) {
        stats_update(STAT_DROP, pkt_len);
        if (events_enabled)                          /* ← hanya kalau enabled */
            emit_event_security(..., PKT_ACTION_DROP, ...);
        return XDP_DROP;
    }
    // ... dst
}
```

---

### 3. Ganti `BPF_RB_FORCE_WAKEUP` → `BPF_RB_NO_WAKEUP`

**File:** [`bpf/xdp_prog_kern.c`](bpf/xdp_prog_kern.c) — fungsi `emit_event_security()`

```c
// Sebelum (buruk untuk throughput):
bpf_ringbuf_output(&packet_events, &ev, sizeof(ev), BPF_RB_FORCE_WAKEUP);

// Sesudah:
bpf_ringbuf_output(&packet_events, &ev, sizeof(ev), BPF_RB_NO_WAKEUP);
```

`BPF_RB_FORCE_WAKEUP` mengirim sinyal interrupt ke userspace **setiap kali** ada DROP,
menyebabkan context switch per-paket. Go consumer sudah punya timer-based poll (100ms)
sehingga `BPF_RB_NO_WAKEUP` cukup — event tetap terbaca, tanpa overhead per-DROP.

---

### 4. Go Userspace: Sync `FwFlags` dan `FwCfgMax`

**File:** [`internal/maps/config.go`](internal/maps/config.go)

```go
const (
    // ... konstanta lama (0-6) ...
    FwCfgEventsEnabled = uint32(7)  // 0=turbo, 1=observability (default)
    FwCfgMax           = uint32(8)  // naik dari 7 → 8
)

type FwFlags struct {
    // ... field lama ...
    EventsEnabled bool `json:"events_enabled"`
}
```

`ReadFlags()` dan `WriteFlags()` diupdate untuk membaca/menulis index ke-8.

---

### 5. Default Events Enabled = True saat Attach

**File:** [`internal/xdp/manager.go`](internal/xdp/manager.go)

```go
// BPF ARRAY diinisialisasi kernel dengan semua 0.
// Set FW_CFG_EVENTS_ENABLED=1 agar ring buffer aktif secara default.
if err := maps.SetFlag(m.objs.FwConfig, maps.FwCfgEventsEnabled, true); err != nil {
    log.Printf("warn: set events_enabled default: %v", err)
}
```

Default **on** sehingga perilaku tidak berubah kecuali user eksplisit matikan.

---

### 6. Ganti `XDPGenericMode` → `XDPDriverMode`

**File:** [`internal/xdp/manager.go`](internal/xdp/manager.go)

```go
// Sebelum (software/SKB mode — lambat):
m.xdpLink, err = link.AttachXDP(link.XDPOptions{
    Program:   m.objs.XdpFirewallFwd,
    Interface: iface.Index,
    Flags:     link.XDPGenericMode,
})

// Sesudah (native driver mode — cepat):
m.xdpLink, err = link.AttachXDP(link.XDPOptions{
    Program:   m.objs.XdpFirewallFwd,
    Interface: iface.Index,
    Flags:     link.XDPDriverMode,
})
```

Hal yang sama diterapkan ke egress pass program di `attachEgressPass()`.

Cara verify mode aktif:
```bash
ip link show enp1s0f1np1 | grep xdp
# xdpgeneric = BURUK (generic/software mode)
# xdp        = BAGUS (native driver mode)
```

---

### 7. `start_turbo.sh` — System Tuning + Launch

**File:** [`start_turbo.sh`](start_turbo.sh)

Script wrapper yang melakukan system tuning sebelum jalankan daemon:

```
1. Stop irqbalance       → cegah IRQ bermigrasi antar CPU
2. CPU governor          → performance (matikan frequency throttling)
3. NIC queues            → set ke jumlah CPU (nproc)
4. IRQ affinity          → pin tiap RX queue IRQ ke CPU dedicated
5. XPS per TX queue      → matching queue-CPU untuk transmit
6. (Sama untuk egress NIC)
7. taskset -c 0-N xdpd  → jalankan daemon spread ke semua CPU
```

Tanpa langkah ini, driver mode tidak lebih cepat dari generic mode karena
semua queue berebut CPU.

---

## Cara Menjalankan Turbo Mode

### Cara Tercepat (Recommended)

```bash
cd /home/telmat/belajar-rania/xdp-go-optimized

# Build (jika belum)
go build -o xdpd ./cmd/xdpd/

# Jalankan dengan semua tuning sekaligus
sudo ./start_turbo.sh [iface] [redirect-dev]

# Default: ingress=enp1s0f1np1, egress=enp1s0f0np0
sudo ./start_turbo.sh
```

### Manual (tanpa system tuning)

```bash
sudo ./xdpd \
    -iface enp1s0f1np1 \
    -redirect-dev enp1s0f0np0 \
    -config turbo.json \
    -db /tmp/xdpd.db
```

### Isi `turbo.json`

```json
{
  "firewall_flags": {
    "events_enabled": false
  }
}
```

### Toggle Turbo Mode saat Runtime (REST API)

```bash
# Matikan events → turbo mode
curl -X PUT http://localhost:8080/api/config \
  -H 'Content-Type: application/json' \
  -d '{"flags": {"events_enabled": false}}'

# Nyalakan kembali → observability mode
curl -X PUT http://localhost:8080/api/config \
  -H 'Content-Type: application/json' \
  -d '{"flags": {"events_enabled": true}}'

# Verify
curl -s http://localhost:8080/api/config | python3 -m json.tool
```

### Lihat Stats Live

```bash
# Terminal terpisah saat daemon sudah jalan
sudo ./xdpd -iface enp1s0f1np1 -stats -stats-interval 1
```

---

## Perbandingan Mode

| | Generic Mode | Driver Mode | Driver Mode + Turbo |
|---|:---:|:---:|:---:|
| **XDP attach point** | Setelah `sk_buff` alloc | Di driver, sebelum kernel | Di driver, sebelum kernel |
| **Ring buffer overhead** | Ada (per DROP + sampled) | Ada (per DROP + sampled) | **Nol** |
| **sample_counter lookup** | Setiap paket | Setiap paket | **Nol** |
| **BPF_RB_FORCE_WAKEUP** | Per DROP | Per DROP | **Nol** (disabled) |
| **System tuning** | Tidak | Tidak | **IRQ affinity + perf governor** |
| **ip link output** | `xdpgeneric` | `xdp` | `xdp` |
| **Throughput** | Rendah | Sedang (tanpa tuning bisa turun) | **Maksimal** |
| **SQLite logging** | Aktif | Aktif | Aktif (tapi tidak ada event masuk) |
| **Web UI / REST API** | Aktif | Aktif | Aktif |

---

## File yang Diubah

| File | Perubahan |
|---|---|
| `bpf/common_kern_user.h` | Tambah `FW_CFG_EVENTS_ENABLED=7`, `FW_CFG_MAX=8` |
| `bpf/xdp_prog_kern.c` | Gate semua emit calls, `FORCE_WAKEUP`→`NO_WAKEUP` |
| `internal/maps/config.go` | Tambah `FwCfgEventsEnabled`, `EventsEnabled` di `FwFlags` |
| `internal/config/config.go` | Tambah `EventsEnabled *bool` di `FwFlagsConfig` |
| `internal/xdp/manager.go` | Default events=true, `GenericMode`→`DriverMode` |
| `internal/bpfobj/xdpprog_bpfel.go` | Auto-regenerated via `go generate` |
| `start_turbo.sh` | Script baru: system tuning + launch |
| `turbo.json` | Config baru: `events_enabled: false` |
