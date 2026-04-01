import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom'
import FirewallConfig from './pages/FirewallConfig'
import Monitoring from './pages/Monitoring'
import RoutesPage from './pages/Routes'

const nav: { to: string; label: string }[] = [
  { to: '/',           label: 'Firewall' },
  { to: '/monitoring', label: 'Monitoring' },
  { to: '/routes',     label: 'Routes' },
]

export default function App() {
  return (
    <BrowserRouter>
      <nav style={styles.nav}>
        <span style={styles.brand}>XDP Dashboard</span>
        <div style={styles.links}>
          {nav.map(n => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              style={({ isActive }) => ({ ...styles.link, ...(isActive ? styles.active : {}) })}
            >
              {n.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <main style={styles.main}>
        <Routes>
          <Route path="/"           element={<FirewallConfig />} />
          <Route path="/monitoring" element={<Monitoring />} />
          <Route path="/routes"     element={<RoutesPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  )
}

const styles: Record<string, React.CSSProperties> = {
  nav: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 24px', height: 42,
    background: '#1E1E1E', borderBottom: '2px solid #111',
    boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
  },
  brand: { fontWeight: 600, fontSize: 14, color: '#FFFFFF', letterSpacing: '0.08em', textTransform: 'uppercase' as const },
  links: { display: 'flex', gap: 0, alignItems: 'stretch', height: 42 },
  link: {
    display: 'flex', alignItems: 'center',
    padding: '0 16px', textDecoration: 'none',
    color: '#C8C8C8', fontSize: 11.5, fontWeight: 500,
    letterSpacing: '0.06em', textTransform: 'uppercase' as const,
    borderBottom: '2px solid transparent',
  },
  active: { color: '#F6A800', borderBottom: '2px solid #F6A800' },
  main: { padding: 24, maxWidth: 1200, margin: '0 auto' },
}
