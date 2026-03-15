// v1773607106
import { useState, useEffect, useRef } from 'react'
import { parseCSVCaisseEpargne, importerMouvements, getMouvementsMois, getMoisDispos } from '../services/banque'
import MoisSelector from '../components/MoisSelector'
import { formatMontant } from '../lib/hospitable'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

const moisCourant = new Date().toISOString().substring(0, 7)

const CANAL_LABELS = {
  airbnb: { label: 'Airbnb', cls: 'badge-airbnb' },
  booking: { label: 'Booking', cls: 'badge-booking' },
  stripe: { label: 'Stripe', cls: 'badge-direct' },
  sepa_manuel: { label: 'SEPA', cls: 'badge-manual' },
  interne: { label: 'Interne', cls: 'badge-neutral' },
  sortant_proprio: { label: 'Reversement', cls: 'badge-neutral' },
  sortant_ae: { label: 'Débours AE', cls: 'badge-neutral' },
  sortant_honoraires: { label: 'Honoraires', cls: 'badge-neutral' },
  frais_bancaires: { label: 'Frais CE', cls: 'badge-neutral' },
}

export default function PageBanque() {
  const [mois, setMois] = useState(moisCourant)
  const [mouvements, setMouvements] = useState([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState(null)
  const [filtre, setFiltre] = useState('tous')
  const [moisDispos, setMoisDispos] = useState([new Date().toISOString().substring(0, 7)])
  const fileRef = useRef()

  useEffect(() => { charger() }, [mois])
  useEffect(() => { chargerMoisDispos() }, [])

  async function charger() {
    setLoading(true)
    setError(null)
    try {
      const data = await getMouvementsMois(mois)
      setMouvements(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function chargerMoisDispos() {
    try {
      const mois_list = await getMoisDispos()
      if (mois_list.length > 0) setMoisDispos(mois_list)
    } catch (err) { /* silencieux */ }
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setPreview(null)
    setImportResult(null)
    try {
      const parsed = await parseCSVCaisseEpargne(file)
      setPreview(parsed)
    } catch (err) {
      setError(`Erreur parsing CSV : ${err.message}`)
    }
    // Reset input pour permettre re-upload du même fichier
    if (fileRef.current) fileRef.current.value = ''
  }

  async function confirmerImport() {
    if (!preview) return
    setImporting(true)
    try {
      const result = await importerMouvements(preview)
      setImportResult(result)
      setPreview(null)
      await charger()
    } catch (err) {
      setError(err.message)
    } finally {
      setImporting(false)
    }
  }

  const entrants = mouvements.filter(m => m.credit !== null)
  const sortants = mouvements.filter(m => m.debit !== null)
  const aRapprocher = entrants.filter(m => m.statut_matching === 'en_attente')
  const totalEntrant = entrants.reduce((s, m) => s + (m.credit || 0), 0)
  const totalSortant = sortants.reduce((s, m) => s + (m.debit || 0), 0)

  const mvtFiltres = filtre === 'a_rapprocher'
    ? aRapprocher
    : filtre === 'entrants'
    ? entrants
    : mouvements

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Compte de gestion</h1>
          <p className="page-subtitle">Caisse d'Épargne — {mouvements.length} opérations</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <MoisSelector mois={mois} setMois={setMois} moisDispos={moisDispos} />
          <button className="btn btn-secondary" onClick={charger} disabled={loading}>↺</button>
          <label className="btn btn-primary" style={{ cursor: 'pointer' }}>
            ↑ Import CSV
            <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFile} />
          </label>
        </div>
      </div>

      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-label">Entrées</div>
          <div className="stat-value montant-positif" style={{ fontSize: 20 }}>{formatMontant(totalEntrant)}</div>
          <div className="stat-sub">{entrants.length} opérations</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Sorties</div>
          <div className="stat-value montant-negatif" style={{ fontSize: 20 }}>{formatMontant(totalSortant)}</div>
          <div className="stat-sub">{sortants.length} opérations</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">À rapprocher</div>
          <div className="stat-value" style={{ color: aRapprocher.length > 0 ? 'var(--warning)' : 'var(--success)' }}>
            {aRapprocher.length}
          </div>
          <div className="stat-sub">virements en attente</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Rapprochés</div>
          <div className="stat-value">
            {entrants.filter(m => ['matche_auto','matche_manuel'].includes(m.statut_matching)).length}
          </div>
          <div className="stat-sub">sur {entrants.length} entrées</div>
        </div>
      </div>

      {error && <div className="alert alert-error">✕ {error}</div>}
      {importResult && (
        <div className="alert alert-success">
          ✓ Import terminé — {importResult.inserted} mouvements importés
          {importResult.skipped > 0 && `, ${importResult.skipped} doublons ignorés`}
        </div>
      )}

      {preview && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <strong>{preview.length} mouvements</strong> détectés
              {preview[0]?.mois_releve && ` — mois ${preview[0].mois_releve}`}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setPreview(null)}>Annuler</button>
              <button className="btn btn-primary btn-sm" onClick={confirmerImport} disabled={importing}>
                {importing ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Import…</> : `✓ Confirmer`}
              </button>
            </div>
          </div>
          <div className="table-container" style={{ maxHeight: 200, overflowY: 'auto' }}>
            <table>
              <thead><tr><th>Date</th><th>Libellé</th><th>Canal</th><th className="right">Crédit</th><th className="right">Débit</th></tr></thead>
              <tbody>
                {preview.slice(0, 10).map((m, i) => (
                  <tr key={i}>
                    <td>{m.date_operation}</td>
                    <td style={{ maxWidth: 260 }}>{m.libelle}</td>
                    <td>
                      {CANAL_LABELS[m.canal]
                        ? <span className={`badge ${CANAL_LABELS[m.canal].cls}`}>{CANAL_LABELS[m.canal].label}</span>
                        : m.canal}
                    </td>
                    <td className="right montant montant-positif">{m.credit ? formatMontant(m.credit) : ''}</td>
                    <td className="right montant montant-negatif">{m.debit ? formatMontant(m.debit) : ''}</td>
                  </tr>
                ))}
                {preview.length > 10 && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    + {preview.length - 10} autres mouvements…
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="toolbar">
        {[
          { key: 'tous', label: `Tous (${mouvements.length})` },
          { key: 'entrants', label: `Entrées (${entrants.length})` },
          { key: 'a_rapprocher', label: `À rapprocher (${aRapprocher.length})` },
        ].map(f => (
          <button key={f.key} className={`btn btn-sm ${filtre === f.key ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFiltre(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading-state"><span className="spinner" /> Chargement…</div>
      ) : mvtFiltres.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">Aucun mouvement</div>
          <p>Importe un relevé CSV Caisse d'Épargne pour ce mois.</p>
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Date</th><th>Libellé</th><th>Détail</th><th>Canal</th>
                <th className="right">Crédit</th><th className="right">Débit</th><th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {mvtFiltres.map(m => {
                const canal = CANAL_LABELS[m.canal]
                return (
                  <tr key={m.id}>
                    <td>{m.date_operation ? format(new Date(m.date_operation), 'd MMM', { locale: fr }) : m.date_operation}</td>
                    <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.libelle}</td>
                    <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-muted)', fontSize: 12 }}>{m.detail || '—'}</td>
                    <td>{canal ? <span className={`badge ${canal.cls}`}>{canal.label}</span> : <span className="badge badge-neutral">{m.canal || '?'}</span>}</td>
                    <td className="right montant montant-positif">{m.credit ? formatMontant(m.credit) : ''}</td>
                    <td className="right montant montant-negatif">{m.debit ? formatMontant(m.debit) : ''}</td>
                    <td>
                      {m.statut_matching === 'matche_auto' && <span className="badge badge-success">✓ Auto</span>}
                      {m.statut_matching === 'matche_manuel' && <span className="badge badge-success">✓ Manuel</span>}
                      {m.statut_matching === 'en_attente' && m.credit && <span className="badge badge-warning">En attente</span>}
                      {m.statut_matching === 'non_rapprochable' && <span className="badge badge-neutral">N/A</span>}
                      {m.debit && !['matche_auto','matche_manuel'].includes(m.statut_matching) && <span className="badge badge-neutral">Sortant</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
