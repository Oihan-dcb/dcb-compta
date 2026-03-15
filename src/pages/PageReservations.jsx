import { useState, useEffect } from 'react'
import MoisSelector from '../components/MoisSelector'
import { supabase } from '../lib/supabase'
import { syncReservations, getReservationsMois } from '../services/syncReservations'
import { calculerVentilationMois, getRecapVentilation } from '../services/ventilation'
import { setToken, formatMontant } from '../lib/hospitable'
import ModalResa from '../components/ModalResa'
import TableReservations from '../components/TableReservations'
import TableVentilation from '../components/TableVentilation'

const HOSP_TOKEN = import.meta.env.VITE_HOSPITABLE_TOKEN
const moisCourant = new Date().toISOString().substring(0, 7)
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
  const nbDirectes = reservations.filter(r => r.platform === 'direct' || r.platform === 'manual').length
  const nbRapprochees = reservations.filter(r => r.rapprochee).length
  const nbManuellesNonVentilees = reservations.filter(r => r.platform === 'manual' && (!r.ventilation || r.ventilation.length === 0)).length
  const totalRevenue = reservations.filter(r => !r.owner_stay).reduce((s, r) => s + (r.fin_revenue || 0), 0)
  // Richesse générée = total TTC ventilation (HON+FMEN+AUTO+VIR) si ventilé, sinon fin_revenue
  const richesseGeneree = (() => {
    const codes = ['HON','FMEN','AUTO','VIR']
    // Inclure toutes les resas : HON+FMEN+AUTO+VIR pour les normales, FMEN pour les séjours proprio
    const sum = reservations.reduce((s, r) => {
      const codesR = r.owner_stay ? ['FMEN'] : codes
      return s + (r.ventilation || []).filter(v => codesR.includes(v.code)).reduce((a, v) => a + v.montant_ttc, 0)
    }, 0)
    return sum > 0 ? sum : totalRevenue
  })()
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
          <p className="page-subtitle">{reservations.length} réservations · {formatMontant(richesseGeneree)} encaissé</p>
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
          <div className="stat-value" style={{ fontSize: 20 }}>{formatMontant(richesseGeneree)}</div>
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
