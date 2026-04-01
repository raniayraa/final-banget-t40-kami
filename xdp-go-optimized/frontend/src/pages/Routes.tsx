import { useEffect, useState } from 'react'
import { api, RouteEntry } from '../api/client'

const MAC_RE = /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/
const IP_RE  = /^(\d{1,3}\.){3}\d{1,3}$/

const emptyForm = (): RouteEntry => ({
  ip: '', dst_mac: '', src_mac: '', action: 'redirect', port_key: 0,
})

export default function RoutesPage() {
  const [routes, setRoutes] = useState<RouteEntry[]>([])
  const [form, setForm] = useState<RouteEntry>(emptyForm())
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 2500) }

  const fetchRoutes = async () => {
    try { setRoutes(await api.getRoutes()) }
    catch (e: any) { setErr(e.message) }
  }

  useEffect(() => { fetchRoutes() }, [])

  const validate = (): string => {
    if (!IP_RE.test(form.ip))       return 'Invalid destination IP'
    if (!MAC_RE.test(form.dst_mac)) return 'Invalid dst MAC (format: aa:bb:cc:dd:ee:ff)'
    if (!MAC_RE.test(form.src_mac)) return 'Invalid src MAC (format: aa:bb:cc:dd:ee:ff)'
    return ''
  }

  const addRoute = async () => {
    const e = validate()
    if (e) { setErr(e); return }
    setErr('')
    try {
      await api.addRoute(form)
      setForm(emptyForm())
      flash('Route added')
      fetchRoutes()
    } catch (ex: any) { setErr(ex.message) }
  }

  const deleteRoute = async (ip: string) => {
    try {
      await api.deleteRoute(ip)
      flash(`Route ${ip} deleted`)
      fetchRoutes()
    } catch (ex: any) { setErr(ex.message) }
  }

  const fi = (field: keyof RouteEntry) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [field]: field === 'port_key' ? +e.target.value : e.target.value }))

  return (
    <div>
      <h1 style={s.title}>Forwarding Routes</h1>

      {msg && <div style={s.toast}>{msg}</div>}
      {err && <div style={s.errBox}>{err}</div>}

      {/* Existing routes table */}
      <section style={s.card}>
        <h2 style={s.cardTitle}>Current Routes ({routes.length})</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={s.table}>
            <thead>
              <tr>
                {['Dst IP', 'Dst MAC', 'Src MAC', 'Action', 'Port Key', ''].map(h => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {routes.length === 0 && (
                <tr><td colSpan={6} style={{ ...s.td, color: '#475569', textAlign: 'center' }}>No routes</td></tr>
              )}
              {routes.map((r, idx) => (
                <tr key={r.ip} style={{ background: idx % 2 === 0 ? '#FFFFFF' : '#EBF0F5' }}>
                  <td style={s.td}>{r.ip}</td>
                  <td style={{ ...s.td, fontFamily: 'monospace' }}>{r.dst_mac}</td>
                  <td style={{ ...s.td, fontFamily: 'monospace' }}>{r.src_mac}</td>
                  <td style={s.td}>
                    <span style={{ ...s.badge, background: r.action === 'tx' ? '#BBDEFB' : '#E1BEE7', color: r.action === 'tx' ? '#0D47A1' : '#4A148C' }}>
                      {r.action.toUpperCase()}
                    </span>
                  </td>
                  <td style={s.td}>{r.port_key}</td>
                  <td style={s.td}>
                    <button style={s.delBtn} onClick={() => deleteRoute(r.ip)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Add route form */}
      <section style={s.card}>
        <h2 style={s.cardTitle}>Add Route</h2>
        <div style={s.formGrid}>
          {([
            ['ip',      'Destination IP',  'text',   '192.168.1.5'],
            ['dst_mac', 'Next-hop MAC',    'text',   'aa:bb:cc:dd:ee:ff'],
            ['src_mac', 'Egress NIC MAC',  'text',   '11:22:33:44:55:66'],
          ] as [keyof RouteEntry, string, string, string][]).map(([field, label, type, placeholder]) => (
            <div key={field} style={s.formField}>
              <label style={s.label}>{label}</label>
              <input
                type={type}
                value={String(form[field])}
                onChange={fi(field)}
                placeholder={placeholder}
                style={s.input}
              />
            </div>
          ))}
          <div style={s.formField}>
            <label style={s.label}>Action</label>
            <select value={form.action} onChange={fi('action')} style={s.input}>
              <option value="redirect">XDP_REDIRECT (to egress NIC)</option>
              <option value="tx">XDP_TX (hairpin)</option>
            </select>
          </div>
          {form.action === 'redirect' && (
            <div style={s.formField}>
              <label style={s.label}>DEVMAP Port Key</label>
              <input
                type="number" min={0} max={15}
                value={form.port_key}
                onChange={fi('port_key')}
                style={{ ...s.input, width: 80 }}
              />
            </div>
          )}
        </div>
        <button style={s.addBtn} onClick={addRoute}>Add Route</button>
      </section>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
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
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16, marginBottom: 16 },
  formField: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 12, color: '#5A5A5A', fontWeight: 500 },
  input: {
    padding: '6px 10px', background: '#FFFFFF', border: '1px solid #C8C8C8',
    borderRadius: 2, color: '#1A1A1A', fontSize: 13,
  },
  addBtn: {
    padding: '7px 18px', background: '#F6A800', border: '1px solid #D99A00',
    borderRadius: 2, color: '#1A1A1A', cursor: 'pointer', fontSize: 13, fontWeight: 500,
  },
}
