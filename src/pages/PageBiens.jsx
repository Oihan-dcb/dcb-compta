import { useState, useEffect } from 'react'
import { syncBiens, getBiens } from '../services/syncBiens'
import { setToken } from '../lib/hospitable'
import { formatMontant } from '../lib/hospitable'

const HOSP_TOKEN = import.meta.env.VITE_HOSPITABLE_TOKEN

export default function PageBiens() {
  const [biens, setBiens] = useState([])
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

  const [editing, setEditing] = useState({}) // { [bienId]: { forfait_dcb_ref, provision_ae_ref, has_ae } }
  const [saving, setSaving] = useState({})

  async function saveField(bienId, field, value) {
    setSaving(s => ({ ...s, [bienId]: true }))
    try {
      const { supabase } = await import('../lib/supabase')
      const numVal = value === '' ? null : Math.round(parseFloat(value) * 100)
      await supabase.from('bien').update({ [field]: numVal }).eq('id', bienId)
      setBiens(prev => prev.map(b => b.id === bienId ? { ...b, [field]: numVal } : b))
      setEditing(e => { const n = {...e}; delete n[bienId+'_'+field]; return n })
    } catch (err) {
      alert('Erreur : ' + err.message)
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
      alert('Erreur : ' + err.message)
    }
  }

  const biensActifs = biens.filter(b => b.listed)
  const biensAvecProprio = biens.filter(b => b.proprietaire_id)
  const biensAConfigurer = biens.filter(b => !b.proprietaire_id || !b.provision_ae_ref)

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Biens</h1>
          <p className="page-subtitle">
            {biensActifs.length} biens actifs · {biensAvecProprio.length} avec propriétaire
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
          <div className="stat-label">Avec AE</div>
          <div className="stat-value">{biens.filter(b => b.provision_ae_ref).length}</div>
          <div className="stat-sub">auto-entrepreneur ménage</div>
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
      {loading ? (
        <div className="loading-state">
          <span className="spinner" /> Chargement des biens…
        </div>
      ) : biens.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">Aucun bien</div>
          <p>Lance une sync Hospitable pour importer les biens.</p>
          <button className="btn btn-primary" onClick={lancerSync} style={{ marginTop: 16 }}>
            ⟳ Sync Hospitable
          </button>
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Bien</th>
                <th>Code</th>
                <th>Ville</th>
                <th>Propriétaire</th>
                <th title="Auto-entrepreneur">AUTO</th>
                <th className="right">Provision AE</th>
                <th className="right">Forfait DCB</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {biens.map(bien => (
                <tr key={bien.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{bien.hospitable_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      {bien.hospitable_id?.substring(0, 8)}…
                    </div>
                  </td>
                  <td>
                    <span className="mono">{bien.code || '—'}</span>
                  </td>
                  <td>{bien.ville || '—'}</td>
                  <td>
                    {bien.proprietaire ? (
                      <span>{bien.proprietaire.nom} {bien.proprietaire.prenom || ''}</span>
                    ) : (
                      <span style={{ color: 'var(--warning)' }}>⚠ Non configuré</span>
                    )}
                  </td>
                  <td>
                    {bien.provision_ae_ref
                      ? <span className="badge badge-success" title="Provision AE configurée">✓</span>
                      : <span className="badge badge-neutral">—</span>}
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
      )}
    </div>
  )
}
