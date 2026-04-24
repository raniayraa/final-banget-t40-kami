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
  type TooltipProps,
} from 'recharts'
import { api, type ExperimentResult, type CsvRow, type LatencyMetrics } from '../api/client'

// ─── Data processing ─────────────────────────────────────────────────────────

interface ChartPoint {
  time: string
  pps: number
  mbps: number
}

function buildChartData(rows: CsvRow[], port: string, pktMetric: string, byteMetric: string): ChartPoint[] {
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
      time: times[i].slice(11, 19),
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

// ─── Description box ─────────────────────────────────────────────────────────

interface DescriptionBoxProps {
  expName: string
  initialValue: string | null
}

function DescriptionBox({ expName, initialValue }: DescriptionBoxProps) {
  const [value, setValue] = useState(initialValue ?? '')
  const [saved, setSaved] = useState(initialValue ?? '')
  const [saving, setSaving] = useState(false)

  const dirty = value !== saved

  async function handleSave() {
    if (!dirty) return
    setSaving(true)
    try {
      await api.updateDescription(expName, value)
      setSaved(value)
    } catch {
      // silently ignore
    } finally {
      setSaving(false)
    }
  }

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
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span>Description</span>
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          style={{
            fontSize: 12,
            padding: '3px 12px',
            borderRadius: 4,
            border: 'none',
            background: dirty ? '#F6A800' : '#555',
            color: dirty ? '#1A1A1A' : '#888',
            fontWeight: 700,
            cursor: dirty ? 'pointer' : 'not-allowed',
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      <div style={{ padding: 12 }}>
        <textarea
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="Add experiment notes, conditions, or observations…"
          rows={3}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            resize: 'vertical',
            fontSize: 13,
            padding: '8px 10px',
            borderRadius: 5,
            border: dirty ? '1.5px solid #F6A800' : '1px solid #ddd',
            outline: 'none',
            fontFamily: 'inherit',
            color: '#333',
            background: '#fafafa',
          }}
        />
      </div>
    </div>
  )
}

// ─── Latency section ─────────────────────────────────────────────────────────

function LatencySection({ metrics }: { metrics: LatencyMetrics | null }) {
  if (metrics === null) {
    return (
      <div style={{
        background: '#fff',
        borderRadius: 8,
        boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
        marginBottom: 24,
        overflow: 'hidden',
      }}>
        <div style={{ background: '#1A1A1A', color: '#F6A800', fontWeight: 700, fontSize: 13, padding: '10px 16px', letterSpacing: 0.3 }}>
          Latency Metrics
        </div>
        <div style={{ padding: '16px', color: '#888', fontSize: 13 }}>
          Latency data not available for this experiment.
        </div>
      </div>
    )
  }

  const toUs = (ns: number) => (ns / 1000).toFixed(2)

  const cards = [
    { label: 'Min', value: toUs(metrics.min_ns), unit: 'µs', color: '#22c55e' },
    { label: 'Avg (≈p50)', value: toUs(metrics.avg_ns), unit: 'µs', color: '#3B82F6' },
    { label: 'Max', value: toUs(metrics.max_ns), unit: 'µs', color: '#ef4444' },
    { label: 'Jitter', value: toUs(metrics.jitter_ns), unit: 'µs', color: '#a855f7' },
  ]

  return (
    <div style={{
      background: '#fff',
      borderRadius: 8,
      boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
      marginBottom: 24,
      overflow: 'hidden',
    }}>
      <div style={{ background: '#1A1A1A', color: '#F6A800', fontWeight: 700, fontSize: 13, padding: '10px 16px', letterSpacing: 0.3 }}>
        Latency Metrics (Node 4 → Node 6 → Node 5)
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, background: '#f0f0f0' }}>
        {cards.map(card => (
          <div key={card.label} style={{ background: '#fff', padding: '16px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#888', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {card.label}
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: card.color, lineHeight: 1 }}>
              {card.value}
            </div>
            <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>{card.unit}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── CPU time-series section ──────────────────────────────────────────────────

const CPU_METRICS = ['%usr', '%nice', '%sys', '%iowait', '%irq', '%soft', '%steal', '%guest', '%gnice', '%idle']

function coreColor(i: number, total: number): string {
  return `hsl(${Math.round((i * 360) / total)}, 65%, 50%)`
}

interface CpuData {
  metrics: string[]
  coreCount: number
  rows: Record<string, number>[]
}

function parseCpuCsv(text: string): CpuData {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return { metrics: [], coreCount: 0, rows: [] }
  const headers = lines[0].split(',').map(h => h.trim())

  // Extract unique metric names from headers like 'cpu0_%usr', 'cpu1_%soft'
  const metricSet = new Set<string>()
  let maxCore = -1
  for (const h of headers) {
    const m = h.match(/^cpu(\d+)_(.+)$/)
    if (m) {
      metricSet.add(m[2])
      maxCore = Math.max(maxCore, parseInt(m[1]))
    }
  }
  // Preserve standard metric order
  const metrics = CPU_METRICS.filter(m => metricSet.has(m))

  const rows: Record<string, number>[] = []
  for (const line of lines.slice(1)) {
    const parts = line.split(',')
    if (parts.length !== headers.length) continue
    const row: Record<string, number> = {}
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = parseFloat(parts[i])
    }
    rows.push(row)
  }
  return { metrics, coreCount: maxCore + 1, rows }
}

const NODE_OPTIONS = [
  { value: 'node1', label: 'Node 1 (10.90.1.1 — Sender)' },
  { value: 'node4', label: 'Node 4 (10.90.1.4 — Sender)' },
  { value: 'node5', label: 'Node 5 (10.90.1.5 — Receiver)' },
  { value: 'node6', label: 'Node 6 (10.90.1.6 — Router/DUT)' },
]

function CpuTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'rgba(26,26,26,0.92)',
      border: '1px solid #444',
      borderRadius: 6,
      padding: '8px 10px',
      fontSize: 11,
      color: '#eee',
      maxWidth: 360,
    }}>
      <div style={{ fontWeight: 700, marginBottom: 6, color: '#F6A800' }}>
        t = {label}s
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '2px 12px',
      }}>
        {payload.map(entry => (
          <div key={entry.dataKey as string} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{
              display: 'inline-block',
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: entry.color,
              flexShrink: 0,
            }} />
            <span style={{ color: '#ccc' }}>{entry.name}:</span>
            <span style={{ fontWeight: 600 }}>{(entry.value as number).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

interface CpuTimeSeriesSectionProps {
  expName: string
}

function CpuTimeSeriesSection({ expName }: CpuTimeSeriesSectionProps) {
  const [selectedNode, setSelectedNode] = useState('node6')
  const [selectedMetric, setSelectedMetric] = useState('%usr')
  const [cpuData, setCpuData] = useState<CpuData | null>(null)
  const [cpuLoading, setCpuLoading] = useState(false)
  const [cpuUnavailable, setCpuUnavailable] = useState(false)

  useEffect(() => {
    setCpuData(null)
    setCpuUnavailable(false)
    setCpuLoading(true)
    api.getCpuTimeseries(expName, selectedNode)
      .then(text => {
        const parsed = parseCpuCsv(text)
        setCpuData(parsed)
        setSelectedMetric(m => parsed.metrics.includes(m) ? m : (parsed.metrics[0] ?? '%usr'))
      })
      .catch(() => setCpuUnavailable(true))
      .finally(() => setCpuLoading(false))
  }, [expName, selectedNode])

  const cores = cpuData ? Array.from({ length: cpuData.coreCount }, (_, i) => i) : []

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
        display: 'flex',
        alignItems: 'center',
        gap: 16,
      }}>
        <span>CPU Usage Over Time</span>
        <select
          value={selectedNode}
          onChange={e => setSelectedNode(e.target.value)}
          style={{
            fontSize: 12,
            padding: '3px 8px',
            borderRadius: 4,
            border: 'none',
            background: '#333',
            color: '#F6A800',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          {NODE_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={selectedMetric}
          onChange={e => setSelectedMetric(e.target.value)}
          style={{
            fontSize: 12,
            padding: '3px 8px',
            borderRadius: 4,
            border: 'none',
            background: '#333',
            color: '#F6A800',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          {(cpuData?.metrics ?? CPU_METRICS).map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>
      <div style={{ padding: '16px 8px 8px 0' }}>
        {cpuLoading && (
          <div style={{ padding: '24px 16px', color: '#888', fontSize: 13 }}>Loading…</div>
        )}
        {!cpuLoading && cpuUnavailable && (
          <div style={{ padding: '16px', color: '#888', fontSize: 13 }}>
            CPU data not available for this node.
          </div>
        )}
        {!cpuLoading && !cpuUnavailable && cpuData !== null && (
          cpuData.rows.length === 0 ? (
            <div style={{ padding: '24px 16px', color: '#888', fontSize: 13 }}>No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={cpuData.rows} margin={{ top: 4, right: 24, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis
                  dataKey="time_s"
                  tick={{ fontSize: 11 }}
                  label={{ value: 'Time (s)', position: 'insideBottomRight', offset: -8, style: { fontSize: 11 } }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 11 }}
                  width={40}
                  label={{ value: '%', angle: -90, position: 'insideLeft', offset: 12, style: { fontSize: 11 } }}
                />
                <Tooltip content={<CpuTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {cores.map(c => (
                  <Line
                    key={c}
                    type="monotone"
                    dataKey={`cpu${c}_${selectedMetric}`}
                    name={`core ${c}`}
                    stroke={coreColor(c, cpuData.coreCount)}
                    dot={false}
                    strokeWidth={1}
                    isAnimationActive={false}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          )
        )}
      </div>
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
  description: string | null
  latency: LatencyMetrics | null
}

export function Results() {
  const [experiments, setExperiments] = useState<ExperimentResult[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [data, setData] = useState<LoadedData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [renamingExp, setRenamingExp] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameLoading, setRenameLoading] = useState(false)
  const [hoveredExp, setHoveredExp] = useState<string | null>(null)

  useEffect(() => {
    api.listResults().then(setExperiments).catch(() => setExperiments([]))
  }, [])

  async function handleRename(expName: string) {
    if (!renameValue.trim()) return
    setRenameLoading(true)
    try {
      await api.renameExperiment(expName, renameValue.trim())
      const updated = await api.listResults()
      setExperiments(updated)
    } catch {
      // silently ignore
    } finally {
      setRenameLoading(false)
      setRenamingExp(null)
      setRenameValue('')
    }
  }

  async function loadExperiment(name: string) {
    setSelected(name)
    setData(null)
    setError(null)
    setLoading(true)
    try {
      const [freshExps, n1Csv, n4Csv, n5Csv, n1Pkt, n4Pkt, latency] = await Promise.allSettled([
        api.listResults(),
        api.getResultCsv(name, 'node1.csv'),
        api.getResultCsv(name, 'node4.csv'),
        api.getResultCsv(name, 'node5.csv'),
        api.getResultPkt(name, 'node1_send.pkt'),
        api.getResultPkt(name, 'node4_send.pkt'),
        api.getLatency(name),
      ])

      const latestExps = freshExps.status === 'fulfilled' ? freshExps.value : experiments
      if (freshExps.status === 'fulfilled') setExperiments(freshExps.value)
      const expMeta = latestExps.find(e => e.name === name)

      setData({
        node1Rows: n1Csv.status === 'fulfilled' ? n1Csv.value.rows : [],
        node4Rows: n4Csv.status === 'fulfilled' ? n4Csv.value.rows : [],
        node5Rows: n5Csv.status === 'fulfilled' ? n5Csv.value.rows : [],
        node1Pkt: n1Pkt.status === 'fulfilled' ? n1Pkt.value.content : null,
        node4Pkt: n4Pkt.status === 'fulfilled' ? n4Pkt.value.content : null,
        description: expMeta?.description ?? null,
        latency: latency.status === 'fulfilled' ? latency.value : null,
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
            const isRenaming = renamingExp === exp.name
            const isHovered = hoveredExp === exp.name
            const label = exp.display_name ?? exp.name.replace('pktgen_stats_', '').replace(/_/g, ' ')
            return (
              <div
                key={exp.name}
                onMouseEnter={() => setHoveredExp(exp.name)}
                onMouseLeave={() => setHoveredExp(null)}
                style={{
                  borderBottom: '1px solid #f0f0f0',
                  background: active ? 'rgba(246,168,0,0.08)' : 'transparent',
                }}
              >
                {isRenaming ? (
                  <div style={{ display: 'flex', alignItems: 'center', padding: '6px 8px', gap: 4 }}>
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleRename(exp.name)
                        if (e.key === 'Escape') { setRenamingExp(null); setRenameValue('') }
                      }}
                      style={{
                        flex: 1,
                        fontSize: 12,
                        padding: '3px 6px',
                        borderRadius: 4,
                        border: '1px solid #C8C8C8',
                        outline: 'none',
                        minWidth: 0,
                      }}
                    />
                    <button
                      onClick={() => handleRename(exp.name)}
                      disabled={renameLoading}
                      style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 4,
                        border: 'none', background: '#1976D2', color: '#fff',
                        cursor: renameLoading ? 'not-allowed' : 'pointer',
                        flexShrink: 0,
                      }}
                    >
                      {renameLoading ? '…' : 'OK'}
                    </button>
                    <button
                      onClick={() => { setRenamingExp(null); setRenameValue('') }}
                      style={{
                        fontSize: 11, padding: '2px 6px', borderRadius: 4,
                        border: 'none', background: '#e0e0e0', cursor: 'pointer',
                        flexShrink: 0,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <button
                      onClick={() => loadExperiment(exp.name)}
                      style={{
                        flex: 1,
                        textAlign: 'left',
                        border: 'none',
                        background: 'transparent',
                        color: active ? '#F6A800' : '#333',
                        fontWeight: active ? 700 : 400,
                        padding: '10px 12px',
                        fontSize: 12,
                        cursor: 'pointer',
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {label}
                    </button>
                    {(isHovered || active) && (
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          setRenamingExp(exp.name)
                          setRenameValue(exp.display_name ?? '')
                        }}
                        title="Rename experiment"
                        style={{
                          border: 'none',
                          background: 'transparent',
                          cursor: 'pointer',
                          padding: '0 10px',
                          fontSize: 13,
                          color: '#888',
                          flexShrink: 0,
                        }}
                      >
                        ✎
                      </button>
                    )}
                  </div>
                )}
              </div>
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
        {data && selected && (
          <>
            <DescriptionBox expName={selected} initialValue={data.description} />
            <PktViewer node1Pkt={data.node1Pkt} node4Pkt={data.node4Pkt} />
            {charts.map(c => (
              <ChartCard key={c.title} title={c.title} data={c.data} />
            ))}
            <LatencySection metrics={data.latency} />
            <CpuTimeSeriesSection expName={selected} />
          </>
        )}
      </div>
    </div>
  )
}
