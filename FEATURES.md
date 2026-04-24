# Feature Inventory — final_t40

## Ansible Playbooks

| Playbook | Feature | Description |
|---|---|---|
| `00_check_node_connection.yaml` | SSH validation | Verifies SSH and internet connectivity to all 4 nodes |
| `00_setup_sudoers.yaml` | Passwordless sudo | Deploys NOPASSWD sudoers entry for `telmat` on all nodes |
| `01_basic_setup.yaml` | Kill pktgen | Force-kills any leftover pktgen processes before setup |
| `01_basic_setup.yaml` | Bind NICs to kernel | Runs `bind-to-kernel.sh` to restore NIC from DPDK to `ice` driver |
| `01_basic_setup.yaml` | Interface up + flush | Brings interfaces up and flushes stale IPv4/IPv6 addresses |
| `01_basic_setup.yaml` | IPv4 addressing | Assigns per-node IPv4 addresses across 192.168.46.x and 192.168.56.x subnets |
| `01_basic_setup.yaml` | IPv6 addressing | Assigns per-node IPv6 addresses in fd00::/64 ranges |
| `02_setup_route.yaml` | IPv4 static routes | Adds static routes on Node4/Node5 to reach opposite subnets via Node6 |
| `02_setup_route.yaml` | IPv6 static routes | Same as above for IPv6 |
| `02_setup_route.yaml` | IPv4 forwarding on Node6 | Sets `net.ipv4.ip_forward=1` to enable routing on the forwarder node |
| `02_setup_route.yaml` | IPv6 forwarding on Node6 | Sets `net.ipv6.conf.all.forwarding=1` on Node6 |
| `02_setup_route.yaml` | Connectivity ping test | Runs pings from each node to all others and prints a per-node pass/fail recap |
| `03_setup_scripts.yaml` | Deploy .pkt files | Copies node1_send.pkt / node4_send.pkt to their respective sender nodes |
| `03_setup_scripts.yaml` | Deploy getstats.lua | Copies the pktgen stats-collection Lua script to all DPDK nodes |
| `03_setup_scripts.yaml` | Deploy bind-to-DPDK.sh | Copies the DPDK driver-binding script to DPDK nodes and creates scripts dir |
| `03_setup_scripts.yaml` | Bind NICs to DPDK | Executes `bind-to-DPDK.sh` to bind interfaces to `vfio-pci` on each node |
| `04_start_pktgen.yaml` | Load pktgen config | Reads pktgen_config.json to determine which nodes are active senders |
| `04_start_pktgen.yaml` | Kill old pktgen | Force-kills any pre-existing pktgen processes before launching |
| `04_start_pktgen.yaml` | Create tmux sessions | Creates named `pktgen` tmux sessions on sender/receiver nodes |
| `04_start_pktgen.yaml` | Launch pktgen | Starts pktgen binary with CPU affinity and port/queue args per node |
| `04_start_pktgen.yaml` | Dashboard start signal | Emits `DASHBOARD_SIGNAL: waiting_for_start` and blocks on `/tmp/ansible_pktgen_start` file |
| `04_start_pktgen.yaml` | Start traffic | Sends `start 0` via tmux when dashboard signals ready |
| `04_start_pktgen.yaml` | Load getstats.lua | Launches real-time pps/bps CSV collection on all DPDK nodes |
| `04_start_pktgen.yaml` | Enable latency measurement | Activates pktgen latency mode on sender and receiver nodes |
| `04_start_pktgen.yaml` | mpstat CPU collection | Starts `mpstat -P ALL` at 1s interval on all nodes, logs to `/tmp/cpu_mpstat.log` |
| `04_start_pktgen.yaml` | Dashboard stop signal | Emits `DASHBOARD_SIGNAL: waiting_for_stop` and blocks on `/tmp/ansible_pktgen_stop` file |
| `04_start_pktgen.yaml` | Stop traffic | Sends `stop 0` via tmux when dashboard signals done |
| `04_start_pktgen.yaml` | Stop mpstat | Kills mpstat processes on all nodes after traffic stops |
| `04_start_pktgen.yaml` | Collect latency stats | Runs getlatency.lua on receiver node to capture min/avg/max/jitter |
| `04_start_pktgen.yaml` | Quit pktgen | Gracefully quits pktgen via tmux after experiment |
| `04_start_pktgen.yaml` | Create results directory | Makes timestamped `/home/telmat/final_t40/results/pktgen_stats_YYYYMMDD_HHMMSS` dir |
| `04_start_pktgen.yaml` | Fetch CSV stats | Downloads node1.csv, node4.csv, node5.csv from each DPDK node |
| `04_start_pktgen.yaml` | Fetch latency log | Downloads node5_latency.log from receiver |
| `04_start_pktgen.yaml` | Fetch mpstat logs | Downloads CPU logs from all nodes |
| `04_start_pktgen.yaml` | Save .pkt scripts | Archives the .pkt files used in the experiment for reproducibility |
| `04_start_pktgen.yaml` | Final kill pktgen | Force-kills pktgen after results are fetched |
| `05_setup_kernel_node6.yaml` | Unload XDP | Removes any attached XDP program from Node6 interfaces |
| `05_setup_kernel_node6.yaml` | Kernel-mode IPs | Assigns 192.168.46.6 and 192.168.56.6 to Node6 interfaces |
| `05_setup_kernel_node6.yaml` | Enable IP forwarding | Enables IPv4 forwarding on Node6 for kernel-mode routing |
| `05_setup_kernel_node6.yaml` | Static ARP entries | Adds 4 static ARP entries mapping DPDK node IPs to their MACs on Node6 |
| `05_setup_xdp_node6.yaml` | Unload XDP | Removes any currently attached XDP program from Node6 |
| `05_setup_xdp_node6.yaml` | Attach XDP redirect | Loads XDP program on ingress interface with redirect to egress |
| `05_setup_xdp_node6.yaml` | Populate forwarding table | Adds 2 forwarding entries (Node5 MAC, Node1 right MAC) to the XDP map |

---

## Shell Scripts

| Script | Feature | Description |
|---|---|---|
| `start.sh` | Full dev stack launch | Kills stale processes and starts backend (:8765), frontend (:5173), xdpd (:8080), fwd (:8081) |
| `start2.sh` | Turbo stack launch | Same as start.sh but launches xdpd via `start_turbo.sh` in turbo mode on :9898 |
| `xdp-go-optimized/langsung.sh` | Quick xdpd rebuild | Kills xdpd, rebuilds binary, relaunches on :8085 with turbo.json |
| `xdp-go-optimized/start_turbo.sh` | Disable irqbalance | Stops irqbalance service to allow manual IRQ pinning |
| `xdp-go-optimized/start_turbo.sh` | CPU performance governor | Sets CPUs to performance governor for assigned core range |
| `xdp-go-optimized/start_turbo.sh` | NIC queue tuning | Configures NIC TX/RX queue count to match CPU count via ethtool |
| `xdp-go-optimized/start_turbo.sh` | IRQ affinity pinning | Pins each NIC interrupt to a dedicated CPU core |
| `xdp-go-optimized/start_turbo.sh` | XPS queue steering | Configures transmit packet steering per TX queue |
| `xdp-go-optimized/start_turbo.sh` | Launch xdpd pinned | Starts xdpd with `taskset` CPU pinning and tuned config |
| `scripts/bind-to-kernel.sh` | Bind NIC to ice driver | Loads ice + vfio-pci modules, rebinds PCI device from DPDK to kernel ice driver |
| `scripts/bind-to-DPDK.sh` | Bind NIC to vfio-pci | Loads vfio-pci module and binds PCI device to DPDK (vfio-pci) driver |

---

## Pktgen Lua Scripts

| Script | Feature | Description |
|---|---|---|
| `scripts/getstats.lua` | Real-time stats CSV | Polls pktgen every second and writes all port metrics to `/tmp/pktgen_stats.log` |
| `scripts/getlatency.lua` | Latency capture | Reads pktgen latency stats (min/avg/max/jitter ns) and writes to `/tmp/pktgen_latency.log` |

---

## PKT Files (Pktgen Traffic Profiles)

| File | Feature | Description |
|---|---|---|
| `pkt_files/node1_send.pkt` | Node1 → Node5 traffic | UDP 64-byte range-mode traffic from 192.168.46.1 to 192.168.56.5 via Node6 |
| `pkt_files/node4_send.pkt` | Node4 → Node1 traffic | UDP 64-byte range-mode traffic from 192.168.46.4 to 192.168.56.1 via Node6 |

---

## Dashboard Backend (FastAPI)

| Module | Feature | Description |
|---|---|---|
| `main.py` | List playbooks API | `GET /api/playbooks` — returns the 6 playbooks with id and description |
| `main.py` | Run playbook API | `POST /api/playbooks/{id}/run` — launches a playbook, supports variant selection for playbook 05 |
| `main.py` | Run all API | `POST /api/jobs/run-all` — runs playbooks 00-04 sequentially |
| `main.py` | Job status API | `GET /api/jobs/{job_id}` — returns job status, pause state, and exit code |
| `main.py` | Job signal API | `POST /api/jobs/{job_id}/signal` — sends start_traffic / stop_traffic / abort to a running job |
| `main.py` | Node registry API | `GET /api/node-registry` — lists all nodes with enabled flag and assigned pkt_file |
| `main.py` | Update node API | `PATCH /api/node-registry/{ip}` — enables/disables a node or changes its pkt_file |
| `main.py` | List pkt files API | `GET /api/pkt-files` — lists .pkt files available in pkt_files/ dir |
| `main.py` | Read pkt file API | `GET /api/pkt-files/{name}` — returns content of a .pkt file |
| `main.py` | Write pkt file API | `PUT /api/pkt-files/{name}` — saves updated content to a .pkt file |
| `main.py` | Read pktgen config API | `GET /api/pktgen-config` — returns current enabled-nodes JSON config |
| `main.py` | Write pktgen config API | `PUT /api/pktgen-config` — updates the pktgen config |
| `main.py` | List results API | `GET /api/results` — lists experiment directories sorted by time with display name/description |
| `main.py` | Metrics summary API | `GET /api/results/{exp}/metrics` — computes or returns cached 8-metric performance summary |
| `main.py` | Rename experiment API | `PUT /api/results/{exp}/rename` — saves display_name to meta.json |
| `main.py` | Describe experiment API | `PUT /api/results/{exp}/description` — saves description to meta.json |
| `main.py` | CPU timeseries API | `GET /api/results/{exp}/cpu/{node}` — returns parsed per-core CPU % timeseries from mpstat |
| `main.py` | Latency metrics API | `GET /api/results/{exp}/latency` — returns min/avg/max/jitter from node5_latency.log |
| `main.py` | Raw result file API | `GET /api/results/{exp}/{node_file}` — serves individual result CSV or .pkt files |
| `main.py` | WebSocket job stream | `WS /ws/jobs/{job_id}` — streams job log lines and state changes to frontend |
| `main.py` | CORS middleware | Allows cross-origin requests from any origin (open policy) |
| `main.py` | Frontend static serving | Mounts `/frontend/dist` as the static root if it exists |
| `runner.py` | PTY job launch | Spawns ansible-playbook in a PTY and tracks it as a Job dataclass |
| `runner.py` | Signal marker detection | Parses stdout for `DASHBOARD_SIGNAL:` lines to update job pause_state |
| `runner.py` | Signal file injection | Creates `/tmp/ansible_pktgen_start` or `_stop` files to unblock the playbook |
| `runner.py` | Job abort | Sends SIGTERM to the running playbook process |
| `runner.py` | Sequential run-all | Runs playbooks 00–04 in order, stops on first non-zero exit |
| `runner.py` | WebSocket broadcast | Pushes each log line and state change to all subscribed WebSocket clients |
| `metrics.py` | Auto-detect sender/receiver | Identifies sender (highest opackets) and receiver (highest ipackets) from CSVs |
| `metrics.py` | Delta computation | Converts cumulative pktgen counters to per-second rates, skipping 2s ramp-up |
| `metrics.py` | 8-metric summary | Computes peak_pps, peak_gbps, injection_pps, loss%, NIC drop rate, efficiency%, stddev |
| `metrics.py` | Metrics caching | Saves computed metrics to `metrics_summary.json` to avoid recomputation |
| `cpu_metrics.py` | mpstat CSV parse | Converts raw mpstat output to a per-core timeseries CSV |
| `cpu_metrics.py` | CPU CSV caching | Saves parsed CPU CSV per node to avoid re-parsing |
| `node_registry.py` | Node state persistence | Loads/saves node enabled+pkt_file state to `node_registry.json` |
| `node_registry.py` | pktgen_config sync | Regenerates pktgen_config.json from enabled nodes whenever registry is updated |
| `pkt_editor.py` | Path traversal guard | Validates .pkt filenames to prevent directory traversal attacks |
| `pkt_editor.py` | Atomic file writes | Uses temp-file + rename pattern for safe concurrent .pkt writes |
| `ws_manager.py` | WebSocket channel management | Maintains per-job subscriber sets and cleans up dead connections on broadcast |
