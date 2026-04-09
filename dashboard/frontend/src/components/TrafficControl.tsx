import { useState } from 'react'
import { api } from '../api/client'

interface Props {
  jobId: string
  pauseState: string | null
}

export function TrafficControl({ jobId, pauseState }: Props) {
  const [busy, setBusy] = useState(false)

  const sendSignal = async (signal: 'start_traffic' | 'stop_traffic') => {
    setBusy(true)
    try {
      await api.sendSignal(jobId, signal)
    } catch (e) {
      console.error(e)
    } finally {
      setBusy(false)
    }
  }

  if (!pauseState && pauseState !== 'paused_start' && pauseState !== 'paused_stop') {
    return null
  }

  return (
    <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
      <button
        onClick={() => sendSignal('start_traffic')}
        disabled={pauseState !== 'paused_start' || busy}
        style={btnStyle('#388E3C', pauseState !== 'paused_start' || busy)}
      >
        Start Traffic
      </button>
      <button
        onClick={() => sendSignal('stop_traffic')}
        disabled={pauseState !== 'paused_stop' || busy}
        style={btnStyle('#D32F2F', pauseState !== 'paused_stop' || busy)}
      >
        Stop Traffic
      </button>
    </div>
  )
}

function btnStyle(bg: string, disabled: boolean): React.CSSProperties {
  return {
    padding: '8px 20px',
    borderRadius: 6,
    border: 'none',
    background: disabled ? '#C8C8C8' : bg,
    color: disabled ? '#888' : '#fff',
    fontWeight: 700,
    fontSize: 14,
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'background 0.2s',
  }
}
