import json
import os
from pathlib import Path

import pktgen_config as cfg_module

REGISTRY_PATH = Path(__file__).parent.parent / "node_registry.json"


def _atomic_write(data: dict) -> None:
    tmp = REGISTRY_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n")
    os.rename(tmp, REGISTRY_PATH)


def _sync_pktgen_config(data: dict) -> None:
    """Regenerate pktgen_config.json with only enabled nodes."""
    enabled = {ip: entry["pkt_file"] for ip, entry in data.items() if entry["enabled"]}
    cfg_module.write_config(enabled)


def _init_from_pktgen_config() -> dict:
    """Bootstrap registry from existing pktgen_config.json; all nodes enabled."""
    existing = cfg_module.read_config()
    data = {}
    for ip, pkt_file in existing.items():
        last_octet = ip.split(".")[-1]
        data[ip] = {"label": f"Node {last_octet}", "pkt_file": pkt_file, "enabled": True}
    _atomic_write(data)
    return data


def read_registry() -> dict:
    if not REGISTRY_PATH.exists():
        return _init_from_pktgen_config()
    return json.loads(REGISTRY_PATH.read_text())


def write_registry(data: dict) -> None:
    _atomic_write(data)
    _sync_pktgen_config(data)
