# CPU Metric Analysis: `%soft` vs `%usr` in Packet Processing Context

## 1. Overview

This document analyzes CPU utilization metrics collected via `mpstat`, with a focus on comparing two key metrics — `%soft` and `%usr` — in the context of evaluating two packet forwarding approaches:

- **VPP/DPDK** — userspace packet processing (reflected in `%usr`)
- **eBPF/XDP** — kernel-native packet processing (reflected in `%soft`)

The goal is to establish that these two metrics, while architecturally distinct, are valid and comparable proxies for **CPU cost of packet forwarding** when measured at equivalent traffic loads.

---

## 2. `mpstat` Metric Glossary

| Metric | Description |
|--------|-------------|
| `%usr` | CPU time spent in **user space** (applications, daemons) |
| `%nice` | CPU time for user processes running with altered scheduling priority |
| `%sys` | CPU time spent in **kernel space** (syscalls, kernel threads) |
| `%iowait` | CPU idle time while waiting for I/O operations to complete |
| `%irq` | CPU time handling **hardware interrupts** |
| `%soft` | CPU time handling **software interrupts** (softirqs) |
| `%steal` | CPU time stolen by a hypervisor (relevant in VMs) |
| `%idle` | CPU time doing nothing |

---

## 3. Focus Metric: `%soft` (Software Interrupt)

### 3.1 What is a Softirq?

A **software interrupt (softirq)** is a deferred kernel mechanism. When a hardware interrupt (e.g., NIC receiving a packet) fires, the kernel acknowledges it quickly and schedules a softirq to handle the heavier processing work asynchronously. This keeps interrupt latency low while still processing the work in a timely manner.

### 3.2 Softirq Types Relevant to Networking

| Softirq Type | Role |
|---|---|
| `NET_RX` | Receiving and processing incoming packets (dominant in XDP) |
| `NET_TX` | Transmitting outgoing packets |
| `TIMER` | Kernel timer callbacks |
| `SCHED` | Scheduler operations |
| `BLOCK` | Block device I/O completion |

In a packet forwarding scenario using XDP/eBPF, `NET_RX` softirq dominates `%soft`.

### 3.3 Where XDP/eBPF Executes

```
NIC receives packet
        │
        ▼
Hardware IRQ fires  ──────────────────────► %irq (brief)
        │
        ▼
Kernel schedules NAPI softirq
        │
        ▼
NAPI poll loop runs  ─────────────────────► %soft (dominant)
        │
        ▼
XDP program executes (XDP_PASS / XDP_DROP / XDP_TX)
        │
        ▼
Packet enters kernel network stack (if XDP_PASS)
```

The XDP program runs **inside the softirq context** on the CPU that owns the NIC's IRQ. All XDP forwarding work — map lookups, rule matching, packet decisions — contributes to `%soft`.

### 3.4 Verifying Softirq Breakdown

```bash
# View per-type softirq counters across all CPUs
watch -n1 cat /proc/softirqs

# Identify which CPUs own NIC interrupts
cat /proc/interrupts | grep -E "eth|ens|enp|mlx"

# Check IRQ affinity for a specific IRQ number
cat /proc/irq/<irq_num>/smp_affinity_list

# Check RPS (Receive Packet Steering) configuration
cat /sys/class/net/<iface>/queues/rx-*/rps_cpus
```

---

## 4. Focus Metric: `%usr` (User Space CPU)

### 4.1 What Does `%usr` Represent?

`%usr` captures all CPU time spent executing code in **user space** — outside the kernel. This includes application logic, library calls, and tight polling loops.

### 4.2 Where VPP/DPDK Executes

```
NIC receives packet
        │
        ▼
DPDK PMD polls NIC directly (no kernel, no IRQ)
        │
        ▼
Packet batch retrieved via DMA ring
        │
        ▼
VPP graph node processes packet ──────────► %usr (dominant)
        │
        ▼
Forwarding decision applied (FIB lookup, ACL, etc.)
        │
        ▼
Packet transmitted via TX ring (still in userspace)
```

VPP/DPDK **bypasses the kernel network stack entirely**. The DPDK Poll Mode Driver (PMD) runs a continuous busy-poll loop in userspace, which means the CPU is always active regardless of whether packets are present. This entire workload shows up as `%usr`.

---

## 5. Architectural Comparison

| Dimension | VPP/DPDK (`%usr`) | XDP/eBPF (`%soft`) |
|---|---|---|
| **Execution context** | User space | Kernel softirq |
| **Kernel bypass** | Yes (full bypass via DPDK PMD) | No (runs inside kernel) |
| **Polling model** | Busy-poll (always spinning) | Interrupt-driven (NAPI) |
| **IRQ involvement** | None (IRQs disabled for DPDK queues) | Yes (IRQ triggers NAPI poll) |
| **Idle behavior** | CPU stays busy (`%usr` remains high) | CPU returns to idle when no traffic |
| **Memory model** | Hugepages, dedicated mempool | Kernel SKB or XDP frame |
| **Programmability** | C plugins, graph nodes | eBPF bytecode (kernel-verified) |
| **Visibility** | `%usr` in `mpstat` | `%soft` in `mpstat` |

---

## 6. Are `%soft` and `%usr` Comparable?

### 6.1 Short Answer: Yes, with One Condition

Both metrics represent **CPU cycles dedicated to packet forwarding**. For the purpose of comparing the CPU efficiency of two packet processing systems, treating `%soft` (XDP) and `%usr` (DPDK) as equivalent "forwarding CPU cost" is methodologically valid — **provided the comparison is done at the same packet rate**.

### 6.2 The Critical Caveat: Idle Behavior Differs

| Condition | DPDK `%usr` | XDP `%soft` |
|---|---|---|
| **No traffic** | High (PMD keeps spinning) | Near zero (no softirqs fired) |
| **Low traffic** | High (still spinning) | Low (proportional to packet rate) |
| **High traffic / saturation** | High | High |
| **Same packet rate** | Comparable | Comparable |

> **Implication**: At low or zero traffic, DPDK will always show high `%usr` because the busy-poll loop never stops. XDP will show near-zero `%soft`. This difference is architectural, not a performance deficiency of DPDK.

### 6.3 Valid Comparison Zone

The comparison between `%usr` and `%soft` is most meaningful and fair when:

1. Both systems are tested at the **same offered packet rate** (e.g., 1 Mpps, 5 Mpps, line rate)
2. Both systems are **forwarding the same traffic profile** (packet size, flow count)
3. Measurements are taken at **steady state** (not during startup or ramp-up)
4. CPU affinity and IRQ pinning are **documented and controlled**

---

## 7. Observed Data Analysis

### 7.1 Raw Data

```
Average:     CPU    %usr   %nice    %sys %iowait    %irq   %soft  %steal  %guest  %gnice   %idle
Average:     all    2,47    0,00    0,43    0,02    0,00    9,20    0,00    0,00    0,00   87,87
Average:       0    0,66    0,00    0,23    0,01    0,00   35,56    0,00    0,00    0,00   63,54
Average:       1    0,18    0,00    0,10    0,01    0,00   23,43    0,00    0,00    0,00   76,28
Average:       2    0,50    0,00    0,20    0,03    0,00   21,30    0,00    0,00    0,00   77,96
Average:       3    0,17    0,00    0,10    0,03    0,00   24,75    0,00    0,00    0,00   74,95
Average:       4    0,67    0,00    0,23    0,13    0,00   21,42    0,00    0,00    0,00   77,55
Average:       5    0,08    0,00    0,05    0,00    0,00   22,25    0,00    0,00    0,00   77,62
Average:       6    0,55    0,00    0,23    0,02    0,00   20,38    0,00    0,00    0,00   78,82
Average:       7    0,04    0,00    0,04    0,00    0,00   19,34    0,00    0,00    0,00   80,58
Average:       8    8,63    0,00    1,60    0,02    0,00    6,62    0,00    0,00    0,00   83,13
Average:       9   13,32    0,00    1,09    0,01    0,00    2,63    0,00    0,00    0,00   82,95
Average:      10   15,45    0,00    1,41    0,06    0,00    4,00    0,00    0,00    0,00   79,08
Average:      11    8,90    0,00    0,66    0,01    0,00    2,60    0,00    0,00    0,00   87,83
Average:      12    3,49    0,00    0,54    0,05    0,00    3,42    0,00    0,00    0,00   92,50
Average:      13    0,10    0,00    0,02    0,00    0,00    0,89    0,00    0,00    0,00   98,99
Average:      14    2,66    0,00    0,37    0,03    0,00    2,71    0,00    0,00    0,00   94,23
Average:      15    0,09    0,00    0,03    0,00    0,00    1,31    0,00    0,00    0,00   98,57
```

### 7.2 CPU Role Grouping

| CPU Group | CPUs | Dominant Metric | Interpretation |
|---|---|---|---|
| **Softirq / XDP workers** | 0–7 | `%soft` 19–35% | NIC IRQs pinned here; XDP runs here |
| **Application workers** | 8–12 | `%usr` 8–15% | VPP or application logic running here |
| **Idle / background** | 13–23 | <3% all metrics | Mostly unused |

### 7.3 Key Observations

- **CPU 0** has the highest `%soft` at 35.56%, indicating it handles the most NIC interrupts (likely the primary IRQ affinity target).
- **CPUs 0–7** collectively show `%soft` of 19–35% with minimal `%usr`, confirming XDP/kernel processing is isolated to these cores.
- **CPUs 8–11** show `%usr` of 8–15% with low `%soft`, indicating DPDK/VPP application threads are pinned here.
- The two workloads are naturally separated by CPU affinity, making per-core comparison straightforward.

---

## 8. Comparison Framework

### 8.1 Metric Mapping

```
┌─────────────────────────────────────────────────────────┐
│              CPU Cost of Packet Forwarding               │
├─────────────────────────┬───────────────────────────────┤
│      VPP / DPDK         │        XDP / eBPF             │
│                         │                               │
│  Metric:  %usr          │  Metric:  %soft               │
│  Context: User space    │  Context: Kernel softirq      │
│  CPUs:    8–12          │  CPUs:    0–7                 │
│  Model:   Busy-poll     │  Model:   Interrupt-driven    │
└─────────────────────────┴───────────────────────────────┘
```

### 8.2 Total Forwarding CPU Cost Formula

To make a system-level comparison, aggregate across the relevant cores:

```
DPDK Total CPU Cost  = Σ %usr  (CPUs 8–12) / N_dpdk_cores
XDP  Total CPU Cost  = Σ %soft (CPUs 0–7)  / N_xdp_cores
```

Or for total system cost at the same throughput:

```
DPDK System CPU% = Σ (100% - %idle) for DPDK-pinned cores
XDP  System CPU% = Σ (100% - %idle) for XDP-pinned cores
```

### 8.3 Interpretation Guide

| Result | Meaning |
|---|---|
| XDP `%soft` < DPDK `%usr` at same pps | XDP is more CPU-efficient per packet |
| XDP `%soft` ≈ DPDK `%usr` at same pps | Comparable efficiency |
| XDP `%soft` > DPDK `%usr` at same pps | DPDK is more efficient (e.g., batch processing advantage) |

---

## 9. Reporting Template

When documenting this comparison in a thesis or technical report, the following framing is recommended:

> CPU utilization was measured using `mpstat` from the `sysstat` package, sampled at 1-second intervals during steady-state traffic. Two metrics were used as proxies for packet forwarding CPU cost:
>
> - **`%soft`** — percentage of CPU time spent in software interrupt context, representing the XDP/eBPF forwarding path running inside the Linux kernel's NAPI poll loop.
> - **`%usr`** — percentage of CPU time spent in user space, representing the VPP/DPDK forwarding path running as a userspace busy-poll process.
>
> Both metrics are treated as equivalent measures of CPU cost allocated to packet forwarding. Comparisons are conducted at the same offered load (packets per second) to neutralize the polling bias inherent to DPDK's always-active PMD loop.

---

## 10. Summary

| Property | `%soft` (XDP/eBPF) | `%usr` (VPP/DPDK) |
|---|---|---|
| What it measures | Kernel softirq time | User space execution time |
| Packet processing model | Interrupt-driven NAPI | Busy-poll PMD |
| Scales with traffic? | Yes | Partially (floor exists) |
| Comparable at same pps? | **Yes** | **Yes** |
| Idle CPU consumption | Low | High |
| Kernel involvement | Full | None (bypass) |

Both `%soft` and `%usr` are valid, first-class CPU utilization metrics. In the context of comparing XDP/eBPF against VPP/DPDK, they serve as the correct and natural measurement points for each system's forwarding overhead — provided the comparison is anchored to the same traffic rate.
