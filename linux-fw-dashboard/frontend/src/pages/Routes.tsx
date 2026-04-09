import { useEffect, useState } from 'react'
import { api, RouteEntry, NeighEntry } from '../api/client'

const MAC_RE   = /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/
const CIDR_RE  = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$|^default$/

const emptyRoute  = (): RouteEntry  => ({ dest: '', gateway: '', dev: '', metric: 0 })
const emptyNeigh  = (): NeighEntry  => ({ ip: '', mac: '', dev: '', state: '' })

const STATE_COLORS: Record<string, { bg: string; color: string }> = {
  PERMANENT:  { bg: '#C8E6C9', color: '#1B5E20' },
  REACHABLE:  { bg: '#BBDEFB', color: '#0D47A1' },
  STALE:      { bg: '#FFE0B2', color: '#E65100' },
  DELAY:      { bg: '#FFF9C4', color: '#F57F17' },
  PROBE:      { bg: '#E1BEE7', color: '#4A148C' },
}

function stateBadge(state: string) {
  const col = STATE_COLORS[state] ?? { bg: '#EEEEEE', color: '#333' }
  return (
    <span style={{ ...st.badge, background: col.bg, color: col.color }}>
      {state}
    </span>
  )
}

export default function RoutesPage() {
  const [routes,   setRoutes]   = useState<RouteEntry[]>([])
  const [neighbors, setNeighbors] = useState<NeighEntry[]>([])
  const [routeForm, setRouteForm] = useState<RouteEntry>(emptyRoute())
  const [neighForm, setNeighForm] = useState<NeighEntry>(emptyNeigh())
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 2500) }

  const fetchAll = async () => {
    try { setRoutes(await api.getRoutes()) }
    catch (e: any) { setErr(e.message) }
    try { setNeighbors(await api.getNeighbors()) }
    catch (e: any) { setErr(e.message) }
  }

  useEffect(() => { fetchAll() }, [])

  // ── Route handlers ──────────────────────────────────────────────────────────

  const validateRoute = (): string => {
    if (!routeForm.dest.trim()) return 'Destination is required'
    if (!CIDR_RE.test(routeForm.dest.trim())) return 'Invalid destination (use CIDR like 192.168.1.0/24 or "default")'
    return ''
  }

  const addRoute = async () => {
    const e = validateRoute()
    if (e) { setErr(e); return }
    setErr('')
    try {
      await api.addRoute({ ...routeForm, dest: routeForm.dest.trim() })
      setRouteForm(emptyRoute())
      flash('Route added')
      fetchAll()
    } catch (ex: any) { setErr(ex.message) }
  }

  const deleteRoute = async (dest: string) => {
    try {
      await api.deleteRoute(dest)
      flash(`Route ${dest} deleted`)
      fetchAll()
    } catch (ex: any) { setErr(ex.message) }
  }

  // ── Neighbor handlers ────────────────────────────────────────────────────────

  const validateNeigh = (): string => {
    if (!neighForm.ip.trim())  return 'IP address is required'
    if (!MAC_RE.test(neighForm.mac)) return 'Invalid MAC address (format: aa:bb:cc:dd:ee:ff)'
    if (!neighForm.dev.trim()) return 'Interface (dev) is required'
    return ''
  }

  const addNeighbor = async () => {
    const e = validateNeigh()
    if (e) { setErr(e); return }
    setErr('')
    try {
      await api.addNeighbor({ ...neighForm, ip: neighForm.ip.trim(), dev: neighForm.dev.trim() })
      setNeighForm(emptyNeigh())
      flash('Neighbor added')
      fetchAll()
    } catch (ex: any) { setErr(ex.message) }
  }

  const deleteNeighbor = async (ip: string, dev: string) => {
    try {
      await api.deleteNeighbor(ip, dev)
      flash(`Neighbor ${ip} deleted`)
      fetchAll()
    } catch (ex: any) { setErr(ex.message) }
  }

  // ── Field helpers ─────────────────────────────────────────────────────────

  const fr = (field: keyof RouteEntry) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setRouteForm(f => ({ ...f, [field]: field === 'metric' ? +e.target.value : e.target.value }))

  const fn = (field: keyof NeighEntry) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setNeighForm(f => ({ ...f, [field]: e.target.value }))

  return (
    <div>
      <h1 style={st.title}>Routes &amp; Neighbors</h1>

      {msg && <div style={st.toast}>{msg}</div>}
      {err && <div style={st.errBox}>{err}</div>}

      {/* ── Routes table ───────────────────────────────────────────────────── */}
      <section style={st.card}>
        <h2 style={st.cardTitle}>Kernel Routes ({routes.length})</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={st.table}>
            <thead>
              <tr>
                {['Destination', 'Gateway', 'Dev', 'Metric', ''].map(h => (
                  <th key={h} style={st.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {routes.length === 0 && (
                <tr><td colSpan={5} style={{ ...st.td, color: '#475569', textAlign: 'center' }}>No routes</td></tr>
              )}
              {routes.map((r, idx) => (
                <tr key={`${r.dest}-${idx}`} style={{ background: idx % 2 === 0 ? '#FFFFFF' : '#EBF0F5' }}>
                  <td style={{ ...st.td, fontFamily: 'monospace' }}>{r.dest}</td>
                  <td style={{ ...st.td, fontFamily: 'monospace' }}>{r.gateway || '—'}</td>
                  <td style={st.td}>{r.dev || '—'}</td>
                  <td style={st.td}>{r.metric || '—'}</td>
                  <td style={st.td}>
                    <button style={st.delBtn} onClick={() => deleteRoute(r.dest)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Add route form ─────────────────────────────────────────────────── */}
      <section style={st.card}>
        <h2 style={st.cardTitle}>Add Route</h2>
        <div style={st.formGrid}>
          <div style={st.formField}>
            <label style={st.label}>Destination <span style={st.req}>*</span></label>
            <input type="text" value={routeForm.dest} onChange={fr('dest')}
              placeholder="192.168.1.0/24 or default" style={st.input} />
          </div>
          <div style={st.formField}>
            <label style={st.label}>Gateway (via)</label>
            <input type="text" value={routeForm.gateway} onChange={fr('gateway')}
              placeholder="192.168.1.1" style={st.input} />
          </div>
          <div style={st.formField}>
            <label style={st.label}>Interface (dev)</label>
            <input type="text" value={routeForm.dev} onChange={fr('dev')}
              placeholder="eth0" style={st.input} />
          </div>
          <div style={st.formField}>
            <label style={st.label}>Metric</label>
            <input type="number" min={0} value={routeForm.metric || ''} onChange={fr('metric')}
              placeholder="100" style={{ ...st.input, width: 100 }} />
          </div>
        </div>
        <button style={st.addBtn} onClick={addRoute}>Add Route</button>
      </section>

      {/* ── Neighbors (ARP) table ─────────────────────────────────────────── */}
      <section style={st.card}>
        <h2 style={st.cardTitle}>Static ARP Neighbors ({neighbors.length})</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={st.table}>
            <thead>
              <tr>
                {['IP', 'MAC (lladdr)', 'Dev', 'State', ''].map(h => (
                  <th key={h} style={st.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {neighbors.length === 0 && (
                <tr><td colSpan={5} style={{ ...st.td, color: '#475569', textAlign: 'center' }}>No neighbors</td></tr>
              )}
              {neighbors.map((n, idx) => (
                <tr key={`${n.ip}-${n.dev}-${idx}`} style={{ background: idx % 2 === 0 ? '#FFFFFF' : '#EBF0F5' }}>
                  <td style={{ ...st.td, fontFamily: 'monospace' }}>{n.ip}</td>
                  <td style={{ ...st.td, fontFamily: 'monospace' }}>{n.mac}</td>
                  <td style={st.td}>{n.dev}</td>
                  <td style={st.td}>{stateBadge(n.state)}</td>
                  <td style={st.td}>
                    <button style={st.delBtn} onClick={() => deleteNeighbor(n.ip, n.dev)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Add neighbor form ─────────────────────────────────────────────── */}
      <section style={st.card}>
        <h2 style={st.cardTitle}>Add Static ARP Neighbor</h2>
        <p style={st.hint}>Adds a permanent ARP entry: <code>ip neigh add &lt;ip&gt; lladdr &lt;mac&gt; dev &lt;dev&gt; nud permanent</code></p>
        <div style={st.formGrid}>
          <div style={st.formField}>
            <label style={st.label}>IP Address <span style={st.req}>*</span></label>
            <input type="text" value={neighForm.ip} onChange={fn('ip')}
              placeholder="192.168.1.1" style={st.input} />
          </div>
          <div style={st.formField}>
            <label style={st.label}>MAC Address <span style={st.req}>*</span></label>
            <input type="text" value={neighForm.mac} onChange={fn('mac')}
              placeholder="aa:bb:cc:dd:ee:ff" style={st.input} />
          </div>
          <div style={st.formField}>
            <label style={st.label}>Interface (dev) <span style={st.req}>*</span></label>
            <input type="text" value={neighForm.dev} onChange={fn('dev')}
              placeholder="eth0" style={st.input} />
          </div>
        </div>
        <button style={st.addBtn} onClick={addNeighbor}>Add Neighbor</button>
      </section>
    </div>
  )
}

const st: Record<string, React.CSSProperties> = {
  title: { fontSize: 20, fontWeight: 600, color: '#1A1A1A', marginBottom: 20 },
  toast: {
    padding: '10px 16px', background: '#FFF8E1', borderRadius: 2,
    border: '1px solid #F6A800', color: '#7A5200', marginBottom: 12, fontSize: 13,
  },
  errBox: {
    padding: '10px 16px', background: '#FFEBEE', borderRadius: 2,
    border: '1px solid #FFCDD2', color: '#C62828', marginBottom: 12, fontSize: 13,
  },
  card: {
    background: '#FFFFFF', borderRadius: 2, padding: 20,
    marginBottom: 16, border: '1px solid #C8C8C8',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  cardTitle: { fontSize: 13, fontWeight: 600, color: '#3A3A3A', marginBottom: 16, textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  hint: { color: '#5A5A5A', fontSize: 12, marginBottom: 14 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
  th: {
    padding: '8px 10px', textAlign: 'left', color: '#3A4A58',
    background: '#D8E0E8', borderBottom: '1px solid #B8C4CE',
    fontWeight: 600, fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.05em',
  },
  td: { padding: '8px 10px', color: '#1A1A1A', borderBottom: '1px solid #E8E8E8' },
  badge: {
    display: 'inline-block', padding: '2px 8px', borderRadius: 2,
    fontSize: 11, fontWeight: 600,
  },
  delBtn: {
    padding: '4px 10px', background: '#FFEBEE', border: '1px solid #FFCDD2',
    borderRadius: 2, color: '#C62828', cursor: 'pointer', fontSize: 12,
  },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16, marginBottom: 16 },
  formField: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 12, color: '#5A5A5A', fontWeight: 500 },
  req: { color: '#C62828' },
  input: {
    padding: '6px 10px', background: '#FFFFFF', border: '1px solid #C8C8C8',
    borderRadius: 2, color: '#1A1A1A', fontSize: 13,
  },
  addBtn: {
    padding: '7px 18px', background: '#F6A800', border: '1px solid #D99A00',
    borderRadius: 2, color: '#1A1A1A', cursor: 'pointer', fontSize: 13, fontWeight: 500,
  },
}
