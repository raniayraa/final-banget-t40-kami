import { useEffect, useState, useCallback } from 'react'
import { api, ConfigResponse, CPUResponse, FwFlags } from '../api/client'
import PortList from '../components/PortList'
import StatusBadge from '../components/StatusBadge'

const FLAG_LABELS: { key: keyof FwFlags; label: string; desc: string }[] = [
  { key: 'block_icmp_ping',    label: 'Block ICMP Ping',       desc: 'Drop ICMP echo request (ping) packets' },
  { key: 'block_ip_fragments', label: 'Block IP Fragments',    desc: 'Drop fragmented IP packets' },
  { key: 'block_malformed_tcp',label: 'Block Malformed TCP',   desc: 'Drop NULL/XMAS/SYN+FIN/RST+FIN scans' },
  { key: 'block_broadcast',    label: 'Block Broadcast',       desc: 'Drop packets to 255.255.255.255' },
  { key: 'block_multicast',    label: 'Block Multicast',       desc: 'Drop packets to 224.0.0.0/4' },
  { key: 'block_all_tcp',      label: 'Block ALL TCP',         desc: 'Drop every TCP packet (overrides port list)' },
  { key: 'block_all_udp',      label: 'Block ALL UDP',         desc: 'Drop every UDP packet (overrides port list)' },
]

export default function FirewallConfig() {
  const [running, setRunning] = useState(false)
  const [config, setConfig] = useState<ConfigResponse | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [cpu, setCpu] = useState<CPUResponse | null>(null)
  const [sliderVal, setSliderVal] = useState(1)
  const [cpuSaving, setCpuSaving] = useState(false)

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 2500) }

  const refresh = useCallback(async () => {
    try {
      const s = await api.getStatus()
      setRunning(s.daemon_running)
      if (s.daemon_running) {
        const c = await api.getConfig()
        setConfig(c)
      }
    } catch { /* ignore — daemon may not be running */ }

    try {
      const cpuInfo = await api.getCPU()
      setCpu(cpuInfo)
      setSliderVal(cpuInfo.num_cpus)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const toggleDaemon = async () => {
    try {
      if (running) { await api.stop(); flash('XDP stopped') }
      else         { await api.start(); flash('XDP started') }
      await refresh()
    } catch (e: any) { flash('Error: ' + e.message) }
  }

  const saveFlags = async (flags: FwFlags) => {
    if (!config) return
    setSaving(true)
    try {
      await api.putConfig({ flags })
      setConfig({ ...config, flags })
      flash('Flags saved')
    } catch (e: any) { flash('Error: ' + e.message) }
    finally { setSaving(false) }
  }

  const savePorts = async (kind: 'tcp_ports' | 'udp_ports', ports: number[]) => {
    if (!config) return
    setSaving(true)
    try {
      await api.putConfig({ [kind]: ports })
      setConfig({ ...config, [kind]: ports })
      flash('Ports saved')
    } catch (e: any) { flash('Error: ' + e.message) }
    finally { setSaving(false) }
  }

  const saveProtos = async (protos: number[]) => {
    if (!config) return
    setSaving(true)
    try {
      await api.putConfig({ protos })
      setConfig({ ...config, protos })
      flash('Protocols saved')
    } catch (e: any) { flash('Error: ' + e.message) }
    finally { setSaving(false) }
  }

  const applyCPU = async (n: number) => {
    setCpuSaving(true)
    try {
      const result = await api.putCPU(n)
      setCpu(result)
      setSliderVal(result.num_cpus)
      flash(`CPU affinity set to ${result.num_cpus} core${result.num_cpus > 1 ? 's' : ''} (CPU 0–${result.num_cpus - 1})`)
    } catch (e: any) { flash('Error: ' + e.message) }
    finally { setCpuSaving(false) }
  }

  return (
    <div>
      <div style={s.header}>
        <h1 style={s.title}>Firewall Configuration</h1>
        <div style={s.headerRight}>
          <StatusBadge running={running} />
          <button
            style={{ ...s.startBtn, background: running ? '#FFEBEE' : '#E8F5E9', color: running ? '#C62828' : '#2E7D32', borderColor: running ? '#FFCDD2' : '#A5D6A7' }}
            onClick={toggleDaemon}
          >
            {running ? 'Stop XDP' : 'Start XDP'}
          </button>
        </div>
      </div>

      {msg && <div style={s.toast}>{msg}</div>}

      {!running && (
        <div style={s.notice}>XDP is not running. Start it to edit configuration.</div>
      )}

      {cpu && (
        <section style={s.card}>
          <h2 style={s.cardTitle}>CPU Affinity</h2>
          <p style={s.hint}>
            Pin daemon to CPUs 0–{sliderVal - 1} &nbsp;|&nbsp; System: {cpu.max_cpus} cores available
          </p>
          <div style={s.cpuRow}>
            <span style={s.cpuNum}>1</span>
            <input
              type="range"
              min={1}
              max={cpu.max_cpus}
              value={sliderVal}
              style={s.slider}
              onChange={e => setSliderVal(Number(e.target.value))}
            />
            <span style={s.cpuNum}>{cpu.max_cpus}</span>
            <div style={s.cpuBadge}>
              {sliderVal} / {cpu.max_cpus} CPU{sliderVal > 1 ? 's' : ''}
            </div>
            <button
              style={{
                ...s.applyBtn,
                opacity: cpuSaving || sliderVal === cpu.num_cpus ? 0.5 : 1,
                cursor:  cpuSaving || sliderVal === cpu.num_cpus ? 'default' : 'pointer',
              }}
              disabled={cpuSaving || sliderVal === cpu.num_cpus}
              onClick={() => applyCPU(sliderVal)}
            >
              {cpuSaving ? 'Applying…' : 'Apply'}
            </button>
          </div>
          <p style={s.cpuDesc}>
            Currently pinned to <strong>{cpu.num_cpus}</strong> CPU{cpu.num_cpus > 1 ? 's' : ''} (core 0–{cpu.num_cpus - 1}).
            Changes take effect immediately without restarting XDP.
          </p>
        </section>
      )}

      {config && (
        <>
          <section style={s.card}>
            <h2 style={s.cardTitle}>Feature Flags</h2>
            <div style={s.flagGrid}>
              {FLAG_LABELS.map(({ key, label, desc }) => (
                <label key={key} style={s.flagRow}>
                  <div style={s.flagText}>
                    <span style={s.flagLabel}>{label}</span>
                    <span style={s.flagDesc}>{desc}</span>
                  </div>
                  <div
                    style={{
                      ...s.toggle,
                      background: config.flags[key] ? '#F6A800' : '#C8C8C8',
                    }}
                    onClick={() => {
                      const newFlags = { ...config.flags, [key]: !config.flags[key] }
                      saveFlags(newFlags)
                    }}
                  >
                    <div style={{
                      ...s.toggleThumb,
                      transform: config.flags[key] ? 'translateX(20px)' : 'translateX(2px)',
                    }} />
                  </div>
                </label>
              ))}
            </div>
          </section>

          <section style={s.card}>
            <h2 style={s.cardTitle}>Blocked Ports</h2>
            <div style={s.twoCol}>
              <PortList
                label="TCP ports"
                ports={config.tcp_ports ?? []}
                onChange={p => savePorts('tcp_ports', p)}
                disabled={saving}
              />
              <PortList
                label="UDP ports"
                ports={config.udp_ports ?? []}
                onChange={p => savePorts('udp_ports', p)}
                disabled={saving}
              />
            </div>
          </section>

          <section style={s.card}>
            <h2 style={s.cardTitle}>Blocked IP Protocols</h2>
            <p style={s.hint}>Enter IP protocol numbers (e.g. 47=GRE, 50=ESP, 51=AH)</p>
            <PortList
              label="Protocol numbers"
              ports={(config.protos ?? []).map(Number)}
              onChange={p => saveProtos(p.map(Number))}
              disabled={saving}
            />
          </section>
        </>
      )}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  headerRight: { display: 'flex', alignItems: 'center', gap: 12 },
  title: { fontSize: 20, fontWeight: 600, color: '#1A1A1A' },
  startBtn: {
    padding: '6px 16px', border: '1px solid', borderRadius: 2,
    fontWeight: 500, cursor: 'pointer', fontSize: 13,
  },
  toast: {
    padding: '10px 16px', background: '#FFF8E1', borderRadius: 2,
    border: '1px solid #F6A800', color: '#7A5200', marginBottom: 16, fontSize: 13,
  },
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
  flagGrid: { display: 'flex', flexDirection: 'column', gap: 2 },
  flagRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 0', borderBottom: '1px solid #EEEEEE', cursor: 'pointer',
  },
  flagText: { display: 'flex', flexDirection: 'column', gap: 2 },
  flagLabel: { color: '#1A1A1A', fontSize: 13, fontWeight: 500 },
  flagDesc: { color: '#5A5A5A', fontSize: 12 },
  toggle: {
    width: 44, height: 24, borderRadius: 12, position: 'relative',
    cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0,
  },
  toggleThumb: {
    position: 'absolute', top: 2, width: 20, height: 20,
    borderRadius: '50%', background: '#fff', transition: 'transform 0.2s',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
  },
  twoCol: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 },
  hint: { color: '#5A5A5A', fontSize: 12, marginBottom: 10 },
  cpuRow: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 },
  slider: { flex: 1, accentColor: '#F6A800', height: 4, cursor: 'pointer' },
  cpuNum: { color: '#5A5A5A', fontSize: 12, minWidth: 16, textAlign: 'center' as const },
  cpuBadge: {
    padding: '3px 10px', background: '#FFF8E1', border: '1px solid #F6A800',
    borderRadius: 2, fontSize: 12, fontWeight: 600, color: '#7A5200', whiteSpace: 'nowrap' as const,
  },
  applyBtn: {
    padding: '5px 14px', background: '#F6A800', color: '#fff',
    border: 'none', borderRadius: 2, fontWeight: 600, fontSize: 12,
  },
  cpuDesc: { color: '#5A5A5A', fontSize: 12, margin: 0 },
}
