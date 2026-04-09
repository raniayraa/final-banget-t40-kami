# Snippets Kode Penting — XDP Firewall + Fast Forwarder (T40)

---

## 1. BPF Maps — Deklarasi Seluruh Map Kernel

**File:** `xdp-go-optimized/bpf/xdp_prog_kern.c`
**Fungsi file:** Program XDP kernel yang berjalan di level NIC — menggabungkan stateless firewall (L3+L4) dan fast forwarder (MAC rewrite + XDP_TX/REDIRECT).
**Yang di-snippet:** Deklarasi semua BPF maps yang digunakan: stats per-CPU, blocked ports, firewall config, forwarding table, DEVMAP, dan ring buffer.

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

/* Firewall: UDP destination ports yang diblokir */
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __type(key,   __u16);
    __type(value, __u8);
    __uint(max_entries, 64);
} blocked_ports_udp SEC(".maps");

/* Firewall: IP protocol numbers yang diblokir */
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __type(key,   __u8);
    __type(value, __u8);
    __uint(max_entries, 32);
} blocked_protos SEC(".maps");

/* Firewall: feature flags on/off (key = enum fw_config_key) */
struct {
    __uint(type, BPF_MAP_TYPE_ARRAY);
    __type(key,   __u32);
    __type(value, __u8);
    __uint(max_entries, FW_CFG_MAX);
} fw_config SEC(".maps");

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
 * tx_port — DEVMAP untuk XDP_REDIRECT ke egress NIC.
 * Key:   __u32 slot (stored di fwd_entry.tx_port_key).
 * Value: __u32 ifindex dari egress NIC.
 * Slot 0 = egress NIC utama (diisi oleh -r flag saat attach).
 */
struct {
    __uint(type, BPF_MAP_TYPE_DEVMAP);
    __type(key,   __u32);
    __type(value, __u32);
    __uint(max_entries, FWD_DEVMAP_MAX_ENTRIES);
} tx_port SEC(".maps");

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
 * Key 0 = satu-satunya entry; value = jumlah paket yang diproses CPU ini.
 */
struct {
    __uint(type, BPF_MAP_TYPE_PERCPU_ARRAY);
    __type(key,   __u32);
    __type(value, __u64);
    __uint(max_entries, 1);
} sample_counter SEC(".maps");
```

---

## 2. Emit Event — Security vs Sampled

**File:** `xdp-go-optimized/bpf/xdp_prog_kern.c`
**Fungsi file:** Program XDP kernel — firewall + forwarder.
**Yang di-snippet:** Dua fungsi emit event: `emit_event_security` (selalu emit untuk DROP/TTL_EXCEEDED) dan `emit_event_sampled` (1 dari setiap SAMPLE_RATE paket untuk PASS/TX/REDIRECT), sebagai inti optimasi performa.

```c
/*
 * emit_event_security() — kirim event DROP/TTL_EXCEEDED ke ring buffer.
 *
 * Selalu emit tanpa sampling. Menggunakan BPF_RB_NO_WAKEUP agar wakeup
 * di-batch bersama consumer timer (100ms poll) — eliminasi per-DROP
 * context switch yang terjadi dengan BPF_RB_FORCE_WAKEUP.
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
 *
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

## 3. Deteksi TCP Scan Malformed + Decrement TTL

**File:** `xdp-go-optimized/bpf/xdp_prog_kern.c`
**Fungsi file:** Program XDP kernel — firewall + forwarder.
**Yang di-snippet:** Fungsi `tcp_flags_malformed` untuk mendeteksi NULL/XMAS/SYN+FIN/RST+FIN scan, dan `ip_decrease_ttl` untuk decrement TTL dengan incremental checksum update (RFC 1624).

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

/*
 * ip_decrease_ttl() — decrement TTL dan update checksum secara inkremental.
 * RFC 1624 §3: carry folding dengan ones'-complement wrap-around.
 */
static __always_inline void ip_decrease_ttl(struct iphdr *iph)
{
    __u32 check = (__u32)iph->check;

    check += bpf_htons(0x0100);
    iph->check = (__u16)(check + (check >= 0xFFFF));
    iph->ttl--;
}
```

---

## 4. XDP Main Program — Alur Firewall + Forwarding

**File:** `xdp-go-optimized/bpf/xdp_prog_kern.c`
**Fungsi file:** Program XDP kernel — firewall + forwarder.
**Yang di-snippet:** Fungsi XDP utama `xdp_firewall_fwd` — seluruh pipeline dari parse Ethernet → firewall L3/L4 → TTL guard → forwarding table lookup → MAC rewrite → XDP_TX / XDP_REDIRECT.

```c
SEC("xdp")
int xdp_firewall_fwd(struct xdp_md *ctx)
{
    void *data_end = (void *)(long)ctx->data_end;
    void *data     = (void *)(long)ctx->data;
    __u32 pkt_len  = (__u32)(ctx->data_end - ctx->data);

    struct hdr_cursor     nh   = { .pos = data };
    struct ethhdr        *eth;
    struct iphdr         *iph  = NULL;
    // ... (deklarasi pointer lainnya)

    /*
     * Cek events_enabled SEKALI di awal, simpan di local variable.
     * Kalau 0 (turbo mode): skip seluruh ring buffer + sample_counter overhead.
     */
    int events_enabled = fw_cfg_enabled(FW_CFG_EVENTS_ENABLED);

    /* ── Step 1: Ethernet → skip non-IPv4 ── */
    eth_type = parse_ethhdr(&nh, data_end, &eth);
    if (eth_type != bpf_htons(ETH_P_IP)) {
        stats_update(STAT_PASS, pkt_len);
        if (events_enabled)
            emit_event_sampled(0, 0, 0, 0, 0, PKT_ACTION_PASS, (__u16)pkt_len);
        return XDP_PASS;
    }

    /* ── Step 3: Firewall L3 — drop fragment, broadcast, multicast ── */
    if (fw_cfg_enabled(FW_CFG_BLOCK_IP_FRAGMENTS) &&
        (iph->frag_off & bpf_htons(IP_MF | IP_OFFSET))) {
        stats_update(STAT_DROP, pkt_len);
        if (events_enabled)
            emit_event_security(iph->saddr, iph->daddr, 0, 0,
                                iph->protocol, PKT_ACTION_DROP, (__u16)pkt_len);
        return XDP_DROP;
    }

    /* ── Step 4+5: Firewall L4 — TCP malformed flags ── */
    if (fw_cfg_enabled(FW_CFG_BLOCK_MALFORMED_TCP) &&
        tcp_flags_malformed(tcph)) {
        stats_update(STAT_DROP, pkt_len);
        if (events_enabled)
            emit_event_security(iph->saddr, iph->daddr, l4_sport, l4_dport,
                                IPPROTO_TCP, PKT_ACTION_DROP, (__u16)pkt_len);
        return XDP_DROP;
    }

    /* ── Step 6: TTL Guard ── */
    if (iph->ttl <= 1) {
        stats_update(STAT_TTL_EXCEEDED, pkt_len);
        if (events_enabled)
            emit_event_security(iph->saddr, iph->daddr, l4_sport, l4_dport,
                                iph->protocol, PKT_ACTION_TTL_EXCEEDED, (__u16)pkt_len);
        return XDP_PASS;
    }

    /* ── Step 7: Forwarding Table Lookup ── */
    entry = bpf_map_lookup_elem(&fwd_table, &iph->daddr);
    if (!entry) {
        stats_update(STAT_PASS, pkt_len);
        if (events_enabled)
            emit_event_sampled(iph->saddr, iph->daddr, l4_sport, l4_dport,
                               iph->protocol, PKT_ACTION_PASS, (__u16)pkt_len);
        return XDP_PASS;
    }

    /* ── Step 8: MAC Rewrite + TTL Decrement ── */
    memcpy(eth->h_dest,   entry->dst_mac, ETH_ALEN);
    memcpy(eth->h_source, entry->src_mac, ETH_ALEN);
    ip_decrease_ttl(iph);

    /* ── Step 9: Forward via XDP_TX atau XDP_REDIRECT ── */
    if (entry->action == FWD_ACTION_TX) {
        stats_update(STAT_TX, pkt_len);
        if (events_enabled)
            emit_event_sampled(iph->saddr, iph->daddr, l4_sport, l4_dport,
                               iph->protocol, PKT_ACTION_TX, (__u16)pkt_len);
        return XDP_TX;
    }

    stats_update(STAT_REDIRECT, pkt_len);
    if (events_enabled)
        emit_event_sampled(iph->saddr, iph->daddr, l4_sport, l4_dport,
                           iph->protocol, PKT_ACTION_REDIRECT, (__u16)pkt_len);
    return bpf_redirect_map(&tx_port, entry->tx_port_key, XDP_PASS);
}
```

---

## 5. Shared Types — Struct dan Enum Kernel↔Userspace

**File:** `xdp-go-optimized/bpf/common_kern_user.h`
**Fungsi file:** Header bersama yang mendefinisikan semua tipe data yang dipakai sekaligus oleh program kernel (C) dan control plane (Go) — firewall flags, forwarding entry, stats, dan packet event.
**Yang di-snippet:** Seluruh definisi enum dan struct penting: `fw_config_key`, `fwd_entry`, `stats_rec`, `packet_event`.

```c
/*
 * enum fw_config_key — index ke fw_config BPF_MAP_TYPE_ARRAY.
 * Setiap key menyimpan nilai 0 (off) atau 1 (on).
 */
enum fw_config_key {
    FW_CFG_BLOCK_ICMP_PING     = 0,  /* Drop ICMP echo request (ping)        */
    FW_CFG_BLOCK_IP_FRAGMENTS  = 1,  /* Drop fragmented IP packets            */
    FW_CFG_BLOCK_MALFORMED_TCP = 2,  /* Drop NULL/XMAS/SYN+FIN/RST+FIN scans */
    FW_CFG_BLOCK_ALL_TCP       = 3,  /* Drop ALL TCP (override port list)     */
    FW_CFG_BLOCK_ALL_UDP       = 4,  /* Drop ALL UDP (override port list)     */
    FW_CFG_BLOCK_BROADCAST     = 5,  /* Drop dst == 255.255.255.255           */
    FW_CFG_BLOCK_MULTICAST     = 6,  /* Drop dst in 224.0.0.0/4              */
    FW_CFG_EVENTS_ENABLED      = 7,  /* Emit ring buffer events (0=off/turbo) */
    FW_CFG_MAX
};

/*
 * struct fwd_entry — satu baris di forwarding table (BPF map value).
 *
 * @dst_mac:      MAC tujuan (next-hop) yang menggantikan eth->h_dest.
 * @src_mac:      MAC interface egress yang menggantikan eth->h_source.
 * @tx_port_key:  Slot DEVMAP untuk XDP_REDIRECT (ifindex egress NIC).
 * @action:       enum fwd_action — TX atau REDIRECT.
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
 *
 * src_port/dst_port = 0 untuk paket yang di-drop di L3 (fragment, broadcast, dll.)
 */
struct packet_event {
    __u64  timestamp_ns;  /* bpf_ktime_get_ns() saat paket diproses      */
    __be32 src_ip;        /* IPv4 source address (network byte order)     */
    __be32 dst_ip;        /* IPv4 destination address (network byte order)*/
    __u16  src_port;      /* L4 source port (0 jika L3-only drop)         */
    __u16  dst_port;      /* L4 destination port (0 jika L3-only drop)    */
    __u8   protocol;      /* IPPROTO_TCP / UDP / ICMP / dll.              */
    __u8   action;        /* enum pkt_action                              */
    __u16  pkt_len;       /* Total packet length in bytes                 */
    __u8   _pad[4];       /* padding ke 24 bytes                          */
};
```

---

## 6. Packet Header Parsing — Bounds-Checked dengan hdr_cursor

**File:** `xdp-go-optimized/bpf/headers/parsing_helpers.h`
**Fungsi file:** Header helper untuk parsing layer-by-layer packet (Ethernet, IPv4, TCP, UDP, ICMP) dengan bounds checking yang diperlukan oleh BPF verifier.
**Yang di-snippet:** Struct `hdr_cursor`, parsing Ethernet (dengan support VLAN), IPv4, TCP, dan UDP.

```c
/* Header cursor to keep track of current parsing position */
struct hdr_cursor {
    void *pos;
};

/* parse_ethhdr_vlan — skip VLAN tags, kembalikan inner EtherType */
static __always_inline int parse_ethhdr_vlan(struct hdr_cursor *nh,
                         void *data_end,
                         struct ethhdr **ethhdr,
                         struct collect_vlans *vlans)
{
    struct ethhdr *eth = nh->pos;
    int hdrsize = sizeof(*eth);

    /* Byte-count bounds check */
    if (nh->pos + hdrsize > data_end)
        return -1;

    nh->pos += hdrsize;
    *ethhdr = eth;

    /* Unroll VLAN tag traversal (BPF verifier tidak izinkan loop dinamis) */
    #pragma unroll
    for (i = 0; i < VLAN_MAX_DEPTH; i++) {
        if (!proto_is_vlan(h_proto))
            break;
        // ... traverse VLAN headers
    }
    return h_proto; /* network-byte-order */
}

/* parse_iphdr — handle variable-length IPv4 header (IHL field) */
static __always_inline int parse_iphdr(struct hdr_cursor *nh,
                       void *data_end,
                       struct iphdr **iphdr)
{
    struct iphdr *iph = nh->pos;
    int hdrsize;

    if (iph + 1 > data_end)
        return -1;

    hdrsize = iph->ihl * 4;
    if (hdrsize < sizeof(*iph))
        return -1;

    /* Variable-length: gunakan byte arithmetic, bukan pointer arithmetic */
    if (nh->pos + hdrsize > data_end)
        return -1;

    nh->pos += hdrsize;
    *iphdr = iph;
    return iph->protocol;
}

/* parse_tcphdr — handle variable-length TCP header (DOFF field) */
static __always_inline int parse_tcphdr(struct hdr_cursor *nh,
                    void *data_end,
                    struct tcphdr **tcphdr)
{
    int len;
    struct tcphdr *h = nh->pos;

    if (h + 1 > data_end)
        return -1;

    len = h->doff * 4;
    if (len < sizeof(*h))
        return -1;

    if (nh->pos + len > data_end)
        return -1;

    nh->pos += len;
    *tcphdr = h;
    return len;
}
```

---

## 7. XDP Manager — Load, Attach, Pin, Stop

**File:** `xdp-go-optimized/internal/xdp/manager.go`
**Fungsi file:** Mengelola siklus hidup program XDP dari sisi Go: load BPF object, pin maps ke `/sys/fs/bpf/`, attach ke NIC, seed default config, attach egress pass program untuk DEVMAP redirect.
**Yang di-snippet:** Method `Start()` lengkap dan `attachEgressPass()` — inti dari lifecycle management.

```go
// Start loads the BPF object, pins all maps under /sys/fs/bpf/<ifname>/,
// attaches the XDP program to the ingress NIC, seeds default blocked port
// lists, and applies any startup config.
func (m *Manager) Start() error {
    m.mu.Lock()
    defer m.mu.Unlock()

    if m.xdpLink != nil {
        return fmt.Errorf("XDP already attached to %s", m.ifname)
    }

    opts := &ebpf.CollectionOptions{
        Maps: ebpf.MapOptions{PinPath: m.pinDir},
    }

    if err := bpfobj.LoadXdpProgObjects(&m.objs, opts); err != nil {
        return fmt.Errorf("load BPF objects: %w", err)
    }

    // cilium/ebpf tidak auto-pin maps — pin manual agar tools lain bisa akses
    if err := m.pinMaps(); err != nil {
        m.objs.Close()
        return fmt.Errorf("pin maps: %w", err)
    }

    // Detach program lama sebelum attach yang baru
    _ = exec.Command("ip", "link", "set", "dev", m.ifname, "xdp", "off").Run()

    m.xdpLink, err = link.AttachXDP(link.XDPOptions{
        Program:   m.objs.XdpFirewallFwd,
        Interface: iface.Index,
        Flags:     link.XDPDriverMode,
    })

    // Default: aktifkan events (observability mode)
    // User bisa matikan via PUT /api/config untuk turbo mode
    if err := maps.SetFlag(m.objs.FwConfig, maps.FwCfgEventsEnabled, true); err != nil {
        log.Printf("warn: set events_enabled default: %v", err)
    }

    // Seed default port blocklists hanya jika map masih kosong
    if existing, _ := maps.ListPorts(m.objs.BlockedPortsTcp); len(existing) == 0 {
        maps.SetPorts(m.objs.BlockedPortsTcp, maps.DefaultTCPPorts)
    }

    // Kernel 5.9+: DEVMAP redirect butuh XDP program di egress NIC
    if redirectDev != "" {
        m.attachEgressPass(redirectDev)
    }

    return nil
}

// attachEgressPass — buat program XDP_PASS minimal dan attach ke egress NIC.
// Diperlukan Linux 5.9+: tanpa ini bpf_redirect_map() silently drop paket.
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
    defer passProg.Close()

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

## 8. Ring Buffer Consumer — Batch Insert ke SQLite

**File:** `xdp-go-optimized/internal/maps/ringbuf.go`
**Fungsi file:** Membaca packet events dari BPF ring buffer dan menyimpannya ke SQLite dalam batch — jembatan antara kernel events dan persistence layer.
**Yang di-snippet:** Fungsi `ConsumeRingBuf` dengan strategi batching (flush tiap 100ms atau 500 event).

```go
// ConsumeRingBuf reads packet events dari BPF ring buffer dan persists
// ke SQLite secara batch. Blocks sampai ctx cancelled.
//
// Security events (DROP, TTL_EXCEEDED) selalu emit; PASS/TX/REDIRECT
// di-sample 1 per SAMPLE_RATE per CPU — sehingga data forwarding bersifat sampled.
func ConsumeRingBuf(ctx context.Context, m *ebpf.Map, store *db.Store) error {
    rd, err := ringbuf.NewReader(m)
    if err != nil {
        return fmt.Errorf("open ring buffer reader: %w", err)
    }

    // Close reader saat ctx done untuk unblock Read()
    go func() {
        <-ctx.Done()
        rd.Close()
    }()
    defer rd.Close()

    const batchSize    = 500
    const flushInterval = 100 * time.Millisecond

    buf    := make([]db.TrafficLog, 0, batchSize)
    ticker := time.NewTicker(flushInterval)
    defer ticker.Stop()

    flush := func() {
        if len(buf) == 0 {
            return
        }
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
            case <-ticker.C:
                flush()
            default:
            }
            continue
        }

        var ev packetEvent
        if err := binary.Read(bytes.NewReader(record.RawSample),
                              binary.LittleEndian, &ev); err != nil {
            continue
        }

        buf = append(buf, toTrafficLog(ev))

        if len(buf) >= batchSize {
            flush()
        } else {
            select {
            case <-ticker.C:
                flush()
            default:
            }
        }
    }
}
```

---

## 9. Forwarding Table — CRUD ke BPF Hash Map

**File:** `xdp-go-optimized/internal/maps/routes.go`
**Fungsi file:** Operasi CRUD forwarding table di sisi Go: konversi IP/MAC string ↔ binary, insert/delete/list entries di BPF hash map `fwd_table`, dan manajemen DEVMAP slots.
**Yang di-snippet:** Fungsi `ipToKey` (kenapa pakai `[4]byte` bukan `uint32`), `AddRoute`, `ListRoutes`, dan `SetDevmapSlot`.

```go
// ipToKey — convert dotted-decimal IP ke 4-byte BPF map key.
//
// PENTING: harus pakai [4]byte, BUKAN uint32.
// cilium/ebpf serialises [4]byte verbatim (no endian swap), sedangkan
// uint32 akan di-swap di little-endian host → lookup mismatch permanen
// terhadap kernel's __be32 iph->daddr.
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

// AddRoute — insert atau update satu forwarding table entry.
func AddRoute(fwdMap *ebpf.Map, r RouteEntry) error {
    key, err := ipToKey(r.IP)
    if err != nil {
        return err
    }
    dstMAC, _ := parseMACBytes(r.DstMAC)
    srcMAC, _ := parseMACBytes(r.SrcMAC)

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

// ListRoutes — iterasi semua entry di forwarding table.
func ListRoutes(fwdMap *ebpf.Map) ([]RouteEntry, error) {
    var routes []RouteEntry
    var key [4]byte
    iter := fwdMap.Iterate()
    for {
        var entry FwdEntry
        if !iter.Next(&key, &entry) {
            break
        }
        routes = append(routes, RouteEntry{
            IP:        ipFromKey(key),
            DstMAC:    macToString(entry.DstMAC),
            SrcMAC:    macToString(entry.SrcMAC),
            Action:    entry.Action.String(),
            TxPortKey: entry.TxPortKey,
        })
    }
    return routes, iter.Err()
}

// SetDevmapSlot — daftarkan egress NIC ifindex ke tx_port DEVMAP slot tertentu.
func SetDevmapSlot(devmap *ebpf.Map, slot uint32, ifindex uint32) error {
    return devmap.Put(slot, ifindex)
}
```

---

## 10. SQLite Store — Schema + WAL Mode

**File:** `xdp-go-optimized/internal/db/db.go`
**Fungsi file:** Persistence layer SQLite untuk traffic logs — menyimpan semua packet events yang dikirim dari ring buffer, dengan indexing untuk query filtering.
**Yang di-snippet:** Schema DDL lengkap dan fungsi `Open` dengan WAL mode configuration.

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

// Open — buka (atau buat) SQLite database dan apply schema.
// WAL mode diaktifkan untuk concurrent readers + ring-buffer writer.
func Open(path string) (*Store, error) {
    dsn := fmt.Sprintf(
        "file:%s?_journal_mode=WAL&_busy_timeout=5000&_synchronous=NORMAL",
        path,
    )
    db, err := sql.Open("sqlite", dsn)
    if err != nil {
        return nil, fmt.Errorf("open sqlite %s: %w", path, err)
    }
    // Satu writer, banyak reader (WAL mode)
    db.SetMaxOpenConns(1)

    if _, err := db.Exec(schema); err != nil {
        db.Close()
        return nil, fmt.Errorf("apply schema: %w", err)
    }
    return &Store{db: db}, nil
}
```

---

## 11. REST API Server — Router + SPA Handler

**File:** `xdp-go-optimized/internal/api/server.go`
**Fungsi file:** HTTP server yang menyajikan REST API untuk kontrol XDP daemon (start/stop/config/routes/stats/logs) sekaligus serve React frontend sebagai SPA.
**Yang di-snippet:** Definisi `Router` dengan semua endpoint, CORS middleware, dan SPA fallback handler.

```go
// Router — daftarkan semua API routes dan serve React build output.
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

    // Serve React SPA; fallback ke index.html untuk client-side routing
    r.Handle("/*", spaHandler(staticDir))
    return r
}

// spaHandler — serve static files; jika tidak ada, kembalikan index.html
// agar React Router bisa handle path seperti /monitoring, /routes langsung.
func spaHandler(dir string) http.Handler {
    fsys := http.Dir(dir)
    fileServer := http.FileServer(fsys)
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        f, err := fsys.Open(r.URL.Path)
        if err != nil {
            if os.IsNotExist(err) {
                http.ServeFile(w, r, filepath.Join(dir, "index.html"))
                return
            }
        } else {
            f.Close()
        }
        fileServer.ServeHTTP(w, r)
    })
}
```

---

## 12. Main Daemon — Entry Point + Stats Mode

**File:** `xdp-go-optimized/cmd/xdpd/main.go`
**Fungsi file:** Entry point daemon `xdpd` — parse CLI flags, load config, inisialisasi DB + XDP Manager + HTTP server, handle graceful shutdown; juga menyediakan mode `-stats` untuk live monitoring tanpa menjalankan server.
**Yang di-snippet:** Fungsi `main` (daemon mode) dan `runStats` / `printStats` (live stats mode).

```go
func main() {
    iface       := flag.String("iface",       "eth0",          "ingress NIC name")
    redirectDev := flag.String("redirect-dev", "",             "egress NIC for XDP_REDIRECT")
    configPath  := flag.String("config",       "",             "JSON config file")
    dbPath      := flag.String("db",          "/tmp/xdpd.db", "SQLite database path")
    addr        := flag.String("addr",        ":8080",         "HTTP listen address")
    statsMode   := flag.Bool("stats",         false,           "print live stats (XDP harus sudah running)")
    flag.Parse()

    if os.Getuid() != 0 {
        log.Fatal("xdpd must run as root (UID 0) to load BPF programs")
    }

    // Stats mode: baca pinned maps dari daemon yang sudah running
    if *statsMode {
        runStats(*iface, *statsInterval)
        return
    }

    store, _ := db.Open(*dbPath)
    defer store.Close()

    mgr := xdp.NewManager(*iface, *redirectDev, cfg)
    srv := api.NewServer(mgr, store)

    httpSrv := &http.Server{
        Addr:         *addr,
        Handler:      srv.Router(*static),
        ReadTimeout:  10 * time.Second,
        WriteTimeout: 30 * time.Second,
    }

    ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    go httpSrv.ListenAndServe()

    <-ctx.Done()
    log.Println("shutting down...")

    shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    httpSrv.Shutdown(shutCtx)

    if mgr.IsAttached() {
        mgr.Stop()
    }
}

// runStats — buka pinned xdp_stats map dan cetak live throughput table
func runStats(iface string, intervalSec int) {
    pinPath := filepath.Join(xdp.PinBaseDir, iface, "xdp_stats")
    statsMap, _ := ebpf.LoadPinnedMap(pinPath, nil)
    defer statsMap.Close()

    maps.PollStats(ctx, statsMap, intervalSec, printStats)
}

// printStats — format dan print delta stats sebagai tabel refreshing
func printStats(delta maps.StatsMap, intervalSec int) {
    fmt.Print("\033[2J\033[H") // clear screen

    fmt.Printf("%-16s %12s %8s %12s %8s\n", "Action", "Packets", "pps", "Bytes", "Mbps")

    rows := []struct{ label string; rec maps.StatsRec }{
        {"DROP", delta.Drop}, {"TX", delta.TX}, {"REDIRECT", delta.Redirect},
        {"PASS", delta.Pass}, {"TTL_EXCEEDED", delta.TTLExceeded},
    }
    for _, row := range rows {
        pps  := row.rec.Packets / uint64(intervalSec)
        mbps := float64(row.rec.Bytes*8) / float64(intervalSec) / 1e6
        fmt.Printf("%-16s %12d %8d %12d %8.1f\n",
            row.label, row.rec.Packets, pps, row.rec.Bytes, mbps)
    }
}
```

---

## 13. Ansible — Setup Interface Tiap Node

**File:** `ansible/01_basic_setup.yaml`
**Fungsi file:** Playbook Ansible untuk konfigurasi awal semua node: bind NIC ke kernel driver, assign IP address (IPv4 + IPv6), dan disable Router Advertisement — dijalankan sebelum XDP di-attach.
**Yang di-snippet:** Vars mapping `iface_setup` per-host dan tasks interface configuration.

```yaml
vars:
  iface_setup:
    "10.90.1.1":
      enp1s0f0np0:
        ipv4: "192.168.46.1/24"
        ipv6: "fd00:46::1/64"
      enp1s0f1np1:
        ipv4: "192.168.56.1/24"
        ipv6: "fd00:56::1/64"
    "10.90.1.6":
      enp1s0f0np0:
        ipv4: "192.168.56.6/24"
        ipv6: "fd00:56::6/64"
      enp1s0f1np1:
        ipv4: "192.168.46.6/24"
        ipv6: "fd00:46::6/64"

tasks:
  - name: Bind NICs to kernel driver
    ansible.builtin.shell: >
      bash /home/telmat/scripts/bind-to-kernel.sh 0000:01:00.1 | grep 01:00.1 &&
      bash /home/telmat/scripts/bind-to-kernel.sh 0000:01:00.0 | grep 01:00.0

  - name: Bring up interface, flush addresses, disable RA
    ansible.builtin.shell: |
      set -e
      ip link set {{ item.key }} up
      ip addr flush dev {{ item.key }}
      ip -6 addr flush dev {{ item.key }}
      sysctl -w net.ipv6.conf.{{ item.key }}.accept_ra=0
    loop: "{{ iface_setup[inventory_hostname] | dict2items }}"
    when: inventory_hostname in iface_setup

  - name: Assign IPv4 address
    ansible.builtin.shell: ip addr add {{ item.value.ipv4 }} dev {{ item.key }}
    loop: "{{ iface_setup[inventory_hostname] | dict2items }}"
    when: inventory_hostname in iface_setup
```

---

## 14. Ansible — Setup Static Routes + Verifikasi Konektivitas

**File:** `ansible/02_setup_route.yaml`
**Fungsi file:** Playbook untuk menambahkan static routes IPv4/IPv6 pada node yang membutuhkan (Node 4 dan 5 via Node 6 sebagai router), enable IP forwarding di Node 6, lalu otomatis menjalankan ping tests antar semua node.
**Yang di-snippet:** Vars `route_setup`, tasks routing + forwarding, dan ping recap dengan Jinja2 templating.

```yaml
vars:
  route_setup:
    "10.90.1.4":
      ipv4:
        - { dst: "192.168.56.0/24", via: "192.168.46.6" }
      ipv6:
        - { dst: "fd00:56::/64", via: "fd00:46::6" }
    "10.90.1.5":
      ipv4:
        - { dst: "192.168.46.0/24", via: "192.168.56.6" }
      ipv6:
        - { dst: "fd00:46::/64", via: "fd00:56::6" }

tasks:
  - name: Add IPv4 static routes
    ansible.builtin.shell: ip route add {{ item.dst }} via {{ item.via }}
    loop: "{{ route_setup[inventory_hostname].ipv4 }}"
    when: inventory_hostname in route_setup
    failed_when: false

  - name: Enable IPv4 forwarding on Node 6
    ansible.builtin.shell: sysctl -w net.ipv4.ip_forward=1
    when: inventory_hostname == "10.90.1.6"

  - name: Enable IPv6 forwarding on Node 6
    ansible.builtin.shell: sysctl -w net.ipv6.conf.all.forwarding=1
    when: inventory_hostname == "10.90.1.6"

  # Ping recap lintas semua host dengan Jinja2 template
  - name: Print ping recap
    ansible.builtin.debug:
      msg: |
        {% for host in groups['targets'] %}
        [{{ host }}]
        {% for line in hostvars[host].ping_summary %}
          {{ line }}
        {% endfor %}
        {% endfor %}
    run_once: true
```

---

## 15. Ansible — Deploy Pktgen Scripts + Bind DPDK

**File:** `ansible/03_setup_scripts.yaml`
**Fungsi file:** Playbook untuk mendistribusikan pktgen traffic generator scripts ke masing-masing sender node, deploy script bind-to-DPDK, dan mengeksekusi binding DPDK interfaces — mempersiapkan testbed sebelum traffic generation dimulai.
**Yang di-snippet:** Vars `script_content` per-host, `bind_to_dpdk_content` inline script, dan tasks deploy + bind DPDK.

```yaml
vars:
  script_content:
    "10.90.1.1":
      filename: "node1_send.pkt"
      content: |
        stop 0
        set 0 size 64
        set 0 src mac 64:9d:99:ff:f5:7a
        set 0 dst mac 64:9d:99:ff:f5:9b
        set 0 src ip 192.168.46.1
        set 0 dst ip 192.168.56.5
        set 0 proto udp

  bind_to_dpdk_content: |
    #!/bin/sh
    PCI_IF=$1
    echo "Bind Interface $PCI_IF into Linux Kernel"
    modprobe vfio-pci
    dpdkdevbind=/home/telmat/dpdk/usertools/dpdk-devbind.py
    $dpdkdevbind --force -u $PCI_IF
    $dpdkdevbind -b vfio-pci $PCI_IF
    $dpdkdevbind -s

tasks:
  - name: Deploy pktgen script
    ansible.builtin.copy:
      content: "{{ script_content[inventory_hostname].content }}"
      dest: "/home/ansible/{{ script_content[inventory_hostname].filename }}"
      mode: "0644"
    when: inventory_hostname in script_content

  - name: Deploy bind-to-DPDK.sh
    ansible.builtin.copy:
      content: "{{ bind_to_dpdk_content }}"
      dest: /home/telmat/scripts/bind-to-DPDK.sh
      mode: "0755"
    become: true
    when: inventory_hostname in dpdk_script_hosts

  - name: Bind DPDK interfaces on Node 1
    ansible.builtin.shell: |
      bash /home/telmat/scripts/bind-to-DPDK.sh 0000:01:00.1 | grep 01:00.1 | tail -n 1
      bash /home/telmat/scripts/bind-to-DPDK.sh 0000:01:00.0 | grep 01:00.0 | tail -n 1
    become: true
    when: inventory_hostname == "10.90.1.1"
```
