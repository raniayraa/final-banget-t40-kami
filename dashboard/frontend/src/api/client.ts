export interface PlaybookInfo {
  id: string
  filename: string
  description: string
}

export interface JobStatus {
  job_id: string
  playbook_id: string
  status: 'running' | 'done' | 'error' | 'aborted'
  pause_state: 'paused_start' | 'paused_stop' | null
  exit_code: number | null
}

export interface PktFileInfo {
  name: string
  last_modified: number
}

export interface PktgenConfig {
  nodes: Record<string, string>
}

export interface ExperimentResult {
  name: string
  mtime: number
  files: string[]
}

export interface CsvRow {
  time: string
  port: string
  metric: string
  value: string
}

export interface NodeCsvData {
  filename: string
  rows: CsvRow[]
}

export interface PktFileData {
  filename: string
  content: string
}

export type WsMessage =
  | { type: 'log'; line: string }
  | { type: 'state'; status: string; pause_state: string | null }
  | { type: 'done'; exit_code: number; status: string }
  | { type: 'ping' }

const BASE = '/api'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export const api = {
  listPlaybooks: () => get<PlaybookInfo[]>('/playbooks'),
  runPlaybook: (id: string) => post<{ job_id: string }>(`/playbooks/${id}/run`),
  runAll: () => post<{ job_id: string }>('/jobs/run-all'),
  getJob: (jobId: string) => get<JobStatus>(`/jobs/${jobId}`),
  sendSignal: (jobId: string, signal: 'start_traffic' | 'stop_traffic' | 'abort') =>
    post<{ ok: boolean }>(`/jobs/${jobId}/signal`, { signal }),
  listPktFiles: () => get<PktFileInfo[]>('/pkt-files'),
  getPktFile: (name: string) => get<{ name: string; content: string }>(`/pkt-files/${name}`),
  savePktFile: (name: string, content: string) =>
    put<{ ok: boolean }>(`/pkt-files/${name}`, { content }),
  getPktgenConfig: () => get<PktgenConfig>('/pktgen-config'),
  savePktgenConfig: (nodes: Record<string, string>) =>
    put<{ ok: boolean }>('/pktgen-config', { nodes }),
  listResults: () => get<ExperimentResult[]>('/results'),
  getResultCsv: (exp: string, file: string) => get<NodeCsvData>(`/results/${exp}/${file}`),
  getResultPkt: (exp: string, file: string) => get<PktFileData>(`/results/${exp}/${file}`),
}

export function createJobWebSocket(
  jobId: string,
  onMessage: (msg: WsMessage) => void,
  onClose?: () => void,
): WebSocket {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${proto}://${window.location.host}/ws/jobs/${jobId}`)
  ws.onmessage = (e) => {
    try {
      onMessage(JSON.parse(e.data))
    } catch {}
  }
  ws.onclose = onClose ?? (() => {})
  return ws
}
