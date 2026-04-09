import { useState } from 'react'

interface PortListProps {
  label: string
  ports: number[]
  onChange: (ports: number[]) => void
  disabled?: boolean
}

export default function PortList({ label, ports, onChange, disabled }: PortListProps) {
  const [input, setInput] = useState('')

  const add = () => {
    const n = parseInt(input, 10)
    if (!isNaN(n) && n > 0 && n <= 65535 && !ports.includes(n)) {
      onChange([...ports, n].sort((a, b) => a - b))
    }
    setInput('')
  }

  const remove = (p: number) => onChange(ports.filter(x => x !== p))

  return (
    <div style={s.wrap}>
      <div style={s.label}>{label}</div>
      <div style={s.tagWrap}>
        {ports.map(p => (
          <span key={p} style={s.tag}>
            {p}
            {!disabled && (
              <button style={s.tagDel} onClick={() => remove(p)}>×</button>
            )}
          </span>
        ))}
        {ports.length === 0 && <span style={s.empty}>none</span>}
      </div>
      {!disabled && (
        <div style={s.inputRow}>
          <input
            type="number"
            min={1} max={65535}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && add()}
            placeholder="port"
            style={s.input}
          />
          <button style={s.btn} onClick={add}>Add</button>
        </div>
      )}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  wrap: { marginBottom: 16 },
  label: { fontSize: 12, color: '#5A5A5A', marginBottom: 6, fontWeight: 500 },
  tagWrap: { display: 'flex', flexWrap: 'wrap', gap: 6, minHeight: 30 },
  tag: {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    background: '#D6E4F7', color: '#1C5EA8', padding: '3px 8px',
    borderRadius: 2, fontSize: 13, border: '1px solid #B8D0EE',
  },
  tagDel: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: '#1C5EA8', fontSize: 14, lineHeight: 1,
  },
  empty: { color: '#AAAAAA', fontSize: 13 },
  inputRow: { display: 'flex', gap: 6, marginTop: 8 },
  input: {
    width: 80, padding: '5px 8px', background: '#FFFFFF',
    border: '1px solid #C8C8C8', borderRadius: 2, color: '#1A1A1A', fontSize: 13,
  },
  btn: {
    padding: '5px 12px', background: '#F6A800', border: '1px solid #D99A00',
    borderRadius: 2, color: '#1A1A1A', cursor: 'pointer', fontSize: 13, fontWeight: 500,
  },
}
