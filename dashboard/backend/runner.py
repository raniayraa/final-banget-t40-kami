import asyncio
import os
import pty
import signal
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Optional

from ws_manager import manager

ANSIBLE_DIR = Path("/home/telmat/final_t40/ansible")
INVENTORY = str(ANSIBLE_DIR / "inventory.ini")

PLAYBOOKS = [
    {"id": "00", "filename": "00_check_node_connection.yaml",  "description": "Check SSH connectivity to all nodes"},
    {"id": "01", "filename": "01_basic_setup.yaml",            "description": "Configure network interfaces and IP addresses"},
    {"id": "02", "filename": "02_setup_route.yaml",            "description": "Set up static routing and validate connectivity"},
    {"id": "03", "filename": "03_setup_scripts.yaml",          "description": "Deploy pktgen scripts and bind NICs to DPDK"},
    {"id": "05", "filename": "05_setup_kernel_node6.yaml",     "description": "Re-assign IPs and static ARP on Node 6 after DPDK binding"},
    {"id": "04", "filename": "04_start_pktgen.yaml",           "description": "Launch pktgen and control traffic generation"},
]

VARIANTS = {
    "05": {
        "kernel": "05_setup_kernel_node6.yaml",
        "xdp":    "05_setup_xdp_node6.yaml",
    }
}

SIGNAL_START_MARKER = "DASHBOARD_SIGNAL: waiting_for_start"
SIGNAL_STOP_MARKER  = "DASHBOARD_SIGNAL: waiting_for_stop"

SIGNAL_FILE_START = Path("/tmp/ansible_pktgen_start")
SIGNAL_FILE_STOP  = Path("/tmp/ansible_pktgen_stop")


@dataclass
class Job:
    job_id: str
    playbook_id: str
    status: str = "running"
    pause_state: Optional[str] = None
    exit_code: Optional[int] = None
    master_fd: int = -1
    pid: int = -1
    _done_event: asyncio.Event = field(default_factory=asyncio.Event)


_registry: Dict[str, Job] = {}
_lock = asyncio.Lock()


def get_job(job_id: str) -> Optional[Job]:
    return _registry.get(job_id)


def get_playbook_path(playbook_id: str) -> Optional[str]:
    for pb in PLAYBOOKS:
        if pb["id"] == playbook_id:
            return str(ANSIBLE_DIR / pb["filename"])
    return None


async def launch_playbook(playbook_id: str, variant: str | None = None) -> Job:
    if variant and playbook_id in VARIANTS:
        filename = VARIANTS[playbook_id].get(variant)
        if filename is None:
            raise ValueError(f"Unknown variant '{variant}' for playbook {playbook_id}")
        path = str(ANSIBLE_DIR / filename)
    else:
        path = get_playbook_path(playbook_id)
    if path is None:
        raise ValueError(f"Unknown playbook id: {playbook_id}")

    job_id = str(uuid.uuid4())
    job = Job(job_id=job_id, playbook_id=playbook_id)

    master_fd, slave_fd = pty.openpty()
    job.master_fd = master_fd

    import subprocess
    proc = subprocess.Popen(
        ["ansible-playbook", "-i", INVENTORY, path],
        stdout=slave_fd,
        stderr=slave_fd,
        stdin=subprocess.DEVNULL,
        close_fds=True,
        env={**os.environ, "ANSIBLE_FORCE_COLOR": "1"},
    )
    os.close(slave_fd)
    job.pid = proc.pid

    async with _lock:
        _registry[job_id] = job

    asyncio.create_task(_read_loop(job, proc))
    return job


async def _read_loop(job: Job, proc):
    loop = asyncio.get_event_loop()
    buf = b""
    while True:
        try:
            chunk = await loop.run_in_executor(None, _safe_read, job.master_fd)
        except OSError:
            break
        if not chunk:
            break

        buf += chunk
        while b"\n" in buf or b"\r" in buf:
            # split on \r\n, \n, \r
            for sep in (b"\r\n", b"\n", b"\r"):
                if sep in buf:
                    line_bytes, buf = buf.split(sep, 1)
                    line = line_bytes.decode("utf-8", errors="replace").rstrip()
                    await _process_line(job, line)
                    break
            else:
                break

    # flush remainder
    if buf:
        line = buf.decode("utf-8", errors="replace").rstrip()
        if line:
            await _process_line(job, line)

    proc.wait()
    exit_code = proc.returncode
    try:
        os.close(job.master_fd)
    except OSError:
        pass

    job.exit_code = exit_code
    job.status = "done" if exit_code == 0 else "error"
    job.pause_state = None
    await manager.broadcast(job.job_id, {
        "type": "done",
        "exit_code": exit_code,
        "status": job.status,
    })
    job._done_event.set()


def _safe_read(fd: int) -> bytes:
    try:
        return os.read(fd, 4096)
    except OSError:
        return b""


async def _process_line(job: Job, line: str):
    await manager.broadcast(job.job_id, {"type": "log", "line": line})

    old_pause = job.pause_state
    if SIGNAL_START_MARKER in line:
        job.pause_state = "paused_start"
    elif SIGNAL_STOP_MARKER in line:
        job.pause_state = "paused_stop"

    if job.pause_state != old_pause:
        await manager.broadcast(job.job_id, {
            "type": "state",
            "status": job.status,
            "pause_state": job.pause_state,
        })


async def inject_enter(job_id: str) -> bool:
    """Create the appropriate signal file based on current pause_state."""
    job = get_job(job_id)
    if job is None or job.status != "running":
        return False
    if job.pause_state == "paused_start":
        SIGNAL_FILE_START.touch()
        return True
    elif job.pause_state == "paused_stop":
        SIGNAL_FILE_STOP.touch()
        return True
    return False


async def abort_job(job_id: str) -> bool:
    job = get_job(job_id)
    if job is None or job.status != "running":
        return False
    try:
        os.kill(job.pid, signal.SIGTERM)
        job.status = "aborted"
        return True
    except ProcessLookupError:
        return False


async def run_all() -> str:
    """Run playbooks 00-04 sequentially. Returns a synthetic job_id for the sequence."""
    seq_id = str(uuid.uuid4())

    async def _sequence():
        for pb in PLAYBOOKS:
            job = await launch_playbook(pb["id"])
            # forward all messages to the seq_id channel too
            asyncio.create_task(_forward_job(job, seq_id))
            await job._done_event.wait()
            if job.exit_code != 0:
                await manager.broadcast(seq_id, {
                    "type": "done",
                    "exit_code": job.exit_code,
                    "status": "error",
                })
                return
        await manager.broadcast(seq_id, {"type": "done", "exit_code": 0, "status": "done"})

    asyncio.create_task(_sequence())
    return seq_id


async def _forward_job(job: Job, target_id: str):
    """Subscribe to job's WS messages and re-broadcast to target_id."""
    # We'll just use a fake WebSocket proxy by directly monitoring the job
    # via a small polling loop — simpler than a real WS subscriber here
    await job._done_event.wait()
