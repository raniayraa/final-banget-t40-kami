import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import pkt_editor
import pktgen_config as cfg_module
import runner
from models import (
    JobStatus,
    PlaybookInfo,
    PktFileContent,
    PktFileInfo,
    PktgenConfig,
    SignalRequest,
)
from ws_manager import manager

FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"
RESULTS_DIR = Path(__file__).parent.parent.parent / "results"


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(title="Ansible Dashboard", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Playbooks ───────────────────────────────────────────────────────────────

@app.get("/api/playbooks", response_model=list[PlaybookInfo])
def list_playbooks():
    return [PlaybookInfo(id=pb["id"], filename=pb["filename"], description=pb["description"])
            for pb in runner.PLAYBOOKS]


@app.post("/api/playbooks/{playbook_id}/run")
async def run_playbook(playbook_id: str):
    try:
        job = await runner.launch_playbook(playbook_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"job_id": job.job_id}


@app.post("/api/jobs/run-all")
async def run_all():
    seq_id = await runner.run_all()
    return {"job_id": seq_id}


# ─── Jobs ────────────────────────────────────────────────────────────────────

@app.get("/api/jobs/{job_id}", response_model=JobStatus)
def get_job(job_id: str):
    job = runner.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobStatus(
        job_id=job.job_id,
        playbook_id=job.playbook_id,
        status=job.status,
        pause_state=job.pause_state,
        exit_code=job.exit_code,
    )


@app.post("/api/jobs/{job_id}/signal")
async def send_signal(job_id: str, req: SignalRequest):
    job = runner.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    if req.signal == "abort":
        ok = await runner.abort_job(job_id)
    else:
        ok = await runner.inject_enter(job_id)

    if not ok:
        raise HTTPException(status_code=409, detail="Cannot send signal in current state")
    return {"ok": True}


# ─── PKT files ───────────────────────────────────────────────────────────────

@app.get("/api/pkt-files", response_model=list[PktFileInfo])
def list_pkt_files():
    return pkt_editor.list_pkt_files()


@app.get("/api/pkt-files/{name}")
def get_pkt_file(name: str):
    try:
        content = pkt_editor.read_pkt_file(name)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"name": name, "content": content}


@app.put("/api/pkt-files/{name}")
def update_pkt_file(name: str, body: PktFileContent):
    try:
        pkt_editor.write_pkt_file(name, body.content)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True}


# ─── Pktgen config ───────────────────────────────────────────────────────────

@app.get("/api/pktgen-config", response_model=PktgenConfig)
def get_pktgen_config():
    data = cfg_module.read_config()
    return PktgenConfig(nodes=data)


@app.put("/api/pktgen-config")
def update_pktgen_config(body: PktgenConfig):
    cfg_module.write_config(body.nodes)
    return {"ok": True}


# ─── Results ─────────────────────────────────────────────────────────────────

@app.get("/api/results")
def list_results():
    if not RESULTS_DIR.exists():
        return []
    dirs = sorted(
        [d for d in RESULTS_DIR.iterdir() if d.is_dir() and d.name.startswith("pktgen_stats_")],
        key=lambda d: d.stat().st_mtime,
        reverse=True,
    )
    return [
        {
            "name": d.name,
            "mtime": d.stat().st_mtime,
            "files": [f.name for f in sorted(d.iterdir())],
        }
        for d in dirs
    ]


@app.get("/api/results/{exp_name}/{node_file}")
def get_result_file(exp_name: str, node_file: str):
    if ".." in exp_name or ".." in node_file or "/" in exp_name or "/" in node_file:
        raise HTTPException(status_code=400, detail="Invalid path")
    path = RESULTS_DIR / exp_name / node_file
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if path.suffix == ".pkt":
        return {"filename": node_file, "content": path.read_text()}
    rows = []
    lines = path.read_text().splitlines()
    for line in lines[1:]:
        parts = line.split(",", 3)
        if len(parts) == 4:
            rows.append({"time": parts[0], "port": parts[1], "metric": parts[2], "value": parts[3]})
    return {"filename": node_file, "rows": rows}


# ─── WebSocket ───────────────────────────────────────────────────────────────

@app.websocket("/ws/jobs/{job_id}")
async def ws_job(job_id: str, websocket: WebSocket):
    await websocket.accept()
    await manager.subscribe(job_id, websocket)
    try:
        # Send current state immediately on connect
        job = runner.get_job(job_id)
        if job:
            await websocket.send_json({
                "type": "state",
                "status": job.status,
                "pause_state": job.pause_state,
            })
        while True:
            # Keep connection alive; all messages come via manager.broadcast
            await asyncio.sleep(30)
            await websocket.send_json({"type": "ping"})
    except WebSocketDisconnect:
        pass
    finally:
        await manager.unsubscribe(job_id, websocket)


# ─── Serve frontend in production ────────────────────────────────────────────

if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="static")
