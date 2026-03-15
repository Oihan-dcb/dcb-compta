import { useState, useEffect } from 'react'
import { syncReservations, getReservationsMois } from '../services/syncReservations'
import { supabase } from '../lib/supabase'
import { calculerVentilationMois, getRecapVentilation } from '../services/ventilation'
import { setToken, formatMontant } from '../lib/hospitable'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

const HOSP_TOKEN = import.meta.env.VITE_HOSPITABLE_TOKEN

// Mois courant par défaut
const moisCourant = new Date().toISOString().substring(0, 7)

const MOIS_FR = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc']

function MoisSelector({ mois, setMois, moisDispos }) {
  const [open, setOpen] = useState(false)

  // Grouper par année
  const parAnnee = {}
  for (const m of moisDispos) {
    const [y] = m.split('-')
    if (!parAnnee[y]) parAnnee[y] = []
    parAnnee[y].push(m)
  }
  const annees = Object.keys(parAnnee).sort((a,b) => b - a)
  const [anneeActive, setAnneeActive] = useState(() => mois.split('-')[0])

  const [year, monthIdx] = mois.split('-')
  const labelMois = MOIS_FR[parseInt(monthIdx) - 1]

  return (
    <div style={{ position: 'relative' }}>
      <button
        className="btn btn-secondary"
        onClick={() => setOpen(o => !o)}
        style={{ minWidth: 120, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>📅</span>
        <span style={{ fontWeight: 600 }}>{labelMois} {year}</span>
        <span style={{ fontSize: 10, opacity: 0.6 }}>▼</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '110%', left: 0, zIndex: 100,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          minWidth: 280, padding: 12,
        }}
        onMouseLeave={() => setOpen(false)}>
          {/* Sélecteur d'année */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            {annees.map(y => (
              <button key={y}
                onClick={() => setAnneeActive(y)}
                style={{
                  padding: '3px 10px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: '0.85em', fontWeight: 600,
                  background: anneeActive === y ? 'var(--brand)' : 'var(--border)',
                  color: anneeActive === y ? '#fff' : 'var(--text)',
                }}>
                {y}
              </button>
            ))}
          </div>
          {/* Grille des mois */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5 }}>
            {(parAnnee[anneeActive] || []).map(m => {
              const mi = parseInt(m.split('-')[1]) - 1
              const isActive = m === mois
              return (
                <button key={m}
                  onClick={() => { setMois(m); setOpen(false) }}
                  style={{
                    padding: '6px 4px', borderRadius: 6, border: 'none', cursor: 'pointer',
                    fontSize: '0.85em', fontWeight: isActive ? 700 : 400,
                    background: isActive ? 'var(--brand)' : 'var(--bg)',
                    color: isActive ? '#fff' : 'var(--text)',
                    textAlign: 'center',
                  }}>
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
  const [onglet, setOnglet] = useState('reservations') // reservations | ventilation
  const [selectedResa, setSelectedResa] = useState(null)


  useEffect(() => {
    if (HOSP_TOKEN) setToken(HOSP_TOKEN)
    charger()
  }, [mois])

  useEffect(() => {
    chargerMoisDispos()
  }, [])

  async function chargerMoisDispos() {
    try {
      // Charger tous les mois distincts avec pagination (peut dépasser 1000 lignes)
      const PAGE = 1000
      let all = [], page = 0
      while (true) {
        const { data } = await supabase
          .from('reservation')
          .select('mois_comptable')
          .not('mois_comptable', 'is', null)
          .range(page * PAGE, (page + 1) * PAGE - 1)
        if (!data || data.length === 0) break
        all = all.concat(data)
        if (data.length < PAGE) break
        page++
      }
      const uniques = [...new Set(all.map(r => r.mois_comptable))].sort((a,b) => b.localeCompare(a))
      setMoisDispos(uniques)
    } catch (e) { console.error('chargerMoisDispos:', e) }
  }

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
          <MoisSelector mois={mois} setMois={setMois} moisDispos={moisDispos} />
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
  const com = ventil.find(v => v.code === 'HON')
  const isManual = resa.platform === 'manual'
  const [editLines, setEditLines] = useState(null) // null = pas en édition
  const [saving, setSaving] = useState(false)

  // Initialiser les lignes éditables depuis la ventilation existante ou template vide
  function startEdit() {
    const existing = ventil.length > 0
      ? ventil.map(v => ({ code: v.code, libelle: v.libelle, ht: (v.montant_ht/100).toFixed(2), tva: (v.montant_tva/100).toFixed(2), ttc: (v.montant_ttc/100).toFixed(2) }))
      : [{ code: 'HON', libelle: 'Honoraires de gestion', ht: '', tva: '', ttc: '' }]
    setEditLines(existing)
  }

  function addLine() {
    setEditLines(l => [...l, { code: 'LOY', libelle: 'Reversement propriétaire', ht: '', tva: '', ttc: '' }])
  }

  function removeLine(i) {
    setEditLines(l => l.filter((_, idx) => idx !== i))
  }

  function updateLine(i, field, value) {
    setEditLines(l => l.map((line, idx) => {
      if (idx !== i) return line
      const updated = { ...line, [field]: value }
      // Auto-calcul TTC = HT + TVA si les deux sont remplis
      if (field === 'ht' || field === 'tva') {
        const ht = parseFloat(field === 'ht' ? value : updated.ht) || 0
        const tva = parseFloat(field === 'tva' ? value : updated.tva) || 0
        if (ht > 0) updated.ttc = (ht + tva).toFixed(2)
      }
      return updated
    }))
  }

  async function saveManualVentil() {
    setSaving(true)
    try {
      const { supabase } = await import('../lib/supabase')
      // Supprimer les anciennes lignes
      await supabase.from('ventilation').delete().eq('reservation_id', resa.id)
      // Insérer les nouvelles
      const lignes = editLines
        .filter(l => l.code && parseFloat(l.ttc) > 0)
        .map(l => ({
          reservation_id: resa.id,
          bien_id: resa.bien?.id,
          proprietaire_id: resa.bien?.proprietaire_id || null,
          code: l.code.toUpperCase(),
          libelle: l.libelle,
          montant_ht: Math.round(parseFloat(l.ht || 0) * 100),
          montant_tva: Math.round(parseFloat(l.tva || 0) * 100),
          montant_ttc: Math.round(parseFloat(l.ttc || 0) * 100),
          taux_tva: parseFloat(l.tva) > 0 ? 20 : 0,
          mois_comptable: resa.mois_comptable,
          calcul_source: 'manual',
        }))
      if (lignes.length > 0) {
        const { error } = await supabase.from('ventilation').insert(lignes)
        if (error) throw error
      }
      await supabase.from('reservation').update({ ventilation_calculee: true }).eq('id', resa.id)
      setEditLines(null)
      // Rafraîchir les données
      onClose()
    } catch (err) {
      alert('Erreur : ' + err.message)
    } finally {
      setSaving(false)
    }
  }

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
        {/* ── Mode édition manuelle ── */}
        {isManual && editLines ? (
          <div style={{borderTop:'1px solid #eee',paddingTop:'16px'}}>
            <div style={{fontWeight:700,marginBottom:'12px',fontSize:'0.8em',color:'#888',textTransform:'uppercase',letterSpacing:'0.08em'}}>Ventilation manuelle</div>
            <table style={{width:'100%',fontSize:'0.85em',borderCollapse:'collapse'}}>
              <thead><tr style={{color:'#888',fontSize:'0.8em'}}>
                <th style={{textAlign:'left',paddingBottom:'6px',width:'70px'}}>Code</th>
                <th style={{textAlign:'left',paddingBottom:'6px'}}>Libellé</th>
                <th style={{textAlign:'right',paddingBottom:'6px',width:'75px'}}>HT €</th>
                <th style={{textAlign:'right',paddingBottom:'6px',width:'65px'}}>TVA €</th>
                <th style={{textAlign:'right',paddingBottom:'6px',width:'75px'}}>TTC €</th>
                <th style={{width:'24px'}}></th>
              </tr></thead>
              <tbody>
                {editLines.map((line, i) => (
                  <tr key={i} style={{borderTop:'1px solid #f0f0f0'}}>
                    <td style={{padding:'4px 4px 4px 0'}}>
                      <select value={line.code} onChange={e => updateLine(i, 'code', e.target.value)}
                        style={{width:'100%',fontSize:'0.85em',padding:'3px',border:'1px solid #ddd',borderRadius:4}}>
                        {['HON','FMEN','AUTO','LOY','TAXE','VIR','DIV'].map(c => <option key={c}>{c}</option>)}
                      </select>
                    </td>
                    <td style={{padding:'4px'}}>
                      <input value={line.libelle} onChange={e => updateLine(i, 'libelle', e.target.value)}
                        style={{width:'100%',fontSize:'0.85em',padding:'3px',border:'1px solid #ddd',borderRadius:4}}/>
                    </td>
                    <td style={{padding:'4px'}}>
                      <input type="number" step="0.01" value={line.ht} onChange={e => updateLine(i, 'ht', e.target.value)}
                        style={{width:'100%',fontSize:'0.85em',padding:'3px',border:'1px solid #ddd',borderRadius:4,textAlign:'right'}}/>
                    </td>
                    <td style={{padding:'4px'}}>
                      <input type="number" step="0.01" value={line.tva} onChange={e => updateLine(i, 'tva', e.target.value)}
                        style={{width:'100%',fontSize:'0.85em',padding:'3px',border:'1px solid #ddd',borderRadius:4,textAlign:'right'}}/>
                    </td>
                    <td style={{padding:'4px'}}>
                      <input type="number" step="0.01" value={line.ttc} onChange={e => updateLine(i, 'ttc', e.target.value)}
                        style={{width:'100%',fontSize:'0.85em',padding:'3px',border:'1px solid #ddd',borderRadius:4,textAlign:'right',fontWeight:600}}/>
                    </td>
                    <td style={{padding:'4px 0 4px 4px'}}>
                      <button onClick={() => removeLine(i)}
                        style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626',fontSize:'1em',padding:'0 2px'}}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{display:'flex',gap:'8px',marginTop:'12px'}}>
              <button onClick={addLine}
                style={{fontSize:'0.85em',padding:'5px 12px',background:'#f5f5f5',border:'1px solid #ddd',borderRadius:6,cursor:'pointer'}}>
                + Ligne
              </button>
              <button onClick={saveManualVentil} disabled={saving}
                style={{fontSize:'0.85em',padding:'5px 16px',background:'var(--brand)',color:'white',border:'none',borderRadius:6,cursor:'pointer',fontWeight:600}}>
                {saving ? 'Enregistrement…' : '✓ Enregistrer'}
              </button>
              <button onClick={() => setEditLines(null)}
                style={{fontSize:'0.85em',padding:'5px 12px',background:'#f5f5f5',border:'1px solid #ddd',borderRadius:6,cursor:'pointer',marginLeft:'auto'}}>
                Annuler
              </button>
            </div>
          </div>
        ) : ventil.length > 0 ? (
          <>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',borderTop:'1px solid #eee',paddingTop:'16px',marginBottom:'12px'}}>
              <div style={{fontWeight:700,fontSize:'0.8em',color:'#888',textTransform:'uppercase',letterSpacing:'0.08em'}}>Ventilation</div>
              {isManual && (
                <button onClick={startEdit}
                  style={{fontSize:'0.8em',padding:'3px 10px',background:'#f5f5f5',border:'1px solid #ddd',borderRadius:5,cursor:'pointer'}}>
                  ✏️ Modifier
                </button>
              )}
            </div>
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
          <div style={{borderTop:'1px solid #eee',paddingTop:'16px'}}>
            <div style={{color:'#999',fontSize:'0.9em',fontStyle:'italic',marginBottom: isManual ? '12px' : '0'}}>
              {isManual ? 'Réservation manuelle — saisie libre de la ventilation.' : 'Pas encore ventilée.'}
            </div>
            {isManual && (
              <button onClick={startEdit}
                style={{fontSize:'0.85em',padding:'6px 16px',background:'var(--brand)',color:'white',border:'none',borderRadius:6,cursor:'pointer',fontWeight:600}}>
                ✏️ Saisir la ventilation
              </button>
            )}
          </div>
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
                {r.bien?.taux_commission_override != null
                  ? <span title="Override bien" style={{fontWeight:600}}>{Math.round(r.bien.taux_commission_override * 100)}%</span>
                  : r.bien?.proprietaire?.taux_commission != null
                  ? <span title="Taux proprio">{r.bien.proprietaire.taux_commission}%</span>
                  : r.ventilation_calculee
                  ? <span title="Taux défaut">25%</span>
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

  const codeOrder = ['HON', 'FMEN', 'AUTO', 'LOY', 'DIV', 'TAXE', 'VIR']
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
                <th className="right">HON HT</th>
                <th className="right">FMEN HT</th>
                                <th className="right">AUTO</th>
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
                  <td className="right montant">{'—'}</td>
                  <td className="right montant">{p.total_auto > 0 ? formatMontant(p.total_auto) : '—'}</td>
                  <td className="right montant">{p.total_loy > 0 ? formatMontant(p.total_loy) : '—'}</td>
                  <td className="right montant" style={{fontWeight:600, color:'var(--brand)'}}>{p.total_vir > 0 ? formatMontant(p.total_vir) : '—'}</td>
                  <td className="right montant" style={{ fontWeight: 700 }}>
                    {formatMontant(p.total_com + p.total_men + p.total_auto)}
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--brand-pale)' }}>
                <td style={{ fontWeight: 600 }}>Total</td>
                <td className="right montant" style={{ fontWeight: 700 }}>{formatMontant(parProprio.reduce((s,p) => s + p.total_com, 0))}</td>
                <td className="right montant" style={{ fontWeight: 700 }}>{formatMontant(parProprio.reduce((s,p) => s + (p.total_comd||0), 0))}</td>
                <td className="right montant" style={{ fontWeight: 700 }}>{formatMontant(parProprio.reduce((s,p) => s + p.total_men, 0))}</td>
                <td className="right montant" style={{ fontWeight: 700 }}>{formatMontant(parProprio.reduce((s,p) => s + p.total_auto, 0))}</td>
                <td className="right montant" style={{ fontWeight: 700 }}>{formatMontant(parProprio.reduce((s,p) => s + p.total_loy, 0))}
                </td>
                <td className="right montant" style={{ fontWeight: 700, color:'var(--brand)' }}>
                  {formatMontant(parProprio.reduce((s,p) => s + (p.total_vir||0), 0))}</td>
                <td className="right montant" style={{ fontWeight: 700 }}>{formatMontant(parProprio.reduce((s,p) => s + p.total_com + p.total_men + p.total_auto, 0))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
