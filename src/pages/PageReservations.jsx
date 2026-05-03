import { AGENCE } from '../lib/agence'
import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import MoisSelector from '../components/MoisSelector'
import { useMoisPersisted } from '../hooks/useMoisPersisted'
import { supabase } from '../lib/supabase'
import { syncReservations, getReservationsMois } from '../services/syncReservations'
import { calculerVentilationMois, getRecapVentilation, calculerVentilationResa } from '../services/ventilation'
import { setToken, formatMontant } from '../lib/hospitable'
import ModalResa from '../components/ModalResa'
import TableReservations from '../components/TableReservations'
import TableVentilation from '../components/TableVentilation'

const HOSP_TOKEN = import.meta.env.VITE_HOSPITABLE_TOKEN
export default function PageReservations() {
  const [mois, setMois] = useMoisPersisted()
  const [moisDispos, setMoisDispos] = useState([])
  const [reservations, setReservations] = useState([])
  const [recap, setRecap] = useState([])
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [calculant, setCalculant] = useState(false)
  const ventilLock = useRef(false)
  const [syncResult, setSyncResult] = useState(null)
  const [ventilResult, setVentilResult] = useState(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const [error, setError] = useState(null)
  const [onglet, setOnglet] = useState(() => localStorage.getItem('tab_reservations') || 'reservations')
  useEffect(() => localStorage.setItem('tab_reservations', onglet), [onglet])
  const [selectedResa, setSelectedResa] = useState(null)
  const [modalManuelles, setModalManuelles] = useState(false)
  const [modeManuelles, setModeManuelles] = useState('normal')
  const [ventilantManuelles, setVentilantManuelles] = useState(false)

  useEffect(() => {
    if (HOSP_TOKEN) setToken(HOSP_TOKEN)
    charger()
  }, [mois])
  useEffect(() => { chargerMoisDispos() }, [])

  async function chargerMoisDispos() {
    try {
      const PAGE = 1000
      let all = [], page = 0
      while (true) {
        const { data } = await supabase.from('reservation').select('mois_comptable, bien!inner(agence)').not('mois_comptable', 'is', null).eq('bien.agence', AGENCE).range(page * PAGE, (page + 1) * PAGE - 1)
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
      // Ouvrir le modal si ?code= dans l'URL (venant du Rapprochement)
      const codeParam = searchParams.get('code')
      if (codeParam) {
        const found = resas.find(r => r.code === codeParam)
        if (found) {
          setSelectedResa(found)
          setSearchParams({}) // nettoyer l'URL
        } else {
          // La résa n'est pas dans ce mois — chercher son mois_comptable
          const { data: resaInfo } = await supabase
            .from('reservation').select('mois_comptable').eq('code', codeParam).single()
          if (resaInfo?.mois_comptable) setMois(resaInfo.mois_comptable)
          // charger() sera rappelé par le useEffect([mois]) — il trouvera la résa
        }
      }
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  async function lancerSync() {
    setSyncing(true); setSyncResult(null); setError(null)
    try { const result = await syncReservations(mois); setSyncResult(result); await charger() }
    catch (err) { setError(err.message) }
    finally { setSyncing(false) }
  }

  async function ventilerToutesManuelles() {
    const cibles = reservations.filter(r => r.platform === 'manual' && (!r.ventilation || r.ventilation.length === 0))
    setVentilantManuelles(true)
    try {
      for (const r of cibles) {
        if (modeManuelles === 'proprio') {
          await supabase.from('reservation').update({ owner_stay: true }).eq('id', r.id)
          await calculerVentilationResa({ ...r, owner_stay: true })
        } else {
          await calculerVentilationResa(r)
        }
      }
      setModalManuelles(false)
      await charger()
    } catch (e) {
      setError(e.message)
    } finally {
      setVentilantManuelles(false)
    }
  }

  async function lancerVentilation() {
    if (ventilLock.current) return
    ventilLock.current = true
    setCalculant(true); setError(null); setVentilResult(null)
    try {
      const result = await calculerVentilationMois(mois)
      setVentilResult(result)
      await charger()
    }
    catch (err) { setError(err.message) }
    finally { setCalculant(false); ventilLock.current = false }
  }

  const nbVentilables = reservations.filter(r => r.final_status !== 'cancelled').length
  const nbVentilees   = reservations.filter(r => r.ventilation_calculee && r.final_status !== 'cancelled').length
  const nbDirectes = reservations.filter(r => r.platform === 'direct' || r.platform === 'manual').length
  const nbRapprochees = reservations.filter(r => r.rapprochee).length
  // Exclut les resas proprio (owner_stay=true) — leur ventilation est saisie manuellement via VentilationEdit
  // Si on les inclut, le mode "Ventilation normale" leur appliquerait HON+LOY (incorrect)
  const nbManuellesNonVentilees = reservations.filter(r => r.platform === 'manual' && !r.owner_stay && (!r.ventilation || r.ventilation.length === 0)).length
  const totalRevenue = reservations.filter(r => !r.owner_stay).reduce((s, r) => s + (r.fin_revenue || 0), 0)
  // Richesse générée = total TTC ventilation (HON+FMEN+AUTO+VIR) si ventilé, sinon fin_revenue
  const richesseGeneree = (() => {
    const codes = ['HON','FMEN','AUTO','LOY']
    // Inclure toutes les resas : HON+FMEN+AUTO+LOY pour les normales, FMEN pour les séjours proprio
    // LOY = reversement proprio (disponible dès ventilation, indépendant du rapprochement)
    const sum = reservations.reduce((s, r) => {
      const codesR = r.owner_stay ? ['FMEN'] : codes
      return s + (r.ventilation || []).filter(v => codesR.includes(v.code)).reduce((a, v) => a + v.montant_ttc, 0)
    }, 0)
    return sum > 0 ? sum : totalRevenue
  })()
  return (
    <div>
      {modalManuelles && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center' }}
          onClick={() => setModalManuelles(false)}>
          <div style={{ background:'#fff', borderRadius:12, padding:28, minWidth:400, maxWidth:500 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin:'0 0 16px' }}>Ventiler {nbManuellesNonVentilees} réservation{nbManuellesNonVentilees > 1 ? 's' : ''} manuelle{nbManuellesNonVentilees > 1 ? 's' : ''}</h3>
            {[
              { val: 'normal', label: 'Ventilation normale', desc: 'HON + FMEN + AUTO + LOY calculés automatiquement' },
              { val: 'proprio', label: 'Séjour propriétaire', desc: 'Marquer comme séjour propriétaire — saisir FMEN manuellement (déduit du LOY ou facturé séparément)' },
            ].map(opt => (
              <label key={opt.val} style={{ display:'flex', alignItems:'flex-start', gap:8, marginBottom:10, cursor:'pointer' }}>
                <input type="radio" name="modeManuelles" value={opt.val}
                  checked={modeManuelles === opt.val} onChange={() => setModeManuelles(opt.val)}
                  style={{ marginTop:3 }} />
                <span>
                  <span style={{ fontWeight:600, fontSize:'0.9em' }}>{opt.label}</span>
                  <span style={{ display:'block', fontSize:'0.8em', color:'#888' }}>{opt.desc}</span>
                </span>
              </label>
            ))}
            <div style={{ display:'flex', gap:8, marginTop:16 }}>
              <button onClick={ventilerToutesManuelles} disabled={ventilantManuelles}
                style={{ padding:'7px 20px', background:'var(--brand)', color:'white', border:'none', borderRadius:6, cursor:'pointer', fontWeight:600 }}>
                {ventilantManuelles ? 'Calcul…' : `⚡ Appliquer à ${nbManuellesNonVentilees}`}
              </button>
              <button onClick={() => setModalManuelles(false)}
                style={{ padding:'7px 16px', background:'#f5f5f5', border:'1px solid #ddd', borderRadius:6, cursor:'pointer' }}>
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
      {selectedResa && (
        <ModalResa
          resa={selectedResa}
          onClose={() => setSelectedResa(null)}
          onSaved={(reventile, updatedResa) => {
            setSelectedResa(null)
            if (updatedResa) setReservations(prev => prev.map(r => r.id === updatedResa.id ? { ...r, ...updatedResa } : r))
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
          <div className="stat-value" style={{ color: nbVentilees === nbVentilables && nbVentilables > 0 ? 'var(--success)' : 'var(--warning)' }}>
            {nbVentilees}/{nbVentilables}
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
            onClick={() => setModalManuelles(true)}
            title="Cliquer pour ventiler les réservations manuelles">
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
      {ventilResult && (
        <div className={`alert ${ventilResult.errors > 0 ? 'alert-error' : 'alert-success'}`}>
          <div>
            ⚡ Ventilation {mois} — {ventilResult.total} calculée{ventilResult.total > 1 ? 's' : ''}
            {ventilResult.skipped > 0 && ` · ${ventilResult.skipped} verrouillée${ventilResult.skipped > 1 ? 's' : ''}`}
            {ventilResult.errors > 0 && ` · ⚠ ${ventilResult.errors} erreur${ventilResult.errors > 1 ? 's' : ''}`}
          </div>
          {ventilResult.errorDetails?.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: '0.82em' }}>
              {ventilResult.errorDetails.map((e, i) => (
                <li key={i}><strong>{e.code}</strong> — {e.msg}</li>
              ))}
            </ul>
          )}
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

      {/* TableReservations reste monté pour préserver les filtres — loading passé en prop */}
      {onglet === 'reservations' ? (
        <TableReservations reservations={reservations} onSelect={setSelectedResa} onRefresh={charger} loading={loading} />
      ) : loading ? (
        <div className="loading-state"><span className="spinner" /> Chargement…</div>
      ) : (
        <TableVentilation recap={recap?.parCode || recap || []} parProprio={recap?.parProprio || []} reservations={reservations} />
      )}
    </div>
  )
}
