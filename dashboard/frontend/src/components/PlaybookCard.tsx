import type { PlaybookInfo } from '../api/client'
import { StatusBadge } from './StatusBadge'

type CardStatus = 'idle' | 'running' | 'paused' | 'done' | 'error' | 'aborted'

interface Props {
  playbook: PlaybookInfo
  status: CardStatus
  onRun: () => void
  onAbort: () => void
}

export function PlaybookCard({ playbook, status, onRun, onAbort }: Props) {
  const isRunning = status === 'running' || status === 'paused'

  return (
    <div style={{
      background: '#fff',
      border: '1px solid #C8C8C8',
      borderRadius: 8,
      padding: '14px 18px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: '#222' }}>
          {playbook.id} — {playbook.filename}
        </div>
        <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>
          {playbook.description}
        </div>
      </div>
      <StatusBadge status={status} />
      {isRunning ? (
        <button onClick={onAbort} style={btnStyle('#D32F2F')}>Abort</button>
      ) : (
        <button onClick={onRun} style={btnStyle('#1976D2')}>Run</button>
      )}
    </div>
  )
}

function btnStyle(bg: string): React.CSSProperties {
  return {
    padding: '6px 18px',
    borderRadius: 6,
    border: 'none',
    background: bg,
    color: '#fff',
    fontWeight: 700,
    fontSize: 13,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  }
}
