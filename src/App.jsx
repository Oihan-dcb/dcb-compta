// v2
import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import { supabase } from './lib/supabase'
import { AGENCE } from './lib/agence'
import { applyTheme } from './lib/theme'

applyTheme(AGENCE)

const AGENCE_LABELS = {
  dcb:     { icon: 'DCB',    text: 'Immo'   },
  lauian:  { icon: 'Lauian', text: 'Immo'   },
  bordeaux:{ icon: 'DBX',    text: 'Immo'   },
}
const agenceLabel = AGENCE_LABELS[AGENCE] || AGENCE_LABELS.dcb

const SIBLING_URLS = {
  dcb:     'https://lauian-compta.vercel.app',
  lauian:  'https://dcb-compta.vercel.app',
  bordeaux: null,
}
const siblingUrl = SIBLING_URLS[AGENCE] || null

const ALLOWED_EMAILS = (import.meta.env.VITE_ALLOWED_ADMIN_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)

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
import PageExports from './pages/PageExports'
import PageSmsReviews from './pages/PageSmsReviews'
import PageLocationsLongues from './pages/PageLocationsLongues'
import PageAchats from './pages/PageAchats'
import PageAgence from './pages/PageAgence'
import PageProprietaires from './pages/PageProprietaires'
import PageTaxeSejour from './pages/PageTaxeSejour'
import PageCloture from './pages/PageCloture'
import PageDemandesOwner from './pages/PageDemandesOwner'
import PageReglesVentilation from './pages/PageReglesVentilation'
import BugReportButton from './components/BugReportButton'
import './App.css'

// ── Écran de chargement ───────────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#F7F3EC' }}>
      <div style={{ fontSize: 13, color: '#8C7B65' }}>Chargement…</div>
    </div>
  )
}

// ── Écran de login OTP email ──────────────────────────────────────────────────
function LoginScreen() {
  const [email, setEmail]       = useState('')
  const [code, setCode]         = useState('')
  const [step, setStep]         = useState('email') // 'email' | 'code'
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [resendCooldown, setResendCooldown] = useState(0)

  const inp = { width: '100%', padding: '10px 12px', border: '1px solid #D9CEB8', borderRadius: 8, fontSize: 14, background: '#fff', outline: 'none', boxSizing: 'border-box' }

  async function handleSendOtp(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false },
    })
    if (err) {
      setError(err.message)
    } else {
      setStep('code')
      setResendCooldown(60)
      const t = setInterval(() => setResendCooldown(c => { if (c <= 1) { clearInterval(t); return 0 } return c - 1 }), 1000)
    }
    setLoading(false)
  }

  async function handleVerifyOtp(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error: err } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    })
    if (err) setError('Code invalide ou expiré')
    setLoading(false)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#F7F3EC' }}>
      <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 4px 24px rgba(0,0,0,.10)', padding: '40px 36px', width: 340, maxWidth: '90vw' }}>
        <div style={{ fontWeight: 800, fontSize: 18, color: '#2C2416', marginBottom: 4 }}>{agenceLabel.icon} Compta</div>
        <div style={{ fontSize: 13, color: '#8C7B65', marginBottom: 28 }}>Accès réservé aux équipes DCB</div>

        {step === 'email' && (
          <form onSubmit={handleSendOtp} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              type="email"
              placeholder="Votre email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
              style={inp}
            />
            {error && <div style={{ fontSize: 12, color: '#ef4444', background: '#fef2f2', padding: '8px 10px', borderRadius: 6 }}>{error}</div>}
            <button type="submit" disabled={loading}
              style={{ marginTop: 4, padding: '11px', background: '#CC9933', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Envoi…' : 'Recevoir le code'}
            </button>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={handleVerifyOtp} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 13, color: '#5C4A2A', background: '#FFF8E7', border: '1px solid #E4C97A', borderRadius: 8, padding: '10px 12px' }}>
              Code envoyé à <strong>{email}</strong>
            </div>
            <input
              type="text"
              inputMode="numeric"
              placeholder="Code à 6 chiffres"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
              autoFocus
              style={{ ...inp, fontSize: 22, letterSpacing: 6, textAlign: 'center', fontWeight: 700 }}
            />
            {error && <div style={{ fontSize: 12, color: '#ef4444', background: '#fef2f2', padding: '8px 10px', borderRadius: 6 }}>{error}</div>}
            <button type="submit" disabled={loading || code.length < 6}
              style={{ padding: '11px', background: '#CC9933', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: (loading || code.length < 6) ? 'not-allowed' : 'pointer', opacity: (loading || code.length < 6) ? 0.7 : 1 }}>
              {loading ? 'Vérification…' : 'Connexion'}
            </button>
            <button type="button"
              onClick={() => { setStep('email'); setCode(''); setError(null) }}
              style={{ padding: '8px', background: 'none', border: 'none', color: '#8C7B65', fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}>
              ← Changer d'email
            </button>
            {resendCooldown > 0
              ? <div style={{ fontSize: 12, color: '#A09282', textAlign: 'center' }}>Renvoyer dans {resendCooldown}s</div>
              : <button type="button" onClick={handleSendOtp}
                  style={{ padding: '6px', background: 'none', border: 'none', color: '#CC9933', fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}>
                  Renvoyer le code
                </button>
            }
          </form>
        )}
      </div>
    </div>
  )
}

// ── Écran accès non autorisé ──────────────────────────────────────────────────
function UnauthorizedScreen({ email, onLogout }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#F7F3EC' }}>
      <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 4px 24px rgba(0,0,0,.10)', padding: '40px 36px', width: 340, maxWidth: '90vw', textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🚫</div>
        <div style={{ fontWeight: 700, fontSize: 16, color: '#2C2416', marginBottom: 8 }}>Accès non autorisé</div>
        <div style={{ fontSize: 13, color: '#8C7B65', marginBottom: 24 }}>
          Le compte <strong>{email}</strong> n'est pas autorisé à accéder à cette application.
        </div>
        <button
          onClick={onLogout}
          style={{ padding: '9px 20px', background: '#D9CEB8', color: '#2C2416', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
          Se déconnecter
        </button>
      </div>
    </div>
  )
}

// ── Navigation ────────────────────────────────────────────────────────────────
function AgencyLogo() {
  const location = useLocation()
  if (!siblingUrl) return (
    <><span className="logo-icon">{agenceLabel.icon}</span><span className="logo-text">{agenceLabel.text}</span></>
  )
  return (
    <a href={siblingUrl + location.pathname} title="Basculer vers l'autre agence" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
      <span className="logo-icon">{agenceLabel.icon}</span>
      <span className="logo-text">{agenceLabel.text}</span>
    </a>
  )
}

function ConfigDropdown() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const location = useLocation()
  const configPaths = ['/import', '/journal', '/config', '/bugs', '/exports', '/agence', '/taxe-sejour', '/proprietaires', '/demandes-owner', '/cloture', '/sms-reviews', '/regles-ventilation']
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
        <div style={{ position: 'absolute', top: '110%', right: 0, zIndex: 200, background: '#EAE3D4', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', minWidth: 150, padding: '6px 0' }}
          onMouseLeave={() => setOpen(false)}>
          {[
            { to: '/agence', label: 'Agence' },
            { to: '/proprietaires', label: 'Propriétaires' },
            { to: '/demandes-owner', label: '🏠 Demandes Owner' },
            { to: '/taxe-sejour', label: 'Taxe de séjour' },
            { to: '/sms-reviews', label: 'Reviews' },
            { to: '/import', label: 'Import CSV' },
            { to: '/journal', label: 'Journal' },
            { to: '/bugs', label: '🐛 Bugs' },
            { to: '/config', label: 'Paramètres' },
            { to: '/regles-ventilation', label: '📐 Règles ventilation' },
            { to: '/cloture', label: '🔒 Clôture' },
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

// ── App principale ────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState(undefined) // undefined = en cours de vérification
  const [nbEnAttente, setNbEnAttente] = useState(0)
  const _now = new Date()
  const _lastDay = new Date(_now.getFullYear(), _now.getMonth() + 1, 0).getDate()
  const _sendDay = _lastDay - 2
  const _daysUntilSend = _sendDay - _now.getDate()
  const showNavetteBadge = _daysUntilSend >= 0 && _daysUntilSend <= 5
  const navetteBadgeColor = _daysUntilSend <= 1 ? '#ef4444' : _daysUntilSend === 2 ? '#f97316' : _daysUntilSend === 3 ? '#f59e0b' : '#22c55e'

  // Auth
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session ?? null))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Badge prestations (seulement si authentifié)
  useEffect(() => {
    if (!session) return
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
  }, [session])

  // États auth
  if (session === undefined) return <LoadingScreen />
  if (!session) return <LoginScreen />

  if (ALLOWED_EMAILS.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#F7F3EC' }}>
        <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 4px 24px rgba(0,0,0,.10)', padding: '40px 36px', width: 380, maxWidth: '90vw', textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#2C2416', marginBottom: 8 }}>Configuration sécurité manquante</div>
          <div style={{ fontSize: 13, color: '#8C7B65', marginBottom: 24 }}>La variable <code>VITE_ALLOWED_ADMIN_EMAILS</code> n'est pas définie. L'application ne peut pas démarrer.</div>
          <button onClick={() => supabase.auth.signOut()} style={{ padding: '9px 20px', background: '#D9CEB8', color: '#2C2416', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            Se déconnecter
          </button>
        </div>
      </div>
    )
  }

  const userEmail = session.user?.email?.toLowerCase() || ''
  if (!ALLOWED_EMAILS.includes(userEmail)) {
    return <UnauthorizedScreen email={session.user?.email} onLogout={() => supabase.auth.signOut()} />
  }

  return (
    <BrowserRouter>
      <div className="app">
        <header className="app-header">
          <div className="header-logo">
            <AgencyLogo />
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
            <NavLink to="/auto-entrepreneurs" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'} style={{ position: 'relative' }}>
              Staff
              {showNavetteBadge && (
                <span style={{ position: 'absolute', top: -6, right: -8, background: navetteBadgeColor, color: '#fff', borderRadius: 10, fontSize: 10, fontWeight: 700, padding: '1px 5px', minWidth: 16, textAlign: 'center' }}>
                  j-{_daysUntilSend}
                </span>
              )}
            </NavLink>
            <NavLink to="/factures" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>Facturation</NavLink>
            <NavLink to="/comptabilite" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>Comptabilité</NavLink>
            <NavLink to="/exports" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>Exports</NavLink>
            <NavLink to="/locations-longues" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>Loc-longues</NavLink>
            <NavLink to="/achats" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>Achats</NavLink>
            <ConfigDropdown />
            <button
              onClick={() => supabase.auth.signOut()}
              title={`Connecté : ${session.user?.email}`}
              style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', fontSize: 12, color: '#8C7B65', cursor: 'pointer', marginLeft: 4 }}>
              ⎋
            </button>
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
            <Route path="/exports" element={<PageExports />} />
            <Route path="/sms-reviews" element={<PageSmsReviews />} />
            <Route path="/locations-longues" element={<PageLocationsLongues />} />
            <Route path="/achats" element={<PageAchats />} />
            <Route path="/agence" element={<PageAgence />} />
            <Route path="/proprietaires" element={<PageProprietaires />} />
            <Route path="/demandes-owner" element={<PageDemandesOwner />} />
            <Route path="/taxe-sejour" element={<PageTaxeSejour />} />
            <Route path="/cloture" element={<PageCloture />} />
            <Route path="/regles-ventilation" element={<PageReglesVentilation />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
