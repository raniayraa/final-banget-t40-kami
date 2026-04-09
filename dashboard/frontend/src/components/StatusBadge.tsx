type Status = 'idle' | 'running' | 'paused' | 'done' | 'error' | 'aborted'

const COLORS: Record<Status, { bg: string; text: string }> = {
  idle:    { bg: '#E0E0E0', text: '#555' },
  running: { bg: '#1976D2', text: '#fff' },
  paused:  { bg: '#F6A800', text: '#fff' },
  done:    { bg: '#388E3C', text: '#fff' },
  error:   { bg: '#D32F2F', text: '#fff' },
  aborted: { bg: '#757575', text: '#fff' },
}

export function StatusBadge({ status }: { status: Status }) {
  const c = COLORS[status] ?? COLORS.idle
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: 12,
      fontSize: 12,
      fontWeight: 700,
      letterSpacing: 0.5,
      background: c.bg,
      color: c.text,
      textTransform: 'uppercase',
    }}>
      {status}
    </span>
  )
}
