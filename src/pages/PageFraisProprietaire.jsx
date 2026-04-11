import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import MoisSelector from '../components/MoisSelector'
import { formatMontant } from '../lib/hospitable'
import { creerFrais, modifierFrais, supprimerFrais, changerStatut, annulerFacturationFrais } from '../services/fraisProprietaire'
import { useMoisPersisted } from '../hooks/useMoisPersisted'

const moisCourant = new Date().toISOString().slice(0, 7)

const MODES_TRAITEMENT = {
  deduire_loyer:   'Déduire du loyer',
  facturer_direct: 'Refacturer au proprio',
  remboursement:   'Remboursement (+ LOY)',
}

const MODES_ENCAISSEMENT = {
  dcb:    'DCB a payé',
  proprio: 'Proprio a payé',
}

const STATUT_LABELS = {
  brouillon:   { label: 'Brouillon',   color: '#8C7B65', bg: '#F7F3EC' },
  a_facturer:  { label: 'À facturer',  color: '#B45309', bg: '#FFF7ED' },
  facture:     { label: 'Facturé',     color: '#059669', bg: '#D1FAE5' },
}

const DEDUCTION_LABELS = {
  totalement_deduit:    { label: 'Déduit ✓',     color: '#059669', bg: '#D1FAE5' },
  partiellement_deduit: { label: 'Partiel ⚠',    color: '#B45309', bg: '#FFF7ED' },
  non_deduit:           { label: 'Non couvert',  color: '#DC2626', bg: '#FEE2E2' },
  en_attente:           { label: '—',            color: '#8C7B65', bg: 'transparent' },
}

const FORM_EMPTY = {
  bien_id: '',
  date: new Date().toISOString().slice(0, 10),
  libelle: '',
  montant_euros: '',
  mode_traitement: 'deduire_loyer',
  mode_encaissement: 'dcb',
}

export default function PageFraisProprietaire() {
  const [mois, setMois] = useMoisPersisted()
  const [moisDispos, setMoisDispos] = useState([moisCourant])
  const [frais, setFrais] = useState([])
  const [biens, setBiens] = useState([])
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(FORM_EMPTY)
  const [editingFrais, setEditingFrais] = useState(null)
  const [formEdit, setFormEdit] = useState(FORM_EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  useEffect(() => { chargerBiens() }, [])
  useEffect(() => { charger() }, [mois])
  useEffect(() => {
    const channel = supabase.channel('frais-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'frais_proprietaire' },
        () => charger()
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  async function chargerBiens() {
    const { data } = await supabase
      .from('bien')
      .select('id, code, hospitable_name, proprietaire_id, proprietaire (id, nom, prenom)')
      .eq('agence', 'dcb')
      .eq('listed', true)
      .order('code')
    setBiens(data || [])
  }

  async function charger() {
    setLoading(true)
    setError(null)
    try {
      const [y, m] = mois.split('-').map(Number)
      const moisSuivant = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`

      const { data, error: err } = await supabase
        .from('frais_proprietaire')
        .select('*, bien (id, code, hospitable_name), proprietaire (id, nom, prenom)')
        .gte('date', `${mois}-01`)
        .lt('date', `${moisSuivant}-01`)
        .order('date')
      if (err) throw err
      setFrais(data || [])

      // Mois dispos — depuis date réelle
      const { data: moisData } = await supabase
        .from('frais_proprietaire')
        .select('date')
        .not('date', 'is', null)
      const set = new Set([moisCourant, ...(moisData || []).map(r => r.date.slice(0, 7))])
      setMoisDispos([...set].sort().reverse())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function ouvrirEdition(f) {
    setFormEdit({
      bien_id:           f.bien_id,
      date:              f.date,
      libelle:           f.libelle,
      montant_euros:     (f.montant_ttc / 100).toFixed(2),
      mode_traitement:   f.mode_traitement,
      mode_encaissement: f.mode_encaissement,
    })
    setEditingFrais(f)
    setError(null)
  }

  async function soumettreMod(e) {
    e.preventDefault()
    const bienEd = biens.find(b => b.id === formEdit.bien_id)
    if (!formEdit.bien_id || !formEdit.libelle || !formEdit.montant_euros || !bienEd?.proprietaire_id) {
      setError('Bien, libellé, montant et propriétaire requis')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await modifierFrais(editingFrais.id, {
        bien_id:           formEdit.bien_id,
        proprietaire_id:   bienEd.proprietaire_id,
        date:              formEdit.date,
        libelle:           formEdit.libelle,
        montant_ttc:       Math.round(parseFloat(formEdit.montant_euros) * 100),
        mode_traitement:   formEdit.mode_traitement,
        mode_encaissement: formEdit.mode_encaissement,
        mois_facturation:  formEdit.date.slice(0, 7),
      })
      setSuccess('Frais modifié')
      setEditingFrais(null)
      await charger()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function supprimerFraisHandler(id) {
    if (!confirm('Supprimer ce frais ? Cette action est irréversible.')) return
    setError(null)
    try {
      await supprimerFrais(id)
      setSuccess('Frais supprimé')
      await charger()
    } catch (e) {
      setError(e.message)
    }
  }

  // Propriétaire déduit du bien sélectionné
  const bienSelectionne = biens.find(b => b.id === form.bien_id)
  const proprioLabel = bienSelectionne?.proprietaire
    ? `${bienSelectionne.proprietaire.nom}${bienSelectionne.proprietaire.prenom ? ' ' + bienSelectionne.proprietaire.prenom : ''}`
    : '—'

  async function soumettre(e) {
    e.preventDefault()
    if (!form.bien_id || !form.libelle || !form.montant_euros || !bienSelectionne?.proprietaire_id) {
      setError('Bien, libellé, montant et propriétaire requis')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await creerFrais({
        bien_id:           form.bien_id,
        proprietaire_id:   bienSelectionne.proprietaire_id,
        date:              form.date,
        libelle:           form.libelle,
        montant_ttc:       Math.round(parseFloat(form.montant_euros) * 100),
        mode_traitement:   form.mode_traitement,
        mode_encaissement: form.mode_encaissement,
        mois_facturation:  form.date.slice(0, 7),
        source:            'manuel',
      })
      setSuccess('Frais créé')
      setShowModal(false)
      setForm(FORM_EMPTY)
      await charger()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function changerStatutFrais(id, statut) {
    setError(null)
    try {
      await changerStatut(id, statut)
      setSuccess(`Statut mis à jour : ${STATUT_LABELS[statut]?.label}`)
      await charger()
    } catch (e) {
      setError(e.message)
    }
  }

  async function reinitialiserFrais(id) {
    if (!confirm('Réinitialiser ce frais en "à facturer" ?\nLa facture du mois devra être régénérée.')) return
    setError(null)
    try {
      await annulerFacturationFrais(id)
      setSuccess('Frais réinitialisé — relancez la génération de factures pour ce mois')
      await charger()
    } catch (e) {
      setError(e.message)
    }
  }

  const totalTTC = frais.reduce((s, f) => s + (f.montant_ttc || 0), 0)
  const nbAFacturer = frais.filter(f => f.statut === 'a_facturer').length

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Frais propriétaires</h1>
          <p className="page-subtitle">
            {frais.length} frais · {formatMontant(totalTTC)} TTC
            {nbAFacturer > 0 && <span style={{ color: '#B45309', marginLeft: 8 }}>· {nbAFacturer} à facturer</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <MoisSelector mois={mois} setMois={setMois} moisDispos={moisDispos} />
          <button className="btn btn-secondary" onClick={charger} disabled={loading}>↺</button>
          <button className="btn btn-primary" onClick={() => { setShowModal(true); setError(null) }}>
            + Ajouter un frais
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {loading && frais.length === 0 ? (
        <div className="loading-state"><span className="spinner" /> Chargement…</div>
      ) : !loading && frais.length === 0 ? (
        <div className="empty-state">Aucun frais pour ce mois.</div>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Bien</th>
                <th>Propriétaire</th>
                <th>Date</th>
                <th>Libellé</th>
                <th style={{ textAlign: 'right' }}>Montant TTC</th>
                <th style={{ textAlign: 'right' }}>Déduit LOY</th>
                <th style={{ textAlign: 'right' }}>Reliquat</th>
                <th>Mode</th>
                <th>Encaissement</th>
                <th>Résultat</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {frais.map(f => {
                const st  = STATUT_LABELS[f.statut] || {}
                const ded = f.statut === 'facture' ? (DEDUCTION_LABELS[f.statut_deduction] || DEDUCTION_LABELS.en_attente) : null
                const proprio = f.proprietaire
                  ? `${f.proprietaire.nom}${f.proprietaire.prenom ? ' ' + f.proprietaire.prenom : ''}`
                  : '—'
                return (
                  <tr key={f.id}>
                    <td>{f.bien?.code || '—'}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>{proprio}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{f.date}</td>
                    <td>{f.libelle}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatMontant(f.montant_ttc)}</td>
                    <td style={{ textAlign: 'right', color: '#059669', fontWeight: f.statut === 'facture' ? 600 : 400 }}>
                      {f.statut === 'facture' ? formatMontant(f.montant_deduit_loy) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', color: f.montant_reliquat > 0 ? '#DC2626' : 'var(--text-muted)', fontWeight: f.montant_reliquat > 0 ? 600 : 400 }}>
                      {f.statut === 'facture' ? (f.montant_reliquat > 0 ? formatMontant(f.montant_reliquat) : '—') : '—'}
                    </td>
                    <td style={{ fontSize: 12 }}>{MODES_TRAITEMENT[f.mode_traitement] || f.mode_traitement}</td>
                    <td style={{ fontSize: 12 }}>{MODES_ENCAISSEMENT[f.mode_encaissement] || f.mode_encaissement}</td>
                    <td>
                      {ded ? (
                        <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 12, fontWeight: 600, color: ded.color, background: ded.bg }}>
                          {ded.label}
                        </span>
                      ) : (
                        <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 12, fontWeight: 600, color: st.color, background: st.bg }}>
                          {st.label}
                        </span>
                      )}
                    </td>
                    <td style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {f.statut === 'brouillon' && (
                        <button className="btn btn-secondary" style={{ fontSize: 12, padding: '3px 8px' }}
                          onClick={() => changerStatutFrais(f.id, 'a_facturer')}>
                          ✓ À facturer
                        </button>
                      )}
                      {f.statut === 'a_facturer' && (
                        <button className="btn btn-secondary" style={{ fontSize: 12, padding: '3px 8px' }}
                          onClick={() => changerStatutFrais(f.id, 'brouillon')}>
                          ← Brouillon
                        </button>
                      )}
                      {f.statut === 'facture' && (
                        <button className="btn btn-secondary" style={{ fontSize: 12, padding: '3px 8px', color: '#B45309' }}
                          onClick={() => reinitialiserFrais(f.id)}
                          title="Réinitialiser pour retraitement — régénérer la facture ensuite">
                          ↺ Réinitialiser
                        </button>
                      )}
                      {(f.statut === 'brouillon' || f.statut === 'a_facturer') && (
                        <button className="btn btn-secondary" style={{ fontSize: 12, padding: '3px 8px' }}
                          onClick={() => ouvrirEdition(f)}>
                          ✏
                        </button>
                      )}
                      {(f.statut === 'brouillon' || f.statut === 'a_facturer') && (
                        <button className="btn btn-secondary" style={{ fontSize: 12, padding: '3px 8px', color: '#DC2626' }}
                          onClick={() => supprimerFraisHandler(f.id)}>
                          🗑
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal édition */}
      {editingFrais && (
        <div className="modal-overlay" onClick={() => setEditingFrais(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <h2>Modifier le frais</h2>
              <button className="modal-close" onClick={() => setEditingFrais(null)}>✗</button>
            </div>
            <form onSubmit={soumettreMod}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                <div>
                  <label className="form-label">Bien *</label>
                  <select className="form-select" value={formEdit.bien_id} required
                    onChange={e => setFormEdit(f => ({ ...f, bien_id: e.target.value }))}>
                    <option value="">— Sélectionner un bien —</option>
                    {biens.map(b => (
                      <option key={b.id} value={b.id}>{b.code} — {b.hospitable_name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="form-label">Propriétaire</label>
                  <input className="form-input" value={(() => {
                    const b = biens.find(x => x.id === formEdit.bien_id)
                    return b?.proprietaire ? `${b.proprietaire.nom}${b.proprietaire.prenom ? ' ' + b.proprietaire.prenom : ''}` : '—'
                  })()} readOnly
                    style={{ background: 'var(--header-bien)', color: 'var(--text-muted)', cursor: 'default' }} />
                </div>

                <div>
                  <label className="form-label">Date *</label>
                  <input className="form-input" type="date" required
                    value={formEdit.date}
                    onChange={e => setFormEdit(f => ({ ...f, date: e.target.value }))} />
                </div>

                <div>
                  <label className="form-label">Libellé *</label>
                  <input className="form-input" type="text" required
                    value={formEdit.libelle}
                    onChange={e => setFormEdit(f => ({ ...f, libelle: e.target.value }))} />
                </div>

                <div>
                  <label className="form-label">Mode de traitement</label>
                  <select className="form-select" value={formEdit.mode_traitement}
                    onChange={e => setFormEdit(f => ({ ...f, mode_traitement: e.target.value }))}>
                    <option value="deduire_loyer">Déduire du loyer</option>
                    <option value="facturer_direct">Refacturer au propriétaire</option>
                    <option value="remboursement">Remboursement (+ LOY)</option>
                  </select>
                </div>

                <div>
                  <label className="form-label">{formEdit.mode_traitement === 'remboursement' ? 'Montant (€) *' : 'Montant TTC (€) *'}</label>
                  <input className="form-input" type="number" min="0.01" step="0.01" required
                    value={formEdit.montant_euros}
                    onChange={e => setFormEdit(f => ({ ...f, montant_euros: e.target.value }))} />
                </div>

                {formEdit.mode_traitement !== 'remboursement' && (
                  <div>
                    <label className="form-label">Mode d'encaissement</label>
                    <select className="form-select" value={formEdit.mode_encaissement}
                      onChange={e => setFormEdit(f => ({ ...f, mode_encaissement: e.target.value }))}>
                      <option value="dcb">DCB a payé</option>
                      <option value="proprio">Propriétaire a payé</option>
                    </select>
                  </div>
                )}

                {error && <div className="alert alert-error">{error}</div>}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setEditingFrais(null)}>
                  Annuler
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <><span className="spinner" /> Enregistrement…</> : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal ajout */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <h2>Ajouter un frais</h2>
              <button className="modal-close" onClick={() => setShowModal(false)}>✗</button>
            </div>
            <form onSubmit={soumettre}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                <div>
                  <label className="form-label">Bien *</label>
                  <select className="form-select" value={form.bien_id} required
                    onChange={e => setForm(f => ({ ...f, bien_id: e.target.value }))}>
                    <option value="">— Sélectionner un bien —</option>
                    {biens.map(b => (
                      <option key={b.id} value={b.id}>{b.code} — {b.hospitable_name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="form-label">Propriétaire</label>
                  <input className="form-input" value={proprioLabel} readOnly
                    style={{ background: 'var(--header-bien)', color: 'var(--text-muted)', cursor: 'default' }} />
                </div>

                <div>
                  <label className="form-label">Date *</label>
                  <input className="form-input" type="date" required
                    value={form.date}
                    onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
                </div>

                <div>
                  <label className="form-label">Libellé *</label>
                  <input className="form-input" type="text" required placeholder="ex : Réparation chauffe-eau"
                    value={form.libelle}
                    onChange={e => setForm(f => ({ ...f, libelle: e.target.value }))} />
                </div>

                <div>
                  <label className="form-label">Mode de traitement</label>
                  <select className="form-select" value={form.mode_traitement}
                    onChange={e => setForm(f => ({ ...f, mode_traitement: e.target.value }))}>
                    <option value="deduire_loyer">Déduire du loyer</option>
                    <option value="facturer_direct">Refacturer au propriétaire</option>
                    <option value="remboursement">Remboursement (+ LOY)</option>
                  </select>
                </div>

                <div>
                  <label className="form-label">{form.mode_traitement === 'remboursement' ? 'Montant (€) *' : 'Montant TTC (€) *'}</label>
                  <input className="form-input" type="number" min="0.01" step="0.01" required placeholder="0.00"
                    value={form.montant_euros}
                    onChange={e => setForm(f => ({ ...f, montant_euros: e.target.value }))} />
                  {form.mode_traitement === 'remboursement' && (
                    <span style={{ fontSize: '0.8em', color: '#059669', marginTop: 4, display: 'block' }}>
                      ↑ Augmente le reversement propriétaire (HT, sans TVA)
                    </span>
                  )}
                </div>

                {form.mode_traitement !== 'remboursement' && (
                  <div>
                    <label className="form-label">Mode d'encaissement</label>
                    <select className="form-select" value={form.mode_encaissement}
                      onChange={e => setForm(f => ({ ...f, mode_encaissement: e.target.value }))}>
                      <option value="dcb">DCB a payé</option>
                      <option value="proprio">Propriétaire a payé</option>
                    </select>
                  </div>
                )}

                {error && <div className="alert alert-error">{error}</div>}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>
                  Annuler
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <><span className="spinner" /> Enregistrement…</> : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
