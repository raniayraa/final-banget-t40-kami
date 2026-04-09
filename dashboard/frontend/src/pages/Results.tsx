import { useEffect, useState } from 'react'
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { api, type ExperimentResult, type CsvRow } from '../api/client'

// ─── Data processing ─────────────────────────────────────────────────────────

interface ChartPoint {
  time: string
  pps: number
  mbps: number
}

function buildChartData(rows: CsvRow[], port: string, pktMetric: string, byteMetric: string): ChartPoint[] {
  // Filter to the requested port and relevant metrics
  const byTime: Map<string, Record<string, number>> = new Map()
  for (const row of rows) {
    if (row.port !== port) continue
    if (row.metric !== pktMetric && row.metric !== byteMetric) continue
    if (!byTime.has(row.time)) byTime.set(row.time, {})
    byTime.get(row.time)![row.metric] = Number(row.value)
  }

  const times = Array.from(byTime.keys()).sort()
  const result: ChartPoint[] = []

  for (let i = 1; i < times.length; i++) {
    const prev = byTime.get(times[i - 1])!
    const curr = byTime.get(times[i])!
    const pktDelta = Math.max(0, (curr[pktMetric] ?? 0) - (prev[pktMetric] ?? 0))
    const byteDelta = Math.max(0, (curr[byteMetric] ?? 0) - (prev[byteMetric] ?? 0))
    result.push({
      time: times[i].slice(11, 19), // HH:MM:SS
      pps: pktDelta,
      mbps: Math.round((byteDelta * 8) / 1_000_000),
    })
  }
  return result
}

// ─── Sub-components ──────────────────────────────────────────────────────────

interface ChartCardProps {
  title: string
  data: ChartPoint[]
}

function ChartCard({ title, data }: ChartCardProps) {
  return (
    <div style={{
      background: '#fff',
      borderRadius: 8,
      boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
      marginBottom: 24,
      overflow: 'hidden',
    }}>
      <div style={{
        background: '#1A1A1A',
        color: '#F6A800',
        fontWeight: 700,
        fontSize: 13,
        padding: '10px 16px',
        letterSpacing: 0.3,
      }}>
        {title}
      </div>
      <div style={{ padding: '16px 8px 8px 0' }}>
        {data.length === 0 ? (
          <div style={{ padding: '24px 16px', color: '#888', fontSize: 13 }}>No data</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={data} margin={{ top: 4, right: 24, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="time" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis yAxisId="pps" orientation="left" tick={{ fontSize: 11 }} width={70}
                label={{ value: 'PPS', angle: -90, position: 'insideLeft', offset: 10, style: { fontSize: 11 } }} />
              <YAxis yAxisId="mbps" orientation="right" tick={{ fontSize: 11 }} width={60}
                label={{ value: 'Mbps', angle: 90, position: 'insideRight', offset: 10, style: { fontSize: 11 } }} />
              <Tooltip formatter={(v: number, name: string) => [v.toLocaleString(), name]} />
              <Legend />
              <Line yAxisId="pps" type="monotone" dataKey="pps" name="PPS"
                stroke="#F6A800" dot={false} strokeWidth={2} />
              <Line yAxisId="mbps" type="monotone" dataKey="mbps" name="Mbps"
                stroke="#3B82F6" dot={false} strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

interface PktViewerProps {
  node1Pkt: string | null
  node4Pkt: string | null
}

function PktViewer({ node1Pkt, node4Pkt }: PktViewerProps) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ marginBottom: 24 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: '#1A1A1A',
          color: '#C8C8C8',
          border: 'none',
          borderRadius: 6,
          padding: '6px 14px',
          fontSize: 13,
          cursor: 'pointer',
          marginBottom: open ? 12 : 0,
        }}
      >
        {open ? '▼' : '▶'} PKT Scripts Used
      </button>
      {open && (
        <div style={{ display: 'flex', gap: 16 }}>
          {([['node1_send.pkt', node1Pkt], ['node4_send.pkt', node4Pkt]] as [string, string | null][]).map(([name, content]) => (
            <div key={name} style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 4 }}>{name}</div>
              <pre style={{
                background: '#1A1A1A',
                color: '#A8F0A8',
                padding: 12,
                borderRadius: 6,
                fontSize: 12,
                margin: 0,
                overflowX: 'auto',
                minHeight: 80,
              }}>
                {content ?? 'Not available'}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

interface LoadedData {
  node1Rows: CsvRow[]
  node4Rows: CsvRow[]
  node5Rows: CsvRow[]
  node1Pkt: string | null
  node4Pkt: string | null
}

export function Results() {
  const [experiments, setExperiments] = useState<ExperimentResult[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [data, setData] = useState<LoadedData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.listResults().then(setExperiments).catch(() => setExperiments([]))
  }, [])

  async function loadExperiment(name: string) {
    setSelected(name)
    setData(null)
    setError(null)
    setLoading(true)
    try {
      const [n1Csv, n4Csv, n5Csv, n1Pkt, n4Pkt] = await Promise.allSettled([
        api.getResultCsv(name, 'node1.csv'),
        api.getResultCsv(name, 'node4.csv'),
        api.getResultCsv(name, 'node5.csv'),
        api.getResultPkt(name, 'node1_send.pkt'),
        api.getResultPkt(name, 'node4_send.pkt'),
      ])
      setData({
        node1Rows: n1Csv.status === 'fulfilled' ? n1Csv.value.rows : [],
        node4Rows: n4Csv.status === 'fulfilled' ? n4Csv.value.rows : [],
        node5Rows: n5Csv.status === 'fulfilled' ? n5Csv.value.rows : [],
        node1Pkt: n1Pkt.status === 'fulfilled' ? n1Pkt.value.content : null,
        node4Pkt: n4Pkt.status === 'fulfilled' ? n4Pkt.value.content : null,
      })
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const charts = data ? [
    {
      title: 'Node 4 — Port 0 (Sender TX)',
      data: buildChartData(data.node4Rows, '0', 'opackets', 'obytes'),
    },
    {
      title: 'Node 1 — Port 0 (Sender TX)',
      data: buildChartData(data.node1Rows, '0', 'opackets', 'obytes'),
    },
    {
      title: 'Node 1 — Port 1 (Receiver RX)',
      data: buildChartData(data.node1Rows, '1', 'ipackets', 'ibytes'),
    },
    {
      title: 'Node 5 — Port 0 (Receiver RX)',
      data: buildChartData(data.node5Rows, '0', 'ipackets', 'ibytes'),
    },
  ] : []

  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
      {/* Sidebar */}
      <div style={{
        width: 240,
        flexShrink: 0,
        background: '#fff',
        borderRadius: 8,
        boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
        overflow: 'hidden',
      }}>
        <div style={{
          background: '#1A1A1A',
          color: '#F6A800',
          fontWeight: 700,
          fontSize: 13,
          padding: '10px 16px',
        }}>
          Experiments
        </div>
        {experiments.length === 0 ? (
          <div style={{ padding: 16, color: '#888', fontSize: 13 }}>No results yet</div>
        ) : (
          experiments.map(exp => {
            const active = exp.name === selected
            const label = exp.name.replace('pktgen_stats_', '').replace(/_/g, ' ')
            return (
              <button
                key={exp.name}
                onClick={() => loadExperiment(exp.name)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  border: 'none',
                  borderBottom: '1px solid #f0f0f0',
                  background: active ? 'rgba(246,168,0,0.08)' : 'transparent',
                  color: active ? '#F6A800' : '#333',
                  fontWeight: active ? 700 : 400,
                  padding: '10px 16px',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            )
          })
        )}
      </div>

      {/* Main panel */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!selected && (
          <div style={{ color: '#888', fontSize: 14, paddingTop: 16 }}>
            Select an experiment from the list to view charts.
          </div>
        )}
        {loading && (
          <div style={{ color: '#888', fontSize: 14, paddingTop: 16 }}>Loading…</div>
        )}
        {error && (
          <div style={{ color: '#c00', fontSize: 13, paddingTop: 16 }}>{error}</div>
        )}
        {data && (
          <>
            <PktViewer node1Pkt={data.node1Pkt} node4Pkt={data.node4Pkt} />
            {charts.map(c => (
              <ChartCard key={c.title} title={c.title} data={c.data} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
