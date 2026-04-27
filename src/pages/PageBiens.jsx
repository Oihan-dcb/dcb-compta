import { useState, useEffect } from 'react'
import { AGENCE } from '../lib/agence'
import { syncBiens, getBiens } from '../services/syncBiens'
import { getProprietaires } from '../services/syncProprietaires'
import { setToken } from '../lib/hospitable'
import { formatMontant } from '../lib/hospitable'

const HOSP_TOKEN = import.meta.env.VITE_HOSPITABLE_TOKEN

export default function PageBiens() {
  const [biens, setBiens] = useState([])
  const [filtreAgence, setFiltreAgence] = useState(AGENCE)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (HOSP_TOKEN) setToken(HOSP_TOKEN)
    chargerBiens()
  }, [])

  async function chargerBiens() {
    setLoading(true)
    setError(null)
    try {
      const data = await getBiens()
      setBiens(data)
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
      const result = await syncBiens()
      setSyncResult(result)
      await chargerBiens()
    } catch (err) {
      setError(err.message)
    } finally {
      setSyncing(false)
    }
  }

  const [editing, setEditing] = useState({})
  const [proprietaires, setProprietaires] = useState([])
  const [airbnbAccounts, setAirbnbAccounts] = useState([])
  const [icalCodes, setIcalCodes] = useState([]) // codes courts extraits des missions iCal
  const [usedIcalCodes, setUsedIcalCodes] = useState({}) // { bien_id: ical_code }
  const [showIcalMatrice, setShowIcalMatrice] = useState(false)

  useEffect(() => {
    getProprietaires().then(setProprietaires).catch(() => {})
  }, [])

  useEffect(() => {
    // Charger les comptes Airbnb distincts depuis Supabase (source de vérité unique)
    import('../lib/supabase').then(({ supabase }) => {
      supabase.from('bien').select('airbnb_account').not('airbnb_account', 'is', null)
        .then(({ data }) => {
          if (data) {
            const uniq = [...new Set(data.map(d => d.airbnb_account).filter(Boolean))].sort()
            setAirbnbAccounts(uniq)
          }
        })
      // Charger les codes iCal disponibles depuis les missions (préfixe = partie alpha+chiffres avant les chiffres finaux)
      supabase.from('mission_menage').select('titre_ical').not('titre_ical', 'is', null)
        .then(({ data: missions }) => {
          if (missions) {
            const codes = [...new Set(
              missions.map(m => {
                const match = m.titre_ical?.match(/\(([A-Za-z0-9\u00C0-\u024F\-]+?\d+)/)
                if (!match) return null
                return match[1].replace(/\d+$/, '') // strip trailing digits = préfixe
              }).filter(Boolean)
            )].sort()
            setIcalCodes(codes)
          }
        })
      // Charger les associations ical_code déjà faites
      supabase.from('bien').select('id, ical_code').not('ical_code', 'is', null)
        .then(({ data: biensWithCode }) => {
          if (biensWithCode) {
            const map = {}
            biensWithCode.forEach(b => { map[b.id] = b.ical_code })
            setUsedIcalCodes(map)
          }
        })
    })
  }, [])

  async function saveProprietaire(bienId, proprietaireId) {
    try {
      const { supabase } = await import('../lib/supabase')
      await supabase.from('bien')
        .update({ proprietaire_id: proprietaireId || null })
        .eq('id', bienId)
      setBiens(prev => prev.map(b => {
        if (b.id !== bienId) return b
        const proprio = proprietaires.find(p => p.id === proprietaireId)
        return { ...b, proprietaire_id: proprietaireId || null, proprietaire: proprio || null }
      }))
      setEditing(e => { const n={...e}; delete n[bienId+'_proprio']; return n })
    } catch (err) {
      setError('Erreur : ' + err.message)
    }
  } // { [bienId]: { forfait_dcb_ref, provision_ae_ref, has_ae } }
  const [saving, setSaving] = useState({})

  async function saveField(bienId, field, value) {
    setSaving(s => ({ ...s, [bienId]: true }))
    try {
      const { supabase } = await import('../lib/supabase')
      // taux_commission_override est un ratio (ex: 0.20 pour 20%), pas en centimes
      // Champs texte : sauvegarder tel quel
      const TEXT_FIELDS = ['airbnb_account', 'ical_code', 'classification_date', 'classification_fin', 'code']
      const finalVal = value === '' || value === null ? null
        : TEXT_FIELDS.includes(field) ? value
        : field === 'taux_commission_override' ? value
        : Math.round(parseFloat(value) * 100)
      await supabase.from('bien').update({ [field]: finalVal }).eq('id', bienId)
      setBiens(prev => prev.map(b => b.id === bienId ? { ...b, [field]: finalVal } : b))
      setEditing(e => { const n = {...e}; delete n[bienId+'_'+field]; delete n[bienId+'_taux_com']; return n })
    } catch (err) {
      setError('Erreur : ' + err.message)
    } finally {
      setSaving(s => { const n = {...s}; delete n[bienId]; return n })
    }
  }

  async function toggleAE(bienId, currentVal) {
    try {
      const { supabase } = await import('../lib/supabase')
      await supabase.from('bien').update({ has_ae: !currentVal }).eq('id', bienId)
      setBiens(prev => prev.map(b => b.id === bienId ? { ...b, has_ae: !currentVal } : b))
    } catch (err) {
      setError('Erreur : ' + err.message)
    }
  }

  async function toggleGestionTaxeSejour(bienId, currentVal) {
    const newVal = !currentVal
    await supabase.from('bien').update({ gestion_taxe_sejour: newVal }).eq('id', bienId)
    setBiens(prev => prev.map(b => b.id === bienId ? { ...b, gestion_taxe_sejour: newVal } : b))
  }

  async function toggleGestionLoyer(bienId, currentVal) {
    try {
      const { supabase } = await import('../lib/supabase')
      const newVal = (currentVal === false || currentVal === null) ? true : false
      await supabase.from('bien').update({ gestion_loyer: newVal }).eq('id', bienId)
      setBiens(prev => prev.map(b => b.id === bienId ? { ...b, gestion_loyer: newVal } : b))
    } catch (err) { setError('Erreur : ' + err.message) }
  }

  async function toggleAgence(bienId, current) {
    try {
      const { supabase } = await import('../lib/supabase')
      const next = current === 'lauian' ? 'dcb' : 'lauian'
      await supabase.from('bien').update({ agence: next }).eq('id', bienId)
      setBiens(prev => prev.map(b => b.id === bienId ? { ...b, agence: next } : b))
    } catch (err) { setError('Erreur : ' + err.message) }
  }

  const biensDCB = biens.filter(b => (b.agence || AGENCE) === AGENCE)
  const biensActifs = biensDCB.filter(b => b.listed)
  const biensAvecProprio = biensDCB.filter(b => b.proprietaire_id)
  const biensAConfigurer = biensDCB.filter(b => b.listed && (!b.proprietaire_id || !b.provision_ae_ref))

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Biens</h1>
          <p className="page-subtitle">
            {biensActifs.length} biens {AGENCE.toUpperCase()} actifs · {biensAvecProprio.length} avec propriétaire
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-secondary" onClick={chargerBiens} disabled={loading}>
            ↺ Actualiser
          </button>
          <button className="btn btn-primary" onClick={lancerSync} disabled={syncing || loading}>
            {syncing ? <><span className="spinner" /> Sync en cours…</> : '⟳ Sync Hospitable'}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-label">Biens actifs</div>
          <div className="stat-value">{biensActifs.length}</div>
          <div className="stat-sub">sur Hospitable</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avec propriétaire</div>
          <div className="stat-value">{biensAvecProprio.length}</div>
          <div className="stat-sub">lien configuré</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">À configurer</div>
          <div className="stat-value" style={{ color: biensAConfigurer.length > 0 ? 'var(--warning)' : 'var(--success)' }}>
            {biensAConfigurer.length}
          </div>
          <div className="stat-sub">proprio ou ménage manquant</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avec AUTO</div>
          <div className="stat-value">{biensDCB.filter(b => b.has_ae).length}</div>
          <div className="stat-sub">Auto-entrepreneur ménage</div>
        </div>
      </div>

      {/* Alertes */}
      {syncResult && (
        <div className="alert alert-success" style={{ marginBottom: 16 }}>
          ✓ Sync terminée — {syncResult.created} biens créés, {syncResult.updated} mis à jour
          (total : {syncResult.total})
        </div>
      )}
      {error && (
        <div className="alert alert-error">
          ✕ Erreur : {error}
        </div>
      )}
      {biensAConfigurer.length > 0 && (
        <div className="alert alert-warning">
          ⚠ {biensAConfigurer.length} bien(s) sans propriétaire ou paramètres ménage — 
          à configurer avant de lancer la ventilation.
        </div>
      )}

      {/* Table */}
      {loading && biens.length === 0 ? (
        <div className="loading-state">
          <span className="spinner" /> Chargement des biens…
        </div>
      ) : !loading && biens.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">Aucun bien</div>
          <p>Lance une sync Hospitable pour importer les biens.</p>
          <button className="btn btn-primary" onClick={lancerSync} style={{ marginTop: 16 }}>
            ⟳ Sync Hospitable
          </button>
        </div>
      ) : (<>
              <div style={{marginBottom:10,display:'flex',gap:6,alignItems:'center'}}>
                <span style={{fontSize:12,color:'#888'}}>Agence :</span>
                {['dcb','lauian','tous'].map(a => (
                  <button key={a} onClick={() => setFiltreAgence(a)} style={{padding:'2px 8px',borderRadius:4,border:'1px solid',fontSize:11,cursor:'pointer',background:filtreAgence===a?(a==='lauian'?'#FEF3C7':a==='dcb'?'#FFF8EC':'#F3F4F6'):'#fff',color:filtreAgence===a?(a==='lauian'?'#B45309':a==='dcb'?'#CC9933':'#374151'):'#888',borderColor:filtreAgence===a?(a==='lauian'?'#F59E0B':a==='dcb'?'#CC9933':'#9CA3AF'):'#E5E7EB'}}>
                    {a==='tous'?'Tous':a==='dcb'?'DCB':'Lauian'}
                  </button>
                ))}
              </div>

        {/* Matrice iCal */}
        {(() => {
          const bienseIcal = biens.filter(b => (filtreAgence === 'tous' || (b.agence || 'dcb') === filtreAgence) && !b.ical_code && b.hospitable_id)
          const avecCode = biens.filter(b => (filtreAgence === 'tous' || (b.agence || 'dcb') === filtreAgence) && b.ical_code)
          const allPrefixes = [...new Set([...icalCodes, ...avecCode.map(b => b.ical_code)])].sort()
          return (
            <div style={{ marginBottom: 12 }}>
              <button onClick={() => setShowIcalMatrice(v => !v)}
                style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, border: '1px solid #e5e7eb', background: showIcalMatrice ? '#FDF5E8' : '#f9fafb', color: showIcalMatrice ? '#92400e' : '#374151', cursor: 'pointer', fontWeight: showIcalMatrice ? 700 : 400 }}>
                📅 Matrice iCal — {avecCode.length} configurés · {bienseIcal.length} manquants {showIcalMatrice ? '▲' : '▼'}
              </button>
              {showIcalMatrice && (
                <div style={{ marginTop: 8, background: '#FAFAF7', border: '1px solid #E8E2D6', borderRadius: 8, padding: '14px 16px' }}>
                  <datalist id="ical-prefixes">
                    {allPrefixes.map(p => <option key={p} value={p} />)}
                  </datalist>
                  {bienseIcal.length === 0 ? (
                    <div style={{ fontSize: 13, color: '#16a34a', fontWeight: 600 }}>✓ Tous les biens ont un code iCal</div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 8 }}>
                      {bienseIcal.map(bien => (
                        <div key={bien.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid #E8E2D6', borderRadius: 6, padding: '7px 10px' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: '#2C2416', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bien.hospitable_name}</div>
                            <div style={{ fontSize: 10, color: '#9C8E7D', fontFamily: 'monospace' }}>{bien.code}</div>
                          </div>
                          <input
                            list="ical-prefixes"
                            placeholder="préfixe iCal…"
                            defaultValue=""
                            style={{ width: 140, fontSize: 12, padding: '4px 7px', borderRadius: 5, border: '1.5px solid #e5e7eb', fontFamily: 'monospace' }}
                            onBlur={e => {
                              const val = e.target.value.trim() || null
                              if (val) saveField(bien.id, 'ical_code', val)
                            }}
                            onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  {avecCode.length > 0 && (
                    <details style={{ marginTop: 12 }}>
                      <summary style={{ fontSize: 11, color: '#9C8E7D', cursor: 'pointer', userSelect: 'none' }}>✓ {avecCode.length} biens déjà configurés</summary>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                        {avecCode.map(b => (
                          <div key={b.id} style={{ fontSize: 11, background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0', borderRadius: 4, padding: '2px 8px', fontFamily: 'monospace' }}>
                            {b.ical_code} <span style={{ color: '#9C8E7D', fontFamily: 'sans-serif' }}>→ {b.code}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>
          )
        })()}

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Bien</th>
                <th>Code</th>
                <th>Ville</th>
                <th>Propriétaire</th>
                <th>Compte Airbnb</th>
                <th className="right">Taux COM</th>
                <th className="right">Provision Auto</th>
                <th className="right">Forfait DCB</th>
                <th className="right">Ménage proprio</th>
                 <th style={{whiteSpace:'nowrap',textAlign:'center'}}>Agence / Collecte</th>
                <th style={{whiteSpace:'nowrap',textAlign:'center'}}>Code iCal</th>
                <th style={{whiteSpace:'nowrap',textAlign:'center'}}>Classification</th>
                <th style={{whiteSpace:'nowrap',textAlign:'center'}}>Taxe séjour</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {biens.filter(b => filtreAgence === "tous" || (b.agence || "dcb") === filtreAgence).map(bien => (
                <tr key={bien.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{bien.hospitable_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      {bien.hospitable_id?.substring(0, 8)}…
                    </div>
                  </td>
                  <td>
                    {editing[bien.id+'_code'] ? (
                      <input
                        autoFocus
                        defaultValue={bien.code || ''}
                        style={{width:'90px', padding:'3px 6px', fontSize:'0.85em', fontFamily:'monospace', borderRadius:4, border:'1px solid var(--border)', textTransform:'uppercase'}}
                        onBlur={e => { saveField(bien.id, 'code', e.target.value.toUpperCase() || null); setEditing(ev => { const n={...ev}; delete n[bien.id+'_code']; return n }) }}
                        onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditing(ev => { const n={...ev}; delete n[bien.id+'_code']; return n }) }}
                      />
                    ) : (
                      <span className="mono" onClick={() => setEditing(e => ({...e, [bien.id+'_code']: true}))} style={{cursor:'pointer', borderBottom:'1px dashed var(--border)'}} title="Cliquer pour modifier le code">{bien.code || '—'}</span>
                    )}
                  </td>
                  <td>{bien.ville || '—'}</td>
                  <td>
                    {editing[bien.id+'_proprio'] ? (
                      <select
                        autoFocus
                        defaultValue={bien.proprietaire_id || ''}
                        style={{width:'100%', padding:'3px 6px', fontSize:'0.85em', borderRadius:4, border:'1px solid var(--border)'}}
                        onChange={e => saveProprietaire(bien.id, e.target.value || null)}
                        onBlur={() => setEditing(e => { const n={...e}; delete n[bien.id+'_proprio']; return n })}>
                        <option value="">— Aucun —</option>
                        {proprietaires.map(p => (
                          <option key={p.id} value={p.id}>
                            {p.nom}{p.prenom ? ' ' + p.prenom : ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span
                        onClick={() => setEditing(e => ({...e, [bien.id+'_proprio']: true}))}
                        style={{cursor:'pointer', borderBottom: bien.proprietaire_id ? 'none' : '1px dashed var(--warning)'}}
                        title="Cliquer pour assigner un propriétaire">
                        {bien.proprietaire
                          ? `${bien.proprietaire.nom}${bien.proprietaire.prenom ? ' ' + bien.proprietaire.prenom : ''}`
                          : <span style={{color:'var(--warning)'}}>⚠ Cliquer pour assigner</span>}
                      </span>
                    )}
                  </td>
                  <td>
                    <select
                      value={bien.airbnb_account || ''}
                      style={{width:'130px', padding:'3px 6px', fontSize:'0.85em', borderRadius:4, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)', cursor:'pointer'}}
                      onChange={e => {
                        const val = e.target.value
                        if (val === '__add__') {
                          const nouveau = window.prompt('Nom du nouveau compte Airbnb :')
                          if (nouveau && nouveau.trim()) {
                            // Sauvegarder en base, puis recharger la liste depuis Supabase
                            saveField(bien.id, 'airbnb_account', nouveau.trim()).then(() => {
                              import('../lib/supabase').then(({ supabase }) => {
                                supabase.from('bien').select('airbnb_account').not('airbnb_account', 'is', null)
                                  .then(({ data }) => {
                                    if (data) {
                                      const uniq = [...new Set(data.map(d => d.airbnb_account).filter(Boolean))].sort()
                                      setAirbnbAccounts(uniq)
                                    }
                                  })
                              })
                            })
                          }
                        } else {
                          saveField(bien.id, 'airbnb_account', val || null)
                        }
                      }}>
                      <option value="">— Aucun —</option>
                      {airbnbAccounts.map(a => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                      <option value="__add__">➕ Ajouter…</option>
                    </select>
                  </td>
                  <td className="right">
                    {editing[bien.id+'_taux_com'] !== undefined ? (
                      <input
                        type="number" step="1" min="0" max="100" autoFocus
                        defaultValue={bien.taux_commission_override != null ? bien.taux_commission_override * 100 : (bien.proprietaire?.taux_commission ?? 25)}
                        style={{width:'60px',textAlign:'right',padding:'2px 4px',fontSize:'0.9em'}}
                        onBlur={e => {
                          const val = e.target.value === '' ? null : parseFloat(e.target.value) / 100
                          saveField(bien.id, 'taux_commission_override', val)
                        }}
                        onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditing(ev => { const n={...ev}; delete n[bien.id+'_taux_com']; return n }) }}
                      />
                    ) : (
                      <span
                        onClick={() => setEditing(e => ({...e, [bien.id+'_taux_com']: true}))}
                        style={{cursor:'pointer', borderBottom:'1px dashed var(--text-muted)', paddingBottom:'1px',
                          color: bien.taux_commission_override != null ? 'var(--brand)' : 'inherit',
                          fontWeight: bien.taux_commission_override != null ? 600 : 'normal'
                        }}
                        title={bien.taux_commission_override != null ? 'Override bien' : 'Taux proprio (cliquer pour override)'}>
                        {bien.taux_commission_override != null
                          ? `${Math.round(bien.taux_commission_override * 100)}%`
                          : bien.proprietaire?.taux_commission != null
                            ? `${bien.proprietaire.taux_commission}% (proprio)`
                            : '25% (défaut)'}
                      </span>
                    )}
                  </td>
                  <td className="right montant">
                    {editing[bien.id+'_provision_ae_ref'] !== undefined ? (
                      <input
                        type="number" step="0.01" autoFocus
                        defaultValue={bien.provision_ae_ref ? bien.provision_ae_ref / 100 : ''}
                        style={{width:'80px',textAlign:'right',padding:'2px 4px',fontSize:'0.9em'}}
                        onBlur={e => saveField(bien.id, 'provision_ae_ref', e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditing(ev => { const n={...ev}; delete n[bien.id+'_provision_ae_ref']; return n }) }}
                      />
                    ) : (
                      <span
                        onClick={() => setEditing(e => ({...e, [bien.id+'_provision_ae_ref']: true}))}
                        style={{cursor:'pointer',borderBottom:'1px dashed var(--text-muted)',paddingBottom:'1px'}}
                        title="Cliquer pour éditer">
                        {bien.provision_ae_ref ? formatMontant(bien.provision_ae_ref) : <span style={{color:'var(--text-muted)'}}>—</span>}
                      </span>
                    )}
                  </td>
                  <td className="right montant">
                    {editing[bien.id+'_forfait_dcb_ref'] !== undefined ? (
                      <input
                        type="number" step="0.01" autoFocus
                        defaultValue={bien.forfait_dcb_ref ? bien.forfait_dcb_ref / 100 : ''}
                        style={{width:'80px',textAlign:'right',padding:'2px 4px',fontSize:'0.9em'}}
                        onBlur={e => saveField(bien.id, 'forfait_dcb_ref', e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditing(ev => { const n={...ev}; delete n[bien.id+'_forfait_dcb_ref']; return n }) }}
                      />
                    ) : (
                      <span
                        onClick={() => setEditing(e => ({...e, [bien.id+'_forfait_dcb_ref']: true}))}
                        style={{cursor:'pointer',borderBottom:'1px dashed var(--text-muted)',paddingBottom:'1px'}}
                        title="Cliquer pour éditer">
                        {bien.forfait_dcb_ref ? formatMontant(bien.forfait_dcb_ref) : <span style={{color:'var(--text-muted)'}}>—</span>}
                      </span>
                    )}
                  </td>
                  <td className="right montant">
                    {editing[bien.id+'_forfait_menage_proprio'] !== undefined ? (
                      <input
                        type="number" step="0.01" autoFocus
                        defaultValue={bien.forfait_menage_proprio ? bien.forfait_menage_proprio / 100 : ''}
                        style={{width:'80px',textAlign:'right',padding:'2px 4px',fontSize:'0.9em'}}
                        placeholder="ex: 60"
                        onBlur={e => saveField(bien.id, 'forfait_menage_proprio', e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditing(ev => { const n={...ev}; delete n[bien.id+'_forfait_menage_proprio']; return n }) }}
                      />
                    ) : (
                      <span
                        onClick={() => setEditing(e => ({...e, [bien.id+'_forfait_menage_proprio']: true}))}
                        style={{cursor:'pointer',borderBottom:'1px dashed var(--text-muted)',paddingBottom:'1px'}}
                        title="Forfait ménage automatique pour séjours proprio">
                        {bien.forfait_menage_proprio ? formatMontant(bien.forfait_menage_proprio) : <span style={{color:'var(--text-muted)'}}>—</span>}
                      </span>
                    )}
                  </td>
                  
                  <td style={{textAlign:'center',padding:'6px 8px'}}>
                    <div style={{display:'flex',flexDirection:'column',gap:4,alignItems:'center'}}>
                      <span onClick={() => toggleAgence(bien.id, bien.agence || 'dcb')} title="Changer d'agence" style={{fontSize:11,fontWeight:700,padding:'2px 6px',borderRadius:4,cursor:'pointer',background:bien.agence==='lauian'?'#FEF3C7':'#FFF8EC',color:bien.agence==='lauian'?'#B45309':'#CC9933'}}>
                        {bien.agence === 'lauian' ? 'Lauian' : 'DCB'}
                      </span>
                      <span onClick={() => toggleGestionLoyer(bien.id, bien.gestion_loyer)} style={{fontSize:16,cursor:'pointer'}} title={bien.gestion_loyer === false ? 'Proprio gere' : 'DCB collecte'}>
                        {bien.gestion_loyer === false ? '🚫' : '✅'}
                      </span>
                    </div>
                  </td>
                  <td style={{textAlign:'center',padding:'6px 8px',minWidth:110}}>
                    <input
                      type="text"
                      defaultValue={bien.ical_code || ''}
                      placeholder="ex: 416Harea"
                      onBlur={e => {
                        const val = e.target.value.trim() || null
                        if (val !== (bien.ical_code || null)) saveField(bien.id, 'ical_code', val)
                      }}
                      style={{
                        fontSize:11, padding:'3px 6px', borderRadius:5,
                        border:'1px solid #e5e7eb', width:100,
                        background: bien.ical_code ? '#f0fdf4' : '#fff',
                        color: bien.ical_code ? '#16a34a' : '#888'
                      }}
                    />
                  </td>
                  <td style={{ textAlign: 'center', minWidth: 150 }}>
                    <select
                      value={bien.classification || 'non_classe'}
                      onChange={e => saveField(bien.id, 'classification', e.target.value)}
                      style={{ fontSize: 11, padding: '3px 6px', borderRadius: 5, border: '1px solid #e5e7eb', background: bien.classification && bien.classification !== 'non_classe' ? '#f0fdf4' : '#fff', color: bien.classification && bien.classification !== 'non_classe' ? '#16a34a' : '#888', cursor: 'pointer' }}>
                      <option value="non_classe">Non classé</option>
                      <option value="1_etoile">1 ★</option>
                      <option value="2_etoiles">2 ★</option>
                      <option value="3_etoiles">3 ★</option>
                      <option value="4_etoiles">4 ★</option>
                      <option value="5_etoiles">5 ★</option>
                    </select>
                    {bien.classification && bien.classification !== 'non_classe' && (() => {
                      const today = new Date().toISOString().slice(0, 10)
                      const expired = bien.classification_fin && bien.classification_fin < today
                      return (
                        <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
                          <input
                            type="date"
                            defaultValue={bien.classification_date || ''}
                            title="Date de classement"
                            onBlur={e => { if (e.target.value !== (bien.classification_date || '')) saveField(bien.id, 'classification_date', e.target.value || null) }}
                            style={{ fontSize: 10, padding: '1px 3px', border: '1px solid #e5e7eb', borderRadius: 3, width: 120, color: '#888' }}
                          />
                          <input
                            type="date"
                            defaultValue={bien.classification_fin || ''}
                            title="Fin de classement"
                            onBlur={e => { if (e.target.value !== (bien.classification_fin || '')) saveField(bien.id, 'classification_fin', e.target.value || null) }}
                            style={{ fontSize: 10, padding: '1px 3px', border: `1px solid ${expired ? '#fca5a5' : '#e5e7eb'}`, borderRadius: 3, width: 120, color: expired ? '#dc2626' : '#888', background: expired ? '#fff1f2' : '#fff', fontWeight: expired ? 600 : 'normal' }}
                          />
                          {expired && <span style={{ fontSize: 9, color: '#dc2626', fontWeight: 700 }}>EXPIRÉ</span>}
                        </div>
                      )
                    })()}
                  </td>
                  <td style={{textAlign:'center'}}>
                    <span
                      onClick={() => toggleGestionTaxeSejour(bien.id, bien.gestion_taxe_sejour)}
                      style={{fontSize:16, cursor:'pointer'}}
                      title={bien.gestion_taxe_sejour ? 'DCB gère la taxe de séjour' : 'Taxe de séjour non gérée par DCB'}>
                      {bien.gestion_taxe_sejour ? '✅' : '⬜'}
                    </span>
                  </td>
                  <td>
                    {bien.listed ? (
                      <span className="badge badge-success">Actif</span>
                    ) : (
                      <span className="badge badge-neutral">Inactif</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
      )}
    </div>
  )
}
