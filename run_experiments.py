#!/usr/bin/env python3

import argparse
import json
import os
import random
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).parent
ANSIBLE_DIR = BASE_DIR / "ansible"
PKT_FILES_DIR = BASE_DIR / "dashboard" / "pkt_files"
PKTGEN_CONFIG = BASE_DIR / "dashboard" / "pktgen_config.json"
RESULTS_DIR = BASE_DIR / "results"
INVENTORY = ANSIBLE_DIR / "inventory.ini"

SETUP_PLAYBOOKS = [
    "00_check_node_connection.yaml",
    "01_basic_setup.yaml",
    "02_setup_route.yaml",
    "03_setup_scripts.yaml",
]
PKTGEN_PLAYBOOK = "05_start_pktgen.yaml"

START_SIGNAL = Path("/tmp/ansible_pktgen_start")
STOP_SIGNAL = Path("/tmp/ansible_pktgen_stop")

TRAFFIC_VARIANTS = [
    ("41",    {"10.90.1.4": "/home/telmat/node4_send.pkt"}),
    ("15",    {"10.90.1.1": "/home/telmat/node1_send.pkt"}),
    ("15_41", {"10.90.1.4": "/home/telmat/node4_send.pkt",
               "10.90.1.1": "/home/telmat/node1_send.pkt"}),
]

MODE_CONFIG = {
    "vpp":    {"setup04": "04_setup_vpp_node6.yaml",    "prefix": "VPP"},
    "xdp":    {"setup04": "04_setup_xdp_node6.yaml",    "prefix": "XDP"},
    "kernel": {"setup04": "04_setup_kernel_node6.yaml", "prefix": "Kernel"},
}


def log(msg: str) -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


DST_PORT_OFFSET = 4409  # keeps dst ports in a different range from src for RSS diversity

def update_pkt_files(num_ports: int) -> None:
    src_start = 1024
    src_max   = 1023 + num_ports
    dst_start = src_start + DST_PORT_OFFSET
    dst_max   = src_max   + DST_PORT_OFFSET
    for name in ("node1_send.pkt", "node4_send.pkt"):
        path = PKT_FILES_DIR / name
        content = path.read_text()
        content = re.sub(r"(range 0 src port start\s+)\d+", rf"\g<1>{src_start}", content)
        content = re.sub(r"(range 0 src port min\s+)\d+",   rf"\g<1>{src_start}", content)
        content = re.sub(r"(range 0 src port max\s+)\d+",   rf"\g<1>{src_max}",   content)
        content = re.sub(r"(range 0 dst port start\s+)\d+", rf"\g<1>{dst_start}", content)
        content = re.sub(r"(range 0 dst port min\s+)\d+",   rf"\g<1>{dst_start}", content)
        content = re.sub(r"(range 0 dst port max\s+)\d+",   rf"\g<1>{dst_max}",   content)
        path.write_text(content)


def update_pktgen_config(cfg: dict) -> None:
    PKTGEN_CONFIG.write_text(json.dumps(cfg, indent=2) + "\n")


def run_playbook(playbook: str, dry_run: bool, required: bool = True) -> None:
    cmd = ["ansible-playbook", "-i", str(INVENTORY), playbook]
    log(f"  ansible-playbook {playbook}")
    if dry_run:
        return
    result = subprocess.run(cmd, cwd=str(ANSIBLE_DIR))
    if result.returncode != 0:
        if required:
            raise RuntimeError(f"Playbook {playbook} failed (exit {result.returncode})")
        log(f"  WARNING: {playbook} exited {result.returncode} — continuing")


def clean_stale_signals() -> None:
    START_SIGNAL.unlink(missing_ok=True)
    STOP_SIGNAL.unlink(missing_ok=True)


def find_new_result(before: set) -> str | None:
    after = set(os.listdir(RESULTS_DIR))
    new_dirs = [d for d in (after - before) if d.startswith("pktgen_stats_")]
    if not new_dirs:
        return None
    return sorted(new_dirs)[-1]


def rename_result(raw_name: str, prefix: str, num_ports: int, suffix: str) -> str:
    target_name = f"{prefix}_{num_ports}_Port_No_Block_{suffix}"
    src = RESULTS_DIR / raw_name
    dst = RESULTS_DIR / target_name
    if dst.exists():
        target_name = f"{target_name}_retry"
        dst = RESULTS_DIR / target_name
    shutil.move(str(src), str(dst))
    return target_name


def run_experiment(mode: str, num_ports: int, suffix: str,
                   pktgen_cfg: dict, dry_run: bool,
                   duration: int = 15) -> None:
    prefix = MODE_CONFIG[mode]["prefix"]
    setup04 = MODE_CONFIG[mode]["setup04"]
    label = f"{prefix}_{num_ports}_Port_No_Block_{suffix}"
    log(f"=== START: {label} ===")

    log(f"  Patching pkt files → port max = {1023 + num_ports}")
    if not dry_run:
        update_pkt_files(num_ports)

    log(f"  Writing pktgen_config.json → active nodes: {list(pktgen_cfg.keys())}")
    if not dry_run:
        update_pktgen_config(pktgen_cfg)

    for pb in SETUP_PLAYBOOKS:
        run_playbook(pb, dry_run, required=False)

    # Run mode-specific node6 setup before pktgen
    run_playbook(setup04, dry_run, required=True)

    # Snapshot results dir before pktgen run
    before = set(os.listdir(RESULTS_DIR))

    if not dry_run:
        clean_stale_signals()

    log(f"  Launching {PKTGEN_PLAYBOOK} (background)...")
    if not dry_run:
        proc = subprocess.Popen(
            ["ansible-playbook", "-i", str(INVENTORY), PKTGEN_PLAYBOOK],
            cwd=str(ANSIBLE_DIR),
        )
    else:
        log(f"  [dry-run] ansible-playbook {PKTGEN_PLAYBOOK}")

    log("  Waiting 5s for pktgen to initialize...")
    if not dry_run:
        time.sleep(5)

    log("  Sending start signal...")
    if not dry_run:
        START_SIGNAL.touch()

    log(f"  Experiment running for {duration}s...")
    if not dry_run:
        time.sleep(duration)

    log("  Sending stop signal...")
    if not dry_run:
        STOP_SIGNAL.touch()
        proc.wait()

    if not dry_run:
        raw = find_new_result(before)
        if raw:
            final_name = rename_result(raw, prefix, num_ports, suffix)
            log(f"  Result saved as: {final_name}")
        else:
            log("  WARNING: no new pktgen_stats_* directory found — check ansible output")
    else:
        log(f"  [dry-run] would rename pktgen_stats_* → {label}")

    log(f"=== DONE: {label} ===\n")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Automate pktgen-DPDK experiment variations (VPP / XDP / Kernel)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print actions without running ansible or sleeping")
    parser.add_argument("--mode", choices=["vpp", "xdp", "kernel"],
                        help="Run only one forwarding mode (default: all three)")
    parser.add_argument("--duration", type=int, default=15,
                        help="Seconds to run traffic per experiment (default: 15)")
    parser.add_argument("--direction", choices=["41", "15", "15_41"], nargs="+",
                        help="One or more traffic directions (default: all three)")

    port_group = parser.add_mutually_exclusive_group()
    port_group.add_argument("--ports", type=int, nargs=2, metavar=("START", "END"),
                            default=[1, 10],
                            help="Inclusive range of port counts (default: 1 10)")
    port_group.add_argument("--port-list", type=int, nargs="+", metavar="N",
                            help="Explicit list of port counts, e.g. --port-list 10 100 1000")
    args = parser.parse_args()

    # Resolve port counts to a plain list
    if args.port_list:
        port_counts = sorted(set(args.port_list))
    else:
        start, end = args.ports
        if start < 1 or end > 65535 or start > end:
            sys.exit("Invalid port range")
        port_counts = list(range(start, end + 1))

    modes = [args.mode] if args.mode else ["vpp", "xdp", "kernel"]

    if args.direction:
        selected = set(args.direction)
        variants = [(s, c) for s, c in TRAFFIC_VARIANTS if s in selected]
    else:
        variants = TRAFFIC_VARIANTS

    total = len(modes) * len(variants) * len(port_counts)
    log(f"Starting {total} experiments: modes={modes}, ports={port_counts}, "
        f"directions={[s for s, _ in variants]}")
    if args.dry_run:
        log("DRY-RUN mode — no ansible or sleeps")

    run_num = 0
    for mode in modes:
        log(f"\n{'='*60}")
        log(f"MODE: {mode.upper()}")
        log(f"{'='*60}")

        for suffix, pktgen_cfg in variants:
            for num_ports in port_counts:
                run_num += 1
                log(f"--- Run {run_num}/{total} ---")
                run_experiment(mode, num_ports, suffix, pktgen_cfg, args.dry_run,
                               duration=args.duration)

    log(f"All {total} experiments complete.")


if __name__ == "__main__":
    main()
