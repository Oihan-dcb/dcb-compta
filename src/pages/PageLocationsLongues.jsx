import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import MoisSelector from '../components/MoisSelector'
import { formatMontant } from '../lib/hospitable'
import { useMoisPersisted } from '../hooks/useMoisPersisted'
import {
  listerEtudiants,
  creerEtudiant,
  modifierEtudiant,
  montantTotalEtudiant,
  montantVirementProprio,
  listerLoyersMois,
  initialiserLoyersMois,
  marquerLoyerRecu,
  marquerLoyerStatut,
  listerVirementsMois,
  marquerVirementEffectue,
} from '../services/locationsLongues'

const moisCourant = new Date().toISOString().slice(0, 7)

const STATUT_LOYER = {
  attendu:  { label: 'Attendu',    color: '#B45309', bg: '#FFF7ED' },
  recu:     { label: 'Reçu ✓',    color: '#059669', bg: '#D1FAE5' },
  en_retard:{ label: 'En retard',  color: '#DC2626', bg: '#FEE2E2' },
  exonere:  { label: 'Exonéré',   color: '#6B7280', bg: '#F3F4F6' },
}

const STATUT_VIREMENT = {
  a_virer: { label: 'À virer',  color: '#B45309', bg: '#FFF7ED' },
  vire:    { label: 'Viré ✓',   color: '#059669', bg: '#D1FAE5' },
}

const STATUT_ETUDIANT = {
  actif:      { label: 'Actif',      color: '#059669', bg: '#D1FAE5' },
  en_attente: { label: 'En attente', color: '#B45309', bg: '#FFF7ED' },
  parti:      { label: 'Parti',      color: '#6B7280', bg: '#F3F4F6' },
}

const FORM_ETUDIANT_EMPTY = {
  nom: '', prenom: '', email: '', telephone: '',
  bien_id: '', proprietaire_id: '', adresse_complete: '',
  date_entree: new Date().toISOString().slice(0, 10),
  date_sortie_prevue: '',
  loyer_nu: '', supplement_loyer: '0', charges_eau: '0',
  charges_copro: '0', charges_internet: '0',
  honoraires_dcb: '', caution: '', jour_paiement_attendu: '5',
  statut: 'actif',
}

export default function PageLocationsLongues() {
  const [mois, setMois] = useMoisPersisted()
  const [onglet, setOnglet] = useState('mensuel') // 'mensuel' | 'etudiants'
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  // Vue mensuelle
  const [loyers, setLoyers] = useState([])
  const [virements, setVirements] = useState([])

  // Vue étudiants
  const [etudiants, setEtudiants] = useState([])
  const [biens, setBiens] = useState([])
  const [proprios, setProprios] = useState([])

  // Modal loyer reçu
  const [loyerModal, setLoyerModal] = useState(null)
  const [dateReception, setDateReception] = useState(new Date().toISOString().slice(0, 10))
  const [montantRecu, setMontantRecu] = useState('')

  // Modal étudiant
  const [showModalEtudiant, setShowModalEtudiant] = useState(false)
  const [editingEtudiant, setEditingEtudiant] = useState(null)
  const [formEtudiant, setFormEtudiant] = useState(FORM_ETUDIANT_EMPTY)
  const [saving, setSaving] = useState(false)

  useEffect(() => { chargerReferentiels() }, [])
  useEffect(() => { if (onglet === 'mensuel') chargerMensuel() }, [mois, onglet])
  useEffect(() => { if (onglet === 'etudiants') chargerEtudiants() }, [onglet])

  useEffect(() => {
    const channel = supabase.channel('lld-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'loyer_suivi' }, () => {
        if (onglet === 'mensuel') chargerMensuel()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'virement_proprio_suivi' }, () => {
        if (onglet === 'mensuel') chargerMensuel()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [onglet, mois])

  async function chargerReferentiels() {
    const [{ data: b }, { data: p }] = await Promise.all([
      supabase.from('bien').select('id, code, hospitable_name').eq('agence', 'dcb').eq('listed', true).order('code'),
      supabase.from('proprietaire').select('id, nom, prenom').eq('agence', 'dcb').order('nom'),
    ])
    setBiens(b || [])
    setProprios(p || [])
  }

  async function chargerMensuel() {
    setLoading(true)
    setError(null)
    try {
      const [l, v] = await Promise.all([
        listerLoyersMois(mois),
        listerVirementsMois(mois),
      ])
      setLoyers(l)
      setVirements(v)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function chargerEtudiants() {
    setLoading(true)
    setError(null)
    try {
      setEtudiants(await listerEtudiants('dcb'))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function initialiserMois() {
    setLoading(true)
    setError(null)
    try {
      const result = await initialiserLoyersMois(mois)
      setLoyers(result)
      const v = await listerVirementsMois(mois)
      setVirements(v)
      setSuccess(`Mois ${mois} initialisé — ${result.length} étudiant(s)`)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function soumettreReception(e) {
    e.preventDefault()
    if (!loyerModal) return
    setSaving(true)
    setError(null)
    try {
      await marquerLoyerRecu(loyerModal.id, {
        montant_recu:   Math.round(parseFloat(montantRecu) * 100),
        date_reception: dateReception,
      })
      setSuccess('Loyer marqué reçu')
      setLoyerModal(null)
      await chargerMensuel()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function changerStatutLoyer(id, statut) {
    setError(null)
    try {
      await marquerLoyerStatut(id, statut)
      await chargerMensuel()
    } catch (e) {
      setError(e.message)
    }
  }

  async function confirmerVirement(id) {
    const today = new Date().toISOString().slice(0, 10)
    setError(null)
    try {
      await marquerVirementEffectue(id, today)
      setSuccess('Virement marqué effectué')
      await chargerMensuel()
    } catch (e) {
      setError(e.message)
    }
  }

  function ouvrirModalEtudiant(etudiant = null) {
    if (etudiant) {
      setFormEtudiant({
        nom:                   etudiant.nom,
        prenom:                etudiant.prenom || '',
        email:                 etudiant.email || '',
        telephone:             etudiant.telephone || '',
        bien_id:               etudiant.bien_id || '',
        proprietaire_id:       etudiant.proprietaire_id || '',
        adresse_complete:      etudiant.adresse_complete || '',
        date_entree:           etudiant.date_entree,
        date_sortie_prevue:    etudiant.date_sortie_prevue || '',
        loyer_nu:              (etudiant.loyer_nu / 100).toFixed(2),
        supplement_loyer:      (etudiant.supplement_loyer / 100).toFixed(2),
        charges_eau:           (etudiant.charges_eau / 100).toFixed(2),
        charges_copro:         (etudiant.charges_copro / 100).toFixed(2),
        charges_internet:      (etudiant.charges_internet / 100).toFixed(2),
        honoraires_dcb:        (etudiant.honoraires_dcb / 100).toFixed(2),
        caution:               (etudiant.caution / 100).toFixed(2),
        jour_paiement_attendu: String(etudiant.jour_paiement_attendu),
        statut:                etudiant.statut,
      })
      setEditingEtudiant(etudiant)
    } else {
      setFormEtudiant(FORM_ETUDIANT_EMPTY)
      setEditingEtudiant(null)
    }
    setShowModalEtudiant(true)
    setError(null)
  }

  async function soumettreEtudiant(e) {
    e.preventDefault()
    if (!formEtudiant.nom || !formEtudiant.date_entree || !formEtudiant.loyer_nu || !formEtudiant.honoraires_dcb) {
      setError('Nom, date d\'entrée, loyer nu et honoraires DCB requis')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = {
        agence:                'dcb',
        nom:                   formEtudiant.nom.trim(),
        prenom:                formEtudiant.prenom.trim() || null,
        email:                 formEtudiant.email.trim() || null,
        telephone:             formEtudiant.telephone.trim() || null,
        bien_id:               formEtudiant.bien_id || null,
        proprietaire_id:       formEtudiant.proprietaire_id || null,
        adresse_complete:      formEtudiant.adresse_complete.trim() || null,
        date_entree:           formEtudiant.date_entree,
        date_sortie_prevue:    formEtudiant.date_sortie_prevue || null,
        loyer_nu:              Math.round(parseFloat(formEtudiant.loyer_nu) * 100),
        supplement_loyer:      Math.round(parseFloat(formEtudiant.supplement_loyer || '0') * 100),
        charges_eau:           Math.round(parseFloat(formEtudiant.charges_eau || '0') * 100),
        charges_copro:         Math.round(parseFloat(formEtudiant.charges_copro || '0') * 100),
        charges_internet:      Math.round(parseFloat(formEtudiant.charges_internet || '0') * 100),
        honoraires_dcb:        Math.round(parseFloat(formEtudiant.honoraires_dcb) * 100),
        caution:               Math.round(parseFloat(formEtudiant.caution || '0') * 100),
        jour_paiement_attendu: parseInt(formEtudiant.jour_paiement_attendu, 10),
        statut:                formEtudiant.statut,
      }
      if (editingEtudiant) {
        await modifierEtudiant(editingEtudiant.id, payload)
        setSuccess('Étudiant modifié')
      } else {
        await creerEtudiant(payload)
        setSuccess('Étudiant créé')
      }
      setShowModalEtudiant(false)
      await chargerEtudiants()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Calculs solde mensuel ──────────────────────────────────────────────
  const totalLoyers = loyers
    .filter(l => l.statut === 'recu')
    .reduce((s, l) => s + (l.montant_recu || 0), 0)
  const totalVirements = virements
    .filter(v => v.statut === 'vire')
    .reduce((s, v) => s + (v.montant || 0), 0)
  const solde = totalLoyers - totalVirements
  const nbLoyersAttendus  = loyers.filter(l => l.statut === 'attendu' || l.statut === 'en_retard').length
  const nbVirementsAFaire = virements.filter(v => v.statut === 'a_virer').length

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Locations longues durée</h1>
          <p className="page-subtitle">
            {onglet === 'mensuel'
              ? <>
                  {loyers.length} étudiant(s) · solde <strong style={{ color: solde === 0 ? '#059669' : '#DC2626' }}>{formatMontant(solde)}</strong>
                  {nbLoyersAttendus > 0 && <span style={{ color: '#DC2626', marginLeft: 8 }}>· {nbLoyersAttendus} loyer(s) en attente</span>}
                  {nbVirementsAFaire > 0 && <span style={{ color: '#B45309', marginLeft: 8 }}>· {nbVirementsAFaire} virement(s) à faire</span>}
                </>
              : <>{etudiants.length} étudiant(s) enregistré(s)</>
            }
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {onglet === 'mensuel' && (
            <>
              <MoisSelector mois={mois} setMois={setMois} moisDispos={[moisCourant]} />
              <button className="btn btn-secondary" onClick={chargerMensuel} disabled={loading}>↺</button>
              {loyers.length === 0 && (
                <button className="btn btn-primary" onClick={initialiserMois} disabled={loading}>
                  Initialiser le mois
                </button>
              )}
            </>
          )}
          {onglet === 'etudiants' && (
            <button className="btn btn-primary" onClick={() => ouvrirModalEtudiant()}>
              + Ajouter un étudiant
            </button>
          )}
        </div>
      </div>

      {/* Onglets */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '2px solid var(--border)' }}>
        {[['mensuel', 'Mensuel'], ['etudiants', 'Étudiants']].map(([key, label]) => (
          <button key={key} onClick={() => setOnglet(key)}
            style={{
              padding: '8px 18px', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600,
              background: 'none', borderBottom: onglet === key ? '2px solid var(--brand)' : '2px solid transparent',
              color: onglet === key ? 'var(--brand)' : 'var(--text-muted)',
              marginBottom: -2,
            }}>
            {label}
          </button>
        ))}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {loading && <div className="loading-state"><span className="spinner" /> Chargement…</div>}

      {/* ── Vue mensuelle ── */}
      {!loading && onglet === 'mensuel' && (
        <>
          {loyers.length === 0 ? (
            <div className="empty-state">
              Aucune donnée pour {mois}.<br />
              <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={initialiserMois}>
                Initialiser le mois
              </button>
            </div>
          ) : (
            <>
              {/* Tableau loyers */}
              <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', margin: '0 0 10px' }}>
                Loyers
              </h2>
              <div className="table-container" style={{ marginBottom: 28 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Étudiant</th>
                      <th>Bien</th>
                      <th style={{ textAlign: 'right' }}>Attendu</th>
                      <th>Statut</th>
                      <th>Date réception</th>
                      <th style={{ textAlign: 'right' }}>Reçu</th>
                      <th>Quittance</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {loyers.map(l => {
                      const e = l.etudiant
                      const total = e ? montantTotalEtudiant(e) : 0
                      const st = STATUT_LOYER[l.statut] || {}
                      const ecart = l.montant_recu && l.montant_recu !== total
                      return (
                        <tr key={l.id}>
                          <td style={{ fontWeight: 600 }}>
                            {e ? `${e.nom}${e.prenom ? ' ' + e.prenom : ''}` : '—'}
                          </td>
                          <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                            {e?.bien?.code || '—'}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>
                            {formatMontant(total)}
                          </td>
                          <td>
                            <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 12, fontWeight: 600, color: st.color, background: st.bg }}>
                              {st.label}
                            </span>
                          </td>
                          <td style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                            {l.date_reception || '—'}
                          </td>
                          <td style={{ textAlign: 'right', color: ecart ? '#DC2626' : undefined, fontWeight: ecart ? 700 : 400 }}>
                            {l.montant_recu ? formatMontant(l.montant_recu) : '—'}
                            {ecart && <span style={{ fontSize: 11, marginLeft: 4 }}>⚠</span>}
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {l.quittance_envoyee_at
                              ? <span style={{ color: '#059669' }}>✓ {l.quittance_envoyee_at.slice(0, 10)}</span>
                              : '—'}
                          </td>
                          <td style={{ display: 'flex', gap: 4 }}>
                            {l.statut !== 'recu' && l.statut !== 'exonere' && (
                              <button className="btn btn-secondary" style={{ fontSize: 12, padding: '3px 8px', color: '#059669' }}
                                onClick={() => {
                                  setLoyerModal(l)
                                  setMontantRecu(e ? (montantTotalEtudiant(e) / 100).toFixed(2) : '')
                                  setDateReception(new Date().toISOString().slice(0, 10))
                                }}>
                                ✓ Reçu
                              </button>
                            )}
                            {l.statut === 'attendu' && (
                              <button className="btn btn-secondary" style={{ fontSize: 12, padding: '3px 8px', color: '#DC2626' }}
                                onClick={() => changerStatutLoyer(l.id, 'en_retard')}>
                                ⚠ Retard
                              </button>
                            )}
                            {l.statut === 'recu' && (
                              <button className="btn btn-secondary" style={{ fontSize: 12, padding: '3px 8px', color: '#6B7280' }}
                                onClick={() => changerStatutLoyer(l.id, 'attendu')}>
                                ← Annuler
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Tableau virements proprio */}
              <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', margin: '0 0 10px' }}>
                Virements propriétaires
              </h2>
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Étudiant</th>
                      <th>Propriétaire</th>
                      <th style={{ textAlign: 'right' }}>Montant</th>
                      <th>Statut</th>
                      <th>Date virement</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {virements.map(v => {
                      const e = v.etudiant
                      const st = STATUT_VIREMENT[v.statut] || {}
                      const proprio = e?.proprietaire
                        ? `${e.proprietaire.nom}${e.proprietaire.prenom ? ' ' + e.proprietaire.prenom : ''}`
                        : '—'
                      return (
                        <tr key={v.id}>
                          <td style={{ fontWeight: 600 }}>
                            {e ? `${e.nom}${e.prenom ? ' ' + e.prenom : ''}` : '—'}
                          </td>
                          <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>{proprio}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatMontant(v.montant)}</td>
                          <td>
                            <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 12, fontWeight: 600, color: st.color, background: st.bg }}>
                              {st.label}
                            </span>
                          </td>
                          <td style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                            {v.date_virement || '—'}
                          </td>
                          <td>
                            {v.statut === 'a_virer' && (
                              <button className="btn btn-secondary" style={{ fontSize: 12, padding: '3px 8px', color: '#059669' }}
                                onClick={() => confirmerVirement(v.id)}>
                                ✓ Viré
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Solde */}
              <div style={{ marginTop: 20, padding: '12px 18px', background: solde === 0 ? '#D1FAE5' : '#FEE2E2', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontWeight: 700, color: solde === 0 ? '#059669' : '#DC2626' }}>
                  Solde du mois : {formatMontant(solde)}
                </span>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  (loyers reçus {formatMontant(totalLoyers)} − virements effectués {formatMontant(totalVirements)})
                </span>
                {solde === 0 && <span style={{ color: '#059669', fontWeight: 700 }}>✓ Équilibré</span>}
              </div>
            </>
          )}
        </>
      )}

      {/* ── Vue étudiants ── */}
      {!loading && onglet === 'etudiants' && (
        <>
          {etudiants.length === 0 ? (
            <div className="empty-state">
              Aucun étudiant enregistré.
              <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => ouvrirModalEtudiant()}>
                + Ajouter un étudiant
              </button>
            </div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Étudiant</th>
                    <th>Bien</th>
                    <th>Entrée</th>
                    <th>Sortie prévue</th>
                    <th style={{ textAlign: 'right' }}>Total / mois</th>
                    <th style={{ textAlign: 'right' }}>Verso proprio</th>
                    <th style={{ textAlign: 'right' }}>Honoraires DCB</th>
                    <th style={{ textAlign: 'right' }}>Caution</th>
                    <th>Statut</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {etudiants.map(e => {
                    const total  = montantTotalEtudiant(e)
                    const verso  = montantVirementProprio(e)
                    const st     = STATUT_ETUDIANT[e.statut] || {}
                    return (
                      <tr key={e.id}>
                        <td style={{ fontWeight: 600 }}>
                          {e.nom}{e.prenom ? ' ' + e.prenom : ''}
                          {e.email && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>{e.email}</div>}
                        </td>
                        <td style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                          {e.bien?.code || '—'}
                        </td>
                        <td style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{e.date_entree}</td>
                        <td style={{ fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {e.date_sortie_prevue || '—'}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatMontant(total)}</td>
                        <td style={{ textAlign: 'right', color: '#059669' }}>{formatMontant(verso)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--brand)' }}>{formatMontant(e.honoraires_dcb)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{formatMontant(e.caution)}</td>
                        <td>
                          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 12, fontWeight: 600, color: st.color, background: st.bg }}>
                            {st.label}
                          </span>
                        </td>
                        <td>
                          <button className="btn btn-secondary" style={{ fontSize: 12, padding: '3px 8px' }}
                            onClick={() => ouvrirModalEtudiant(e)}>
                            ✏
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Modal loyer reçu */}
      {loyerModal && (
        <div className="modal-overlay" onClick={() => setLoyerModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h2>Loyer reçu</h2>
              <button className="modal-close" onClick={() => setLoyerModal(null)}>✗</button>
            </div>
            <form onSubmit={soumettreReception}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label className="form-label">Date de réception *</label>
                  <input className="form-input" type="date" required
                    value={dateReception}
                    onChange={e => setDateReception(e.target.value)} />
                </div>
                <div>
                  <label className="form-label">Montant reçu (€) *</label>
                  <input className="form-input" type="number" min="0.01" step="0.01" required
                    value={montantRecu}
                    onChange={e => setMontantRecu(e.target.value)} />
                </div>
                {error && <div className="alert alert-error">{error}</div>}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setLoyerModal(null)}>Annuler</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <><span className="spinner" /> Enregistrement…</> : 'Confirmer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal étudiant (ajout / édition) */}
      {showModalEtudiant && (
        <div className="modal-overlay" onClick={() => setShowModalEtudiant(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="modal-header">
              <h2>{editingEtudiant ? 'Modifier l\'étudiant' : 'Ajouter un étudiant'}</h2>
              <button className="modal-close" onClick={() => setShowModalEtudiant(false)}>✗</button>
            </div>
            <form onSubmit={soumettreEtudiant}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label className="form-label">Nom *</label>
                    <input className="form-input" type="text" required
                      value={formEtudiant.nom}
                      onChange={e => setFormEtudiant(f => ({ ...f, nom: e.target.value }))} />
                  </div>
                  <div>
                    <label className="form-label">Prénom</label>
                    <input className="form-input" type="text"
                      value={formEtudiant.prenom}
                      onChange={e => setFormEtudiant(f => ({ ...f, prenom: e.target.value }))} />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label className="form-label">Email</label>
                    <input className="form-input" type="email"
                      value={formEtudiant.email}
                      onChange={e => setFormEtudiant(f => ({ ...f, email: e.target.value }))} />
                  </div>
                  <div>
                    <label className="form-label">Téléphone</label>
                    <input className="form-input" type="tel"
                      value={formEtudiant.telephone}
                      onChange={e => setFormEtudiant(f => ({ ...f, telephone: e.target.value }))} />
                  </div>
                </div>

                <div>
                  <label className="form-label">Bien</label>
                  <select className="form-select"
                    value={formEtudiant.bien_id}
                    onChange={e => setFormEtudiant(f => ({ ...f, bien_id: e.target.value }))}>
                    <option value="">— Sélectionner un bien —</option>
                    {biens.map(b => (
                      <option key={b.id} value={b.id}>{b.code} — {b.hospitable_name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="form-label">Propriétaire</label>
                  <select className="form-select"
                    value={formEtudiant.proprietaire_id}
                    onChange={e => setFormEtudiant(f => ({ ...f, proprietaire_id: e.target.value }))}>
                    <option value="">— Sélectionner un propriétaire —</option>
                    {proprios.map(p => (
                      <option key={p.id} value={p.id}>{p.nom}{p.prenom ? ' ' + p.prenom : ''}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="form-label">Adresse complète du logement (pour quittances)</label>
                  <input className="form-input" type="text" placeholder="ex : 3 rue du Port, 64200 Biarritz"
                    value={formEtudiant.adresse_complete}
                    onChange={e => setFormEtudiant(f => ({ ...f, adresse_complete: e.target.value }))} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <div>
                    <label className="form-label">Date d'entrée *</label>
                    <input className="form-input" type="date" required
                      value={formEtudiant.date_entree}
                      onChange={e => setFormEtudiant(f => ({ ...f, date_entree: e.target.value }))} />
                  </div>
                  <div>
                    <label className="form-label">Sortie prévue</label>
                    <input className="form-input" type="date"
                      value={formEtudiant.date_sortie_prevue}
                      onChange={e => setFormEtudiant(f => ({ ...f, date_sortie_prevue: e.target.value }))} />
                  </div>
                  <div>
                    <label className="form-label">Jour paiement</label>
                    <input className="form-input" type="number" min="1" max="28"
                      value={formEtudiant.jour_paiement_attendu}
                      onChange={e => setFormEtudiant(f => ({ ...f, jour_paiement_attendu: e.target.value }))} />
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10 }}>
                    Montants mensuels (€) — fixes à la création
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                    <div>
                      <label className="form-label">Loyer nu * (CC)</label>
                      <input className="form-input" type="number" min="0" step="0.01" required
                        value={formEtudiant.loyer_nu}
                        onChange={e => setFormEtudiant(f => ({ ...f, loyer_nu: e.target.value }))} />
                    </div>
                    <div>
                      <label className="form-label">Supplément</label>
                      <input className="form-input" type="number" min="0" step="0.01"
                        value={formEtudiant.supplement_loyer}
                        onChange={e => setFormEtudiant(f => ({ ...f, supplement_loyer: e.target.value }))} />
                    </div>
                    <div>
                      <label className="form-label">Charges eau</label>
                      <input className="form-input" type="number" min="0" step="0.01"
                        value={formEtudiant.charges_eau}
                        onChange={e => setFormEtudiant(f => ({ ...f, charges_eau: e.target.value }))} />
                    </div>
                    <div>
                      <label className="form-label">Charges copro</label>
                      <input className="form-input" type="number" min="0" step="0.01"
                        value={formEtudiant.charges_copro}
                        onChange={e => setFormEtudiant(f => ({ ...f, charges_copro: e.target.value }))} />
                    </div>
                    <div>
                      <label className="form-label">Internet</label>
                      <input className="form-input" type="number" min="0" step="0.01"
                        value={formEtudiant.charges_internet}
                        onChange={e => setFormEtudiant(f => ({ ...f, charges_internet: e.target.value }))} />
                    </div>
                    <div>
                      <label className="form-label">Honoraires DCB *</label>
                      <input className="form-input" type="number" min="0" step="0.01" required
                        value={formEtudiant.honoraires_dcb}
                        onChange={e => setFormEtudiant(f => ({ ...f, honoraires_dcb: e.target.value }))} />
                    </div>
                  </div>

                  {/* Récap calculé */}
                  {formEtudiant.loyer_nu && formEtudiant.honoraires_dcb && (() => {
                    const total = (parseFloat(formEtudiant.loyer_nu) || 0) +
                                  (parseFloat(formEtudiant.supplement_loyer) || 0) +
                                  (parseFloat(formEtudiant.charges_eau) || 0) +
                                  (parseFloat(formEtudiant.charges_copro) || 0) +
                                  (parseFloat(formEtudiant.charges_internet) || 0)
                    const verso = total - (parseFloat(formEtudiant.honoraires_dcb) || 0)
                    return (
                      <div style={{ marginTop: 10, padding: '8px 12px', background: 'var(--bg)', borderRadius: 8, fontSize: 13, display: 'flex', gap: 20 }}>
                        <span>Total étudiant : <strong>{total.toFixed(2)} €</strong></span>
                        <span style={{ color: '#059669' }}>Verso proprio : <strong>{verso.toFixed(2)} €</strong></span>
                        <span style={{ color: 'var(--brand)' }}>DCB : <strong>{parseFloat(formEtudiant.honoraires_dcb).toFixed(2)} €</strong></span>
                      </div>
                    )
                  })()}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label className="form-label">Caution (€)</label>
                    <input className="form-input" type="number" min="0" step="0.01"
                      value={formEtudiant.caution}
                      onChange={e => setFormEtudiant(f => ({ ...f, caution: e.target.value }))} />
                  </div>
                  <div>
                    <label className="form-label">Statut</label>
                    <select className="form-select"
                      value={formEtudiant.statut}
                      onChange={e => setFormEtudiant(f => ({ ...f, statut: e.target.value }))}>
                      <option value="actif">Actif</option>
                      <option value="en_attente">En attente</option>
                      <option value="parti">Parti</option>
                    </select>
                  </div>
                </div>

                {error && <div className="alert alert-error">{error}</div>}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModalEtudiant(false)}>Annuler</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <><span className="spinner" /> Enregistrement…</> : (editingEtudiant ? 'Enregistrer' : 'Créer')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
