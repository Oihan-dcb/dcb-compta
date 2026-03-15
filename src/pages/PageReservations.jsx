import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { syncReservations, getReservationsMois } from '../services/syncReservations'
import { calculerVentilationMois, getRecapVentilation } from '../services/ventilation'
import { setToken, formatMontant } from '../lib/hospitable'
import ModalResa from '../components/ModalResa'
import TableReservations from '../components/TableReservations'
import TableVentilation from '../components/TableVentilation'

const HOSP_TOKEN = import.meta.env.VITE_HOSPITABLE_TOKEN
const moisCourant = new Date().toISOString().substring(0, 7)
const MOIS_FR = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc']

function MoisSelector({ mois, setMois, moisDispos }) {
  const [open, setOpen] = useState(false)
  const parAnnee = {}
  for (const m of moisDispos) {
    const [y] = m.split('-')
    if (!parAnnee[y]) parAnnee[y] = []
    parAnnee[y].push(m)
  }
  const annees = Object.keys(parAnnee).sort((a, b) => b - a)
  const [anneeActive, setAnneeActive] = useState(() => mois.split('-')[0])
  const [year, monthIdx] = mois.split('-')

  return (
    <div style={{ position: 'relative' }}>
      <button className="btn btn-secondary" onClick={() => setOpen(o => !o)}
        style={{ minWidth: 120, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>📅</span>
        <span style={{ fontWeight: 600 }}>{MOIS_FR[parseInt(monthIdx) - 1]} {year}</span>
        <span style={{ fontSize: 10, opacity: 0.6 }}>▼</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '110%', left: 0, zIndex: 100, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.15)', minWidth: 280, padding: 12 }}
          onMouseLeave={() => setOpen(false)}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            {annees.map(y => (
              <button key={y} onClick={() => setAnneeActive(y)}
                style={{ padding: '3px 10px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: '0.85em', fontWeight: 600, background: anneeActive === y ? 'var(--brand)' : 'var(--border)', color: anneeActive === y ? '#fff' : 'var(--text)' }}>
                {y}
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5 }}>
            {(parAnnee[anneeActive] || []).map(m => {
              const mi = parseInt(m.split('-')[1]) - 1
              const isActive = m === mois
              return (
                <button key={m} onClick={() => { setMois(m); setOpen(false) }}
                  style={{ padding: '6px 4px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: '0.85em', fontWeight: isActive ? 700 : 400, background: isActive ? 'var(--brand)' : 'var(--bg)', color: isActive ? '#fff' : 'var(--text)', textAlign: 'center' }}>
                  {MOIS_FR[mi]}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default function PageReservations() {
  const [mois, setMois] = useState(moisCourant)
  const [moisDispos, setMoisDispos] = useState([])
  const [reservations, setReservations] = useState([])
  const [recap, setRecap] = useState([])
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [calculant, setCalculant] = useState(false)
  const [syncResult, setSyncResult] = useState(null)
  const [error, setError] = useState(null)
  const [onglet, setOnglet] = useState('reservations')
  const [selectedResa, setSelectedResa] = useState(null)

  useEffect(() => { if (HOSP_TOKEN) setToken(HOSP_TOKEN); charger() }, [mois])
  useEffect(() => { chargerMoisDispos() }, [])

  async function chargerMoisDispos() {
    try {
      const PAGE = 1000
      let all = [], page = 0
      while (true) {
        const { data } = await supabase.from('reservation').select('mois_comptable').not('mois_comptable', 'is', null).range(page * PAGE, (page + 1) * PAGE - 1)
        if (!data || data.length === 0) break
        all = all.concat(data)
        if (data.length < PAGE) break
        page++
      }
      setMoisDispos([...new Set(all.map(r => r.mois_comptable))].sort((a, b) => b.localeCompare(a)))
    } catch (e) { console.error('chargerMoisDispos:', e) }
  }

  async function charger() {
    setLoading(true); setError(null)
    try {
      const [resas, recapData] = await Promise.all([getReservationsMois(mois), getRecapVentilation(mois)])
      setReservations(resas); setRecap(recapData)
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  async function lancerSync() {
    setSyncing(true); setSyncResult(null); setError(null)
    try { const result = await syncReservations(mois); setSyncResult(result); await charger() }
    catch (err) { setError(err.message) }
    finally { setSyncing(false) }
  }

  async function lancerVentilation() {
    setCalculant(true); setError(null)
    try { await calculerVentilationMois(mois); await charger() }
    catch (err) { setError(err.message) }
    finally { setCalculant(false) }
  }

  const nbVentilees = reservations.filter(r => r.ventilation_calculee).length
  const nbRapprochees = reservations.filter(r => r.rapprochee).length
  const nbManuellesNonVentilees = reservations.filter(r => r.platform === 'manual' && (!r.ventilation || r.ventilation.length === 0)).length
  const totalRevenue = reservations.filter(r => !r.owner_stay).reduce((s, r) => s + (r.fin_revenue || 0), 0)
  // Richesse générée = total TTC ventilation (HON+FMEN+AUTO+VIR) si ventilé, sinon fin_revenue
  const totalVentilCalc = (() => {
    const codes = ['HON','FMEN','AUTO','VIR']
    let sum = 0
    for (const r of reservations) {
      if (r.owner_stay) continue
      for (const v of (r.ventilation || [])) {
        if (codes.includes(v.code)) sum += v.montant_ttc
      }
    }
    return sum
  })()
  const richesseGeneree = totalVentilCalc > 0 ? totalVentilCalc : totalRevenue
  // Total TTC ventilation = HON+FMEN+AUTO+VIR (sans LOY ni TAXE) — utilisé pour cohérence avec le tableau
    return (
    <div>
      {selectedResa && (
        <ModalResa
          resa={selectedResa}
          onClose={() => setSelectedResa(null)}
          onSaved={(reventile) => {
            setSelectedResa(null)
            charger()
            if (reventile) setTimeout(lancerVentilation, 300)
          }}
        />
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title">Réservations</h1>
          <p className="page-subtitle">{reservations.length} réservations · {formatMontant(revAffiche)} encaissé</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <MoisSelector mois={mois} setMois={setMois} moisDispos={moisDispos} />
          <button className="btn btn-secondary" onClick={charger} disabled={loading}>↺</button>
          <button className="btn btn-secondary" onClick={lancerSync} disabled={syncing}>
            {syncing ? <><span className="spinner" /> Sync…</> : '⟳ Sync Hospitable'}
          </button>
          <button className="btn btn-primary" onClick={lancerVentilation} disabled={calculant || reservations.length === 0}>
            {calculant ? <><span className="spinner" /> Calcul…</> : '⚡ Ventiler'}
          </button>
        </div>
      </div>

      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-label">Réservations</div>
          <div className="stat-value">{reservations.length}</div>
          <div className="stat-sub">{nbDirectes} directes/manuelles</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Revenue total</div>
          <div className="stat-value" style={{ fontSize: 20 }}>{formatMontant(revAffiche)}</div>
          <div className="stat-sub">net reçu en banque</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Ventilées</div>
          <div className="stat-value" style={{ color: nbVentilees === reservations.length && reservations.length > 0 ? 'var(--success)' : 'var(--warning)' }}>
            {nbVentilees}/{reservations.length}
          </div>
          <div className="stat-sub">calcul effectué</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Rapprochées</div>
          <div className="stat-value">{nbRapprochees}/{reservations.length}</div>
          <div className="stat-sub">virement identifié</div>
        </div>
        {nbManuellesNonVentilees > 0 && (
          <div className="stat-card" style={{ borderLeft: '3px solid #f59e0b', background: '#fffbeb', cursor: 'pointer' }}
            onClick={() => {
              setOnglet('reservations')
              const premiere = reservations.find(r => r.platform === 'manual' && (!r.ventilation || r.ventilation.length === 0))
              if (premiere) setSelectedResa(premiere)
            }}
            title="Cliquer pour saisir la ventilation">
            <div className="stat-label" style={{ color: '#92400e' }}>⚠ MANUELLES</div>
            <div className="stat-value" style={{ color: '#d97706' }}>{nbManuellesNonVentilees}</div>
            <div className="stat-sub" style={{ color: '#b45309' }}>à saisir manuellement →</div>
          </div>
        )}
      </div>

      {syncResult && (
        <div className="alert alert-success">
          ✓ Sync {mois} — {syncResult.created} créées, {syncResult.updated} mises à jour
          {syncResult.errors > 0 && ` — ⚠ ${syncResult.errors} erreurs`}
        </div>
      )}
      {error && <div className="alert alert-error">✕ {error}</div>}

      <div className="toolbar">
        <button className={`btn ${onglet === 'reservations' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setOnglet('reservations')}>
          Réservations ({reservations.length})
        </button>
        <button className={`btn ${onglet === 'ventilation' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setOnglet('ventilation')}>
          Ventilation ({recap?.parCode?.length || recap?.length || 0} codes)
        </button>
      </div>

      {loading ? (
        <div className="loading-state"><span className="spinner" /> Chargement…</div>
      ) : onglet === 'reservations' ? (
        <TableReservations reservations={reservations} onSelect={setSelectedResa} onRefresh={charger} />
      ) : (
        <TableVentilation recap={recap?.parCode || recap || []} parProprio={recap?.parProprio || []} reservations={reservations} />
      )}
    </div>
  )
}
