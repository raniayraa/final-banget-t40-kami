# Code Snippets Penting — xdp-go-optimized

Kumpulan snippet kode kritis beserta penjelasan konteksnya.

---

## 1. BPF Maps Declaration

> **File:** `bpf/xdp_prog_kern.c`
> **Fungsi file:** Program XDP kernel yang berjalan di NIC — menggabungkan stateless firewall (L3+L4) dan fast forwarder (MAC rewrite + XDP_TX/REDIRECT).
> **Snippet:** Deklarasi seluruh BPF maps yang digunakan kernel program, beserta alasan pemilihan tipe map.

```c
/*
 * xdp_stats — per-CPU packet/byte counter per action.
 * PERCPU_ARRAY menghindari atomic contention di hot path.
 * Userspace menjumlahkan semua CPU saat menampilkan statistik.
 */
struct {
    __uint(type, BPF_MAP_TYPE_PERCPU_ARRAY);
    __type(key,   __u32);
    __type(value, struct stats_rec);
    __uint(max_entries, STAT_MAX);
} xdp_stats SEC(".maps");

/* Firewall: TCP destination ports yang diblokir */
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __type(key,   __u16);
    __type(value, __u8);
    __uint(max_entries, 64);
} blocked_ports_tcp SEC(".maps");

/*
 * fwd_table — forwarding table.
 * Key:   destination IPv4 (network byte order).
 * Value: struct fwd_entry (next-hop MAC, egress MAC, action, port-key).
 */
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __type(key,   __be32);
    __type(value, struct fwd_entry);
    __uint(max_entries, FWD_TABLE_MAX_ENTRIES);
} fwd_table SEC(".maps");

/*
 * packet_events — ring buffer untuk stream per-packet events ke userspace.
 * 256 KB cukup untuk burst traffic; Go consumer membaca dan flush ke SQLite
 * setiap 100ms atau 500 events.
 *
 * Dengan sampling SAMPLE_RATE=1000, volume event turun ~1000x sehingga
 * ring buffer jauh lebih jarang penuh.
 */
struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 256 * 1024);
} packet_events SEC(".maps");

/*
 * sample_counter — per-CPU counter untuk sampling non-security events.
 * PERCPU_ARRAY = masing-masing CPU punya slot sendiri, zero atomic ops.
 */
struct {
    __uint(type, BPF_MAP_TYPE_PERCPU_ARRAY);
    __type(key,   __u32);
    __type(value, __u64);
    __uint(max_entries, 1);
} sample_counter SEC(".maps");
```

---

## 2. Sampling Strategy — Security vs Non-Security Events

> **File:** `bpf/xdp_prog_kern.c`
> **Fungsi file:** Program XDP kernel.
> **Snippet:** Dua fungsi emit event — `emit_event_security()` selalu emit (DROP/TTL), `emit_event_sampled()` hanya emit 1 dari setiap SAMPLE_RATE paket untuk PASS/TX/REDIRECT. Ini adalah inti optimasi throughput.

```c
#define SAMPLE_RATE  1000

/*
 * emit_event_security() — kirim event DROP/TTL_EXCEEDED ke ring buffer.
 * Selalu emit tanpa sampling. Menggunakan BPF_RB_NO_WAKEUP agar wakeup
 * di-batch bersama consumer timer (100ms poll).
 */
static __always_inline void emit_event_security(
    __be32 src_ip, __be32 dst_ip,
    __u16 src_port, __u16 dst_port,
    __u8 protocol, __u8 action, __u16 pkt_len)
{
    struct packet_event ev = {
        .timestamp_ns = bpf_ktime_get_ns(),
        .src_ip       = src_ip,
        .dst_ip       = dst_ip,
        .src_port     = src_port,
        .dst_port     = dst_port,
        .protocol     = protocol,
        .action       = action,
        .pkt_len      = pkt_len,
    };
    bpf_ringbuf_output(&packet_events, &ev, sizeof(ev), BPF_RB_NO_WAKEUP);
}

/*
 * emit_event_sampled() — kirim event PASS/TX/REDIRECT ke ring buffer,
 * hanya untuk 1 dari setiap SAMPLE_RATE paket per CPU.
 * sample_counter adalah PERCPU_ARRAY sehingga tidak ada atomic contention.
 */
static __always_inline void emit_event_sampled(
    __be32 src_ip, __be32 dst_ip,
    __u16 src_port, __u16 dst_port,
    __u8 protocol, __u8 action, __u16 pkt_len)
{
    __u32 key = 0;
    __u64 *counter = bpf_map_lookup_elem(&sample_counter, &key);

    if (!counter)
        return;

    (*counter)++;
    if ((*counter % SAMPLE_RATE) != 0)
        return;

    struct packet_event ev = {
        .timestamp_ns = bpf_ktime_get_ns(),
        .src_ip       = src_ip,
        .dst_ip       = dst_ip,
        .src_port     = src_port,
        .dst_port     = dst_port,
        .protocol     = protocol,
        .action       = action,
        .pkt_len      = pkt_len,
    };
    bpf_ringbuf_output(&packet_events, &ev, sizeof(ev), BPF_RB_NO_WAKEUP);
}
```

---

## 3. TCP Scan Detection

> **File:** `bpf/xdp_prog_kern.c`
> **Fungsi file:** Program XDP kernel.
> **Snippet:** Deteksi teknik port scanning berbasis kombinasi TCP flags yang tidak valid secara RFC (NULL scan, XMAS scan, SYN+FIN, RST+FIN).

```c
/*
 * tcp_flags_malformed() — deteksi TCP scan techniques:
 *   NULL scan  : tidak ada flag (probe untuk bypass firewall)
 *   XMAS scan  : FIN + PSH + URG
 *   SYN + FIN  : kontradiktif (tidak valid per RFC)
 *   RST + FIN  : kontradiktif (dipakai scanning tools)
 */
static __always_inline int tcp_flags_malformed(struct tcphdr *tcph)
{
    if (!tcph->fin && !tcph->syn && !tcph->rst &&
        !tcph->psh && !tcph->ack && !tcph->urg)
        return 1;
    if (tcph->fin && tcph->psh && tcph->urg)
        return 1;
    if (tcph->syn && tcph->fin)
        return 1;
    if (tcph->rst && tcph->fin)
        return 1;
    return 0;
}
```

---

## 4. XDP Main Program — Alur Paket Lengkap

> **File:** `bpf/xdp_prog_kern.c`
> **Fungsi file:** Program XDP kernel.
> **Snippet:** Fungsi utama `xdp_firewall_fwd` — entry point XDP. Mencakup alur lengkap dari parsing Ethernet hingga forwarding decision (DROP/PASS/XDP_TX/REDIRECT).

```c
SEC("xdp")
int xdp_firewall_fwd(struct xdp_md *ctx)
{
    void *data_end = (void *)(long)ctx->data_end;
    void *data     = (void *)(long)ctx->data;
    __u32 pkt_len  = (__u32)(ctx->data_end - ctx->data);

    /*
     * Cek events_enabled SEKALI di awal, simpan di local variable.
     * Kalau 0 (turbo mode): skip seluruh ring buffer + sample_counter overhead.
     */
    int events_enabled = fw_cfg_enabled(FW_CFG_EVENTS_ENABLED);

    /* ── Step 1: Ethernet ─── */
    eth_type = parse_ethhdr(&nh, data_end, &eth);
    if (eth_type != bpf_htons(ETH_P_IP)) {
        stats_update(STAT_PASS, pkt_len);
        if (events_enabled)
            emit_event_sampled(0, 0, 0, 0, 0, PKT_ACTION_PASS, (__u16)pkt_len);
        return XDP_PASS;
    }

    /* ── Step 3: Firewall L3 — fragment/broadcast/multicast/proto ─── */
    if (fw_cfg_enabled(FW_CFG_BLOCK_IP_FRAGMENTS) &&
        (iph->frag_off & bpf_htons(IP_MF | IP_OFFSET))) {
        stats_update(STAT_DROP, pkt_len);
        if (events_enabled)
            emit_event_security(iph->saddr, iph->daddr, 0, 0, iph->protocol, PKT_ACTION_DROP, (__u16)pkt_len);
        return XDP_DROP;
    }

    /* ── Step 4+5: TCP malformed flags + blocked ports ─── */
    if (fw_cfg_enabled(FW_CFG_BLOCK_MALFORMED_TCP) &&
        tcp_flags_malformed(tcph)) {
        stats_update(STAT_DROP, pkt_len);
        if (events_enabled)
            emit_event_security(iph->saddr, iph->daddr, l4_sport, l4_dport, IPPROTO_TCP, PKT_ACTION_DROP, (__u16)pkt_len);
        return XDP_DROP;
    }

    /* ── Step 6: TTL Guard ─── */
    if (iph->ttl <= 1) {
        stats_update(STAT_TTL_EXCEEDED, pkt_len);
        if (events_enabled)
            emit_event_security(iph->saddr, iph->daddr, l4_sport, l4_dport, iph->protocol, PKT_ACTION_TTL_EXCEEDED, (__u16)pkt_len);
        return XDP_PASS; /* kernel kirim ICMP TTL Exceeded */
    }

    /* ── Step 7: Forwarding Table Lookup ─── */
    entry = bpf_map_lookup_elem(&fwd_table, &iph->daddr);
    if (!entry) {
        stats_update(STAT_PASS, pkt_len);
        if (events_enabled)
            emit_event_sampled(iph->saddr, iph->daddr, l4_sport, l4_dport, iph->protocol, PKT_ACTION_PASS, (__u16)pkt_len);
        return XDP_PASS;
    }

    /* ── Step 8: MAC Rewrite + TTL Decrement ─── */
    memcpy(eth->h_dest,   entry->dst_mac, ETH_ALEN);
    memcpy(eth->h_source, entry->src_mac, ETH_ALEN);
    ip_decrease_ttl(iph);

    /* ── Step 9: Forward ─── */
    if (entry->action == FWD_ACTION_TX) {
        stats_update(STAT_TX, pkt_len);
        if (events_enabled)
            emit_event_sampled(iph->saddr, iph->daddr, l4_sport, l4_dport, iph->protocol, PKT_ACTION_TX, (__u16)pkt_len);
        return XDP_TX;
    }

    stats_update(STAT_REDIRECT, pkt_len);
    if (events_enabled)
        emit_event_sampled(iph->saddr, iph->daddr, l4_sport, l4_dport, iph->protocol, PKT_ACTION_REDIRECT, (__u16)pkt_len);
    return bpf_redirect_map(&tx_port, entry->tx_port_key, XDP_PASS);
}
```

---

## 5. Shared Structs — Kernel ↔ Userspace ABI

> **File:** `bpf/common_kern_user.h`
> **Fungsi file:** Header bersama yang mendefinisikan struct dan enum yang dipakai oleh kernel program (C) dan userspace control plane (Go). Ini adalah "kontrak" antar kedua sisi.
> **Snippet:** Struct `fwd_entry` (forwarding table row), `packet_event` (ring buffer event), dan enum `fw_config_key` (feature flags firewall).

```c
/*
 * enum fw_config_key — index ke fw_config BPF_MAP_TYPE_ARRAY.
 * Setiap key menyimpan nilai 0 (off) atau 1 (on).
 */
enum fw_config_key {
    FW_CFG_BLOCK_ICMP_PING     = 0,
    FW_CFG_BLOCK_IP_FRAGMENTS  = 1,
    FW_CFG_BLOCK_MALFORMED_TCP = 2,
    FW_CFG_BLOCK_ALL_TCP       = 3,
    FW_CFG_BLOCK_ALL_UDP       = 4,
    FW_CFG_BLOCK_BROADCAST     = 5,
    FW_CFG_BLOCK_MULTICAST     = 6,
    FW_CFG_EVENTS_ENABLED      = 7,  /* 0 = turbo mode (no ring buf overhead) */
    FW_CFG_MAX
};

/*
 * struct fwd_entry — satu baris di forwarding table (BPF map value).
 * dst_mac: MAC next-hop yang menggantikan eth->h_dest.
 * src_mac: MAC interface egress yang menggantikan eth->h_source.
 */
struct fwd_entry {
    __u8  dst_mac[6];
    __u8  src_mac[6];
    __u32 tx_port_key;
    __u8  action;
    __u8  _pad[3];
};

/*
 * struct packet_event — satu event paket yang dikirim ke userspace via ring buffer.
 * Total size: 24 bytes (aligned).
 * src_port/dst_port = 0 untuk drop di L3 karena L4 belum di-parse.
 */
struct packet_event {
    __u64  timestamp_ns;
    __be32 src_ip;
    __be32 dst_ip;
    __u16  src_port;
    __u16  dst_port;
    __u8   protocol;
    __u8   action;
    __u16  pkt_len;
    __u8   _pad[4];
};
```

---

## 6. Packet Header Parser — Bounds-Checked

> **File:** `bpf/headers/parsing_helpers.h`
> **Fungsi file:** Header-only helpers untuk mem-parse header Ethernet, IPv4, TCP, UDP, ICMP. Semua fungsi `__always_inline` dan wajib lolos BPF verifier bounds check.
> **Snippet:** `parse_iphdr` dan `parse_tcphdr` — contoh pola bounds checking yang dibutuhkan verifier BPF untuk akses pointer ke paket.

```c
static __always_inline int parse_iphdr(struct hdr_cursor *nh,
                                        void *data_end,
                                        struct iphdr **iphdr)
{
    struct iphdr *iph = nh->pos;
    int hdrsize;

    if (iph + 1 > data_end)
        return -1;

    hdrsize = iph->ihl * 4;
    if (hdrsize < sizeof(*iph))  /* sanity: IHL minimum 5 (20 bytes) */
        return -1;

    /* Variable-length IPv4 header — pakai byte arithmetic, bukan pointer+1 */
    if (nh->pos + hdrsize > data_end)
        return -1;

    nh->pos += hdrsize;
    *iphdr = iph;
    return iph->protocol;
}

static __always_inline int parse_tcphdr(struct hdr_cursor *nh,
                                         void *data_end,
                                         struct tcphdr **tcphdr)
{
    int len;
    struct tcphdr *h = nh->pos;

    if (h + 1 > data_end)
        return -1;

    len = h->doff * 4;
    if (len < sizeof(*h))   /* sanity: doff minimum 5 (20 bytes) */
        return -1;

    if (nh->pos + len > data_end)
        return -1;

    nh->pos += len;
    *tcphdr = h;
    return len;
}
```

---

## 7. XDP Manager — Load, Attach, Pin Maps

> **File:** `internal/xdp/manager.go`
> **Fungsi file:** Go package yang mengelola lifecycle XDP kernel program — load BPF object, pin maps ke `/sys/fs/bpf/`, attach ke NIC, dan detach saat stop.
> **Snippet:** Method `Start()` — seluruh alur dari load BPF object hingga seed default config ke maps, termasuk attach egress pass program untuk DEVMAP redirect.

```go
// Start loads the BPF object, pins all maps under /sys/fs/bpf/<ifname>/,
// attaches the XDP program to the ingress NIC, seeds default blocked port
// lists, and applies any startup config.
func (m *Manager) Start() error {
    m.mu.Lock()
    defer m.mu.Unlock()

    opts := &ebpf.CollectionOptions{
        Maps: ebpf.MapOptions{PinPath: m.pinDir},
    }
    if err := bpfobj.LoadXdpProgObjects(&m.objs, opts); err != nil {
        return fmt.Errorf("load BPF objects: %w", err)
    }

    // Explicit pin — cilium/ebpf tidak auto-pin kecuali BPF C spec
    // set __uint(pinning, LIBBPF_PIN_BY_NAME).
    if err := m.pinMaps(); err != nil {
        m.objs.Close()
        return fmt.Errorf("pin maps: %w", err)
    }

    // Detach existing program before attaching ours.
    _ = exec.Command("ip", "link", "set", "dev", m.ifname, "xdp", "off").Run()

    m.xdpLink, err = link.AttachXDP(link.XDPOptions{
        Program:   m.objs.XdpFirewallFwd,
        Interface: iface.Index,
        Flags:     link.XDPDriverMode,
    })

    // Default: events enabled (observability mode).
    // User bisa matikan untuk turbo mode via PUT /api/config.
    if err := maps.SetFlag(m.objs.FwConfig, maps.FwCfgEventsEnabled, true); err != nil {
        log.Printf("warn: set events_enabled default: %v", err)
    }

    // Seed default blocked port lists only when maps are fresh.
    if existing, _ := maps.ListPorts(m.objs.BlockedPortsTcp); len(existing) == 0 {
        maps.SetPorts(m.objs.BlockedPortsTcp, maps.DefaultTCPPorts)
    }

    // Kernel 5.9+: DEVMAP redirect requires an XDP program on egress NIC.
    if redirectDev != "" {
        if err := m.attachEgressPass(redirectDev); err != nil {
            log.Printf("warn: attach egress XDP pass to %s: %v", redirectDev, err)
        }
    }
    return nil
}
```

---

## 8. Egress Pass Program — Minimal BPF via Go ASM

> **File:** `internal/xdp/manager.go`
> **Fungsi file:** XDP Manager.
> **Snippet:** `attachEgressPass()` — membuat program XDP minimal (hanya `return XDP_PASS`) secara programatik menggunakan cilium/ebpf assembler, lalu melampirkannya ke NIC egress. Diperlukan kernel 5.9+ agar `bpf_redirect_map()` ke DEVMAP tidak silently drop.

```go
// attachEgressPass creates a minimal XDP_PASS program and attaches it to the
// egress NIC. Required on Linux 5.9+ for bpf_redirect_map() with DEVMAP:
// without an XDP program on the target device, the kernel silently drops.
func (m *Manager) attachEgressPass(ifname string) error {
    passSpec := &ebpf.ProgramSpec{
        Name:    "xdp_pass",
        Type:    ebpf.XDP,
        License: "GPL",
        Instructions: asm.Instructions{
            asm.Mov.Imm(asm.R0, 2), // XDP_PASS = 2
            asm.Return(),
        },
    }
    passProg, err := ebpf.NewProgram(passSpec)
    if err != nil {
        return fmt.Errorf("create xdp_pass program: %w", err)
    }
    defer passProg.Close() // link holds its own reference after AttachXDP

    _ = exec.Command("ip", "link", "set", "dev", ifname, "xdp", "off").Run()

    egressLnk, err := link.AttachXDP(link.XDPOptions{
        Program:   passProg,
        Interface: iface.Index,
        Flags:     link.XDPDriverMode,
    })
    m.egressLink = egressLnk
    return nil
}
```

---

## 9. Ring Buffer Consumer — Batched SQLite Write

> **File:** `internal/maps/ringbuf.go`
> **Fungsi file:** Go package yang membaca events dari BPF ring buffer dan mem-persist-nya ke SQLite dalam batch. Berjalan sebagai goroutine yang di-cancel via context.
> **Snippet:** `ConsumeRingBuf()` — strategi batching 500 events atau 100ms flush interval, mana yang lebih dahulu.

```go
// ConsumeRingBuf reads packet events from the BPF ring buffer and persists
// them to SQLite in batches. Blocks until ctx is cancelled.
//
// Batching strategy: flush every 100ms or when 500 events accumulate,
// whichever comes first.
func ConsumeRingBuf(ctx context.Context, m *ebpf.Map, store *db.Store) error {
    rd, _ := ringbuf.NewReader(m)

    // Close the reader when ctx is done to unblock the Read() call.
    go func() {
        <-ctx.Done()
        rd.Close()
    }()
    defer rd.Close()

    const batchSize = 500
    const flushInterval = 100 * time.Millisecond

    buf    := make([]db.TrafficLog, 0, batchSize)
    ticker := time.NewTicker(flushInterval)

    flush := func() {
        if len(buf) == 0 { return }
        _ = store.BatchInsert(context.Background(), buf)
        buf = buf[:0]
    }

    for {
        record, err := rd.Read()
        if err != nil {
            if errors.Is(err, ringbuf.ErrClosed) {
                flush()
                return nil
            }
            select {
            case <-ticker.C: flush()
            default:
            }
            continue
        }

        var ev packetEvent
        binary.Read(bytes.NewReader(record.RawSample), binary.LittleEndian, &ev)
        buf = append(buf, toTrafficLog(ev))

        if len(buf) >= batchSize {
            flush()
        } else {
            select {
            case <-ticker.C: flush()
            default:
            }
        }
    }
}
```

---

## 10. Forwarding Table — IP Key Endianness

> **File:** `internal/maps/routes.go`
> **Fungsi file:** Typed wrapper di Go untuk operasi CRUD pada BPF forwarding table (`fwd_table` hash map).
> **Snippet:** `ipToKey()` dan `AddRoute()` — penanganan endianness IP address agar lookup di kernel (yang menggunakan `__be32 iph->daddr`) selalu match dengan key yang ditulis dari userspace.

```go
// ipToKey converts a dotted-decimal IP string to a 4-byte BPF map key.
// Bytes disimpan dalam network (big-endian) order agar match dengan iph->daddr kernel.
// cilium/ebpf serialises [4]byte verbatim — berbeda dengan uint32 yang di-swap
// di host little-endian, yang akan menyebabkan permanent lookup mismatch.
func ipToKey(s string) ([4]byte, error) {
    ip := net.ParseIP(s)
    if ip == nil {
        return [4]byte{}, fmt.Errorf("invalid IP: %s", s)
    }
    ip4 := ip.To4()
    if ip4 == nil {
        return [4]byte{}, fmt.Errorf("IPv6 not supported: %s", s)
    }
    return [4]byte{ip4[0], ip4[1], ip4[2], ip4[3]}, nil
}

// AddRoute inserts or updates a forwarding table entry.
func AddRoute(fwdMap *ebpf.Map, r RouteEntry) error {
    key, err    := ipToKey(r.IP)
    dstMAC, err := parseMACBytes(r.DstMAC)
    srcMAC, err := parseMACBytes(r.SrcMAC)

    action := FwdActionRedirect
    if strings.ToLower(r.Action) == "tx" {
        action = FwdActionTX
    }
    entry := FwdEntry{
        DstMAC:    dstMAC,
        SrcMAC:    srcMAC,
        TxPortKey: r.TxPortKey,
        Action:    action,
    }
    return fwdMap.Put(key, entry)
}
```

---

## 11. Per-CPU Stats Aggregation

> **File:** `internal/maps/stats.go`
> **Fungsi file:** Membaca dan mengaggregasi `xdp_stats` BPF PERCPU_ARRAY map — menjumlahkan semua CPU slice untuk mendapatkan total counter per action.
> **Snippet:** `ReadStats()` — cara membaca PERCPU_ARRAY dari Go: allocate slice sepanjang `numCPU`, lakukan `Lookup`, kemudian sum semua elemen.

```go
// ReadStats reads and aggregates the xdp_stats PERCPU_ARRAY map.
func ReadStats(m *ebpf.Map) (*StatsMap, error) {
    numCPU, err := ebpf.PossibleCPU()
    if err != nil {
        return nil, fmt.Errorf("get cpu count: %w", err)
    }

    result := &StatsMap{}
    recs := []*StatsRec{
        &result.Drop, &result.TX, &result.Redirect,
        &result.Pass, &result.TTLExceeded,
    }

    for key := uint32(0); key < StatMax; key++ {
        // Lookup PERCPU_ARRAY: kernel returns one value per CPU.
        perCPU := make([]perCPUStatsRec, numCPU)
        if err := m.Lookup(key, &perCPU); err != nil {
            continue
        }
        // Sum all CPU slices into single aggregate.
        for _, cpu := range perCPU {
            recs[key].Packets += cpu.Packets
            recs[key].Bytes   += cpu.Bytes
        }
    }
    return result, nil
}
```

---

## 12. SQLite Schema + WAL Mode

> **File:** `internal/db/db.go`
> **Fungsi file:** Persistence layer — membuka (atau membuat) database SQLite untuk menyimpan traffic logs dari ring buffer.
> **Snippet:** Schema DDL dan `Open()` — penggunaan WAL mode (`_journal_mode=WAL`) agar ring buffer writer dan HTTP API reader bisa berjalan concurrent tanpa blocking.

```go
const schema = `
CREATE TABLE IF NOT EXISTS traffic_logs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp_ns INTEGER NOT NULL,
    src_ip       TEXT    NOT NULL,
    dst_ip       TEXT    NOT NULL,
    src_port     INTEGER NOT NULL DEFAULT 0,
    dst_port     INTEGER NOT NULL DEFAULT 0,
    protocol     INTEGER NOT NULL,
    action       INTEGER NOT NULL,
    pkt_len      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ts   ON traffic_logs(timestamp_ns);
CREATE INDEX IF NOT EXISTS idx_act  ON traffic_logs(action);
CREATE INDEX IF NOT EXISTS idx_prot ON traffic_logs(protocol);
`

// Open opens (or creates) the SQLite database at path.
// WAL mode enables concurrent readers alongside the ring-buffer writer.
func Open(path string) (*Store, error) {
    dsn := fmt.Sprintf(
        "file:%s?_journal_mode=WAL&_busy_timeout=5000&_synchronous=NORMAL",
        path,
    )
    db, err := sql.Open("sqlite", dsn)

    // Allow one writer and multiple readers concurrently.
    db.SetMaxOpenConns(1)

    if _, err := db.Exec(schema); err != nil {
        db.Close()
        return nil, fmt.Errorf("apply schema: %w", err)
    }
    return &Store{db: db}, nil
}
```

---

## 13. HTTP API Router

> **File:** `internal/api/server.go`
> **Fungsi file:** HTTP REST API server menggunakan chi router — mendaftarkan semua endpoint `/api/*` dan menyajikan React build sebagai SPA.
> **Snippet:** `Router()` — peta lengkap semua endpoint REST dan SPA fallback handler untuk client-side routing React.

```go
// Router builds and returns the chi router with all API routes.
func (s *Server) Router(staticDir string) http.Handler {
    r := chi.NewRouter()
    r.Use(middleware.Logger)
    r.Use(middleware.Recoverer)
    r.Use(corsMiddleware)

    r.Route("/api", func(r chi.Router) {
        r.Get("/status",           s.handleStatus)
        r.Post("/start",           s.handleStart)
        r.Post("/stop",            s.handleStop)
        r.Post("/restart",         s.handleRestart)
        r.Get("/config",           s.handleGetConfig)
        r.Put("/config",           s.handlePutConfig)
        r.Get("/stats/live",       s.handleStatsLive)
        r.Get("/logs",             s.handleLogs)
        r.Get("/routes",           s.handleGetRoutes)
        r.Post("/routes",          s.handlePostRoute)
        r.Delete("/routes/{ip}",   s.handleDeleteRoute)
        r.Get("/devmap",           s.handleGetDevmap)
        r.Post("/devmap",          s.handlePostDevmap)
        r.Delete("/devmap/{slot}", s.handleDeleteDevmap)
        r.Get("/system/cpu",       s.handleGetCPU)
        r.Put("/system/cpu",       s.handlePutCPU)
        r.Get("/system/settings",  s.handleGetSettings)
        r.Put("/system/settings",  s.handlePutSettings)
    })

    // Serve React build; fall back to index.html for SPA routing.
    r.Handle("/*", spaHandler(staticDir))
    return r
}
```

---

## 14. XDP Start/Stop Lifecycle — Goroutine Management

> **File:** `internal/api/control.go`
> **Fungsi file:** HTTP handlers untuk kontrol lifecycle XDP program (start, stop, restart) via REST API.
> **Snippet:** `handleStart()` — menampilkan pola start XDP manager + launch goroutine ring buffer consumer dengan context yang bisa di-cancel saat stop.

```go
// handleStart attaches the XDP program and starts the ring buffer consumer.
func (s *Server) handleStart(w http.ResponseWriter, r *http.Request) {
    s.mu.Lock()
    defer s.mu.Unlock()

    if s.mgr.IsAttached() {
        writeError(w, http.StatusConflict, "XDP already running")
        return
    }

    if err := s.mgr.Start(); err != nil {
        writeError(w, http.StatusInternalServerError, "start failed: "+err.Error())
        return
    }

    // Launch ring buffer consumer goroutine with cancellable context.
    // Context disimpan agar bisa di-cancel saat handleStop dipanggil.
    ctx, cancel := context.WithCancel(context.Background())
    s.rbufCancel = cancel
    go func() {
        _ = maps.ConsumeRingBuf(ctx, s.mgr.Objects().PacketEvents, s.store)
    }()

    writeJSON(w, http.StatusOK, map[string]string{"status": "started"})
}
```

---

## 15. Query Language — Tokenizer + Parser (Frontend)

> **File:** `frontend/src/utils/queryLang.ts`
> **Fungsi file:** Implementasi mini query language bergaya Palo Alto Panorama untuk memfilter traffic logs di frontend. Mendukung ekspresi seperti `addr.src in 192.168.0.0/24 and action eq drop`.
> **Snippet:** Tokenizer dan struktur AST — inti dari recursive descent parser yang menghasilkan AST untuk dievaluasi terhadap setiap baris log.

```typescript
// AST node types
type ASTNode =
  | { kind: 'compare'; field: FieldName; op: Operator; value: string }
  | { kind: 'logical'; op: 'and' | 'or'; left: ASTNode; right: ASTNode }
  | { kind: 'not'; operand: ASTNode }

const FIELDS = new Set(['addr.src', 'addr.dst', 'port.src', 'port.dst', 'proto', 'action'])
const OPS    = new Set(['eq', 'neq', 'in', 'gt', 'lt', 'geq', 'leq'])

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < input.length) {
    if (/\s/.test(input[i])) { i++; continue }
    if (input[i] === '(') { tokens.push({ kind: 'LPAREN', value: '(', pos: i }); i++; continue }
    if (input[i] === ')') { tokens.push({ kind: 'RPAREN', value: ')', pos: i }); i++; continue }

    const start = i
    while (i < input.length && !/[\s()]/.test(input[i])) i++
    const lower = input.slice(start, i).toLowerCase()

    let kind: TokenKind
    if (FIELDS.has(lower))    kind = 'FIELD'
    else if (OPS.has(lower))  kind = 'OP'
    else if (lower === 'and') kind = 'AND'
    else if (lower === 'or')  kind = 'OR'
    else if (lower === 'not') kind = 'NOT'
    else                      kind = 'VALUE'

    tokens.push({ kind, value: input.slice(start, i), pos: start })
  }
  tokens.push({ kind: 'EOF', value: '', pos: i })
  return tokens
}

// Recursive descent: OR → AND → NOT → Atom
private parseOr(): ASTNode {
  let left = this.parseAnd()
  while (this.peek().kind === 'OR') {
    this.consume()
    const right = this.parseAnd()
    left = { kind: 'logical', op: 'or', left, right }
  }
  return left
}

// CIDR matching untuk operator 'in'
function cidrContains(cidr: string, ip: string): boolean {
  const slash   = cidr.indexOf('/')
  if (slash === -1) return ip === cidr
  const prefix  = parseInt(cidr.slice(slash + 1), 10)
  const mask    = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0
  const network = ipToUint32(cidr.slice(0, slash)) & mask
  const target  = ipToUint32(ip) & mask
  return network === target
}
```

---

## 16. Typed REST API Client (Frontend)

> **File:** `frontend/src/api/client.ts`
> **Fungsi file:** Typed HTTP client untuk semua endpoint REST API xdpd. Dipakai oleh seluruh halaman React (Monitoring, FirewallConfig, Routes).
> **Snippet:** Interface TypeScript utama dan fungsi `fetchJSON` yang menjadi backbone semua API call.

```typescript
export interface TrafficLog {
  id: number
  timestamp_ns: number
  src_ip: string
  dst_ip: string
  src_port: number
  dst_port: number
  protocol: number
  action: number
  pkt_len: number
}

export interface RouteEntry {
  ip: string
  dst_mac: string
  src_mac: string
  action: 'tx' | 'redirect'
  port_key: number
}

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  if (!r.ok) {
    const text = await r.text()
    throw new Error(text || `HTTP ${r.status}`)
  }
  return r.json()
}

export const api = {
  getStatus:   () => fetchJSON<StatusResponse>(`/api/status`),
  start:       () => fetchJSON<{ status: string }>(`/api/start`, { method: 'POST' }),
  stop:        () => fetchJSON<{ status: string }>(`/api/stop`,  { method: 'POST' }),
  getStatsLive:() => fetchJSON<LiveStats>(`/api/stats/live`),
  getLogs: (params: { action?: number; proto?: number; range?: string; limit?: number }) => {
    const q = new URLSearchParams()
    if (params.action !== undefined) q.set('action', String(params.action))
    if (params.proto  !== undefined) q.set('proto',  String(params.proto))
    if (params.range)                q.set('range',  params.range)
    if (params.limit)                q.set('limit',  String(params.limit))
    return fetchJSON<TrafficLog[]>(`/api/logs?${q}`)
  },
  addRoute:    (r: RouteEntry) =>
    fetchJSON<RouteEntry>(`/api/routes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(r),
    }),
}
```
