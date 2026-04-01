# Dokumentasi Implementasi (T40)
## Design and Implementation of In-Kernel Fast Path Data Plane Using eBPF/XDP for High-Performance Networking

---

## 3. IMPLEMENTASI DESAIN

Implementasi sistem terdiri dari tiga subsistem utama yang saling terintegrasi:

1. **Subsistem Dashboard Otomatisasi dan Visualisasi**
2. **Subsistem Eksperimen eBPF/XDP**
3. **Subsistem Orkestrasi dan Otomasi Testbed Multi-Node**

Ketiganya mengacu pada persyaratan desain yang telah ditetapkan pada dokumen T20, yaitu dua objektif utama (Fleksibel & Efisien; Terotomasi & Informatif), empat constraint, dan tiga fungsi subsistem.

---

## 3.1 Subsistem 1 — Dashboard Otomatisasi dan Visualisasi

### Keterkaitan dengan T20

| T20 | Keterkaitan |
|-----|-------------|
| **Objektif 2** — Terotomasi dan Informatif | Dashboard menyediakan antarmuka terpusat untuk kontrol dan monitoring real-time |
| **Subobjektif 4** — Visualisasi hasil eksperimen dan metrik performa | Halaman Monitoring menampilkan throughput, packet rate, dan traffic logs |
| **Constraint Subobjektif 4** | Dashboard menampilkan minimal 3 metrik utama: throughput (Mbps), packet rate (pps), dan CPU usage |
| **PF 1** | Dashboard menyediakan inventarisasi hasil eksperimen dan kontrol eksperimen baru |
| **PF 4** | Dashboard menampilkan hasil eksperimen eBPF/XDP secara visual (grafik, tabel, log) |

### Arsitektur Subsistem

Subsistem Dashboard terdiri dari dua lapisan:

- **Backend REST API** — Go HTTP server (`internal/api/`) yang melayani semua permintaan data dari frontend
- **Frontend Web UI** — React + TypeScript (`frontend/`) yang dibangun dengan Vite dan di-serve langsung oleh daemon

```
Browser ──── HTTP ────► Go Daemon (:8081)
                          │
                    ┌─────┴──────────┐
                    │  React SPA     │  ← static files dari frontend/dist/
                    │  REST API      │  ← /api/* endpoints
                    └─────┬──────────┘
                          │
                    ┌─────┴──────────┐
                    │  BPF Maps      │  ← xdp_stats, fwd_table, fw_config
                    │  SQLite DB     │  ← traffic_logs
                    └────────────────┘
```

### Implementasi Backend REST API

REST API diimplementasikan menggunakan framework `go-chi/chi` dengan total 18 endpoint yang dikelompokkan berdasarkan domain:

**Tabel Endpoint REST API:**

| Endpoint | Method | Fungsi |
|----------|--------|--------|
| `/api/status` | GET | Status daemon, XDP attached, interface, pinned maps |
| `/api/start` | POST | Attach XDP ke NIC, mulai ring buffer consumer |
| `/api/stop` | POST | Detach XDP, stop ring buffer |
| `/api/restart` | POST | Stop + start ulang |
| `/api/config` | GET | Baca firewall flags, blocked ports, protocols |
| `/api/config` | PUT | Update firewall flags/ports/protocols (partial) |
| `/api/stats/live` | GET | Baca xdp_stats PERCPU_ARRAY (aggregated) |
| `/api/logs` | GET | Query SQLite traffic logs (filter: action, proto, range, limit) |
| `/api/routes` | GET/POST | List/tambah forwarding route |
| `/api/routes/{ip}` | DELETE | Hapus route |
| `/api/devmap` | GET/POST | List/tambah egress NIC slot |
| `/api/devmap/{slot}` | DELETE | Hapus slot |
| `/api/system/cpu` | GET/PUT | Baca/set CPU affinity (taskset + IRQ pinning) |
| `/api/system/settings` | GET/PUT | Baca/ganti interface (stop–reconfigure–start otomatis) |

**Pseudocode — Handler `/api/start`:**
```
FUNCTION handleStart(request, response):
    LOCK server.mutex
    IF manager.IsAttached():
        RETURN error "XDP already running"
    
    IF manager.Start() FAILS:
        RETURN error "start failed: <detail>"
    
    ctx, cancel = context.WithCancel()
    server.rbufCancel = cancel
    
    GO ROUTINE:
        maps.ConsumeRingBuf(ctx, packetEventsMap, sqliteStore)
    
    RETURN status "started"
    UNLOCK server.mutex
```

**Pseudocode — Handler `/api/system/cpu` (PUT):**
```
FUNCTION handlePutCPU(request, response):
    DECODE JSON body → { num_cpus: N }
    max = runtime.NumCPU()
    
    IF N < 1 OR N > max:
        RETURN error "num_cpus must be between 1 and max"
    
    cpuList = "0" IF N==1 ELSE "0-{N-1}"
    
    // Step 1: Pin daemon process
    EXEC "taskset -cp {cpuList} {os.Getpid()}"
    
    // Step 2: Reduce NIC queues
    EXEC "ethtool -L {iface} combined {N}"
    EXEC "ethtool -L {redirectDev} combined {N}"
    
    // Step 3: Pin IRQ per queue to dedicated CPU
    FOR each IRQ in /proc/interrupts matching {iface}:
        cpu = i % N
        WRITE hex(1 << cpu) to /proc/irq/{IRQ}/smp_affinity
    
    RETURN { num_cpus: N, max_cpus: max }
```

### Implementasi Frontend

Frontend dibangun dengan React + TypeScript dan terdiri dari tiga halaman utama:

**Gambar 3.1 — Halaman Firewall Configuration**

Halaman ini menampilkan:
- Badge status XDP (running/stopped) dan tombol Start/Stop
- **CPU Affinity Slider** — mengatur jumlah CPU yang aktif (1 hingga max CPU sistem) secara real-time
- **Feature Flags** — 7 toggle switch untuk enable/disable aturan firewall
- **Blocked Ports** — editor daftar port TCP dan UDP yang diblokir
- **Blocked Protocols** — editor nomor protokol IP yang diblokir

**Gambar 3.2 — Halaman Monitoring**

Halaman ini menampilkan:
- **Live Stats Chart** — line chart 60-detik untuk DROP pps, PASS pps, TX pps, REDIRECT pps, dan total throughput (Mbps), di-refresh setiap 2 detik
- **Traffic Logs Table** — tabel paket dari SQLite dengan kolom: timestamp, src IP:port, dst IP:port, protocol, action, pkt_len
- **Filter Controls** — filter berdasarkan action (DROP/PASS/TX/REDIRECT/TTL_EXCEEDED), protocol (TCP/UDP/ICMP), dan rentang waktu (30s hingga 24h)
- **Query Language** — DSL sederhana untuk filter kompleks (`src_ip == 10.0.0.1 AND action == 0`)

**Gambar 3.3 — Halaman Routes**

Halaman ini menampilkan:
- **Forwarding Table** — tabel entri routing: dst IP, dst MAC, src MAC, action (TX/REDIRECT), port key
- **Add/Delete Route** — form untuk menambah rute baru, tombol hapus per entri
- **DEVMAP Manager** — tabel slot egress NIC (slot index → interface name), dengan tombol tambah/hapus

**Pseudocode — Komponen CPU Slider (React):**
```
COMPONENT CPUSlider:
    STATE: cpu (CPUResponse | null), sliderVal, saving
    
    ON MOUNT:
        cpuInfo = await api.getCPU()
        SET cpu = cpuInfo
        SET sliderVal = cpuInfo.num_cpus
    
    FUNCTION applyCPU(n):
        SET saving = true
        result = await api.putCPU(n)
        SET cpu = result
        SET sliderVal = result.num_cpus
        FLASH "CPU affinity set to {n} cores (CPU 0–{n-1})"
        SET saving = false
    
    RENDER:
        LABEL "1"
        SLIDER min=1 max=cpu.max_cpus value=sliderVal
        LABEL "{cpu.max_cpus}"
        BADGE "{sliderVal} / {cpu.max_cpus} CPUs"
        BUTTON [disabled IF saving OR sliderVal==cpu.num_cpus]
            onClick → applyCPU(sliderVal)
```

---

## 3.2 Subsistem 2 — Eksperimen eBPF/XDP

### Keterkaitan dengan T20

| T20 | Keterkaitan |
|-----|-------------|
| **Objektif 1** — Fleksibel dan Efisien | XDP program berjalan di level kernel driver, tanpa overhead sk_buff allocation |
| **Subobjektif 1** — Implementasi kernel bypass berbasis eBPF/XDP | Program `xdp_prog_kern.c` diload ke kernel via cilium/ebpf, attached ke NIC dalam native driver mode |
| **Subobjektif 2** — Meminimalkan overhead pemrosesan | CPU usage idle <5%; ring buffer hanya emit 1:1000 paket (sampling), DROP selalu di-emit; tidak ada busy-polling |
| **Constraint Subobjektif 1** | Sistem mendukung eksekusi dan pengukuran eksperimen berbasis eBPF/XDP |
| **Constraint Subobjektif 2** | CPU usage proporsional terhadap beban trafik, tanpa busy-polling |
| **PF 2** | Sistem menjalankan eksperimen eBPF/XDP di testbed dan mencatat throughput, latensi, CPU usage |

### Arsitektur Subsistem

Subsistem eBPF/XDP terdiri dari empat komponen:

```
┌────────────────────────────────────────────────────────────────┐
│  NIC (ingress: enp1s0f1np1)                                    │
│                                                                 │
│  eBPF XDP Program (xdp_prog_kern.c) — di dalam kernel         │
│  ├── BPF Maps (xdp_stats, fw_config, fwd_table, tx_port, ...) │
│  └── Ring Buffer (packet_events) → userspace consumer          │
│                                                                 │
│  NIC (egress: enp1s0f0np0) — XDP_REDIRECT target              │
└────────────────────────────────────────────────────────────────┘
          ↑ load & attach via cilium/ebpf
┌────────────────────────────────────────────────────────────────┐
│  Go Daemon (xdpd)                                              │
│  ├── XDP Manager  (internal/xdp/manager.go)                   │
│  ├── BPF Map OPs  (internal/maps/)                             │
│  └── Ring Buffer Consumer → SQLite batch insert               │
└────────────────────────────────────────────────────────────────┘
```

### Implementasi eBPF Kernel Program

Program eBPF ditulis dalam C (`bpf/xdp_prog_kern.c`) dan dikompilasi ke bytecode BPF menggunakan `clang` + `bpf2go`. Binding Go otomatis di-generate ke `internal/bpfobj/`.

**BPF Maps yang Digunakan:**

| Map | Tipe | Max Entries | Fungsi |
|-----|------|-------------|--------|
| `xdp_stats` | PERCPU_ARRAY | 5 | Counter paket/bytes per action, per CPU |
| `fw_config` | ARRAY | 8 | Feature flags on/off (firewall rules) |
| `blocked_ports_tcp` | HASH | 64 | TCP destination ports yang diblokir |
| `blocked_ports_udp` | HASH | 64 | UDP destination ports yang diblokir |
| `blocked_protos` | HASH | 32 | IP protocol numbers yang diblokir |
| `fwd_table` | HASH | 4096 | Forwarding table: dst IP → fwd_entry |
| `tx_port` | DEVMAP | 16 | Mapping slot → ifindex egress NIC |
| `packet_events` | RINGBUF | 256 KB | Stream event paket ke userspace |

**Pseudocode — Alur Eksekusi XDP Program:**
```
FUNCTION xdp_firewall_fwd(ctx):
    data     = ctx.data
    data_end = ctx.data_end
    pkt_len  = data_end - data
    
    events_enabled = fw_config[FW_CFG_EVENTS_ENABLED]
    
    // Step 1: Parse Ethernet
    eth_type = parse_ethhdr(nh, data_end, &eth)
    IF eth_type != ETH_P_IP:
        stats_update(STAT_PASS, pkt_len)
        RETURN XDP_PASS
    
    // Step 2: Parse IPv4
    ip_proto = parse_iphdr(nh, data_end, &iph)
    IF ip_proto < 0:
        RETURN XDP_PASS
    
    // Step 3: Firewall L3
    IF block_ip_fragments AND iph.frag_off has IP_MF/IP_OFFSET:
        EMIT_DROP; RETURN XDP_DROP
    IF block_broadcast AND iph.daddr == 0xFFFFFFFF:
        EMIT_DROP; RETURN XDP_DROP
    IF block_multicast AND (iph.daddr & 0xF0000000 == 0xE0000000):
        EMIT_DROP; RETURN XDP_DROP
    IF blocked_protos[iph.protocol] EXISTS:
        EMIT_DROP; RETURN XDP_DROP
    
    // Step 4+5: Parse L4 + Firewall L4
    IF ip_proto == TCP:
        parse_tcphdr → l4_sport, l4_dport
        IF block_all_tcp: EMIT_DROP; RETURN XDP_DROP
        IF block_malformed_tcp AND flags_malformed(tcph): EMIT_DROP; RETURN XDP_DROP
        IF blocked_ports_tcp[l4_dport] EXISTS: EMIT_DROP; RETURN XDP_DROP
    ELSE IF ip_proto == UDP:
        parse_udphdr → l4_sport, l4_dport
        IF block_all_udp: EMIT_DROP; RETURN XDP_DROP
        IF blocked_ports_udp[l4_dport] EXISTS: EMIT_DROP; RETURN XDP_DROP
    ELSE IF ip_proto == ICMP:
        parse_icmphdr
        IF block_icmp_ping AND icmph.type == ICMP_ECHO: EMIT_DROP; RETURN XDP_DROP
    
    // Step 6: TTL Guard
    IF iph.ttl <= 1:
        stats_update(STAT_TTL_EXCEEDED)
        EMIT_SECURITY_EVENT(TTL_EXCEEDED)
        RETURN XDP_PASS   // kernel kirim ICMP TTL Exceeded
    
    // Step 7: Forwarding Table Lookup
    entry = fwd_table[iph.daddr]
    IF entry == NULL:
        stats_update(STAT_PASS)
        EMIT_SAMPLED(PASS)
        RETURN XDP_PASS
    
    // Step 8: MAC Rewrite + TTL Decrement
    eth.h_dest   = entry.dst_mac
    eth.h_source = entry.src_mac
    ip_decrease_ttl(iph)   // RFC 1624 incremental checksum
    
    // Step 9: Forward
    IF entry.action == FWD_ACTION_TX:
        stats_update(STAT_TX)
        EMIT_SAMPLED(TX)
        RETURN XDP_TX
    ELSE:
        stats_update(STAT_REDIRECT)
        EMIT_SAMPLED(REDIRECT)
        RETURN bpf_redirect_map(&tx_port, entry.tx_port_key, XDP_PASS)
```

**Pseudocode — Optimasi Sampling Ring Buffer:**
```
FUNCTION emit_event_sampled(src_ip, dst_ip, sport, dport, proto, action, pkt_len):
    // Menggunakan PERCPU_ARRAY → zero atomic contention
    counter = sample_counter[0]  // per-CPU counter
    counter++
    
    IF (counter % SAMPLE_RATE) != 0:   // SAMPLE_RATE = 1000
        RETURN   // Skip 999 dari 1000 paket
    
    event = { timestamp_ns, src_ip, dst_ip, sport, dport, proto, action, pkt_len }
    bpf_ringbuf_output(&packet_events, event, BPF_RB_NO_WAKEUP)
    // NO_WAKEUP: consumer di-wake up secara batch, bukan per-event

FUNCTION emit_event_security(src_ip, dst_ip, sport, dport, proto, action, pkt_len):
    // Selalu emit, tanpa sampling (DROP dan TTL_EXCEEDED)
    event = { timestamp_ns, src_ip, dst_ip, sport, dport, proto, action, pkt_len }
    bpf_ringbuf_output(&packet_events, event, BPF_RB_NO_WAKEUP)
```

### Implementasi XDP Manager (Go)

XDP Manager (`internal/xdp/manager.go`) mengelola siklus hidup program BPF:

**Pseudocode — `Manager.Start()`:**
```
FUNCTION Manager.Start():
    LOCK mutex
    IF xdpLink != nil:
        RETURN error "already attached"
    
    // Load BPF objects (compiled bytecode)
    LoadXdpProgObjects(&objs, PinPath: /sys/fs/bpf/{iface}/)
    
    // Explicitly pin all 8 maps
    FOR each map in [xdp_stats, blocked_ports_tcp, blocked_ports_udp,
                     blocked_protos, fw_config, fwd_table, tx_port, packet_events]:
        map.Pin(/sys/fs/bpf/{iface}/{map_name})
    
    // Attach XDP in DRIVER MODE (not generic/SKB mode)
    xdpLink = link.AttachXDP(
        Program:   objs.XdpFirewallFwd,
        Interface: iface.Index,
        Flags:     XDPDriverMode   // native, before sk_buff allocation
    )
    
    // Enable events by default
    maps.SetFlag(fw_config, FW_CFG_EVENTS_ENABLED, true)
    
    // Seed default port blocklists (only when fresh)
    IF len(ListPorts(blocked_ports_tcp)) == 0:
        SetPorts(blocked_ports_tcp, DefaultTCPPorts)
    IF len(ListPorts(blocked_ports_udp)) == 0:
        SetPorts(blocked_ports_udp, DefaultUDPPorts)
    
    // Seed DEVMAP slot 0 for redirect-dev
    IF redirectDev != "":
        SetDevmapSlot(tx_port, slot=0, ifindex=redirectDev.Index)
        attachEgressPass(redirectDev)  // required kernel 5.9+ for DEVMAP
    
    // Apply startup config (turbo.json)
    IF cfg != nil:
        applyConfig()
    
    UNLOCK mutex
```

### Implementasi Ring Buffer Consumer (Go)

Ring buffer consumer berjalan sebagai goroutine terpisah, membaca event paket dari kernel dan menyimpannya ke SQLite secara batch:

**Pseudocode — `maps.ConsumeRingBuf()`:**
```
FUNCTION ConsumeRingBuf(ctx, ebpf_map, sqlite_store):
    reader = ringbuf.NewReader(ebpf_map)
    
    // Close reader saat ctx cancelled
    GO: <-ctx.Done() → reader.Close()
    
    buf = []TrafficLog{}
    ticker = time.NewTicker(100ms)
    
    flush = FUNCTION():
        IF len(buf) > 0:
            sqlite_store.BatchInsert(buf)
            buf = []
    
    LOOP:
        record, err = reader.Read()
        IF err == ErrClosed:
            flush(); RETURN
        
        IF err != nil:
            SELECT ticker.C → flush()
            CONTINUE
        
        event = decode binary little-endian → packetEvent{24 bytes}
        buf = append(buf, toTrafficLog(event))
        
        IF len(buf) >= 500:
            flush()
        ELSE:
            SELECT ticker.C → flush()
            DEFAULT: continue
```

### Konfigurasi Sistem — Turbo Mode

Untuk mencapai throughput maksimal, sistem harus dikonfigurasi melalui `start_turbo.sh`:

**Pseudocode — `start_turbo.sh`:**
```
SCRIPT start_turbo.sh [IFACE] [REDIRECT_DEV] [NUM_CPUS]:
    NUM_CPUS = argumen ke-3 ATAU nproc (semua CPU)
    ALL_CPUS = "0-{NUM_CPUS-1}"
    
    // 1. Disable irqbalance
    systemctl stop irqbalance
    
    // 2. CPU governor → performance
    FOR cpu IN 0..NUM_CPUS-1:
        WRITE "performance" → /sys/devices/system/cpu/cpu{N}/cpufreq/scaling_governor
    
    // 3. NIC queues = NUM_CPUS
    ethtool -L {IFACE} combined {NUM_CPUS}
    
    // 4. IRQ affinity per queue
    FOR i, irq IN enumerate(grep IFACE /proc/interrupts):
        cpu = i % NUM_CPUS
        WRITE hex(1<<cpu) → /proc/irq/{irq}/smp_affinity
    
    // 5. XPS per TX queue
    FOR i, xps_file IN enumerate(find xps_cpus for IFACE):
        cpu = i % NUM_CPUS
        WRITE hex(1<<cpu) → {xps_file}
    
    // 6. Sama untuk REDIRECT_DEV
    (Ulangi langkah 4 untuk IRQ REDIRECT_DEV)
    
    // 7. Launch xdpd dengan taskset
    taskset -c {ALL_CPUS} ./xdpd \
        -iface {IFACE} \
        -redirect-dev {REDIRECT_DEV} \
        -config turbo.json \
        -db /tmp/xdpd.db
```

---

## 3.3 Subsistem 3 — Orkestrasi dan Otomasi Testbed Multi-Node

### Keterkaitan dengan T20

| T20 | Keterkaitan |
|-----|-------------|
| **Objektif 2** — Terotomasi dan Informatif | Ansible mengotomasi seluruh deployment dan eksekusi eksperimen tanpa intervensi manual |
| **Subobjektif 3** — Otomasi penuh deployment dan manajemen eksperimen di testbed multi-node | 5 playbook Ansible mengcover setup OS, routing, deploy tools, hingga launch traffic generator |
| **Constraint Subobjektif 3** | Otomasi seluruh tahapan: instalasi, konfigurasi jaringan, eksekusi, tanpa intervensi manual pada node |
| **PF 3** | Dashboard dapat mengatur deployment, menjalankan eksperimen, serta monitoring status node secara otomatis |

### Topologi Testbed

Testbed terdiri dari 4 node fisik yang terhubung dalam topologi berikut:

```
Node-1 (10.90.1.1) — Traffic Sender
  enp1s0f0np0: 192.168.46.1/24
  enp1s0f1np1: 192.168.56.1/24
        │ (paket dikirim ke Node-6)
        ▼
Node-6 (10.90.1.6) — XDP Forwarder (xdpd)
  enp1s0f0np0: 192.168.46.6/24  ← ingress (XDP attach di sini)
  enp1s0f1np1: 192.168.56.6/24  ← egress  (XDP_REDIRECT ke sini)
        │ (paket diteruskan ke Node-4/5)
        ▼
Node-4 (10.90.1.4) — Traffic Receiver
  192.168.46.4/24
Node-5 (10.90.1.5) — Traffic Receiver
  192.168.56.5/24
```

### Implementasi Ansible Playbooks

Otomasi diimplementasikan menggunakan Ansible dengan 5 playbook yang dieksekusi secara berurutan:

**Tabel Playbooks:**

| No | File | Target | Fungsi |
|----|------|--------|--------|
| 00 | `00_check_node_connection.yaml` | all nodes | Verifikasi SSH connectivity, ping 8.8.8.8 |
| 01 | `01_basic_setup.yaml` | all nodes | Bind NIC ke kernel driver, assign IPv4/IPv6 |
| 02 | `02_setup_route.yaml` | all nodes | Konfigurasi static routes, enable IP forwarding, uji konektivitas |
| 03 | `03_setup_scripts.yaml` | sender nodes | Deploy pktgen-DPDK scripts dan DPDK bind helper |
| 04 | `04_start_pktgen.yaml` | sender nodes | Launch pktgen traffic generator via tmux session |

**File Inventory (`inventory.ini`):**
```ini
[all]
node1 ansible_host=10.90.1.1 ansible_user=ansible
node4 ansible_host=10.90.1.4 ansible_user=ansible
node5 ansible_host=10.90.1.5 ansible_user=ansible
node6 ansible_host=10.90.1.6 ansible_user=ansible

[sender]
node1

[forwarder]
node6

[receiver]
node4
node5
```

**Pseudocode — Playbook `01_basic_setup.yaml`:**
```
PLAY basic_setup ON all_nodes:
    TASK: Bind NIC ke kernel driver
        shell: python3 dpdk-devbind.py --bind=ice {NIC_PCI_ADDR}
    
    TASK: Assign IPv4 address per node
        command: ip addr add {node_ip}/{prefix} dev {iface}
    
    TASK: Assign IPv6 address per node
        command: ip addr add {node_ipv6}/{prefix6} dev {iface}
    
    TASK: Bring up interface
        command: ip link set dev {iface} up
```

**Pseudocode — Playbook `02_setup_route.yaml`:**
```
PLAY setup_route ON all_nodes:
    TASK: Add static route
        command: ip route add {dst_network} via {gateway} dev {iface}
    
    TASK: Enable IP forwarding (forwarder node only)
        sysctl: net.ipv4.ip_forward = 1
    
    TASK: Verifikasi konektivitas
        command: ping -c 3 {target_ip}
        register: ping_result
        ASSERT ping_result.rc == 0
```

**Pseudocode — Playbook `04_start_pktgen.yaml`:**
```
PLAY start_pktgen ON sender_nodes:
    TASK: Kill sesi tmux lama jika ada
        shell: tmux kill-session -t pktgen 2>/dev/null || true
    
    TASK: Launch pktgen dalam tmux session baru
        shell: |
            tmux new-session -d -s pktgen \
                "sudo ./pktgen -l 0-3 -n 4 -- \
                 -T -P -m [1:3].0 \
                 -f lua/dpdk_pktgen_start.lua"
    
    TASK: Tunggu pktgen siap
        pause: seconds=3
    
    TASK: Mulai traffic generation
        shell: tmux send-keys -t pktgen "start 0" Enter
    
    TASK: Verifikasi traffic berjalan
        shell: tmux capture-pane -t pktgen -p
        ASSERT output contains "Tx:"
```

### Pipeline Eksperimen End-to-End

Alur lengkap eksperimen dari awal hingga pengumpulan data:

```
┌─────────────────────────────────────────────────────────────┐
│ TAHAP 1: Setup Infrastruktur (Ansible)                      │
│   ansible-playbook 00_check_node_connection.yaml            │
│   ansible-playbook 01_basic_setup.yaml                      │
│   ansible-playbook 02_setup_route.yaml                      │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│ TAHAP 2: Deploy Tools (Ansible)                             │
│   ansible-playbook 03_setup_scripts.yaml                    │
│   (deploy pktgen scripts ke sender nodes)                   │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│ TAHAP 3: Jalankan XDP Daemon (Manual di Node-6)             │
│   sudo ./start_turbo.sh enp1s0f0np0 enp1s0f1np1 [N_CPU]   │
│   ATAU                                                       │
│   sudo ./xdpd -iface enp1s0f0np0 -redirect-dev enp1s0f1np1│
│               -config turbo.json -static ./frontend/dist    │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│ TAHAP 4: Konfigurasi XDP via Dashboard                      │
│   - Buka browser → http://{node6_ip}:8081                   │
│   - Klik "Start XDP" di halaman Firewall                    │
│   - Set forwarding routes di halaman Routes                 │
│   - Set CPU affinity via slider                             │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│ TAHAP 5: Generate Traffic (Ansible)                         │
│   ansible-playbook 04_start_pktgen.yaml                    │
│   (launch pktgen-DPDK, mulai traffic)                       │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│ TAHAP 6: Pengukuran & Pengumpulan Data                      │
│   - Live stats: Dashboard halaman Monitoring                │
│   - CLI stats: sudo ./xdpd -iface enp1s0f0np0 -stats       │
│   - CPU usage: mpstat -P ALL 1                              │
│   - Traffic logs: Dashboard → Monitoring → Filter & export  │
└─────────────────────────────────────────────────────────────┘
```

### Metrik yang Diukur

Sistem mengumpulkan tiga metrik utama sesuai constraint T20 (Subobjektif 4):

| Metrik | Cara Ukur | Sumber Data |
|--------|-----------|-------------|
| **Throughput (Mbps/Mpps)** | xdp_stats PERCPU_ARRAY, dibaca setiap 2 detik via `/api/stats/live` | BPF map `xdp_stats` |
| **CPU Usage (%)** | `mpstat -P ALL 1` di node forwarder, atau htop | OS `/proc/stat` |
| **Traffic Logs** | Ring buffer events → SQLite → Dashboard query | BPF `packet_events` → SQLite |

---

## 3.4 Integrasi Antar Subsistem

Ketiga subsistem bekerja secara terpadu dalam satu sistem:

```
                  ┌──────────────────────────┐
                  │  Subsistem 3: Orkestrasi  │
                  │  (Ansible Playbooks)       │
                  │  - Deploy infrastructure  │
                  │  - Launch traffic gen      │
                  └────────────┬─────────────┘
                               │ setup testbed
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                        Node-6 (Forwarder)                    │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Subsistem 1: Dashboard (Go daemon + React UI)       │    │
│  │  - REST API server                                   │    │
│  │  - Config management                                 │    │
│  │  - Real-time visualization                          │    │
│  └──────────────────────┬──────────────────────────────┘    │
│                         │ R/W BPF maps via cilium/ebpf       │
│  ┌──────────────────────▼──────────────────────────────┐    │
│  │  Subsistem 2: eBPF/XDP (kernel program)             │    │
│  │  - Packet parsing & firewall (L3 + L4)              │    │
│  │  - Forwarding (MAC rewrite + XDP_TX/REDIRECT)       │    │
│  │  - Stats counting (PERCPU_ARRAY)                    │    │
│  │  - Event emission (RINGBUF)                         │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  NIC ingress ←── packets ──── Node-1 (sender)               │
│  NIC egress  ───► packets ──→ Node-4/5 (receiver)           │
└──────────────────────────────────────────────────────────────┘
```

---

## Referensi Kode

| Komponen | File |
|----------|------|
| eBPF kernel program | `xdp-go-optimized/bpf/xdp_prog_kern.c` |
| Shared types (maps, structs, enums) | `xdp-go-optimized/bpf/common_kern_user.h` |
| XDP lifecycle manager | `xdp-go-optimized/internal/xdp/manager.go` |
| REST API server & router | `xdp-go-optimized/internal/api/server.go` |
| BPF map operations | `xdp-go-optimized/internal/maps/` |
| Ring buffer consumer | `xdp-go-optimized/internal/maps/ringbuf.go` |
| CPU affinity handler | `xdp-go-optimized/internal/api/cpu.go` |
| React Firewall page | `xdp-go-optimized/frontend/src/pages/FirewallConfig.tsx` |
| React Monitoring page | `xdp-go-optimized/frontend/src/pages/Monitoring.tsx` |
| React Routes page | `xdp-go-optimized/frontend/src/pages/Routes.tsx` |
| System tuning script | `xdp-go-optimized/start_turbo.sh` |
| Ansible inventory | `ansible/inventory.ini` |
| Ansible playbooks | `ansible/00_*.yaml` – `ansible/04_*.yaml` |
