// v2
import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import { supabase } from './lib/supabase'
import PageBiens from './pages/PageBiens'
import PageReservations from './pages/PageReservations'
import PageBanque from './pages/PageBanque'
import PageRapprochement from './pages/PageRapprochement'
import PageFactures from './pages/PageFactures'
import PageConfig from './pages/PageConfig'
import PageAutoEntrepreneurs from './pages/PageAutoEntrepreneurs'
import PagePrestationsAE from './pages/PagePrestationsAE'
import PageFraisProprietaire from './pages/PageFraisProprietaire'
import PageImport from './pages/PageImport'
import PageJournal from './pages/PageJournal'
import PageRapports from './pages/PageRapports'
import PageComptabilite from './pages/PageComptabilite'
import PageBugReports from './pages/PageBugReports'
import BugReportButton from './components/BugReportButton'
import './App.css'

function ConfigDropdown() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const location = useLocation()
  const configPaths = ['/import', '/journal', '/auto-entrepreneurs', '/config', '/bugs']
  const isActive = configPaths.some(p => location.pathname === p)

  useEffect(() => {
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className={isActive ? 'nav-link active' : 'nav-link'}
        style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
        Config <span style={{ fontSize: 9, opacity: 0.6 }}>▼</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '110%', right: 0, zIndex: 200, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.15)', minWidth: 150, padding: '6px 0' }}
          onMouseLeave={() => setOpen(false)}>
          {[
            { to: '/import', label: 'Import CSV' },
            { to: '/journal', label: 'Journal' },
            { to: '/auto-entrepreneurs', label: 'AEs' },
            { to: '/bugs', label: '🐛 Bugs' },
            { to: '/config', label: 'Paramètres' },
          ].map(({ to, label }) => (
            <NavLink key={to} to={to} onClick={() => setOpen(false)}
              className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}
              style={{ display: 'block', padding: '7px 16px', borderRadius: 0 }}>
              {label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

export default function App() {
  const [nbEnAttente, setNbEnAttente] = useState(0)

  useEffect(() => {
    const mois = new Date().toISOString().slice(0, 7)
    const chargerBadge = () => {
      supabase.from('prestation_hors_forfait').select('id', { count: 'exact' })
        .eq('statut', 'en_attente').eq('mois', mois)
        .then(({ count }) => setNbEnAttente(count || 0))
    }
    chargerBadge()
    const channel = supabase.channel('badge-prestations')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prestation_hors_forfait' },
        () => chargerBadge()
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  return (
    <BrowserRouter>
      <div className="app">
        <header className="app-header">
          <div className="header-logo">
            <span className="logo-icon">DCB</span>
            <span className="logo-text">Compta</span>
          </div>
          <nav className="app-nav">
            <NavLink to="/" end className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>Biens</NavLink>
            <NavLink to="/reservations" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>Réservations</NavLink>
            <NavLink to="/banque" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>Banque</NavLink>
            <NavLink to="/rapprochement" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>Rapprochement</NavLink>
            <NavLink to="/frais-proprietaire" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>Frais</NavLink>
            <NavLink to="/prestations-ae" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'} style={{ position: 'relative' }}>
              Prestations
              {nbEnAttente > 0 && (
                <span style={{ position: 'absolute', top: -6, right: -8, background: '#ef4444', color: '#fff', borderRadius: 10, fontSize: 10, fontWeight: 700, padding: '1px 5px', minWidth: 16, textAlign: 'center' }}>
                  {nbEnAttente}
                </span>
              )}
            </NavLink>
            <NavLink to="/rapports" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>Rapports</NavLink>
            <NavLink to="/factures" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>Facturation</NavLink>
            <NavLink to="/comptabilite" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>Comptabilité</NavLink>
            <ConfigDropdown />
          </nav>
        </header>
        <BugReportButton source="compta" />
        <main className="app-main">
          <Routes>
            <Route path="/" element={<PageBiens />} />
            <Route path="/biens" element={<PageBiens />} />
            <Route path="/reservations" element={<PageReservations />} />
            <Route path="/banque" element={<PageBanque />} />
            <Route path="/rapprochement" element={<PageRapprochement />} />
            <Route path="/frais-proprietaire" element={<PageFraisProprietaire />} />
            <Route path="/prestations-ae" element={<PagePrestationsAE />} />
            <Route path="/factures" element={<PageFactures />} />
            <Route path="/comptabilite" element={<PageComptabilite />} />
            <Route path="/rapports" element={<PageRapports />} />
            <Route path="/import" element={<PageImport />} />
            <Route path="/auto-entrepreneurs" element={<PageAutoEntrepreneurs />} />
            <Route path="/journal" element={<PageJournal />} />
            <Route path="/bugs" element={<PageBugReports />} />
            <Route path="/config" element={<PageConfig />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
