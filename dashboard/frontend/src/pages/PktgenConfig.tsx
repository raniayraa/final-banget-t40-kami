import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { NodeEntry, PktFileInfo } from '../api/client'

function ToggleSwitch({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  return (
    <div
      onClick={onChange}
      title={enabled ? 'Click to disable' : 'Click to enable'}
      style={{
        width: 44,
        height: 24,
        borderRadius: 12,
        background: enabled ? '#4CAF50' : '#C8C8C8',
        cursor: 'pointer',
        position: 'relative',
        flexShrink: 0,
        transition: 'background 0.15s',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 3,
          left: enabled ? 23 : 3,
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
          transition: 'left 0.15s',
        }}
      />
    </div>
  )
}

export function PktgenConfig() {
  const [entries, setEntries] = useState<NodeEntry[]>([])
  const [localPktFiles, setLocalPktFiles] = useState<Record<string, string>>({})
  const [pktFiles, setPktFiles] = useState<PktFileInfo[]>([])
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([api.getNodeRegistry(), api.listPktFiles()])
      .then(([reg, files]) => {
        setEntries(reg.nodes)
        setPktFiles(files)
      })
      .catch(console.error)
  }, [])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2000)
  }

  const handleToggle = async (ip: string) => {
    const node = entries.find(n => n.ip === ip)
    if (!node) return
    try {
      const updated = await api.updateNode(ip, { enabled: !node.enabled })
      setEntries(updated.nodes)
    } catch {
      showToast('Error updating node')
    }
  }

  const handlePktFileChange = (ip: string, path: string) => {
    setLocalPktFiles(prev => ({ ...prev, [ip]: path }))
  }

  const save = async () => {
    setSaving(true)
    try {
      let latest = entries
      for (const [ip, pkt_file] of Object.entries(localPktFiles)) {
        const current = entries.find(n => n.ip === ip)
        if (!current || current.pkt_file === pkt_file) continue
        const updated = await api.updateNode(ip, { pkt_file })
        latest = updated.nodes
      }
      setEntries(latest)
      setLocalPktFiles({})
      showToast('Saved!')
    } catch {
      showToast('Error saving')
    } finally {
      setSaving(false)
    }
  }

  const DEPLOY_DIR = '/home/telmat'

  const activeNodes = entries.filter(n => n.enabled)
  const activeLabel =
    activeNodes.length === 0
      ? 'None'
      : activeNodes.map(n => n.label).join(', ')

  const getPktFile = (node: NodeEntry) =>
    localPktFiles[node.ip] ?? node.pkt_file

  return (
    <div>
      <h2 style={{ color: '#222', marginBottom: 8 }}>Pktgen Config</h2>
      <p style={{ color: '#666', fontSize: 14, marginBottom: 24 }}>
        Enable or disable sender nodes and select which <code>.pkt</code> file each uses when
        playbook 04 is run. Toggle changes take effect immediately.
      </p>

      <div
        style={{
          background: '#fff',
          border: '1px solid #C8C8C8',
          borderRadius: 8,
          padding: 24,
          maxWidth: 680,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {entries.map((node, i) => (
            <div
              key={node.ip}
              style={{
                borderBottom: i < entries.length - 1 ? '1px solid #F0F0F0' : 'none',
                padding: '16px 0',
                opacity: node.enabled ? 1 : 0.55,
              }}
            >
              {/* Row 1: toggle + label + IP */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                <ToggleSwitch enabled={node.enabled} onChange={() => handleToggle(node.ip)} />
                <span style={{ fontWeight: 700, fontSize: 15, color: '#222' }}>{node.label}</span>
                <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#666' }}>
                  {node.ip}
                </span>
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: 12,
                    fontWeight: 600,
                    color: node.enabled ? '#388E3C' : '#888',
                    background: node.enabled ? '#E8F5E9' : '#F5F5F5',
                    borderRadius: 4,
                    padding: '2px 8px',
                  }}
                >
                  {node.enabled ? 'Active' : 'Inactive'}
                </span>
              </div>

              {/* Row 2: PKT file selector */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 56 }}>
                <span style={{ fontSize: 13, color: '#555', flexShrink: 0 }}>PKT file:</span>
                <select
                  value={getPktFile(node)}
                  disabled={!node.enabled}
                  onChange={e => handlePktFileChange(node.ip, e.target.value)}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 6,
                    border: '1px solid #C8C8C8',
                    fontFamily: 'monospace',
                    fontSize: 13,
                    flex: 1,
                    background: node.enabled ? '#fff' : '#F5F5F5',
                    cursor: node.enabled ? 'pointer' : 'not-allowed',
                  }}
                >
                  {pktFiles.map(f => (
                    <option key={f.name} value={`${DEPLOY_DIR}/${f.name}`}>
                      {f.name} → {DEPLOY_DIR}/{f.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>

        {/* Active summary + Save button */}
        <div
          style={{
            marginTop: 20,
            paddingTop: 16,
            borderTop: '1px solid #E0E0E0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <span style={{ fontSize: 14, color: '#555' }}>
            <strong>Active senders:</strong>{' '}
            <span style={{ color: activeNodes.length > 0 ? '#1976D2' : '#D32F2F' }}>
              {activeLabel}
            </span>
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {toast && (
              <span style={{ fontSize: 14, color: toast === 'Saved!' ? '#388E3C' : '#D32F2F' }}>
                {toast}
              </span>
            )}
            <button
              onClick={save}
              disabled={saving || Object.keys(localPktFiles).length === 0}
              style={{
                padding: '8px 22px',
                borderRadius: 6,
                border: 'none',
                background:
                  saving || Object.keys(localPktFiles).length === 0 ? '#C8C8C8' : '#1976D2',
                color:
                  saving || Object.keys(localPktFiles).length === 0 ? '#888' : '#fff',
                fontWeight: 700,
                fontSize: 14,
                cursor:
                  saving || Object.keys(localPktFiles).length === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              {saving ? 'Saving…' : 'Save PKT Files'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
