import { useEffect, useRef, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { api } from '../api/client'

interface RatePoint {
  t:        string
  drop_pps: number
  pass_pps: number
  mbits:    number
}

export default function Monitoring() {
  const [chart, setChart] = useState<RatePoint[]>([])
  const [running, setRunning] = useState(false)
  const prevTime = useRef<number>(Date.now())

  useEffect(() => {
    const tick = async () => {
      try {
        const s = await api.getStatus()
        setRunning(s.daemon_running)
        if (!s.daemon_running) return

        // The backend already returns per-2s deltas (not absolute counters).
        // Divide directly by the actual elapsed time to get rates.
        const st = await api.getStatsLive()
        const now = Date.now()
        const dt = (now - prevTime.current) / 1000 || 2

        const totalBytes = st.drop.bytes + st.pass.bytes
        const pt: RatePoint = {
          t:        new Date().toLocaleTimeString(),
          drop_pps: st.drop.packets / dt,
          pass_pps: st.pass.packets / dt,
          mbits:    (totalBytes * 8) / dt / 1e6,
        }
        setChart(prev => [...prev.slice(-59), pt])
        prevTime.current = now
      } catch { /* ignore */ }
    }
    tick()
    const id = setInterval(tick, 2000)
    return () => clearInterval(id)
  }, [])

  return (
    <div>
      <h1 style={s.title}>Monitoring</h1>

      {!running && (
        <div style={s.notice}>Firewall is not running. Start it from the Firewall page.</div>
      )}

      <section style={s.card}>
        <h2 style={s.cardTitle}>Throughput (live, 2s interval)</h2>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chart}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E0E0E0" />
            <XAxis dataKey="t" tick={{ fill: '#5A5A5A', fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis yAxisId="pps" tick={{ fill: '#5A5A5A', fontSize: 11 }} />
            <YAxis yAxisId="mb" orientation="right" tick={{ fill: '#5A5A5A', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: '#FFFFFF', border: '1px solid #C8C8C8', fontSize: 12, color: '#1A1A1A' }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line yAxisId="pps" type="monotone" dataKey="drop_pps" name="DROP pps" stroke="#f87171" dot={false} />
            <Line yAxisId="pps" type="monotone" dataKey="pass_pps" name="PASS pps" stroke="#4ade80" dot={false} />
            <Line yAxisId="mb"  type="monotone" dataKey="mbits"    name="Mbits/s"  stroke="#fbbf24" dot={false} strokeDasharray="4 2" />
          </LineChart>
        </ResponsiveContainer>
      </section>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  title: { fontSize: 20, fontWeight: 600, color: '#1A1A1A', marginBottom: 20 },
  notice: {
    padding: '12px 16px', background: '#FFF3CD', borderRadius: 2,
    border: '1px solid #F6A800', color: '#7A5200', marginBottom: 16, fontSize: 13,
  },
  card: {
    background: '#FFFFFF', borderRadius: 2, padding: 20,
    marginBottom: 16, border: '1px solid #C8C8C8',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  cardTitle: { fontSize: 13, fontWeight: 600, color: '#3A3A3A', marginBottom: 16, textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
}
