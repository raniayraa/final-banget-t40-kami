import csv
from pathlib import Path

VALID_NODES = {"node1", "node4", "node5", "node6"}


def parse_mpstat_to_csv(mpstat_path: Path, csv_path: Path) -> None:
    """Parse mpstat -P ALL output and write wide per-core CSV.

    Output columns: time_s, cpu0_%usr, cpu0_%nice, ..., cpuN_%idle
    Each row is one second; each core gets its own column per metric.
    """
    with open(mpstat_path) as f:
        lines = f.readlines()

    header_cols: list[str] | None = None
    cpu_idx = 1
    data_start = 2

    per_second: list[dict[int, list[float]]] = []
    current: dict[int, list[float]] = {}

    for line in lines:
        parts = line.split()
        if not parts:
            continue
        # Header line — marks start of a new second block
        if 'CPU' in parts and '%usr' in parts:
            if current:
                per_second.append(current)
                current = {}
            if header_cols is None:
                cpu_idx = parts.index('CPU')
                data_start = cpu_idx + 1
                header_cols = parts[data_start:]
            continue
        # Skip 'all' aggregate and 'Average:' summary rows
        if parts[0] == 'Average:' or (len(parts) > cpu_idx and parts[cpu_idx] == 'all'):
            continue
        if header_cols is None or len(parts) <= cpu_idx:
            continue
        # Per-core row: CPU column is an integer
        try:
            core = int(parts[cpu_idx])
        except ValueError:
            continue
        if data_start + len(header_cols) > len(parts):
            continue
        values = [float(parts[data_start + i].replace(',', '.')) for i in range(len(header_cols))]
        current[core] = values

    if current:
        per_second.append(current)

    if not per_second or header_cols is None:
        with open(csv_path, 'w', newline='') as f:
            csv.writer(f).writerow(['time_s'])
        return

    cores = sorted({c for sec in per_second for c in sec})
    col_headers = [f'cpu{c}_{m}' for c in cores for m in header_cols]

    with open(csv_path, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['time_s'] + col_headers)
        for t, sec in enumerate(per_second):
            row: list = [t]
            for c in cores:
                vals = sec.get(c, [0.0] * len(header_cols))
                row.extend(round(v, 2) for v in vals)
            writer.writerow(row)


def get_or_parse_cpu_csv(exp_dir: Path, node: str) -> Path | None:
    """Return path to per-node CPU time-series CSV, parsing from mpstat log if needed."""
    if node not in VALID_NODES:
        return None
    csv_path = exp_dir / f"{node}_cpu.csv"
    if csv_path.exists():
        return csv_path
    mpstat_path = exp_dir / f"{node}_mpstat.log"
    if not mpstat_path.exists():
        return None
    parse_mpstat_to_csv(mpstat_path, csv_path)
    return csv_path
