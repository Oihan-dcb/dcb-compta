import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import MoisSelector from '../components/MoisSelector'
import { formatMontant } from '../lib/hospitable'
import { creerFrais, changerStatut } from '../services/fraisProprietaire'

const moisCourant = new Date().toISOString().slice(0, 7)

const MODES_TRAITEMENT = {
  deduire_loyer:   'Déduire du loyer',
  facturer_direct: 'Refacturer au proprio',
}

const MODES_ENCAISSEMENT = {
  dcb:    'DCB a payé',
  proprio: 'Proprio a payé',
}

const STATUT_LABELS = {
  brouillon:   { label: 'Brouillon',       color: '#8C7B65', bg: '#F7F3EC' },
  a_facturer:  { label: 'À facturer',      color: '#B45309', bg: '#FFF7ED' },
  facture:     { label: 'Facturé',         color: '#059669', bg: '#D1FAE5' },
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
  const [mois, setMois] = useState(moisCourant)
  const [moisDispos, setMoisDispos] = useState([moisCourant])
  const [frais, setFrais] = useState([])
  const [biens, setBiens] = useState([])
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(FORM_EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  useEffect(() => { chargerBiens() }, [])
  useEffect(() => { charger() }, [mois])

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

      {loading ? (
        <div className="loading-state"><span className="spinner" /> Chargement…</div>
      ) : frais.length === 0 ? (
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
                <th>Mode</th>
                <th>Encaissement</th>
                <th>Statut</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {frais.map(f => {
                const st = STATUT_LABELS[f.statut] || {}
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
                    <td style={{ fontSize: 12 }}>{MODES_TRAITEMENT[f.mode_traitement] || f.mode_traitement}</td>
                    <td style={{ fontSize: 12 }}>{MODES_ENCAISSEMENT[f.mode_encaissement] || f.mode_encaissement}</td>
                    <td>
                      <span style={{
                        display: 'inline-block', padding: '2px 8px', borderRadius: 10,
                        fontSize: 12, fontWeight: 600,
                        color: st.color, background: st.bg,
                      }}>
                        {st.label}
                      </span>
                    </td>
                    <td>
                      {f.statut === 'brouillon' && (
                        <button className="btn btn-secondary" style={{ fontSize: 12, padding: '3px 8px' }}
                          onClick={() => changerStatutFrais(f.id, 'a_facturer')}>
                          Marquer à facturer
                        </button>
                      )}
                      {f.statut === 'a_facturer' && (
                        <button className="btn btn-secondary" style={{ fontSize: 12, padding: '3px 8px' }}
                          onClick={() => changerStatutFrais(f.id, 'brouillon')}>
                          Annuler
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
                  <label className="form-label">Montant TTC (€) *</label>
                  <input className="form-input" type="number" min="0.01" step="0.01" required placeholder="0.00"
                    value={form.montant_euros}
                    onChange={e => setForm(f => ({ ...f, montant_euros: e.target.value }))} />
                </div>

                <div>
                  <label className="form-label">Mode de traitement</label>
                  <select className="form-select" value={form.mode_traitement}
                    onChange={e => setForm(f => ({ ...f, mode_traitement: e.target.value }))}>
                    <option value="deduire_loyer">Déduire du loyer</option>
                    <option value="facturer_direct">Refacturer au propriétaire</option>
                  </select>
                </div>

                <div>
                  <label className="form-label">Mode d'encaissement</label>
                  <select className="form-select" value={form.mode_encaissement}
                    onChange={e => setForm(f => ({ ...f, mode_encaissement: e.target.value }))}>
                    <option value="dcb">DCB a payé</option>
                    <option value="proprio">Propriétaire a payé</option>
                  </select>
                </div>

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
