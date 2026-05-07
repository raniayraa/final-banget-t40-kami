# Ansible Playbook Diagrams

## Section 1 — System Overview

High-level view of the three subsystems and how they interact.

```mermaid
flowchart LR
    Konfigurasi(["⚙️ Konfigurasi\n(User Input)"])

    subgraph SUB1["Subsistem 1: Dashboard"]
        Dashboard["Dashboard\n(Web UI + Backend)"]
    end

    subgraph SUB3["Subsistem 3: Ansible"]
        Ansible["Ansible\n(Playbook Orchestrator)"]
    end

    subgraph SUB2["Subsistem 2: Eksperimen eBPF/XDP"]
        Node1["Node 1\n(Sender & Receiver)"]
        Node4["Node 4\n(Sender)"]
        Node5["Node 5\n(Receiver)"]
        Node6["Node 6\n(Router / Forwarder)"]
    end

    Konfigurasi -->|"pktgen config\n& ansible config"| Dashboard
    Dashboard -->|"trigger playbook\n+ start/stop signals"| Ansible
    Ansible -->|"SSH commands"| Node1
    Ansible -->|"SSH commands"| Node4
    Ansible -->|"SSH commands"| Node5
    Ansible -->|"SSH commands"| Node6
    Node1 & Node4 & Node5 & Node6 -->|"results"| Dashboard
```

---

## Section 2 — Script 00: Check Node Connectivity

Ansible verifies SSH reachability to all nodes, then checks external internet connectivity.

```mermaid
flowchart LR
    Ansible["Ansible\n(00_check_node_connection.yaml)"]

    Node1["Node 1\n(10.90.1.1)"]
    Node4["Node 4\n(10.90.1.4)"]
    Node5["Node 5\n(10.90.1.5)"]
    Node6["Node 6\n(10.90.1.6)"]
    Internet(["🌐 Internet\n(8.8.8.8)"])

    Ansible -->|"SSH ping"| Node1
    Ansible -->|"SSH ping"| Node4
    Ansible -->|"SSH ping"| Node5
    Ansible -->|"SSH ping"| Node6

    Node1 -->|"ping 8.8.8.8"| Internet
    Node4 -->|"ping 8.8.8.8"| Internet
    Node5 -->|"ping 8.8.8.8"| Internet
    Node6 -->|"ping 8.8.8.8"| Internet
```

---

## Section 3 — Script 01: Basic Setup

Ansible kills any running pktgen processes, rebinds NICs to kernel driver, and assigns IP addresses to each node's interfaces.

```mermaid
flowchart TD
    Ansible["Ansible\n(01_basic_setup.yaml)"]

    subgraph N4["Node 4 (10.90.1.4)"]
        N4A["kill pktgen\nbind NIC → kernel"]
        N4B["enp1s0f1np1\n192.168.46.4/24\nfd00:46::4/64"]
        N4A --> N4B
    end

    subgraph N5["Node 5 (10.90.1.5)"]
        N5A["kill pktgen\nbind NIC → kernel"]
        N5B["enp1s0f1np1\n192.168.56.5/24\nfd00:56::5/64"]
        N5A --> N5B
    end

    subgraph N6["Node 6 (10.90.1.6)"]
        N6A["enp1s0f0np0\n192.168.56.6/24\nfd00:56::6/64"]
        N6B["enp1s0f1np1\n192.168.46.6/24\nfd00:46::6/64"]
    end

    subgraph N1["Node 1 (10.90.1.1)"]
        N1A["kill pktgen\nbind NICs → kernel"]
        N1B["enp1s0f0np0\n192.168.46.1/24\nfd00:46::1/64"]
        N1C["enp1s0f1np1\n192.168.56.1/24\nfd00:56::1/64"]
        N1A --> N1B
        N1A --> N1C
    end

    Ansible --> N4
    Ansible --> N5
    Ansible --> N6
    Ansible --> N1
```

---

## Section 4 — Script 02: Setup Route & Testing

Ansible configures static routes on sender/receiver nodes, enables IP forwarding on the router (Node 6), and validates end-to-end connectivity with ping tests.

```mermaid
flowchart LR
    Ansible["Ansible\n(02_setup_route.yaml)"]

    Node4["Node 4\nroute 192.168.56.0/24\nvia 192.168.46.6"]
    Node5["Node 5\nroute 192.168.46.0/24\nvia 192.168.56.6"]
    Node6["Node 6\nip_forward = 1\nipv6_forward = 1"]
    Node1["Node 1\n(dual-homed,\nno extra route)"]

    Ansible --> Node4
    Ansible --> Node5
    Ansible --> Node6
    Ansible --> Node1

    Node4 <-->|"ping test\nvia Node 6"| Node1
    Node4 <-->|"ping test\nvia Node 6"| Node5
    Node1 <-->|"ping test\nvia Node 6"| Node5
```

---

## Section 5 — Script 03: Setup Scripts & DPDK Binding

Ansible deploys pktgen packet scripts and Lua stat/latency collection scripts to each node, then rebinds NICs from kernel to DPDK driver.

```mermaid
flowchart LR
    Ansible["Ansible\n(03_setup_scripts.yaml)"]

    subgraph FILES["Files Deployed"]
        PKT1["node1_send.pkt"]
        PKT4["node4_send.pkt"]
        LUA["getstats.lua\ngetlatency.lua"]
        BINDSCRIPT["bind-to-DPDK.sh"]
    end

    subgraph N1["Node 1"]
        N1R["~/node1_send.pkt\n~/scripts/getstats.lua\n~/scripts/getlatency.lua"]
        N1D["NIC 0 + NIC 1\n→ DPDK (vfio-pci)"]
        N1R --> N1D
    end

    subgraph N4["Node 4"]
        N4R["~/node4_send.pkt\n~/scripts/getstats.lua\n~/scripts/getlatency.lua"]
        N4D["NIC 1\n→ DPDK (vfio-pci)"]
        N4R --> N4D
    end

    subgraph N5["Node 5"]
        N5R["~/scripts/getstats.lua\n~/scripts/getlatency.lua"]
        N5D["NIC 1\n→ DPDK (vfio-pci)"]
        N5R --> N5D
    end

    Node6["Node 6\n(no pkt script,\nno DPDK binding)"]

    PKT1 -->|"copy"| N1
    PKT4 -->|"copy"| N4
    LUA -->|"copy"| N1
    LUA -->|"copy"| N4
    LUA -->|"copy"| N5
    BINDSCRIPT -->|"copy + execute"| N1
    BINDSCRIPT -->|"copy + execute"| N4
    BINDSCRIPT -->|"copy + execute"| N5

    Ansible --> FILES
    Ansible -.->|"no action"| Node6
```

---

## Section 6 — Script 04: Start Pktgen & Collect Results

The most complex playbook. Ansible and the Dashboard communicate via signal files to control traffic generation and collect experiment results.

```mermaid
flowchart LR
    Ansible["Ansible\n(04_start_pktgen.yaml)"]

    subgraph EXP["eBPF/XDP Experiment"]
        direction TB
        Node1["Node 1\n(Sender & Receiver)"]
        Node4["Node 4\n(Sender)"]
        Node5["Node 5\n(Receiver)"]
        Node6["Node 6\n(Router / Forwarder)"]
    end

    Results[("results/\npktgen_stats_YYYYMMDD_HHMMSS/\n- node1.csv, node4.csv, node5.csv\n- node5_latency.log\n- node1,4,5,6_mpstat.log")]

    Ansible -->|"trigger\n(start/stop signals)"| Node1
    Ansible -->|"trigger\n(start/stop signals)"| Node4
    Ansible -->|"trigger\n(start/stop signals)"| Node5
    Ansible -->|"trigger\n(start/stop signals)"| Node6
    Node1 -->|"output"| Results
    Node4 -->|"output"| Results
    Node5 -->|"output"| Results
    Node6 -->|"output"| Results
```

---

## Section 7 — Script 05: Node 6 Forwarding Setup

Two mutually exclusive variants for configuring how Node 6 forwards packets between the two network segments.

```mermaid
flowchart TD
    Ansible["Ansible\n(05_setup_node6.yaml)"]

    Ansible --> VariantChoice{{"Variant?"}}

    subgraph KERNEL["Variant: kernel"]
        direction TD
        K1["Unload XDP program\n(if any attached)"]
        K2["Assign IPs on both interfaces\n192.168.56.6/24 & 192.168.46.6/24"]
        K3["Set static ARP entries\nNode1 MAC @ 192.168.46.1\nNode4 MAC @ 192.168.46.4\nNode5 MAC @ 192.168.56.5"]
        K4["Verify: ARP table, IP addrs,\nrouting table"]
        K1 --> K2 --> K3 --> K4
    end

    subgraph XDP["Variant: xdp"]
        direction TD
        X1["Unload previous XDP program\n(if any attached)"]
        X2["Attach XDP redirect program\nto ingress NIC (enp1s0f0np0)"]
        X3["Populate XDP forwarding table\n192.168.56.5 → Node5 MAC\n192.168.56.1 → Node1 MAC"]
        X4["Verify: XDP forwarding table"]
        X1 --> X2 --> X3 --> X4
    end

    VariantChoice -->|"--extra-vars variant=kernel"| KERNEL
    VariantChoice -->|"--extra-vars variant=xdp"| XDP

    KERNEL --> Node6K["Node 6\n(Kernel IP Forwarding)"]
    XDP --> Node6X["Node 6\n(XDP Fast Path)"]
```
