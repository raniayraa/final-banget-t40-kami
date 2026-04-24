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


class RunOptions(BaseModel):
    variant: Optional[str] = None


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


class NodeEntry(BaseModel):
    ip: str
    label: str
    pkt_file: str
    enabled: bool


class NodeRegistryResponse(BaseModel):
    nodes: list[NodeEntry]


class NodeUpdateRequest(BaseModel):
    enabled: Optional[bool] = None
    pkt_file: Optional[str] = None


class RenameRequest(BaseModel):
    display_name: str


class ExperimentSummary(BaseModel):
    name: str
    mtime: float
    files: list[str]
    display_name: Optional[str] = None
    description: Optional[str] = None


class DescriptionRequest(BaseModel):
    description: str


class MetricsSummary(BaseModel):
    peak_forwarded_pps: float
    peak_forwarded_gbps: float
    sender_injection_pps: float
    packet_loss_pct: float
    nic_drop_rate_mean: float
    nic_drop_rate_peak: float
    forwarding_efficiency_pct: float
    throughput_std_dev: float


class LatencyMetrics(BaseModel):
    min_ns: float
    avg_ns: float
    max_ns: float
    jitter_ns: float
