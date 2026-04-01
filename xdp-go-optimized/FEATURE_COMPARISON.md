# Feature Comparison: Python XDP App vs Go XDP App

Comparing `combine-firewall-forwarder/` (Python-managed C binary) against `xdp-go/` (Go daemon + REST API).

Both share the same XDP kernel program core (firewall + L3 forwarding), but differ significantly
in management interface, observability, and operational tooling.

---

## Throughput Parity dengan combine-firewall-forwarder

Serangkaian perubahan telah dilakukan sehingga Go app mencapai throughput maksimal
setara dengan Python/C app. Lihat [TURBO_MODE.md](TURBO_MODE.md) untuk detail lengkap.

### Ringkasan perubahan

| Perubahan | Dampak |
|-----------|--------|
| `FW_CFG_EVENTS_ENABLED` flag (index 7) | Toggle ring buffer on/off at runtime |
| Gate semua `emit_event_*` calls | Zero ring buffer overhead saat turbo mode |
| `BPF_RB_FORCE_WAKEUP` → `BPF_RB_NO_WAKEUP` | Eliminasi context switch per-DROP |
| `XDPGenericMode` → `XDPDriverMode` | Native driver intercept, 5–10× lebih cepat |
| `start_turbo.sh` | System tuning: IRQ affinity, CPU governor, XPS |

### Cara aktifkan turbo mode

```bash
sudo ./start_turbo.sh                     # recommended (dengan system tuning)
# atau
sudo ./xdpd -iface <NIC> -config turbo.json
# atau via REST API saat runtime:
curl -X PUT http://localhost:8080/api/config \
  -d '{"flags": {"events_enabled": false}}'
```

---

## Core Firewall — L3

| Feature | Description | Python App | Go App |
|---------|-------------|:----------:|:------:|
| Block IP Fragments | Drop fragmented IPv4 packets | ✅ | ✅ |
| Block Broadcast | Drop packets destined to 255.255.255.255 | ✅ | ✅ |
| Block Multicast | Drop packets destined to 224.0.0.0/4 | ✅ | ✅ |
| Block by IP Protocol | Drop by IP proto number (e.g. OSPF=89) | ✅ | ✅ |

---

## Core Firewall — L4

| Feature | Description | Python App | Go App |
|---------|-------------|:----------:|:------:|
| Block All TCP | Drop all TCP traffic globally | ✅ | ✅ |
| Block All UDP | Drop all UDP traffic globally | ✅ | ✅ |
| Block TCP by Destination Port | Per-port blocklist (up to 64 entries) | ✅ | ✅ |
| Block UDP by Destination Port | Per-port blocklist (up to 64 entries) | ✅ | ✅ |
| Malformed TCP Detection | NULL scan, XMAS scan, SYN+FIN, RST+FIN | ✅ | ✅ |
| Block ICMP Echo (Ping) | Drop ICMP type 8 echo requests | ✅ | ✅ |
| Default TCP Port Blocklist | Pre-seeded: 20/21/22/23/69/135–139/445/1433/1521/3306/3389/5432/5900 | ✅ | ❌ |
| Default UDP Port Blocklist | Pre-seeded: 53/69/123/137/138/161/162/11211 | ✅ | ❌ |

---

## L3 Forwarding / Routing

| Feature | Description | Python App | Go App |
|---------|-------------|:----------:|:------:|
| Forwarding Table | Exact-match dst IP lookup (up to 4096 routes) | ✅ | ✅ |
| MAC Address Rewrite | Overwrite `eth->h_dest` and `eth->h_source` | ✅ | ✅ |
| TTL Decrement | Decrement TTL + RFC 1624 incremental checksum update | ✅ | ✅ |
| TTL Guard | Packets with TTL ≤ 1 passed to kernel (ICMP TTL Exceeded) | ✅ | ✅ |
| XDP_TX Action | Hairpin forward out same NIC | ✅ | ✅ |
| XDP_REDIRECT Action | Forward to a different NIC via DEVMAP | ✅ | ✅ |
| Multi-Egress NIC Support | Up to 16 egress NICs via DEVMAP slots | ✅ | ✅ |
| Route Add | Add/update a forwarding entry | ✅ | ✅ |
| Route Delete | Remove a forwarding entry by dst IP | ✅ | ✅ |
| Route List | List all active forwarding entries | ✅ | ✅ |

---

## Observability & Statistics

| Feature | Description | Python App | Go App |
|---------|-------------|:----------:|:------:|
| Per-CPU Action Counters | 5 counters: DROP / TX / REDIRECT / PASS / TTL_EXCEEDED | ✅ | ✅ |
| Live Stats Terminal Output | Refreshing pps/bps per action printed to terminal | ✅ | ❌ |
| Stats Refresh Interval Flag | `-i / --interval <sec>` | ✅ | ❌ |
| Ring Buffer Event Stream | Per-packet event: timestamp, src/dst IP, ports, proto, action | ❌ | ✅ |
| SQLite Traffic Log | Persist every packet decision to on-disk SQLite database | ❌ | ✅ |
| Query Logs by Action | Filter traffic history by action (DROP/PASS/TX/REDIRECT/TTL) | ❌ | ✅ |
| Query Logs by Protocol | Filter traffic history by IP protocol number | ❌ | ✅ |
| Query Logs by Time Range | Filter logs: `30s / 5m / 30m / 1h / 6h / 24h` | ❌ | ✅ |
| Query Logs with Row Limit | Cap results at N rows (default 1000, max 5000) | ❌ | ✅ |
| Kernel Trace Pipe Access | `manage.py trace` — tail `bpf_printk` output via trace_pipe | ✅ | ❌ |

---

## Management Interface

| Feature | Description | Python App | Go App |
|---------|-------------|:----------:|:------:|
| CLI Binary | Direct C program (`xdp_fw_fwd`) with flags | ✅ | ❌ |
| Python Automation Script | `manage.py` wrapping all operations as subcommands | ✅ | ❌ |
| REST API | HTTP JSON API for all control operations | ❌ | ✅ |
| Web UI | React frontend served by the Go daemon | ❌ | ✅ |
| CORS Support | Permissive CORS headers for browser-based access | ❌ | ✅ |

### Python App — `manage.py` Subcommands

```
sudo python manage.py check               # Verify prerequisites
sudo python manage.py setup               # Full setup: network + build + attach
sudo python manage.py build               # Compile BPF + userspace programs
sudo python manage.py start               # Attach XDP daemon in background
sudo python manage.py stop                # Detach XDP daemon
sudo python manage.py restart             # Stop then start daemon
sudo python manage.py status              # Show attachment and running state
sudo python manage.py route list          # List all forwarding entries
sudo python manage.py route add <ip> \
     --dst-mac <mac> \
     --src-mac <mac> \
     --action [tx|redirect]               # Add a forwarding route
sudo python manage.py route del <ip>      # Delete a forwarding route
sudo python manage.py monitor [-i SEC]    # Live stats refresh in terminal
sudo python manage.py trace               # Stream kernel trace_pipe output
sudo python manage.py logs [-n LINES]     # Tail daemon process log
sudo python manage.py perf setup          # Apply high-performance NIC tuning
sudo python manage.py perf teardown       # Restore NIC defaults
sudo python manage.py teardown            # Full cleanup: detach + reset network
python  manage.py config                  # Print current manage.cfg config
python  manage.py config KEY=VALUE        # Update a config key
```

### Go App — REST API Endpoints

```
GET    /api/status           Daemon and XDP attachment status
POST   /api/start            Attach XDP program to interface
POST   /api/stop             Detach XDP program
GET    /api/config           Read firewall flags + port/proto blocklists
PUT    /api/config           Update firewall configuration (partial updates OK)
GET    /api/stats/live       Read aggregated live statistics (all 5 counters)
GET    /api/logs             Query traffic logs from SQLite
                               ?action=0-4
                               ?proto=0-255
                               ?range=30s|5m|30m|1h|6h|24h
                               ?limit=N
GET    /api/routes           List all forwarding table entries
POST   /api/routes           Add a forwarding route
DELETE /api/routes/{ip}      Remove route by destination IP
```

---

## Daemon / Process Lifecycle

| Feature | Description | Python App | Go App |
|---------|-------------|:----------:|:------:|
| Start (attach XDP) | Load and attach BPF program to interface | ✅ | ✅ |
| Stop (detach XDP) | Detach program and clean up resources | ✅ | ✅ |
| Restart Daemon | Stop + start in one command | ✅ | ❌ |
| Background Daemon Mode | Run loader as background process | ✅ | ❌ |
| Daemon Logs View | `logs -n N` — tail process log file | ✅ | ❌ |
| Status Check | Show XDP attachment state + daemon running state | ✅ | ✅ |
| Graceful Shutdown | Handle SIGINT/SIGTERM cleanly | ✅ | ✅ |
| BPF Map Pinning | Persist maps at `/sys/fs/bpf/<iface>/` across reloads | ✅ | ✅ |
| Unload + Cleanup | Remove XDP program and all pinned maps | ✅ | ✅ |

---

## Configuration Management

| Feature | Description | Python App | Go App |
|---------|-------------|:----------:|:------:|
| Config File (`manage.cfg`) | Persistent iface names, IPs, ring/NAPI tuning params | ✅ | ❌ |
| XDP Config File (`xdp_config.json`) | Pre-declare routes, ports, flags before first attach | ✅ | ❌ |
| Runtime Config Read | Get current flags/ports/protos from live BPF maps | ❌ | ✅ |
| Runtime Config Write | PUT partial update to flags/ports/protos at runtime | ❌ | ✅ |
| Set Single Firewall Flag (CLI) | `--fw-flag <idx>:<0\|1>` via CLI binary | ✅ | ❌ |
| Set Firewall Flag (API) | JSON body on `PUT /api/config` | ❌ | ✅ |
| Config Key Reference | `cpu.num_cpus`, `firewall_flags.*`, `blocked_ports.*`, `routes[]` | ✅ | ❌ |

---

## System / Performance Tuning

| Feature | Description | Python App | Go App |
|---------|-------------|:----------:|:------:|
| High-Performance Mode Setup | `perf setup` — tune ring buffers + NAPI budget | ✅ | ❌ |
| High-Performance Mode Teardown | `perf teardown` — restore system defaults | ✅ | ❌ |
| NIC RX Ring Buffer Tuning | Set `ring_buffer_rx` via ethtool | ✅ | ❌ |
| NIC TX Ring Buffer Tuning | Set `ring_buffer_tx` via ethtool | ✅ | ❌ |
| NAPI Budget Tuning | Tune `napi_budget` / `napi_budget_usecs` per interface | ✅ | ❌ |
| CPU Count Config | `cpu.num_cpus` for per-CPU stats aggregation | ✅ | ❌ |
| XDP Driver Mode (native) | Attach with `link.XDPDriverMode` — intercept di level driver NIC | ✅ | ✅ |
| Turbo Mode (events off) | `events_enabled=false` — zero ring buffer overhead di hot path | ❌ | ✅ |
| System Tuning Script | IRQ affinity, CPU governor, XPS per queue | ✅ (`xdp_pin_cpus.sh`) | ✅ (`start_turbo.sh`) |

---

## Setup / Build

| Feature | Description | Python App | Go App |
|---------|-------------|:----------:|:------:|
| Prerequisite Check | Verify all system deps before setup | ✅ | ❌ |
| Full Setup Command | One command: network config + build + attach | ✅ | ❌ |
| Build Command | Compile BPF + userspace from source | ✅ | ❌ |
| Full Teardown Command | Undo all setup steps in reverse | ✅ | ❌ |
| IP Address Assignment | Auto-assign IPs to ingress/egress ifaces during setup | ✅ | ❌ |

---

## BPF Maps (Kernel Data Plane)

| Map | Type | Size | Python App | Go App |
|-----|------|------|:----------:|:------:|
| `xdp_stats` | PERCPU_ARRAY | 5 entries | ✅ | ✅ |
| `fw_config` | ARRAY | 8 entries (index 7 = events_enabled) | ✅ | ✅ |
| `blocked_ports_tcp` | HASH | 64 entries | ✅ | ✅ |
| `blocked_ports_udp` | HASH | 64 entries | ✅ | ✅ |
| `blocked_protos` | HASH | 32 entries | ✅ | ✅ |
| `fwd_table` | HASH | 4096 entries | ✅ | ✅ |
| `tx_port` | DEVMAP | 16 entries | ✅ | ✅ |
| `packet_events` | RINGBUF | 256 KB | ❌ | ✅ |
| `sample_counter` | PERCPU_ARRAY | 1 entry | ❌ | ✅ |

---

## Summary

| Category | Python App strengths | Go App strengths |
|----------|----------------------|------------------|
| **Management** | CLI binary + `manage.py` automation with 16 subcommands | REST API (9 endpoints) + React Web UI |
| **Observability** | Kernel trace pipe, terminal live stats with interval | Per-packet ring buffer, SQLite log, queryable history |
| **Performance** | NAPI/ring buffer tuning, `perf setup/teardown` mode | — |
| **Configuration** | File-based (JSON + cfg), default port blocklists, offline config | Runtime API-driven, partial updates, no restart needed |
| **Setup** | Automated prerequisite check, build, network, teardown | XDP generic mode (no native driver required) |
| **Packet Logging** | `bpf_printk` trace (ephemeral, dev only) | Per-packet persistent log: src/dst IP, port, proto, timestamp |

> **In short:** The Python app is richer in operational tooling (setup automation, offline config).
> The Go app is richer in observability (per-packet ring buffer, persistent SQLite traffic logs with
> filters) and remote management (REST API, web UI, runtime config without restart).
> Dengan turbo mode (`events_enabled=false`) + `start_turbo.sh`, throughput Go app setara dengan
> Python/C app karena hot path XDP identik dan system tuning yang sama diterapkan.
