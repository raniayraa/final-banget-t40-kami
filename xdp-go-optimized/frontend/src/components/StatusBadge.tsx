interface StatusBadgeProps {
  running: boolean
}

export default function StatusBadge({ running }: StatusBadgeProps) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 10px', borderRadius: 20,
      background: running ? '#E8F5E9' : '#FFEBEE',
      color: running ? '#2E7D32' : '#C62828',
      fontSize: 13, fontWeight: 600,
      border: `1px solid ${running ? '#A5D6A7' : '#FFCDD2'}`,
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        background: running ? '#2E7D32' : '#C62828',
      }} />
      {running ? 'Running' : 'Stopped'}
    </span>
  )
}
