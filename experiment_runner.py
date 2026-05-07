#!/usr/bin/env python3
"""
Experiment automation script for pktgen port-range sweeps.

Sweeps across port counts, forwarder types (VPP → XDP → Kernel), and traffic
directions, running the full ansible playbook sequence for each combination.

Usage examples:
  python experiment_runner.py --ports 1-10 --traffic 41,15,15_41 --inventory hosts.ini
  python experiment_runner.py --ports 1,10,100,1000 --traffic 41 --dry-run
  python experiment_runner.py --ports 1-5,100 --traffic 15_41 --duration 30
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths (match what ansible scripts expect)
# ---------------------------------------------------------------------------
PKT_FILES_DIR = Path("/home/telmat/final_t40/dashboard/pkt_files")
PKTGEN_CONFIG = Path("/home/telmat/final_t40/dashboard/pktgen_config.json")
RESULTS_DIR   = Path("/home/telmat/final_t40/results")
SIGNAL_START  = Path("/tmp/ansible_pktgen_start")
SIGNAL_STOP   = Path("/tmp/ansible_pktgen_stop")

PKT_NODES = ["node1_send.pkt", "node4_send.pkt"]

FORWARDERS = ["vpp", "xdp", "kernel"]

FORWARDER_PLAYBOOK = {
    "vpp":    "04_stup_vpp_node6.yaml",
    "xdp":    "04_setup_xdp_node6.yaml",
    "kernel": "04_setup_kernel_node6.yaml",
}

FORWARDER_LABEL = {
    "vpp":    "VPP",
    "xdp":    "XDP",
    "kernel": "Kernel",
}

PKTGEN_CONFIG_MAP = {
    "41":    {"10.90.1.4": "/home/ansible/node4_send.pkt"},
    "15":    {"10.90.1.1": "/home/ansible/node1_send.pkt"},
    "15_41": {
        "10.90.1.4": "/home/ansible/node4_send.pkt",
        "10.90.1.1": "/home/ansible/node1_send.pkt",
    },
}

VALID_DIRECTIONS = {"41", "15", "15_41"}

SETUP_PLAYBOOKS = [
    "01_basic_setup.yaml",
    "02_setup_route.yaml",
    "03_setup_scripts.yaml",
]

# ---------------------------------------------------------------------------
# Port range parser
# ---------------------------------------------------------------------------

def parse_ports(spec: str) -> list[int]:
    """Parse port spec: "1-10", "1,10,100", "1-5,100,1000" → sorted unique list."""
    result = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            lo, hi = part.split("-", 1)
            lo, hi = int(lo.strip()), int(hi.strip())
            if lo > hi:
                raise ValueError(f"Invalid range {part}: start > end")
            result.update(range(lo, hi + 1))
        else:
            result.add(int(part))
    if not result:
        raise ValueError("No ports parsed from spec: " + spec)
    return sorted(result)


def parse_directions(spec: str) -> list[str]:
    dirs = [d.strip() for d in spec.split(",") if d.strip()]
    for d in dirs:
        if d not in VALID_DIRECTIONS:
            raise ValueError(f"Unknown direction '{d}'. Valid: {', '.join(sorted(VALID_DIRECTIONS))}")
    return dirs

# ---------------------------------------------------------------------------
# Pkt file modification
# ---------------------------------------------------------------------------

PORT_LINE_RE = re.compile(
    r"^(range\s+0\s+(?:src|dst)\s+port\s+(?:start|min|max))\s+(\d+)\s*$"
)


def set_port_range(content: str, n_ports: int) -> str:
    """Rewrite all src/dst port start/min/max lines for n_ports."""
    port_min   = 1024
    port_start = 1024
    port_max   = 1024 + n_ports - 1

    lines = content.splitlines(keepends=True)
    out = []
    for line in lines:
        m = PORT_LINE_RE.match(line)
        if m:
            prefix = m.group(1)
            keyword = prefix.split()[-1]  # start / min / max
            value = {"start": port_start, "min": port_min, "max": port_max}[keyword]
            # preserve original spacing width
            orig_spacing = line[len(m.group(1)):-len(m.group(2).rstrip()) - 1]
            # rebuild with same column width as original (at least one space)
            gap = line[len(m.group(1)) : line.index(m.group(2), len(m.group(1)))]
            out.append(f"{prefix}{gap}{value}\n")
        else:
            out.append(line)
    return "".join(out)


def update_pkt_files(n_ports: int, dry_run: bool) -> None:
    for fname in PKT_NODES:
        path = PKT_FILES_DIR / fname
        if dry_run:
            print(f"    [dry-run] would write port max={1024 + n_ports - 1} to {path}")
            continue
        original = path.read_text()
        updated = set_port_range(original, n_ports)
        path.write_text(updated)


def update_pktgen_config(direction: str, dry_run: bool) -> None:
    config = PKTGEN_CONFIG_MAP[direction]
    if dry_run:
        print(f"    [dry-run] would write pktgen_config.json: {json.dumps(config)}")
        return
    PKTGEN_CONFIG.write_text(json.dumps(config, indent=2) + "\n")

# ---------------------------------------------------------------------------
# Ansible runner
# ---------------------------------------------------------------------------

def run_playbook(playbook: str, ansible_dir: Path, inventory: str,
                 label: str, dry_run: bool) -> bool:
    """Run a playbook synchronously. Returns True on success."""
    cmd = ["ansible-playbook", "-i", inventory, str(ansible_dir / playbook)]
    if dry_run:
        print(f"    [dry-run] would run: {' '.join(cmd)}")
        return True
    print(f"    Running {playbook} ...", end=" ", flush=True)
    result = subprocess.run(cmd, capture_output=False)
    if result.returncode != 0:
        print(f"FAILED (exit {result.returncode})")
        return False
    print("OK")
    return True

# ---------------------------------------------------------------------------
# Result directory renaming and validation
# ---------------------------------------------------------------------------

def unique_name(base: Path) -> Path:
    """Return base, or base_v2, base_v3 etc. if base already exists."""
    if not base.exists():
        return base
    v = 2
    while True:
        candidate = base.parent / f"{base.name}_v{v}"
        if not candidate.exists():
            return candidate
        v += 1


NODE5_CSV_HEADER_SIZE = 23  # "Time,Port,Metric,Value\n" — getstats.lua header only


def validate_results(result_dir: Path, direction: str) -> bool:
    """Check result quality. Returns True if OK, False if node5 data is missing.

    For direction "15" or "15_41", Node 1 sends traffic to Node 5 so node5.csv
    should have more than just the header row. Header-only means the forwarder
    didn't deliver traffic to Node 5 (silent forwarding failure).
    """
    if direction not in ("15", "15_41"):
        return True  # "41" direction never sends to Node 5 — header-only is expected

    node5_csv = result_dir / "node5.csv"
    if not node5_csv.exists():
        print(f"  WARNING [node5]: node5.csv not found in {result_dir.name}")
        return False

    size = node5_csv.stat().st_size
    if size <= NODE5_CSV_HEADER_SIZE:
        print(
            f"  WARNING [node5]: node5.csv is header-only ({size} bytes) in "
            f"{result_dir.name} — VPP/XDP may not be forwarding Node1→Node5 traffic."
        )
        return False

    return True

# ---------------------------------------------------------------------------
# Single experiment
# ---------------------------------------------------------------------------

def run_experiment(
    port_count: int,
    forwarder: str,
    direction: str,
    ansible_dir: Path,
    inventory: str,
    duration: int,
    setup_wait: int,
    dry_run: bool,
) -> tuple[bool, bool]:
    """Run one experiment. Returns (ansible_ok, data_ok)."""
    print(f"\n  [1/5] Modifying pkt files ...", end=" ", flush=True)
    update_pkt_files(port_count, dry_run)
    if not dry_run:
        print("OK")

    print(f"  [2/5] Updating pktgen_config.json ...", end=" ", flush=True)
    update_pktgen_config(direction, dry_run)
    if not dry_run:
        print("OK")

    print(f"  [3/5] Running setup playbooks ...")
    for pb in SETUP_PLAYBOOKS:
        ok = run_playbook(pb, ansible_dir, inventory, pb, dry_run)
        if not ok:
            print(f"  ERROR: {pb} failed — skipping this experiment.")
            return False, False

    print(f"  [4/5] Running forwarder setup ({forwarder}) ...")
    ok = run_playbook(FORWARDER_PLAYBOOK[forwarder], ansible_dir, inventory,
                      FORWARDER_PLAYBOOK[forwarder], dry_run)
    if not ok:
        print(f"  ERROR: forwarder setup failed — skipping this experiment.")
        return False, False

    print(f"  [5/5] Running pktgen experiment ...")

    if dry_run:
        print(f"    [dry-run] would: launch 05_start_pktgen.yaml, wait {setup_wait}s,")
        print(f"              touch start signal, wait {duration}s, touch stop signal,")
        print(f"              wait for ansible, rename result dir to "
              f"{FORWARDER_LABEL[forwarder]}_{port_count}_Port_No_Block_{direction}")
        print(f"              validate node5.csv for direction '{direction}'")
        return True, True

    # Snapshot existing result directories
    existing = set(RESULTS_DIR.iterdir()) if RESULTS_DIR.exists() else set()

    # Clear stale signals
    SIGNAL_START.unlink(missing_ok=True)
    SIGNAL_STOP.unlink(missing_ok=True)

    cmd = ["ansible-playbook", "-i", inventory,
           str(ansible_dir / "05_start_pktgen.yaml")]
    proc = subprocess.Popen(cmd)

    # Wait for pktgen to initialize (playbook sleeps 5s internally)
    print(f"        Waiting {setup_wait}s for pktgen to initialize ...", end=" ", flush=True)
    time.sleep(setup_wait)
    SIGNAL_START.touch()
    print("STARTED")

    print(f"        Running for {duration}s ...", end=" ", flush=True)
    time.sleep(duration)
    SIGNAL_STOP.touch()
    print("STOPPED")

    print(f"        Waiting for ansible to collect results ...", end=" ", flush=True)
    proc.wait()
    print(f"done (exit {proc.returncode})")

    if proc.returncode != 0:
        print("  WARNING: 05_start_pktgen.yaml exited non-zero — results may be incomplete.")

    # Find and rename new result directory
    result_dir = None
    if RESULTS_DIR.exists():
        new_dirs = set(RESULTS_DIR.iterdir()) - existing
        if new_dirs:
            newest = max(new_dirs, key=lambda d: d.stat().st_mtime)
            target_name = f"{FORWARDER_LABEL[forwarder]}_{port_count}_Port_No_Block_{direction}"
            target = unique_name(RESULTS_DIR / target_name)
            newest.rename(target)
            result_dir = target
            print(f"        Results saved as: {target.name}")
        else:
            print("  WARNING: No new result directory found to rename.")

    data_ok = validate_results(result_dir, direction) if result_dir else False
    return proc.returncode == 0, data_ok

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Automate pktgen experiments across port counts, forwarders, and traffic directions.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--ports", required=True,
        help='Port counts to sweep. Range: "1-10". List: "1,10,100". Mixed: "1-5,100,1000".',
    )
    parser.add_argument(
        "--traffic", required=True,
        help='Traffic direction(s): "41", "15", "15_41", or comma-separated combination.',
    )
    parser.add_argument(
        "--duration", type=int, default=15,
        help="Seconds to run pktgen traffic per experiment (default: 15).",
    )
    parser.add_argument(
        "--setup-wait", type=int, default=10,
        help="Seconds to wait after launching pktgen before sending start signal (default: 10).",
    )
    parser.add_argument(
        "--inventory", default=os.environ.get("ANSIBLE_INVENTORY", ""),
        help="Ansible inventory file path (or set ANSIBLE_INVENTORY env var).",
    )
    parser.add_argument(
        "--ansible-dir", default="ansible",
        help="Path to the ansible/ directory (default: ./ansible).",
    )
    parser.add_argument(
        "--forwarder",
        nargs="+",
        choices=FORWARDERS,
        default=FORWARDERS,
        metavar="FORWARDER",
        help="Forwarder(s) to run: vpp, xdp, kernel (default: all three).",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print what would happen without executing anything.",
    )
    args = parser.parse_args()

    if not args.dry_run and not args.inventory:
        parser.error("--inventory is required (or set ANSIBLE_INVENTORY env var)")

    try:
        ports = parse_ports(args.ports)
    except ValueError as e:
        parser.error(str(e))

    try:
        directions = parse_directions(args.traffic)
    except ValueError as e:
        parser.error(str(e))

    ansible_dir = Path(args.ansible_dir)
    if not args.dry_run and not ansible_dir.is_dir():
        parser.error(f"ansible-dir not found: {ansible_dir}")

    # Build full experiment list
    experiments = [
        (port, fw, direction)
        for port in ports
        for fw in args.forwarder
        for direction in directions
    ]
    total = len(experiments)

    print(f"\nExperiment sweep: {len(ports)} port(s) × {len(args.forwarder)} forwarder(s) × {len(directions)} direction(s) = {total} runs")
    print(f"  Ports:      {ports}")
    print(f"  Forwarders: {args.forwarder}")
    print(f"  Directions: {directions}")
    print(f"  Duration:   {args.duration}s per run")
    print(f"  Setup wait: {args.setup_wait}s")
    if args.dry_run:
        print("  [DRY RUN — no changes will be made]")

    failed = []
    data_warnings = []
    for idx, (port, forwarder, direction) in enumerate(experiments, 1):
        label = f"{FORWARDER_LABEL[forwarder]} | {port} Port(s) | Direction: {direction}"
        print(f"\n{'═' * 60}")
        print(f"[{idx}/{total}] {label}")
        print(f"{'═' * 60}")

        ansible_ok, data_ok = run_experiment(
            port_count=port,
            forwarder=forwarder,
            direction=direction,
            ansible_dir=ansible_dir,
            inventory=args.inventory,
            duration=args.duration,
            setup_wait=args.setup_wait,
            dry_run=args.dry_run,
        )
        run_name = f"{FORWARDER_LABEL[forwarder]}_{port}_Port_No_Block_{direction}"
        if not ansible_ok:
            failed.append(run_name)
        if not data_ok and not args.dry_run:
            data_warnings.append(run_name)

    print(f"\n{'═' * 60}")
    print(f"Sweep complete: {total - len(failed)}/{total} ansible runs succeeded.")
    if failed:
        print("\nFailed (ansible error):")
        for name in failed:
            print(f"  {name}")
    if data_warnings:
        print("\nDegraded results (node5.csv empty — forwarder may not have reached Node 5):")
        for name in data_warnings:
            print(f"  {name}")
    sys.exit(1 if (failed or data_warnings) else 0)


if __name__ == "__main__":
    main()
