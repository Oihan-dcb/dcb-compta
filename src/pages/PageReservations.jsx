import { useState, useEffect } from 'react'
import { syncReservations, getReservationsMois } from '../services/syncReservations'
import { calculerVentilationMois, getRecapVentilation } from '../services/ventilation'
import { setToken, formatMontant } from '../lib/hospitable'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

const HOSP_TOKEN = import.meta.env.VITE_HOSPITABLE_TOKEN

// Mois courant par défaut
const moisCourant = new Date().toISOString().substring(0, 7)

export default function PageReservations() {
  const [mois, setMois] = useState(moisCourant)
  const [reservations, setReservations] = useState([])
  const [recap, setRecap] = useState([])
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [calculant, setCalculant] = useState(false)
  const [syncResult, setSyncResult] = useState(null)
  const [error, setError] = useState(null)
  const [onglet, setOnglet] = useState('reservations') // reservations | ventilation
  const [selectedResa, setSelectedResa] = useState(null)


  useEffect(() => {
    if (HOSP_TOKEN) setToken(HOSP_TOKEN)
    charger()
  }, [mois])

  async function charger() {
    setLoading(true)
    setError(null)
    try {
      const [resas, recapData] = await Promise.all([
        getReservationsMois(mois),
        getRecapVentilation(mois),
      ])
      setReservations(resas)
      setRecap(recapData)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function lancerSync() {
    setSyncing(true)
    setSyncResult(null)
    setError(null)
    try {
      const result = await syncReservations(mois)
      setSyncResult(result)
      await charger()
    } catch (err) {
      setError(err.message)
    } finally {
      setSyncing(false)
    }
  }

  async function lancerVentilation() {
    setCalculant(true)
    setError(null)
    try {
      await calculerVentilationMois(mois)
      await charger()
    } catch (err) {
      setError(err.message)
    } finally {
      setCalculant(false)
    }
  }

  const nbVentilees = reservations.filter(r => r.ventilation_calculee).length
  const nbRapprochees = reservations.filter(r => r.rapprochee).length
  const totalRevenue = reservations.reduce((s, r) => s + (r.fin_revenue || 0), 0)
  const nbDirectes = reservations.filter(r => r.platform === 'direct' || r.platform === 'manual').length

  return (
    <div>
      {selectedResa && <ModalResa resa={selectedResa} onClose={() => setSelectedResa(null)} />}
      <div className="page-header">
        <div>
          <h1 className="page-title">Réservations</h1>
          <p className="page-subtitle">{reservations.length} réservations · {formatMontant(totalRevenue)} encaissé</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            type="month"
            className="form-input"
            style={{ width: 160 }}
            value={mois}
            onChange={e => setMois(e.target.value)}
          />
          <button className="btn btn-secondary" onClick={charger} disabled={loading}>↺</button>

          <button className="btn btn-secondary" onClick={lancerSync} disabled={syncing}>
            {syncing ? <><span className="spinner" /> Sync…</> : '⟳ Sync Hospitable'}
          </button>
          <button
            className="btn btn-primary"
            onClick={lancerVentilation}
            disabled={calculant || reservations.length === 0}
          >
            {calculant ? <><span className="spinner" /> Calcul…</> : '⚡ Ventiler'}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-label">Réservations</div>
          <div className="stat-value">{reservations.length}</div>
          <div className="stat-sub">{nbDirectes} directes/manuelles</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Revenue total</div>
          <div className="stat-value" style={{ fontSize: 20 }}>{formatMontant(totalRevenue)}</div>
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
      </div>

      {/* Alertes */}

      {syncResult && (
        <div className="alert alert-success">
          ✓ Sync {mois} — {syncResult.created} créées, {syncResult.updated} mises à jour
          {syncResult.errors > 0 && ` — ⚠ ${syncResult.errors} erreurs`}
        </div>
      )}
      {error && <div className="alert alert-error">✕ {error}</div>}

      {/* Onglets */}
      <div className="toolbar">
        <button
          className={`btn ${onglet === 'reservations' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setOnglet('reservations')}
        >
          Réservations ({reservations.length})
        </button>
        <button
          className={`btn ${onglet === 'ventilation' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setOnglet('ventilation')}
        >
          Ventilation ({recap?.parCode?.length || recap?.length || 0} codes)
        </button>
      </div>

      {loading ? (
        <div className="loading-state"><span className="spinner" /> Chargement…</div>
      ) : onglet === 'reservations' ? (
        <TableReservations reservations={reservations} onSelect={setSelectedResa} />
      ) : (
        <TableVentilation recap={recap?.parCode || recap || []} parProprio={recap?.parProprio || []} mois={mois} />
      )}
    </div>
  )
}

function ModalResa({ resa, onClose }) {
  if (!resa) return null
  const ventil = (resa.ventilation || [])
  const com = ventil.find(v => v.code === 'COM')
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={onClose}>
      <div style={{background:'#ffffff',color:'#1a1a2e',borderRadius:'12px',padding:'28px',minWidth:'500px',maxWidth:'620px',maxHeight:'85vh',overflowY:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.4)'}} onClick={e => e.stopPropagation()}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'16px'}}>
          <h3 style={{margin:0,color:'#1a1a2e'}}>{resa.bien?.hospitable_name || resa.bien?.code || '—'}</h3>
          <button onClick={onClose} style={{background:'none',border:'none',fontSize:'1.5rem',cursor:'pointer',color:'#666'}}>×</button>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',marginBottom:'16px',fontSize:'0.9em'}}>
          <div><span style={{color:'#888',fontSize:'0.8em',textTransform:'uppercase'}}>Code</span><br/><strong className="mono">{resa.code}</strong></div>
          <div><span style={{color:'#888',fontSize:'0.8em',textTransform:'uppercase'}}>Plateforme</span><br/><span className={`badge badge-${resa.platform}`}>{resa.platform}</span></div>
          <div><span style={{color:'#888',fontSize:'0.8em',textTransform:'uppercase'}}>Check-in</span><br/><strong>{resa.arrival_date ? format(new Date(resa.arrival_date), 'd MMM yyyy', {locale: fr}) : '—'}</strong></div>
          <div><span style={{color:'#888',fontSize:'0.8em',textTransform:'uppercase'}}>Nuits</span><br/><strong>{resa.nights}</strong></div>
          <div><span style={{color:'#888',fontSize:'0.8em',textTransform:'uppercase'}}>Voyageur</span><br/><strong>{resa.guest_name || '—'}</strong></div>
          <div><span style={{color:'#888',fontSize:'0.8em',textTransform:'uppercase'}}>Statut réservation</span><br/>
            {resa.final_status === 'cancelled'
              ? <span style={{color:'#dc2626',fontWeight:700}}>⚠ Annulée</span>
              : resa.final_status === 'request'
              ? <span style={{color:'#0369a1',fontWeight:700}}>⏳ En attente</span>
              : <span style={{color:'#16a34a',fontWeight:700}}>✓ Confirmée</span>}
          </div>
          <div><span style={{color:'#888',fontSize:'0.8em',textTransform:'uppercase'}}>Revenue net</span><br/><strong>{resa.fin_revenue ? formatMontant(resa.fin_revenue) : '—'}</strong></div>
        </div>
        {ventil.length > 0 ? (
          <>
            <div style={{fontWeight:700,marginBottom:'12px',fontSize:'0.8em',color:'#888',textTransform:'uppercase',letterSpacing:'0.08em',borderTop:'1px solid #eee',paddingTop:'16px'}}>Ventilation</div>
            <table style={{width:'100%',fontSize:'0.9em'}}>
              <thead><tr style={{color:'#888',fontSize:'0.8em'}}>
                <th style={{textAlign:'left',paddingBottom:'6px'}}>Code</th>
                <th style={{textAlign:'left',paddingBottom:'6px'}}>Libellé</th>
                <th style={{textAlign:'right',paddingBottom:'6px'}}>HT</th>
                <th style={{textAlign:'right',paddingBottom:'6px'}}>TVA</th>
                <th style={{textAlign:'right',paddingBottom:'6px'}}>TTC</th>
              </tr></thead>
              <tbody>
                {ventil.map((v,i) => (
                  <tr key={i} style={{borderTop:'1px solid #eee'}}>
                    <td style={{padding:'6px 0'}}><strong>{v.code}</strong></td>
                    <td style={{padding:'6px 8px',color:'#555'}}>{v.libelle}</td>
                    <td style={{textAlign:'right',padding:'6px 0'}}>{formatMontant(v.montant_ht)}</td>
                    <td style={{textAlign:'right',padding:'6px 0',color:'#999'}}>{v.montant_tva > 0 ? formatMontant(v.montant_tva) : '—'}</td>
                    <td style={{textAlign:'right',padding:'6px 0'}}><strong>{formatMontant(v.montant_ttc)}</strong></td>
                  </tr>
                ))}
                {com?.taux_calcule && (
                  <tr><td colSpan={5} style={{paddingTop:'8px',color:'#888',fontSize:'0.85em',fontStyle:'italic'}}>
                    Taux calculé : {Math.round(com.taux_calcule * 100)}%
                  </td></tr>
                )}
              </tbody>
            </table>
          </>
        ) : (
          <div style={{color:'#999',fontSize:'0.9em',fontStyle:'italic'}}>Pas encore ventilée — lance la ventilation pour voir le détail.</div>
        )}
      </div>
    </div>
  )
}

function TableReservations({ reservations, onSelect }) {
  if (reservations.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">Aucune réservation</div>
        <p>Lance une sync Hospitable pour ce mois.</p>
      </div>
    )
  }

  return (
    <div className="table-container">
      <table>
        <thead>
          <tr>
            <th>Code</th>
            <th>Plateforme</th>
            <th>Bien</th>
            <th>Voyageur</th>
            <th>Statut</th>
            <th>Check-in</th>
            <th>Nuits</th>
            <th className="right">Revenue net</th>
            <th className="right">Taux COM</th>
            <th>Statut</th>
          </tr>
        </thead>
        <tbody>
          {reservations.map(r => (
            <tr key={r.id} onClick={() => onSelect(r)} style={{cursor:'pointer'}}>
              <td><span className="mono">{r.code}</span></td>
              <td>
                <span className={`badge badge-${r.platform}`}>{r.platform}</span>
              </td>
              <td title={r.bien?.hospitable_name}>
                <span className='mono'>{r.bien?.code || '—'}</span>
                {r.bien?.hospitable_name && <div style={{fontSize:'0.75em',color:'var(--text-muted)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:'160px'}}>{r.bien.hospitable_name}</div>}
              </td>
              <td>{r.guest_name || '—'}</td>
              <td>
                {r.final_status === 'cancelled'
                  ? <span className="badge" style={{background:'#fee2e2',color:'#dc2626',borderRadius:'4px',padding:'2px 6px',fontSize:'0.75em',fontWeight:600}}>Annulée</span>
                  : r.final_status === 'accepted'
                  ? <span className="badge" style={{background:'#dcfce7',color:'#16a34a',borderRadius:'4px',padding:'2px 6px',fontSize:'0.75em',fontWeight:600}}>Confirmée</span>
                  : r.final_status === 'request'
                  ? <span className="badge" style={{background:'#e0f2fe',color:'#0369a1',borderRadius:'4px',padding:'2px 6px',fontSize:'0.75em',fontWeight:600}}>En attente</span>
                  : <span className="badge" style={{background:'#fef9c3',color:'#ca8a04',borderRadius:'4px',padding:'2px 6px',fontSize:'0.75em',fontWeight:600}}>{r.final_status || '—'}</span>
                }
              </td>
              <td>{r.arrival_date ? format(new Date(r.arrival_date), 'd MMM', { locale: fr }) : '—'}</td>
              <td>{r.nights}</td>
              <td className="right montant">
                {r.fin_revenue ? formatMontant(r.fin_revenue) : '—'}
              </td>
              <td className="right">
                {r.ventilation?.[0]?.taux_calcule != null
                  ? <span title="Taux calculé depuis les financials Hospitable" style={{cursor:'help',borderBottom:'1px dashed var(--text-muted)'}}>{Math.round(r.ventilation[0].taux_calcule * 100)}%</span>
                  : '—'}
              </td>
              <td>
                {r.owner_stay ? (
                  <span className="badge badge-neutral">Séjour proprio</span>
                ) : r.rapprochee ? (
                  <span className="badge badge-success">✓ Rapprochée</span>
                ) : r.ventilation_calculee ? (
                  <span className="badge badge-warning">Ventilée</span>
                ) : (
                  <span className="badge badge-info">Importée</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TableVentilation({ recap, parProprio, mois }) {
  const [vue, setVue] = useState('codes') // codes | proprios
  if (!recap || recap.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">Aucune ventilation calculée</div>
        <p>Clique sur "Ventiler" pour calculer la ventilation du mois.</p>
      </div>
    )
  }

  const totalHT = recap.reduce((s, r) => s + r.ht, 0)
  const totalTVA = recap.reduce((s, r) => s + r.tva, 0)
  const totalTTC = recap.reduce((s, r) => s + r.ttc, 0)

  const codeOrder = ['COM', 'MEN', 'MOE', 'AE', 'LOY', 'DIV', 'TAX']
  const sorted = [...recap].sort((a, b) =>
    codeOrder.indexOf(a.code) - codeOrder.indexOf(b.code)
  )

  return (
    <div>
      {/* Sélecteur de vue */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <button
          className={`btn btn-sm ${vue === 'codes' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setVue('codes')}>
          Par code
        </button>
        <button
          className={`btn btn-sm ${vue === 'proprios' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setVue('proprios')}>
          Par propriétaire ({parProprio.length})
        </button>
      </div>

      {vue === 'codes' ? (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Libellé</th>
                <th className="right">Lignes</th>
                <th className="right">Montant HT</th>
                <th className="right">TVA</th>
                <th className="right">TTC</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => (
                <tr key={r.code}>
                  <td><span className={`code-${r.code}`}>{r.code}</span></td>
                  <td>{r.libelle}</td>
                  <td className="right">{r.nb}</td>
                  <td className="right montant">{formatMontant(r.ht)}</td>
                  <td className="right montant" style={{ color: 'var(--text-muted)' }}>
                    {r.tva > 0 ? formatMontant(r.tva) : '—'}
                  </td>
                  <td className="right montant">{formatMontant(r.ttc)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--brand-pale)' }}>
                <td colSpan={3} style={{ fontWeight: 600 }}>Total</td>
                <td className="right montant" style={{ fontWeight: 700 }}>{formatMontant(totalHT)}</td>
                <td className="right montant" style={{ fontWeight: 700, color: 'var(--text-muted)' }}>{formatMontant(totalTVA)}</td>
                <td className="right montant" style={{ fontWeight: 700 }}>{formatMontant(totalTTC)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Propriétaire</th>
                <th className="right">COM HT</th>
                <th className="right">MEN HT</th>
                <th className="right">MOE</th>
                <th className="right">AE</th>
                <th className="right">LOY (reversement)</th>
                <th className="right">Total DCB</th>
              </tr>
            </thead>
            <tbody>
              {parProprio.map(p => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 500 }}>{p.nom}</td>
                  <td className="right montant">{p.total_com > 0 ? formatMontant(p.total_com) : '—'}</td>
                  <td className="right montant">{p.total_men > 0 ? formatMontant(p.total_men) : '—'}</td>
                  <td className="right montant">{p.total_moe > 0 ? formatMontant(p.total_moe) : '—'}</td>
                  <td className="right montant">{p.total_ae > 0 ? formatMontant(p.total_ae) : '—'}</td>
                  <td className="right montant">{p.total_loy > 0 ? formatMontant(p.total_loy) : '—'}</td>
                  <td className="right montant" style={{ fontWeight: 700 }}>
                    {formatMontant(p.total_com + p.total_men + p.total_ae)}
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--brand-pale)' }}>
                <td style={{ fontWeight: 600 }}>Total</td>
                <td className="right montant" style={{ fontWeight: 700 }}>{formatMontant(parProprio.reduce((s,p) => s + p.total_com, 0))}</td>
                <td className="right montant" style={{ fontWeight: 700 }}>{formatMontant(parProprio.reduce((s,p) => s + p.total_men, 0))}</td>
                <td className="right montant" style={{ fontWeight: 700 }}>{formatMontant(parProprio.reduce((s,p) => s + p.total_ae, 0))}</td>
                <td className="right montant" style={{ fontWeight: 700 }}>{formatMontant(parProprio.reduce((s,p) => s + p.total_loy, 0))}</td>
                <td className="right montant" style={{ fontWeight: 700 }}>{formatMontant(parProprio.reduce((s,p) => s + p.total_com + p.total_men + p.total_ae, 0))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
