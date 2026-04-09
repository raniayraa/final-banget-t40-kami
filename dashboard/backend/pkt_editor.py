import os
from pathlib import Path
from typing import List
from models import PktFileInfo

PKT_DIR = Path("/home/telmat/final_t40/dashboard/pkt_files")


def _validate_name(name: str) -> Path:
    if "/" in name or "\\" in name or name.startswith("."):
        raise ValueError(f"Invalid pkt file name: {name}")
    path = PKT_DIR / name
    path.resolve().relative_to(PKT_DIR.resolve())  # ensures no traversal
    return path


def list_pkt_files() -> List[PktFileInfo]:
    files = []
    for f in sorted(PKT_DIR.glob("*.pkt")):
        files.append(PktFileInfo(name=f.name, last_modified=f.stat().st_mtime))
    return files


def read_pkt_file(name: str) -> str:
    path = _validate_name(name)
    return path.read_text()


def write_pkt_file(name: str, content: str) -> None:
    path = _validate_name(name)
    tmp = path.with_suffix(".pkt.tmp")
    tmp.write_text(content)
    os.rename(tmp, path)
