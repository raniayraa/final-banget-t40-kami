import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom'
import { Playbooks } from './pages/Playbooks'
import { PktEditor } from './pages/PktEditor'
import { PktgenConfig } from './pages/PktgenConfig'
import { Results } from './pages/Results'
import { Compare } from './pages/Compare'

const NAV_LINKS = [
  { to: '/',              label: 'Playbooks' },
  { to: '/pkt-editor',    label: 'PKT Editor' },
  { to: '/pktgen-config', label: 'Pktgen Config' },
  { to: '/results',       label: 'Results' },
  { to: '/compare',       label: 'Compare' },
]

function NavBar() {
  const { pathname } = useLocation()
  return (
    <nav style={{
      background: '#1A1A1A',
      padding: '0 32px',
      display: 'flex',
      alignItems: 'center',
      height: 56,
      gap: 8,
      boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
    }}>
      <span style={{ color: '#F6A800', fontWeight: 800, fontSize: 18, marginRight: 32, letterSpacing: 0.5 }}>
        Ansible Dashboard
      </span>
      {NAV_LINKS.map(({ to, label }) => {
        const active = pathname === to
        return (
          <Link
            key={to}
            to={to}
            style={{
              color: active ? '#F6A800' : '#C8C8C8',
              textDecoration: 'none',
              fontWeight: active ? 700 : 400,
              fontSize: 14,
              padding: '4px 12px',
              borderRadius: 6,
              background: active ? 'rgba(246,168,0,0.1)' : 'transparent',
            }}
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ minHeight: '100vh', background: '#F5F5F5', fontFamily: 'system-ui, sans-serif' }}>
        <NavBar />
        <main style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px' }}>
          <Routes>
            <Route path="/" element={<Playbooks />} />
            <Route path="/pkt-editor" element={<PktEditor />} />
            <Route path="/pktgen-config" element={<PktgenConfig />} />
            <Route path="/results" element={<Results />} />
            <Route path="/compare" element={<Compare />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
