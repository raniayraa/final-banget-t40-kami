import { useEffect, useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { api, type ExperimentResult, type MetricsSummary } from '../api/client'

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_SELECTED = 3
const BAR_COLORS = ['#F6A800', '#3B82F6', '#22C55E']

interface MetricDef {
  key: keyof MetricsSummary
  label: string
  unit: string
}

const METRIC_DEFS: MetricDef[] = [
  { key: 'peak_forwarded_pps',        label: 'Peak Forwarded PPS',       unit: 'pps'  },
  { key: 'peak_forwarded_gbps',       label: 'Peak Forwarded Gbps',      unit: 'Gbps' },
  { key: 'sender_injection_pps',      label: 'Sender Injection PPS',     unit: 'pps'  },
  { key: 'packet_loss_pct',           label: 'Packet Loss %',            unit: '%'    },
  { key: 'nic_drop_rate_mean',        label: 'NIC Drop Rate (mean)',     unit: 'pps'  },
  { key: 'nic_drop_rate_peak',        label: 'NIC Drop Rate (peak)',     unit: 'pps'  },
  { key: 'forwarding_efficiency_pct', label: 'Forwarding Efficiency %',  unit: '%'    },
  { key: 'throughput_std_dev',        label: 'Throughput Std Dev',       unit: 'pps'  },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getLabel(exp: ExperimentResult): string {
  return exp.display_name ?? exp.name.replace('pktgen_stats_', '').replace(/_/g, ' ')
}

// ─── MetricBarChart ───────────────────────────────────────────────────────────

interface ExpBarEntry {
  label: string
  value: number
  colorIndex: number
}

interface MetricBarChartProps {
  def: MetricDef
  experiments: ExpBarEntry[]
}

function MetricBarChart({ def, experiments }: MetricBarChartProps) {
  // recharts grouped bar: single-item data array, one <Bar> per experiment
  // Each key in the data object is the experiment label
  const data = [Object.fromEntries(experiments.map(e => [e.label, e.value]))]

  return (
    <div style={{
      background: '#fff',
      borderRadius: 8,
      boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
      marginBottom: 20,
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
        {def.label} ({def.unit})
      </div>
      <div style={{ padding: '16px 8px 8px 0' }}>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={{ top: 4, right: 24, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
            <XAxis dataKey={undefined} tick={false} axisLine={false} tickLine={false} />
            <YAxis
              tick={{ fontSize: 11 }}
              width={75}
              tickFormatter={(v: number) => v.toLocaleString()}
            />
            <Tooltip formatter={(v: number) => [v.toLocaleString(), def.unit]} />
            <Legend />
            {experiments.map(exp => (
              <Bar
                key={exp.label}
                dataKey={exp.label}
                name={exp.label}
                fill={BAR_COLORS[exp.colorIndex]}
                maxBarSize={80}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function Compare() {
  const [experiments, setExperiments] = useState<ExperimentResult[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [metricsMap, setMetricsMap] = useState<Map<string, MetricsSummary>>(new Map())
  const [loadingSet, setLoadingSet] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.listResults().then(setExperiments).catch(() => setExperiments([]))
  }, [])

  async function fetchMetricsFor(name: string) {
    if (metricsMap.has(name)) return
    setLoadingSet(prev => new Set(prev).add(name))
    setError(null)
    try {
      const m = await api.getMetrics(name)
      setMetricsMap(prev => new Map(prev).set(name, m))
    } catch (e) {
      setError(`Failed to load metrics for "${name}": ${String(e)}`)
    } finally {
      setLoadingSet(prev => {
        const next = new Set(prev)
        next.delete(name)
        return next
      })
    }
  }

  function toggleExperiment(name: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
        setMetricsMap(m => {
          const n = new Map(m)
          n.delete(name)
          return n
        })
      } else if (next.size < MAX_SELECTED) {
        next.add(name)
        fetchMetricsFor(name)
      }
      return next
    })
  }

  // Ordered by position in experiments list (newest-first from API)
  const selectedList = experiments.filter(e => selected.has(e.name))
  const isLoading = loadingSet.size > 0
  const readyToChart = selectedList.length >= 2 && selectedList.every(e => metricsMap.has(e.name))

  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
      {/* ── Left column: experiment checklist ─────────────────────── */}
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
          Select Experiments (2–{MAX_SELECTED})
        </div>
        <div style={{ maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' }}>
          {experiments.length === 0 ? (
            <div style={{ padding: 16, color: '#888', fontSize: 13 }}>No results yet</div>
          ) : (
            experiments.map(exp => {
              const isChecked = selected.has(exp.name)
              const isDisabled = !isChecked && selected.size >= MAX_SELECTED
              const label = getLabel(exp)
              return (
                <label
                  key={exp.name}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '10px 14px',
                    borderBottom: '1px solid #f0f0f0',
                    cursor: isDisabled ? 'not-allowed' : 'pointer',
                    background: isChecked ? 'rgba(246,168,0,0.08)' : 'transparent',
                    opacity: isDisabled ? 0.45 : 1,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={isDisabled}
                    onChange={() => toggleExperiment(exp.name)}
                    style={{ marginTop: 2, accentColor: '#F6A800', flexShrink: 0 }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontSize: 12,
                      fontWeight: isChecked ? 700 : 400,
                      color: isChecked ? '#F6A800' : '#333',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {label}
                    </div>
                    {exp.display_name && (
                      <div style={{ fontSize: 10, color: '#aaa', fontFamily: 'monospace', marginTop: 2 }}>
                        {exp.name.replace('pktgen_stats_', '')}
                      </div>
                    )}
                  </div>
                </label>
              )
            })
          )}
        </div>
      </div>

      {/* ── Right panel: charts ───────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {selected.size < 2 && !isLoading && (
          <div style={{ color: '#888', fontSize: 14, paddingTop: 16 }}>
            Select 2 or 3 experiments from the list to compare their metrics.
          </div>
        )}
        {isLoading && (
          <div style={{ color: '#888', fontSize: 14, paddingTop: 16 }}>
            Computing metrics…
          </div>
        )}
        {error && (
          <div style={{ color: '#c00', fontSize: 13, paddingTop: 16 }}>{error}</div>
        )}
        {readyToChart && METRIC_DEFS.map((def) => {
          const expData: ExpBarEntry[] = selectedList.map((exp, idx) => ({
            label: getLabel(exp),
            value: metricsMap.get(exp.name)![def.key],
            colorIndex: idx,
          }))
          return <MetricBarChart key={def.key} def={def} experiments={expData} />
        })}
      </div>
    </div>
  )
}
