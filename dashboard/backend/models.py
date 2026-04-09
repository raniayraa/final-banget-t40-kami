from pydantic import BaseModel
from typing import Optional, Literal


class PlaybookInfo(BaseModel):
    id: str
    filename: str
    description: str


class JobStatus(BaseModel):
    job_id: str
    playbook_id: str
    status: Literal["running", "done", "error", "aborted"]
    pause_state: Optional[Literal["paused_start", "paused_stop"]] = None
    exit_code: Optional[int] = None


class SignalRequest(BaseModel):
    signal: Literal["start_traffic", "stop_traffic", "abort"]


class PktFile(BaseModel):
    name: str
    content: str


class PktFileInfo(BaseModel):
    name: str
    last_modified: float


class PktFileContent(BaseModel):
    content: str


class PktgenConfig(BaseModel):
    nodes: dict[str, str]
