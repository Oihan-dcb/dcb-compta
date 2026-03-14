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

  const biensActifs = biens.filter(b => b.listed)
  const biensAvecProprio = biens.filter(b => b.proprietaire_id)
  const biensAConfigurer = biens.filter(b => !b.proprietaire_id || (!b.provision_ae_ref && !b.forfait_dcb_ref))

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
          <div className="stat-value">{biens.filter(b => b.has_ae).length}</div>
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
                <th>AE</th>
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
                    {bien.has_ae ? (
                      <span className="badge badge-success">Oui</span>
                    ) : (
                      <span className="badge badge-neutral">Non</span>
                    )}
                  </td>
                  <td className="right montant">
                    {bien.provision_ae_ref ? formatMontant(bien.provision_ae_ref) : '—'}
                  </td>
                  <td className="right montant">
                    {bien.forfait_dcb_ref ? formatMontant(bien.forfait_dcb_ref) : '—'}
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
