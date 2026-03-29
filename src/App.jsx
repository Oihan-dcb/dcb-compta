// v2
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import PageBiens from './pages/PageBiens'
import PageReservations from './pages/PageReservations'
import PageBanque from './pages/PageBanque'
import PageMatching from './pages/PageMatching'
import PageRapprochement from './pages/PageRapprochement'
import PageFactures from './pages/PageFactures'
import PageConfig from './pages/PageConfig'
import PageAutoEntrepreneurs from './pages/PageAutoEntrepreneurs'
import PagePrestationsAE from './pages/PagePrestationsAE'
import PageFraisProprietaire from './pages/PageFraisProprietaire'
import PageImport from './pages/PageImport'
import PageJournal from './pages/PageJournal'
import './App.css'

export default function App() {
  const [nbEnAttente, setNbEnAttente] = useState(0)

  useEffect(() => {
    const mois = new Date().toISOString().slice(0, 7)
    // Fonction de chargement du badge
    const chargerBadge = () => {
      supabase.from('prestation_hors_forfait').select('id', { count: 'exact' })
        .eq('statut', 'en_attente').eq('mois', mois)
        .then(({ count }) => setNbEnAttente(count || 0))
    }
    chargerBadge()
    // Realtime : badge se met à jour dès qu'une prestation est créée ou validée
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
            <NavLink to="/factures" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>Factures</NavLink>
            <NavLink to="/import" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>Import</NavLink>
            <NavLink to="/auto-entrepreneurs" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>AEs</NavLink>
            <NavLink to="/prestations-ae" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'} style={{ position: 'relative' }}>
              Prestations
              {nbEnAttente > 0 && (
                <span style={{ position: 'absolute', top: -6, right: -8, background: '#ef4444', color: '#fff', borderRadius: 10, fontSize: 10, fontWeight: 700, padding: '1px 5px', minWidth: 16, textAlign: 'center' }}>
                  {nbEnAttente}
                </span>
              )}
            </NavLink>
            <NavLink to="/frais-proprietaire" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>Frais</NavLink>
            <NavLink to="/journal" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>Journal</NavLink>
            <NavLink to="/config" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>Config</NavLink>
          </nav>
        </header>
        <main className="app-main">
          <Routes>
            <Route path="/" element={<PageBiens />} />
            <Route path="/biens" element={<PageBiens />} />
            <Route path="/reservations" element={<PageReservations />} />
            <Route path="/banque" element={<PageBanque />} />
            <Route path="/matching" element={<PageMatching />} />
            <Route path="/rapprochement" element={<PageRapprochement />} />
            <Route path="/factures" element={<PageFactures />} />
            <Route path="/import" element={<PageImport />} />
            <Route path="/auto-entrepreneurs" element={<PageAutoEntrepreneurs />} />
            <Route path="/prestations-ae" element={<PagePrestationsAE />} />
            <Route path="/frais-proprietaire" element={<PageFraisProprietaire />} />
            <Route path="/journal" element={<PageJournal />} />
            <Route path="/config" element={<PageConfig />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
