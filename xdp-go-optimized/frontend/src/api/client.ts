// Typed API client for the xdpd REST API.

export interface StatusResponse {
  daemon_running: boolean
  xdp_attached: boolean
  interface: string
  pinned_maps: string[]
}

export interface FwFlags {
  block_icmp_ping: boolean
  block_ip_fragments: boolean
  block_malformed_tcp: boolean
  block_all_tcp: boolean
  block_all_udp: boolean
  block_broadcast: boolean
  block_multicast: boolean
}

export interface ConfigResponse {
  flags: FwFlags
  tcp_ports: number[]
  udp_ports: number[]
  protos: number[]
}

export interface ConfigRequest {
  flags?: Partial<FwFlags>
  tcp_ports?: number[]
  udp_ports?: number[]
  protos?: number[]
}

export interface StatsRec {
  packets: number
  bytes: number
}

export interface LiveStats {
  drop: StatsRec
  tx: StatsRec
  redirect: StatsRec
  pass: StatsRec
  ttl_exceeded: StatsRec
}

export interface TrafficLog {
  id: number
  timestamp_ns: number
  src_ip: string
  dst_ip: string
  src_port: number
  dst_port: number
  protocol: number
  action: number
  pkt_len: number
}

export interface RouteEntry {
  ip: string
  dst_mac: string
  src_mac: string
  action: 'tx' | 'redirect'
  port_key: number
}

export interface CPUResponse {
  num_cpus: number
  max_cpus: number
}

export interface SettingsResponse {
  iface: string
  redirect_dev: string
  interfaces: string[]
}

const BASE = '/api'

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  if (!r.ok) {
    const text = await r.text()
    throw new Error(text || `HTTP ${r.status}`)
  }
  return r.json()
}

export const api = {
  getStatus: () => fetchJSON<StatusResponse>(`${BASE}/status`),

  start: () => fetchJSON<{ status: string }>(`${BASE}/start`, { method: 'POST' }),
  stop:  () => fetchJSON<{ status: string }>(`${BASE}/stop`,  { method: 'POST' }),

  getConfig: () => fetchJSON<ConfigResponse>(`${BASE}/config`),
  putConfig: (body: ConfigRequest) =>
    fetchJSON<{ status: string }>(`${BASE}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  getStatsLive: () => fetchJSON<LiveStats>(`${BASE}/stats/live`),

  getLogs: (params: {
    action?: number
    proto?: number
    range?: string
    limit?: number
  }) => {
    const q = new URLSearchParams()
    if (params.action !== undefined) q.set('action', String(params.action))
    if (params.proto  !== undefined) q.set('proto',  String(params.proto))
    if (params.range)                q.set('range',  params.range)
    if (params.limit)                q.set('limit',  String(params.limit))
    return fetchJSON<TrafficLog[]>(`${BASE}/logs?${q}`)
  },

  getRoutes: () => fetchJSON<RouteEntry[]>(`${BASE}/routes`),
  addRoute:  (r: RouteEntry) =>
    fetchJSON<RouteEntry>(`${BASE}/routes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(r),
    }),
  deleteRoute: (ip: string) =>
    fetchJSON<{ status: string; ip: string }>(`${BASE}/routes/${encodeURIComponent(ip)}`, {
      method: 'DELETE',
    }),

  getCPU: () => fetchJSON<CPUResponse>(`${BASE}/system/cpu`),
  putCPU: (num_cpus: number) =>
    fetchJSON<CPUResponse>(`${BASE}/system/cpu`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ num_cpus }),
    }),

  getSettings: () => fetchJSON<SettingsResponse>(`${BASE}/system/settings`),
  putSettings: (iface: string, redirect_dev: string) =>
    fetchJSON<SettingsResponse>(`${BASE}/system/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ iface, redirect_dev }),
    }),
}
