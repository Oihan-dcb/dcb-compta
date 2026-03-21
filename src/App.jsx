// v2
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import PageBiens from './pages/PageBiens'
import PageReservations from './pages/PageReservations'
import PageBanque from './pages/PageBanque'
import PageMatching from './pages/PageMatching'
import PageRapprochement from './pages/PageRapprochement'
import PageFactures from './pages/PageFactures'
import PageConfig from './pages/PageConfig'
import PageAutoEntrepreneurs from './pages/PageAutoEntrepreneurs'
import PortailAEWrapper from './pages/PortailAEWrapper'
import PageImport from './pages/PageImport'
import './App.css'

export default function App() {
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
            <NavLink to="/config" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>Config</NavLink>
          </nav>
        </header>
        <main className="app-main">
          <Routes>
            <Route path="/" element={<PageBiens />} />
            <Route path="/reservations" element={<PageReservations />} />
            <Route path="/banque" element={<PageBanque />} />
            <Route path="/matching" element={<PageMatching />} />
            <Route path="/rapprochement" element={<PageRapprochement />} />
            <Route path="/factures" element={<PageFactures />} />
            <Route path="/import" element={<PageImport />} />
            <Route path="/portail-ae/:token" element={<PortailAEWrapper />} />
            <Route path="/auto-entrepreneurs" element={<PageAutoEntrepreneurs />} />
            <Route path="/config" element={<PageConfig />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
