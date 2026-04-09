import { useEffect, useRef, useState } from 'react'
import { createJobWebSocket } from '../api/client'
import type { WsMessage } from '../api/client'

interface Props {
  jobId: string
  onStateChange?: (status: string, pauseState: string | null) => void
  onDone?: (exitCode: number) => void
}

export function LogViewer({ jobId, onStateChange, onDone }: Props) {
  const [lines, setLines] = useState<string[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLines([])
    const ws = createJobWebSocket(jobId, (msg: WsMessage) => {
      if (msg.type === 'log') {
        setLines(prev => [...prev, msg.line])
      } else if (msg.type === 'state') {
        onStateChange?.(msg.status, msg.pause_state)
      } else if (msg.type === 'done') {
        onStateChange?.(msg.status, null)
        onDone?.(msg.exit_code)
      }
    })
    return () => ws.close()
  }, [jobId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  return (
    <pre style={{
      background: '#1A1A1A',
      color: '#00FF41',
      fontFamily: 'monospace',
      fontSize: 13,
      padding: 16,
      borderRadius: 6,
      height: 360,
      overflowY: 'auto',
      margin: 0,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-all',
    }}>
      {lines.map((l, i) => <div key={i}>{l}</div>)}
      <div ref={bottomRef} />
    </pre>
  )
}
