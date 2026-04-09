# Ansible Pipeline Flowcharts

This document describes the automation pipeline for provisioning a multi-node DPDK/pktgen test environment. The pipeline is executed sequentially across 5 playbooks.

---

## 1. General System Overview

High-level view of the full pipeline by phase (not by filename).

```mermaid
flowchart TD
    A([Start]) --> B[Check Node Connectivity]
    B --> C[Setup Network Interfaces]
    C --> D[Configure Routes and Forwarding]
    D --> E[Deploy Scripts and Bind DPDK]
    E --> F[Run Traffic Generation]
    F --> G([End])
```

---

## 2. `01_basic_setup.yaml` — Network Interface Setup

Binds NICs to the kernel driver, configures each interface, then assigns IPv4 and IPv6 addresses.

```mermaid
flowchart TD
    A([Start]) --> B[Bind NICs to Kernel Driver]
    B --> C{Node has interface config?}
    C -- No --> Z([End])
    C -- Yes --> D[Bring Up Interface and Flush Addresses]
    D --> E[Assign IPv4 Address]
    E --> F[Assign IPv6 Address]
    F --> G[Verify Interface Addresses]
    G --> Z
```

**Node-to-interface mapping:**

| Node | Interface | IPv4 | IPv6 |
|---|---|---|---|
| 10.90.1.1 | enp1s0f0np0 | 192.168.46.1/24 | fd00:46::1/64 |
| 10.90.1.1 | enp1s0f1np1 | 192.168.56.1/24 | fd00:56::1/64 |
| 10.90.1.4 | enp1s0f1np1 | 192.168.46.4/24 | fd00:46::4/64 |
| 10.90.1.5 | enp1s0f1np1 | 192.168.56.5/24 | fd00:56::5/64 |
| 10.90.1.6 | enp1s0f0np0 | 192.168.56.6/24 | fd00:56::6/64 |
| 10.90.1.6 | enp1s0f1np1 | 192.168.46.6/24 | fd00:46::6/64 |

---

## 3. `02_setup_route.yaml` — Routing and Forwarding

Adds static routes on sender nodes, enables IP forwarding on the router node, then validates connectivity with ping tests.

```mermaid
flowchart TD
    A([Start]) --> B{Node needs static routes?}
    B -- Yes --> C[Add IPv4 Static Routes]
    C --> D[Add IPv6 Static Routes]
    B -- No --> E
    D --> E{Is this the router node?}
    E -- Yes --> F[Enable IPv4 Forwarding]
    F --> G[Enable IPv6 Forwarding]
    E -- No --> H
    G --> H[Display Routing Tables]
    H --> I{Node has ping targets?}
    I -- No --> K
    I -- Yes --> J[Ping All Configured Targets]
    J --> K[Print Global Ping Recap]
    K --> L([End])
```

**Static routes added:**

| Node | Direction | Destination | Via |
|---|---|---|---|
| 10.90.1.4 | IPv4 | 192.168.56.0/24 | 192.168.46.6 (Node6) |
| 10.90.1.4 | IPv6 | fd00:56::/64 | fd00:46::6 (Node6) |
| 10.90.1.5 | IPv4 | 192.168.46.0/24 | 192.168.56.6 (Node6) |
| 10.90.1.5 | IPv6 | fd00:46::/64 | fd00:56::6 (Node6) |

---

## 4. `03_setup_scripts.yaml` — Script and DPDK Deployment

Deploys pktgen send scripts to sender nodes, deploys the DPDK bind helper to nodes 1/4/5, then binds each node's NIC(s) to the DPDK driver.

```mermaid
flowchart TD
    A([Start]) --> B{Node is a sender?}
    B -- Yes --> C[Deploy Pktgen Send Script]
    C --> D[Confirm Script Deployed]
    B -- No --> E
    D --> E{Node uses DPDK?}
    E -- No --> K([End])
    E -- Yes --> F[Ensure Scripts Directory Exists]
    F --> G[Deploy bind-to-DPDK Helper Script]
    G --> H[Confirm Helper Deployed]
    H --> I{Which node?}
    I -- Node 1 --> J1[Bind Both NICs to DPDK]
    I -- Node 4 or 5 --> J2[Bind One NIC to DPDK\nUnbind the Other]
    J1 --> K
    J2 --> K
```

---

## 5. `04_start_pktgen.yaml` — Traffic Generation

Launches pktgen inside a detached tmux session on sender nodes, then interactively prompts the operator to start and stop UDP traffic.

```mermaid
flowchart TD
    A([Start]) --> B{Node is a sender?}
    B -- No --> Z([End])
    B -- Yes --> C[Kill Existing Pktgen Session]
    C --> D[Launch Pktgen in tmux]
    D --> E[Wait for Pktgen to Initialize]
    E --> F[Prompt Operator to Start Traffic]
    F --> G[Start Traffic]
    G --> H[Prompt Operator to Stop Traffic]
    H --> I[Stop Traffic]
    I --> J[Quit Pktgen]
    J --> Z
```

**Pktgen configuration per sender node:**

| Node | Packet File | CPU Core Mapping |
|---|---|---|
| 10.90.1.1 | /home/ansible/node1_send.pkt | `-m [1-3:4-6].0 -m [7-9:10-12].1` |
| 10.90.1.4 | /home/ansible/node4_send.pkt | `-m [1-3:4-6].0` |
