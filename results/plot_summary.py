import os
import re
import glob
from collections import defaultdict
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

FONT_SETTINGS = {
    "font.family":      "Courier New",
    "font.size":        20,
    "axes.titlesize":   20,
    "axes.labelsize":   20,
    "xtick.labelsize":  20,
    "ytick.labelsize":  20,
    "legend.fontsize":  18,
    "figure.titlesize": 20,
}

TECH_STYLES = {
    "Kernel": {"color": "#77b5b6", "marker": "o"},
    "XDP":    {"color": "#e8895c", "marker": "s"},
    "VPP":    {"color": "#6a408d", "marker": "^"},
}

VERSION_STYLES = [
    {"color": "#77b5b6", "marker": "o"},
    {"color": "#e8895c", "marker": "s"},
    {"color": "#6a408d", "marker": "^"},
    {"color": "#2d8b57", "marker": "D"},
    {"color": "#c0392b", "marker": "v"},
]

# RX subplot specs per variant: (rx_label, csv, metric, port, y_max)
RX_SPECS = {
    "Multi": [
        ("Node 1 (RX)", "node1.csv", "ipackets", 1,    37),
        ("Node 5 (RX)", "node5.csv", "ipackets", None, 37),
    ],
    "Single_15": [
        ("Node 5 (RX)", "node5.csv", "ipackets", 0, 37),
    ],
    "Single_41": [
        ("Node 1 (RX)", "node1.csv", "ipackets", 1, 37),
    ],
}


def _detect_variant(folder_name):
    name = re.sub(r'_v\d+$', '', folder_name)
    if re.search(r"_15_41$", name):
        return "Multi", "Multi Traffic"
    if re.search(r"_41$", name):
        return "Single_41", "Single Traffic"
    if re.search(r"_15$", name):
        return "Single_15", "Single Traffic"
    raise RuntimeError(
        f"Cannot detect traffic variant from folder name: {folder_name!r}\n"
        "Expected suffix '_15_41', '_41', or '_15'."
    )


def _parse_port_info(folder_name):
    """Return (technology, port_range_str, n_port) or None."""
    m = re.match(r"(Kernel|VPP|XDP)_(\d+(?:-\d+)?)_Port", folder_name)
    if not m:
        return None
    technology = m.group(1)
    port_range = m.group(2)
    if '-' in port_range:
        start, end = port_range.split('-')
        n_port = int(end) - int(start) + 1
    else:
        n_port = 1
    return technology, port_range, n_port


def _load_data(csv_file, metric, port):
    df = pd.read_csv(csv_file, parse_dates=["Time"])
    df["Port"] = pd.to_numeric(df["Port"], errors="coerce")
    df = df.dropna(subset=["Time", "Port", "Metric", "Value"])
    mask = df["Metric"] == metric
    if port is not None:
        mask &= df["Port"] == port
    df_node = df[mask].copy()
    df_node = df_node.sort_values("Time").reset_index(drop=True)

    t0 = df_node["Time"].iloc[0]
    df_node["elapsed"] = (df_node["Time"] - t0).dt.total_seconds()
    df_node["mpps"]    = df_node["Value"].diff().fillna(0).clip(lower=0) / 1e6

    return df_node["elapsed"].values, df_node["mpps"].values


def _max_stable(y):
    y_nz = y[y > 0]
    if y_nz.size == 0:
        return 0.0
    Q1, Q3 = np.percentile(y_nz, [25, 75])
    fence = Q3 + 1.5 * (Q3 - Q1)
    stable = y_nz[y_nz <= fence]
    return stable.max() if stable.size > 0 else y_nz.max()


def _apply_yticks(ax, y_max, peak_val, peak_color, y_tick_step=5):
    base_ticks     = list(range(0, y_max, y_tick_step))
    filtered_ticks = [t for t in base_ticks if abs(t - peak_val) > 0.3]
    combined_ticks  = filtered_ticks + [peak_val]
    combined_labels = [str(t) for t in filtered_ticks] + [f"{peak_val:.3f}"]
    tick_colors     = ["black"] * len(filtered_ticks) + [peak_color]

    ax.set_ylim(0, y_max)
    ax.set_yticks(combined_ticks)
    ax.set_yticklabels(combined_labels)
    for lbl, color in zip(ax.get_yticklabels(), tick_colors):
        lbl.set_color(color)


def _grid(ax):
    ax.grid(True, which="major", linestyle="-", linewidth=0.75, alpha=0.25)
    ax.minorticks_on()
    ax.grid(True, which="minor", linestyle="-", linewidth=0.25, alpha=0.15)
    ax.set_axisbelow(True)


def draw_summary_ax(ax, rx_label, points, technology, traffic_label,
                    y_max=37):
    """points: list of (n_port, mpps, version_label) — all runs as scatter."""
    style  = TECH_STYLES.get(technology, {"color": "gray", "marker": "o"})
    ports  = [p for p, _, _ in points]
    mpps_v = [m for _, m, _ in points]
    peak   = max(mpps_v) if mpps_v else 0.0

    ax.set_title(f"{rx_label}\n{technology} - {traffic_label} - Port Scaling",
                 pad=55, fontweight="bold", fontsize=24)
    ax.set_xlabel("Number of ports")
    ax.set_ylabel("Max stable packet rate (Mpps)")
    _grid(ax)

    # scatter — all individual data points
    ax.scatter(ports, mpps_v, color=style["color"], marker=style["marker"],
               s=90, alpha=0.75, zorder=3,
               label=f"All runs  (peak = {peak:.3f})")

    # mean trend line
    port_groups = defaultdict(list)
    for p, m, _ in points:
        port_groups[p].append(m)
    mean_pts = sorted((p, float(np.mean(ms))) for p, ms in port_groups.items())
    if mean_pts:
        mx, my = zip(*mean_pts)
        ax.plot(mx, my, color=style["color"], linewidth=1.5,
                linestyle="-", alpha=0.5, zorder=2, label="Mean per port count")

    ax.axhline(peak, color=style["color"], linewidth=1.5,
               linestyle=":", zorder=3)

    _apply_yticks(ax, y_max, peak, style["color"])

    sorted_ports = sorted(set(ports))
    ax.set_xticks(sorted_ports)
    ax.set_xticklabels([str(p) for p in sorted_ports])
    pad = max(0.3, (sorted_ports[-1] - sorted_ports[0]) * 0.03) if len(sorted_ports) > 1 else 0.5
    ax.set_xlim(sorted_ports[0] - pad, sorted_ports[-1] + pad)

    ax.legend(loc="lower center", bbox_to_anchor=(0.5, 1.01),
              ncol=2, frameon=False)


def draw_duplicates_ax(ax, rx_label, points, technology, traffic_label,
                       y_max=37):
    """points: list of (n_port, mpps, version_label) — one line per version."""
    ver_data = defaultdict(list)
    for n_port, mpps, ver in points:
        ver_data[ver].append((n_port, mpps))

    all_versions = sorted(ver_data.keys())
    peak = max(m for _, m, _ in points) if points else 0.0

    ax.set_title(f"{rx_label}\n{technology} - {traffic_label} - Duplicate Runs",
                 pad=55, fontweight="bold", fontsize=24)
    ax.set_xlabel("Number of ports")
    ax.set_ylabel("Max stable packet rate (Mpps)")
    _grid(ax)

    n_vers = len(all_versions)
    jitter_step = 0.04
    offsets = [(i - (n_vers - 1) / 2) * jitter_step for i in range(n_vers)]

    for i, ver in enumerate(all_versions):
        pts = sorted(ver_data[ver])
        px  = [p + offsets[i] for p, _ in pts]
        py  = [m for _, m in pts]
        vstyle = VERSION_STYLES[i % len(VERSION_STYLES)]
        ax.plot(px, py, color=vstyle["color"], marker=vstyle["marker"],
                linewidth=2.0, markersize=8, zorder=2 + i, label=ver)

    ax.axhline(peak, color="gray", linewidth=1.0, linestyle=":", zorder=1)

    _apply_yticks(ax, y_max, peak, "gray")

    sorted_ports = sorted({p for p, _, _ in points})
    ax.set_xticks(sorted_ports)
    ax.set_xticklabels([str(p) for p in sorted_ports])
    pad = max(0.3, (sorted_ports[-1] - sorted_ports[0]) * 0.03) if len(sorted_ports) > 1 else 0.5
    ax.set_xlim(sorted_ports[0] - pad, sorted_ports[-1] + pad)

    ax.legend(loc="lower center", bbox_to_anchor=(0.5, 1.01),
              ncol=min(4, n_vers), frameon=False)


# ── main ──────────────────────────────────────────────────────────────────────

base_dir = os.path.dirname(os.path.abspath(__file__))

plt.rcParams.update(FONT_SETTINGS)

result_dir = os.path.join(base_dir, "result")
os.makedirs(result_dir, exist_ok=True)

data_folders = sorted(
    glob.glob(os.path.join(base_dir, "Kernel_*_Port_No_Block_*")) +
    glob.glob(os.path.join(base_dir, "VPP_*_Port_No_Block_*"))    +
    glob.glob(os.path.join(base_dir, "XDP_*_Port_No_Block_*"))
)
if not data_folders:
    raise RuntimeError("No Kernel_*, VPP_*, or XDP_*_Port_No_Block_* folders found.")

# summary_data[(technology, variant_key)][rx_label] = [(n_port, mpps, version_label), ...]
summary_data   = defaultdict(lambda: defaultdict(list))
traffic_labels = {}

for folder in data_folders:
    folder_name = os.path.basename(folder)

    try:
        variant_key, traffic_label = _detect_variant(folder_name)
    except RuntimeError as e:
        print(f"Skipping {folder_name}: {e}")
        continue

    parsed = _parse_port_info(folder_name)
    if not parsed:
        print(f"Skipping {folder_name}: cannot parse technology/port range.")
        continue

    technology, port_range, n_port = parsed

    ver_match     = re.search(r'_v(\d+)$', folder_name)
    version_label = f"v{ver_match.group(1)}" if ver_match else "v1"

    key = (technology, variant_key)
    traffic_labels[key] = traffic_label

    for rx_label, csv_file, metric, port, _y_max in RX_SPECS[variant_key]:
        try:
            _, y    = _load_data(os.path.join(folder, csv_file), metric, port)
            max_val = _max_stable(y)
            summary_data[key][rx_label].append((n_port, max_val, version_label))
        except Exception as exc:
            print(f"  Warning: {folder_name} [{rx_label}]: {exc}")

# ── pass 1: port-scaling summary plots ────────────────────────────────────────
for key, rx_data in sorted(summary_data.items()):
    technology, variant_key = key
    traffic_label = traffic_labels[key]
    rx_spec_list  = RX_SPECS[variant_key]
    n_rx          = len(rx_spec_list)

    fig, axes = plt.subplots(1, n_rx, figsize=(14 * n_rx, 7))
    if n_rx == 1:
        axes = [axes]

    for ax, (rx_label, _csv, _metric, _port, y_max) in zip(axes, rx_spec_list):
        points = sorted(rx_data.get(rx_label, []))
        draw_summary_ax(ax, rx_label, points, technology, traffic_label,
                        y_max=y_max)

    plt.tight_layout(pad=4.0)
    stem = os.path.join(result_dir, f"summary_{technology}_{variant_key}")
    plt.savefig(f"{stem}.png", dpi=150, bbox_inches="tight")
    plt.savefig(f"{stem}.svg",           bbox_inches="tight")
    plt.close(fig)
    print(f"Saved: result/summary_{technology}_{variant_key}.png  "
          f"[{technology} | {traffic_label}]")

# ── pass 2: duplicate-summary plots ───────────────────────────────────────────
print()
for key, rx_data in sorted(summary_data.items()):
    technology, variant_key = key
    traffic_label = traffic_labels[key]
    rx_spec_list  = RX_SPECS[variant_key]
    n_rx          = len(rx_spec_list)

    fig, axes = plt.subplots(1, n_rx, figsize=(14 * n_rx, 7))
    if n_rx == 1:
        axes = [axes]

    for ax, (rx_label, _csv, _metric, _port, y_max) in zip(axes, rx_spec_list):
        points = sorted(rx_data.get(rx_label, []))
        draw_duplicates_ax(ax, rx_label, points, technology, traffic_label,
                           y_max=y_max)

    plt.tight_layout(pad=4.0)
    stem = os.path.join(result_dir, f"duplicates_{technology}_{variant_key}")
    plt.savefig(f"{stem}.png", dpi=150, bbox_inches="tight")
    plt.savefig(f"{stem}.svg",           bbox_inches="tight")
    plt.close(fig)
    print(f"Saved: result/duplicates_{technology}_{variant_key}.png  "
          f"[{technology} | {traffic_label}]")

print("Done.")
