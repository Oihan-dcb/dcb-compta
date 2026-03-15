import { useState, useEffect } from 'react'
import {
  getFacturesAuto, initialiserFacturesAuto, updateFactureAE,
  validerFactureAE, getStatsFacturesAuto, getMontantEffectifAE
} from '../services/facturesAE'
import { formatMontant } from '../lib/hospitable'

const moisCourant = new Date().toISOString().substring(0, 7)

export default function PageFacturesAuto() {
  const [mois, setMois] = useState(moisCourant)
  const [factures, setFactures] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(null) // id de la facture en cours d'édition
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  useEffect(() => { charger() }, [mois])

  async function charger() {
    setLoading(true)
    setError(null)
    try {
      const [f, s] = await Promise.all([getFacturesAuto(mois), getStatsFacturesAuto(mois)])
      setFactures(f)
      setStats(s)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function initialiser() {
    setLoading(true)
    setError(null)
    try {
      const result = await initialiserFacturesAuto(mois)
      setSuccess(`${result.created} fiches AE créées pour ${mois}`)
      await charger()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function ouvrir(facture) {
    setEditing(facture.id)
    setForm({
      ae_nom: facture.ae_nom || '',
      ae_initiales: facture.ae_initiales || '',
      montant_reel: facture.montant_reel !== null ? (facture.montant_reel / 100).toFixed(2) : '',
      note: facture.note || '',
    })
    setError(null)
    setSuccess(null)
  }

  async function sauvegarder(factureId) {
    setSaving(true)
    setError(null)
    try {
      const montantReel = form.montant_reel ? Math.round(parseFloat(form.montant_reel) * 100) : null
      const result = await updateFactureAE(factureId, {
        ae_nom: form.ae_nom,
        ae_initiales: form.ae_initiales,
        montant_reel: montantReel,
        note: form.note,
      })
      setSuccess(`Facture sauvegardée${result.alerteEcart ? ' — ⚠ Écart > 20% détecté' : ''}`)
      setEditing(null)
      await charger()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function valider(factureId) {
    try {
      await validerFactureAE(factureId)
      setSuccess('Facture AE validée')
      await charger()
    } catch (err) {
      setError(err.message)
    }
  }

  const totalEffectif = factures.reduce((s, f) => s + getMontantEffectifAE(f), 0)

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Factures auto-entrepreneurs</h1>
          <p className="page-subtitle">
            Provision main d'œuvre ménage — {factures.length} biens avec AE
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input type="month" className="form-input" style={{ width: 160 }} value={mois} onChange={e => setMois(e.target.value)} />
          <button className="btn btn-secondary" onClick={charger} disabled={loading}>↺</button>
          <button className="btn btn-primary" onClick={initialiser} disabled={loading}>
            + Initialiser le mois
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-label">Total biens AE</div>
            <div className="stat-value">{stats.total}</div>
            <div className="stat-sub">biens avec auto-entrepreneur</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Théoriques</div>
            <div className="stat-value" style={{ color: stats.theoriques > 0 ? 'var(--text-muted)' : 'var(--success)' }}>
              {stats.theoriques}
            </div>
            <div className="stat-sub">valeur par défaut utilisée</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Saisis / Validés</div>
            <div className="stat-value" style={{ color: 'var(--success)' }}>
              {stats.saisis + stats.valides}
            </div>
            <div className="stat-sub">montant réel renseigné</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Alertes écart</div>
            <div className="stat-value" style={{ color: stats.alertes > 0 ? 'var(--warning)' : 'var(--success)' }}>
              {stats.alertes}
            </div>
            <div className="stat-sub">écart &gt; 20% vs théorique</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total effectif</div>
            <div className="stat-value" style={{ fontSize: 18 }}>{formatMontant(totalEffectif)}</div>
            <div className="stat-sub">débours AE à reverser</div>
          </div>
        </div>
      )}

      {/* Alertes */}
      {error && <div className="alert alert-error">✕ {error}</div>}
      {success && <div className="alert alert-success">✓ {success}</div>}

      {loading ? (
        <div className="loading-state"><span className="spinner" /> Chargement…</div>
      ) : factures.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">Aucune fiche AE pour ce mois</div>
          <p>Clique sur "Initialiser le mois" pour créer les fiches à partir des biens avec AE configurés.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {factures.map(f => (
            <FactureAECard
              key={f.id}
              facture={f}
              editing={editing === f.id}
              form={form}
              saving={saving}
              onEdit={() => ouvrir(f)}
              onFormChange={changes => setForm(prev => ({ ...prev, ...changes }))}
              onSave={() => sauvegarder(f.id)}
              onCancel={() => setEditing(null)}
              onValider={() => valider(f.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FactureAECard({ facture, editing, form, saving, onEdit, onFormChange, onSave, onCancel, onValider }) {
  const bien = facture.bien
  const montantEffectif = getMontantEffectifAE(facture)
  const hasReel = facture.montant_reel !== null
  const ecartPct = facture.ecart && facture.montant_theorique
    ? Math.round(Math.abs(facture.ecart) / facture.montant_theorique * 100)
    : null

  const statutColor = {
    theorique: 'var(--text-muted)',
    saisi: 'var(--warning)',
    valide: 'var(--success)',
  }

  return (
    <div style={{
      background: 'var(--white)',
      border: `1px solid ${facture.alerte_ecart ? '#FBBF24' : 'var(--border)'}`,
      borderRadius: 'var(--radius)',
      padding: '14px 18px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {/* Infos bien */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flex: 1 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>
              {bien?.code || bien?.hospitable_name}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {bien?.proprietaire?.nom}
              {facture.ae_nom && <span> · AE : {facture.ae_nom}</span>}
            </div>
          </div>
        </div>

        {/* Montants */}
        <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Théorique</div>
            <div style={{ fontWeight: 500 }}>{formatMontant(facture.montant_theorique)}</div>
          </div>
          {hasReel && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Réel</div>
              <div style={{ fontWeight: 700, color: facture.alerte_ecart ? 'var(--warning)' : 'var(--success)' }}>
                {formatMontant(facture.montant_reel)}
                {ecartPct !== null && (
                  <span style={{ fontSize: 11, marginLeft: 6 }}>
                    ({facture.ecart > 0 ? '+' : ''}{formatMontant(facture.ecart)}, {ecartPct}%)
                  </span>
                )}
              </div>
            </div>
          )}
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Effectif</div>
            <div style={{ fontWeight: 700, color: 'var(--brand)', fontSize: 16 }}>{formatMontant(montantEffectif)}</div>
          </div>

          {/* Statut */}
          <span style={{
            padding: '3px 10px', borderRadius: 100, fontSize: 12, fontWeight: 600,
            background: facture.statut === 'valide' ? 'var(--success-bg)'
              : facture.statut === 'saisi' ? 'var(--warning-bg)' : '#F3F4F6',
            color: statutColor[facture.statut] || 'var(--text-muted)',
          }}>
            {facture.statut === 'theorique' ? 'Théorique'
              : facture.statut === 'saisi' ? 'Saisi'
              : 'Validé'}
          </span>

          {/* Actions */}
          {facture.statut !== 'valide' && !editing && (
            <button className="btn btn-secondary btn-sm" onClick={onEdit}>Saisir</button>
          )}
          {facture.statut === 'saisi' && !editing && (
            <button className="btn btn-primary btn-sm" onClick={onValider}>✓ Valider</button>
          )}
        </div>
      </div>

      {/* Formulaire de saisie */}
      {editing && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Nom AE</label>
              <input
                className="form-input"
                value={form.ae_nom}
                onChange={e => onFormChange({ ae_nom: e.target.value })}
                placeholder="ex: Cécile Alaux"
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Initiales</label>
              <input
                className="form-input"
                value={form.ae_initiales}
                onChange={e => onFormChange({ ae_initiales: e.target.value })}
                placeholder="ex: CA"
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Montant réel (€)</label>
              <input
                className="form-input"
                type="number"
                step="0.01"
                value={form.montant_reel}
                onChange={e => onFormChange({ montant_reel: e.target.value })}
                placeholder={`${(facture.montant_theorique / 100).toFixed(2)} (théorique)`}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Note</label>
              <input
                className="form-input"
                value={form.note}
                onChange={e => onFormChange({ note: e.target.value })}
                placeholder="Facultatif"
              />
            </div>
          </div>

          {/* Référence facture suggérée */}
          {form.ae_initiales && bien?.code && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
              Référence facture suggérée :{' '}
              <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                DCB-{bien.code}-{mois.replace('-', '')}-{form.ae_initiales}
              </span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={onSave} disabled={saving}>
              {saving ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Sauvegarde…</> : '✓ Sauvegarder'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={onCancel}>Annuler</button>
          </div>
        </div>
      )}
    </div>
  )
}
