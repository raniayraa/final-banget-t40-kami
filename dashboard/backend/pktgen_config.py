import json
import os
from pathlib import Path

CONFIG_PATH = Path("/home/telmat/final_t40/dashboard/pktgen_config.json")


def read_config() -> dict:
    return json.loads(CONFIG_PATH.read_text())


def write_config(data: dict) -> None:
    tmp = CONFIG_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n")
    os.rename(tmp, CONFIG_PATH)
