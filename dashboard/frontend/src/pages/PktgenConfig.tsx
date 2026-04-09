import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { PktFileInfo } from '../api/client'

export function PktgenConfig() {
  const [nodes, setNodes] = useState<Record<string, string>>({})
  const [pktFiles, setPktFiles] = useState<PktFileInfo[]>([])
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([api.getPktgenConfig(), api.listPktFiles()])
      .then(([cfg, files]) => {
        setNodes(cfg.nodes)
        setPktFiles(files)
      })
      .catch(console.error)
  }, [])

  const setNode = (ip: string, path: string) => {
    setNodes(prev => ({ ...prev, [ip]: path }))
  }

  const save = async () => {
    setSaving(true)
    try {
      await api.savePktgenConfig(nodes)
      setToast('Saved!')
    } catch {
      setToast('Error saving')
    } finally {
      setSaving(false)
    }
    setTimeout(() => setToast(null), 2000)
  }

  const DEPLOY_DIR = '/home/ansible'

  return (
    <div>
      <h2 style={{ color: '#222', marginBottom: 8 }}>Pktgen Config</h2>
      <p style={{ color: '#666', fontSize: 14, marginBottom: 24 }}>
        Select which <code>.pkt</code> file each sender node uses when pktgen is launched (playbook 04).
        Changes take effect next time playbook 04 is run.
      </p>

      <div style={{
        background: '#fff',
        border: '1px solid #C8C8C8',
        borderRadius: 8,
        padding: 24,
        maxWidth: 640,
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #E0E0E0' }}>
              <th style={{ textAlign: 'left', padding: '8px 0', color: '#555', fontWeight: 600 }}>Node IP</th>
              <th style={{ textAlign: 'left', padding: '8px 0', color: '#555', fontWeight: 600 }}>PKT File (deployed path)</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(nodes).map(([ip, path]) => (
              <tr key={ip} style={{ borderBottom: '1px solid #F0F0F0' }}>
                <td style={{ padding: '12px 0', fontFamily: 'monospace', color: '#222' }}>{ip}</td>
                <td style={{ padding: '12px 0' }}>
                  <select
                    value={path}
                    onChange={e => setNode(ip, e.target.value)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 6,
                      border: '1px solid #C8C8C8',
                      fontFamily: 'monospace',
                      fontSize: 13,
                      width: '100%',
                    }}
                  >
                    {pktFiles.map(f => (
                      <option key={f.name} value={`${DEPLOY_DIR}/${f.name}`}>
                        {f.name} → {DEPLOY_DIR}/{f.name}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={save}
            disabled={saving}
            style={{
              padding: '8px 22px',
              borderRadius: 6,
              border: 'none',
              background: saving ? '#C8C8C8' : '#1976D2',
              color: saving ? '#888' : '#fff',
              fontWeight: 700,
              fontSize: 14,
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving…' : 'Save Config'}
          </button>
          {toast && (
            <span style={{ fontSize: 14, color: toast === 'Saved!' ? '#388E3C' : '#D32F2F' }}>
              {toast}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
