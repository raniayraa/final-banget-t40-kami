// Typed API client for the Linux Firewall Dashboard REST API.

export interface StatusResponse {
  daemon_running: boolean
  interface: string
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
  pass: StatsRec
}

export interface RouteEntry {
  dest:    string  // e.g. "192.168.1.0/24" or "default"
  gateway: string  // empty for directly-connected routes
  dev:     string  // interface name
  metric:  number  // 0 = kernel default
}

export interface NeighEntry {
  ip:    string  // neighbor IP address
  mac:   string  // link-layer address, e.g. "aa:bb:cc:dd:ee:ff"
  dev:   string  // interface name
  state: string  // e.g. "PERMANENT", "REACHABLE", "STALE"
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

  getRoutes: () => fetchJSON<RouteEntry[]>(`${BASE}/routes`),
  addRoute:  (r: RouteEntry) =>
    fetchJSON<RouteEntry>(`${BASE}/routes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(r),
    }),
  deleteRoute: (dest: string) =>
    fetchJSON<{ status: string; dest: string }>(
      `${BASE}/routes/${encodeURIComponent(dest)}`,
      { method: 'DELETE' },
    ),

  getNeighbors: () => fetchJSON<NeighEntry[]>(`${BASE}/neighbors`),
  addNeighbor:  (n: NeighEntry) =>
    fetchJSON<NeighEntry>(`${BASE}/neighbors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(n),
    }),
  deleteNeighbor: (ip: string, dev: string) =>
    fetchJSON<{ status: string }>(
      `${BASE}/neighbors/${encodeURIComponent(ip)}/${encodeURIComponent(dev)}`,
      { method: 'DELETE' },
    ),
}
