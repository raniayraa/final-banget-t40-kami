import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { PktFileInfo } from '../api/client'

interface FileState {
  content: string
  saved: string
  saving: boolean
  toast: string | null
}

export function PktEditor() {
  const [files, setFiles] = useState<PktFileInfo[]>([])
  const [states, setStates] = useState<Record<string, FileState>>({})

  useEffect(() => {
    api.listPktFiles().then(async (list) => {
      setFiles(list)
      const loaded: Record<string, FileState> = {}
      for (const f of list) {
        const { content } = await api.getPktFile(f.name)
        loaded[f.name] = { content, saved: content, saving: false, toast: null }
      }
      setStates(loaded)
    }).catch(console.error)
  }, [])

  const setContent = (name: string, content: string) => {
    setStates(prev => ({ ...prev, [name]: { ...prev[name], content } }))
  }

  const save = async (name: string) => {
    const s = states[name]
    if (!s) return
    setStates(prev => ({ ...prev, [name]: { ...prev[name], saving: true } }))
    try {
      await api.savePktFile(name, s.content)
      setStates(prev => ({
        ...prev,
        [name]: { ...prev[name], saving: false, saved: s.content, toast: 'Saved!' },
      }))
    } catch {
      setStates(prev => ({
        ...prev,
        [name]: { ...prev[name], saving: false, toast: 'Error saving' },
      }))
    }
    setTimeout(() => {
      setStates(prev => ({ ...prev, [name]: { ...prev[name], toast: null } }))
    }, 2000)
  }

  return (
    <div>
      <h2 style={{ color: '#222', marginBottom: 20 }}>PKT File Editor</h2>
      <p style={{ color: '#666', fontSize: 14, marginTop: -12, marginBottom: 24 }}>
        Edit pktgen configuration scripts. Changes take effect next time playbook 03 is run.
      </p>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {files.map(f => {
          const s = states[f.name]
          if (!s) return null
          const isDirty = s.content !== s.saved
          return (
            <div key={f.name} style={{
              flex: '1 1 400px',
              background: '#fff',
              border: '1px solid #C8C8C8',
              borderRadius: 8,
              padding: 20,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: '#222' }}>{f.name}</div>
                  <div style={{ fontSize: 12, color: '#999' }}>
                    Last modified: {new Date(f.last_modified * 1000).toLocaleString()}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {s.toast && (
                    <span style={{ fontSize: 13, color: s.toast === 'Saved!' ? '#388E3C' : '#D32F2F' }}>
                      {s.toast}
                    </span>
                  )}
                  <button
                    onClick={() => save(f.name)}
                    disabled={s.saving || !isDirty}
                    style={{
                      padding: '6px 18px',
                      borderRadius: 6,
                      border: 'none',
                      background: isDirty && !s.saving ? '#1976D2' : '#C8C8C8',
                      color: isDirty && !s.saving ? '#fff' : '#888',
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: isDirty && !s.saving ? 'pointer' : 'not-allowed',
                    }}
                  >
                    {s.saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
              <textarea
                value={s.content}
                onChange={e => setContent(f.name, e.target.value)}
                spellCheck={false}
                style={{
                  width: '100%',
                  minHeight: 220,
                  fontFamily: 'monospace',
                  fontSize: 13,
                  padding: 12,
                  border: `1px solid ${isDirty ? '#F6A800' : '#C8C8C8'}`,
                  borderRadius: 6,
                  resize: 'vertical',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
