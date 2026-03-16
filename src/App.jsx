import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import PageBiens from './pages/PageBiens'
import PageReservations from './pages/PageReservations'
import PageBanque from './pages/PageBanque'
import PageMatching from './pages/PageMatching'
import PageRapprochement from './pages/PageRapprochement'
import PageFacturesAE from './pages/PageFacturesAE'
import PageFactures from './pages/PageFactures'
import PageConfig from './pages/PageConfig'
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
            <NavLink to="/matching" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>Rapprochement</NavLink>
            <NavLink to="/factures-ae" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>Factures Auto</NavLink>
            <NavLink to="/factures" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>Factures</NavLink>
            <NavLink to="/import" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>Import</NavLink>
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
            <Route path="/factures-ae" element={<PageFacturesAE />} />
            <Route path="/factures" element={<PageFactures />} />
            <Route path="/import" element={<PageImport />} />
            <Route path="/config" element={<PageConfig />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
