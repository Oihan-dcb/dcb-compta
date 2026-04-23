import { useState, useEffect } from 'react'
import { AGENCE } from '../lib/agence'
import {
  getProprietairesComplets,
  updateProprietaire,
  creerMandat,
  updateMandat,
  supprimerMandat,
} from '../services/mandats'
import { syncProprietairesEvoliz } from '../services/syncProprietaires'
import { buildRapportData } from '../services/buildRapportData'
import { supabase } from '../lib/supabase'

const TYPE_LABELS = {
  particulier: 'Particulier',
  sci:         'SCI',
  societe:     'Société',
  indivision:  'Indivision',
}

const MANDAT_STATUT_LABELS = {
  actif:             'Actif',
  resilie:           'Résilié',
  en_renouvellement: 'En renouvellement',
}

function badgeStatutMandat(statut) {
  const colors = {
    actif:             { bg: '#d1fae5', color: '#065f46' },
    resilie:           { bg: '#fee2e2', color: '#991b1b' },
    en_renouvellement: { bg: '#fef3c7', color: '#92400e' },
  }
  const c = colors[statut] || { bg: '#f3f4f6', color: '#6b7280' }
  return (
    <span className="badge" style={{ background: c.bg, color: c.color }}>
      {MANDAT_STATUT_LABELS[statut] || statut}
    </span>
  )
}

// ── Modale fiche proprio ───────────────────────────────────────────────────────

function ModalFiche({ proprio, onClose, onSaved }) {
  const [tab, setTab] = useState('identite')
  const [form, setForm] = useState({
    nom:            proprio.nom || '',
    prenom:         proprio.prenom || '',
    type_proprio:   proprio.type_proprio || 'particulier',
    email:          proprio.email || '',
    telephone:      proprio.telephone || '',
    adresse:        proprio.adresse || '',
    code_postal:    proprio.code_postal || '',
    ville:          proprio.ville || '',
    pays:           proprio.pays || 'France',
    iban:           proprio.iban || '',
    bic:            proprio.bic || '',
    taux_commission: proprio.taux_commission != null ? String(proprio.taux_commission) : '',
    actif:          proprio.actif !== false,
    notes:          proprio.notes || '',
  })
  const [saving, setSaving]   = useState(false)
  const [err, setErr]         = useState(null)
  const [ok, setOk]           = useState(false)
  const [syncing, setSyncing] = useState(false)

  async function syncDepuisEvoliz() {
    if (!proprio.id_evoliz) return
    setSyncing(true); setErr(null)
    try {
      // Appel direct getClient (plus rapide que full sync, et inclut l'email)
      const { data: resp, error: fnErr } = await supabase.functions.invoke('evoliz-proxy', {
        body: {
          action: 'getClient',
          companyId: parseInt(import.meta.env.VITE_EVOLIZ_COMPANY_ID || '114158'),
          payload: { clientId: proprio.id_evoliz },
        },
      })
      if (fnErr) throw new Error(fnErr.message)
      const c = resp?.data

      // L'email peut être direct (c.email) ou dans les contacts (c.contacts[].email)
      const emailDirect = (c?.email || '').trim() || null
      const emailContact = c?.contacts?.find(ct => ct.email)?.email?.trim() || null
      const email = emailDirect || emailContact

      const addr = c?.address || {}
      const tel = (c?.mobile || c?.phone || '').trim() || null

      const payload = {
        email:       email,
        telephone:   tel || null,
        adresse:     addr.addr || null,
        code_postal: addr.postcode || null,
        ville:       addr.town || null,
        pays:        addr.country?.label || 'France',
      }
      // Ne mettre à jour que les champs non-nuls retournés par Evoliz
      const toUpdate = Object.fromEntries(Object.entries(payload).filter(([, v]) => v != null))
      if (Object.keys(toUpdate).length > 0) {
        await supabase.from('proprietaire').update(toUpdate).eq('id', proprio.id)
      }

      setForm(f => ({ ...f, ...toUpdate }))
      onSaved({ ...proprio, ...toUpdate })
      setOk(true); setTimeout(() => setOk(false), 2000)
    } catch (e) { setErr(e.message) }
    finally { setSyncing(false) }
  }

  // Mandats
  const [mandats, setMandats]       = useState(proprio.mandat_gestion || [])
  const [mandatForm, setMandatForm] = useState(null) // null = fermé, {} = nouveau, {id} = édition
  const [savingMandat, setSavingMandat] = useState(false)
  const [mandatErr, setMandatErr]   = useState(null)

  const biens = (proprio.bien || []).filter(b => b.agence === AGENCE)

  async function sauvegarder() {
    setSaving(true); setErr(null); setOk(false)
    try {
      const payload = {
        nom:            form.nom.trim(),
        prenom:         form.prenom.trim() || null,
        type_proprio:   form.type_proprio,
        email:          form.email.trim() || null,
        telephone:      form.telephone.trim() || null,
        adresse:        form.adresse.trim() || null,
        code_postal:    form.code_postal.trim() || null,
        ville:          form.ville.trim() || null,
        pays:           form.pays.trim() || 'France',
        iban:           form.iban.trim() || null,
        bic:            form.bic.trim() || null,
        taux_commission: form.taux_commission !== '' ? parseFloat(form.taux_commission) : null,
        actif:          form.actif,
        notes:          form.notes.trim() || null,
      }
      await updateProprietaire(proprio.id, payload)
      setOk(true)
      onSaved({ ...proprio, ...payload })
      setTimeout(() => setOk(false), 2000)
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  async function soumettreMandat(mf) {
    setSavingMandat(true); setMandatErr(null)
    try {
      const payload = {
        proprietaire_id: proprio.id,
        numero:          mf.numero?.trim() || null,
        date_signature:  mf.date_signature || null,
        date_echeance:   mf.date_echeance || null,
        type:            mf.type || 'gestion_locative',
        taux_commission: mf.taux_commission !== '' && mf.taux_commission != null
                           ? parseFloat(mf.taux_commission) : null,
        conditions:      mf.conditions?.trim() || null,
        statut:          mf.statut || 'actif',
      }
      if (mf.id) {
        await updateMandat(mf.id, payload)
        setMandats(prev => prev.map(m => m.id === mf.id ? { ...m, ...payload, id: mf.id } : m))
      } else {
        const created = await creerMandat(payload)
        setMandats(prev => [...prev, created])
      }
      setMandatForm(null)
    } catch (e) { setMandatErr(e.message) }
    finally { setSavingMandat(false) }
  }

  async function effacerMandat(id) {
    if (!confirm('Supprimer ce mandat ?')) return
    await supprimerMandat(id)
    setMandats(prev => prev.filter(m => m.id !== id))
  }

  const tabs = [
    { id: 'identite', label: 'Identité' },
    { id: 'bancaire', label: 'Bancaire' },
    { id: 'mandats',  label: `Mandats (${mandats.length})` },
    { id: 'biens',    label: `Biens (${biens.length})` },
  ]

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 740 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 style={{ margin: 0 }}>{form.nom} {form.prenom}</h2>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {TYPE_LABELS[form.type_proprio] || form.type_proprio}
              {proprio.id_evoliz && ` · Evoliz #${proprio.id_evoliz}`}
            </span>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Onglets */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', padding: '0 24px' }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer',
                fontWeight: tab === t.id ? 700 : 400,
                color: tab === t.id ? 'var(--brand)' : 'var(--text-muted)',
                borderBottom: tab === t.id ? '2px solid var(--brand)' : '2px solid transparent',
                fontSize: 13, marginBottom: -1 }}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="modal-body">
          {err && <div className="alert alert-error" style={{ marginBottom: 12 }}>✗ {err}</div>}
          {ok  && <div className="alert alert-success" style={{ marginBottom: 12 }}>✓ Sauvegardé</div>}

          {/* ── Identité ── */}
          {tab === 'identite' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {proprio.id_evoliz && (
                <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--brand-pale)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Lié Evoliz #{proprio.id_evoliz} — email, téléphone et adresse sont synchronisés depuis Evoliz
                  </span>
                  <button className="btn btn-secondary btn-sm" disabled={syncing} onClick={syncDepuisEvoliz}>
                    {syncing ? '⏳ Sync…' : '⟳ Rafraîchir depuis Evoliz'}
                  </button>
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Nom *</label>
                <input className="form-input" value={form.nom} onChange={e => setForm(f => ({ ...f, nom: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Prénom</label>
                <input className="form-input" value={form.prenom} onChange={e => setForm(f => ({ ...f, prenom: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Type</label>
                <select className="form-select" value={form.type_proprio} onChange={e => setForm(f => ({ ...f, type_proprio: e.target.value }))}>
                  {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="form-input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Téléphone</label>
                <input className="form-input" value={form.telephone} onChange={e => setForm(f => ({ ...f, telephone: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Taux commission (%)</label>
                <input className="form-input" type="number" step="0.1" min="0" max="100"
                  value={form.taux_commission}
                  onChange={e => setForm(f => ({ ...f, taux_commission: e.target.value }))} />
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">Adresse</label>
                <input className="form-input" value={form.adresse} onChange={e => setForm(f => ({ ...f, adresse: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Code postal</label>
                <input className="form-input" value={form.code_postal} onChange={e => setForm(f => ({ ...f, code_postal: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Ville</label>
                <input className="form-input" value={form.ville} onChange={e => setForm(f => ({ ...f, ville: e.target.value }))} />
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">Notes internes</label>
                <textarea className="form-input" rows={3} value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  style={{ resize: 'vertical' }} />
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.actif} onChange={e => setForm(f => ({ ...f, actif: e.target.checked }))} />
                  <span style={{ fontSize: 13 }}>Propriétaire actif</span>
                </label>
              </div>
            </div>
          )}

          {/* ── Bancaire ── */}
          {tab === 'bancaire' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="alert alert-info" style={{ fontSize: 12 }}>
                Ces coordonnées sont utilisées pour la génération des virements SCT propriétaires (exports SEPA).
              </div>
              <div className="form-group">
                <label className="form-label">IBAN</label>
                <input className="form-input" value={form.iban}
                  onChange={e => setForm(f => ({ ...f, iban: e.target.value.replace(/\s/g, '').toUpperCase() }))}
                  placeholder="FR76XXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                  style={{ fontFamily: 'monospace', letterSpacing: '0.05em' }} />
                {form.iban && !/^[A-Z]{2}\d{2}[A-Z0-9]{1,30}$/.test(form.iban) && (
                  <p style={{ color: '#dc2626', fontSize: 11, marginTop: 4 }}>Format IBAN invalide</p>
                )}
              </div>
              <div className="form-group">
                <label className="form-label">BIC <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optionnel pour virements SEPA intra-UE)</span></label>
                <input className="form-input" value={form.bic}
                  onChange={e => setForm(f => ({ ...f, bic: e.target.value.toUpperCase() }))}
                  placeholder="CCBPFRPPXXX"
                  style={{ fontFamily: 'monospace', maxWidth: 200 }} />
              </div>
              {proprio.id_evoliz && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  Lien Evoliz : client #{proprio.id_evoliz} — les coordonnées bancaires ne sont pas synchronisées vers Evoliz.
                </div>
              )}
            </div>
          )}

          {/* ── Mandats ── */}
          {tab === 'mandats' && (
            <div>
              {mandatErr && <div className="alert alert-error" style={{ marginBottom: 12 }}>✗ {mandatErr}</div>}

              {mandats.length === 0 && !mandatForm && (
                <div className="empty-state" style={{ padding: 32 }}>
                  <div className="empty-state-title">Aucun mandat</div>
                  <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Ajoutez le mandat de gestion signé avec ce propriétaire.</p>
                </div>
              )}

              {mandats.map(m => (
                <div key={m.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>
                          {m.numero ? `Mandat n° ${m.numero}` : 'Mandat sans numéro'}
                        </span>
                        {badgeStatutMandat(m.statut)}
                        <span className="badge badge-neutral">{m.type === 'gestion_locative' ? 'Gestion locative' : 'Location simple'}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 16 }}>
                        {m.date_signature && <span>Signé le {new Date(m.date_signature).toLocaleDateString('fr-FR')}</span>}
                        {m.date_echeance  && <span>Échéance {new Date(m.date_echeance).toLocaleDateString('fr-FR')}</span>}
                        {m.taux_commission != null && <span>Taux : {Number(m.taux_commission).toFixed(1)}%</span>}
                      </div>
                      {m.conditions && (
                        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, whiteSpace: 'pre-wrap' }}>{m.conditions}</p>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-secondary btn-sm"
                        onClick={() => setMandatForm({ ...m, taux_commission: m.taux_commission != null ? String(m.taux_commission) : '' })}>
                        Modifier
                      </button>
                      <button className="btn btn-sm" style={{ background: '#fee2e2', color: '#991b1b', border: 'none' }}
                        onClick={() => effacerMandat(m.id)}>
                        Suppr.
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {/* Formulaire mandat */}
              {mandatForm ? (
                <div style={{ border: '1px solid var(--brand)', borderRadius: 8, padding: 16, marginTop: 12, background: 'var(--brand-pale)' }}>
                  <h4 style={{ margin: '0 0 12px', fontSize: 14 }}>{mandatForm.id ? 'Modifier le mandat' : 'Nouveau mandat'}</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div className="form-group">
                      <label className="form-label">N° mandat</label>
                      <input className="form-input" value={mandatForm.numero || ''} placeholder="ex: 2025-33"
                        onChange={e => setMandatForm(f => ({ ...f, numero: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Type</label>
                      <select className="form-select" value={mandatForm.type || 'gestion_locative'}
                        onChange={e => setMandatForm(f => ({ ...f, type: e.target.value }))}>
                        <option value="gestion_locative">Gestion locative</option>
                        <option value="location_simple">Location simple</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Date de signature</label>
                      <input className="form-input" type="date" value={mandatForm.date_signature || ''}
                        onChange={e => setMandatForm(f => ({ ...f, date_signature: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Date d'échéance</label>
                      <input className="form-input" type="date" value={mandatForm.date_echeance || ''}
                        onChange={e => setMandatForm(f => ({ ...f, date_echeance: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Taux commission (%)</label>
                      <input className="form-input" type="number" step="0.1" min="0" max="100"
                        value={mandatForm.taux_commission ?? ''}
                        onChange={e => setMandatForm(f => ({ ...f, taux_commission: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Statut</label>
                      <select className="form-select" value={mandatForm.statut || 'actif'}
                        onChange={e => setMandatForm(f => ({ ...f, statut: e.target.value }))}>
                        <option value="actif">Actif</option>
                        <option value="en_renouvellement">En renouvellement</option>
                        <option value="resilie">Résilié</option>
                      </select>
                    </div>
                    <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                      <label className="form-label">Conditions particulières</label>
                      <textarea className="form-input" rows={3} value={mandatForm.conditions || ''}
                        onChange={e => setMandatForm(f => ({ ...f, conditions: e.target.value }))}
                        style={{ resize: 'vertical' }} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => { setMandatForm(null); setMandatErr(null) }}>
                      Annuler
                    </button>
                    <button className="btn btn-primary btn-sm" disabled={savingMandat}
                      onClick={() => soumettreMandat(mandatForm)}>
                      {savingMandat ? 'Enregistrement…' : 'Enregistrer'}
                    </button>
                  </div>
                </div>
              ) : (
                <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }}
                  onClick={() => setMandatForm({ type: 'gestion_locative', statut: 'actif' })}>
                  + Ajouter un mandat
                </button>
              )}
            </div>
          )}

          {/* ── Biens gérés ── */}
          {tab === 'biens' && (
            <div>
              {biens.length === 0 ? (
                <div className="empty-state" style={{ padding: 32 }}>
                  <div className="empty-state-title">Aucun bien associé</div>
                  <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    Assignez ce propriétaire à ses biens depuis l'onglet Biens.
                  </p>
                </div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Nom Hospitable</th>
                      <th>Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {biens.map(b => (
                      <tr key={b.id}>
                        <td><span className="badge badge-info">{b.code}</span></td>
                        <td style={{ fontSize: 13 }}>{b.hospitable_name || '—'}</td>
                        <td>
                          {b.listed
                            ? <span className="badge badge-success">Actif</span>
                            : <span className="badge badge-neutral">Inactif</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

        {/* Footer — sauvegarde seulement pour identité + bancaire */}
        {(tab === 'identite' || tab === 'bancaire') && (
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={onClose}>Fermer</button>
            <button className="btn btn-primary" disabled={saving} onClick={sauvegarder}>
              {saving ? 'Enregistrement…' : 'Sauvegarder'}
            </button>
          </div>
        )}
        {(tab === 'mandats' || tab === 'biens') && (
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={onClose}>Fermer</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Modal prévisionnel ────────────────────────────────────────────────────────

const MOIS_FR = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre']
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

function fmtEur(centimes) {
  return ((centimes || 0) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

function moisLabel(mois) {
  const [y, m] = mois.split('-')
  return MOIS_FR[parseInt(m) - 1] + ' ' + y
}

function addMois(mois, n) {
  let [y, m] = mois.split('-').map(Number)
  m += n
  while (m > 12) { m -= 12; y++ }
  return `${y}-${String(m).padStart(2, '0')}`
}

function raisonZero(r) {
  const net = r.vir > 0 ? r.vir : r.loy
  if (net > 0) return null
  if ((r.base_comm || 0) === 0) return 'Montants Hospitable non disponibles'
  if (r.isEstimated)             return 'Virement non encore calculé (mois futur)'
  if ((r.loy || 0) === 0)       return 'Couvert par frais propriétaire'
  return 'En attente de rapprochement bancaire'
}

function genererHTMLPrevisionnel(proprio, moisDebut, nbMois, data) {
  const moisList = Array.from({ length: nbMois }, (_, i) => addMois(moisDebut, i))
  const periode = nbMois === 1
    ? moisLabel(moisDebut)
    : `${moisLabel(moisDebut)} – ${moisLabel(addMois(moisDebut, nbMois - 1))}`

  const sectionsHTML = moisList.map(mois => {
    const resasMois = data.filter(r => r.mois_comptable === mois)
    const totalMois = resasMois.reduce((s, r) => s + (r.vir > 0 ? r.vir : r.loy), 0)

    const rows = resasMois.map((r, i) => {
      const arrFR = r.arrival_date ? r.arrival_date.substring(5).split('-').reverse().join('/') : '—'
      const depFR = r.departure_date ? r.departure_date.substring(5).split('-').reverse().join('/') : '—'
      const net = r.vir > 0 ? r.vir : r.loy
      const raison = raisonZero(r)
      const netDisplay = raison
        ? `<span style="font-size:10px;color:#dc2626;">${raison}</span>`
        : `${((net || 0) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
      return `<tr style="background:${i % 2 === 0 ? '#F7F4EF' : '#fff'};">
        <td>${arrFR} → ${depFR}</td>
        <td>${r.guest_name || '—'}</td>
        <td style="text-align:center;">${r.nights || '—'} nuits</td>
        <td style="text-align:right;font-weight:600;color:${raison ? '#dc2626' : '#CC9933'};">
          ${netDisplay}
        </td>
      </tr>`
    }).join('')

    const totalStr = ((totalMois || 0) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

    return `
      <div class="mois-section">
        <div class="mois-header">
          <span>${moisLabel(mois).toUpperCase()}</span>
          <span style="font-size:15px;">${totalStr} €</span>
        </div>
        ${resasMois.length === 0
          ? `<p style="color:#9C8E7D;font-style:italic;font-size:12px;padding:8px 0;">Aucune réservation confirmée.</p>`
          : `<table>
              <thead>
                <tr>
                  <th>Séjour</th>
                  <th>Client</th>
                  <th style="text-align:center;">Durée</th>
                  <th style="text-align:right;">Virement estimé</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
              <tfoot>
                <tr>
                  <td colspan="3" style="font-weight:700;border-top:2px solid #CC9933;padding-top:6px;">Total ${moisLabel(mois)}</td>
                  <td style="text-align:right;font-weight:700;border-top:2px solid #CC9933;padding-top:6px;color:#CC9933;">${totalStr} €</td>
                </tr>
              </tfoot>
            </table>`
        }
      </div>`
  }).join('')

  const totalGlobal = data.reduce((s, r) => s + (r.vir > 0 ? r.vir : r.loy), 0)
  const totalStr = ((totalGlobal || 0) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Prévisionnel ${proprio.nom} — ${periode}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #fff; color: #2C2416; font-size: 13px; padding: 32px 40px; }
  .header { border-bottom: 3px solid #CC9933; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-end; }
  .header-left h1 { font-size: 20px; font-weight: 600; color: #2C2416; }
  .header-left p { font-size: 12px; color: #9C8E7D; margin-top: 4px; }
  .header-right { text-align: right; font-size: 11px; color: #9C8E7D; }
  .disclaimer { background: #FEF9EC; border: 1px solid #CC9933; border-radius: 4px; padding: 8px 12px; font-size: 11px; color: #92400E; margin-bottom: 20px; }
  .mois-section { margin-bottom: 24px; page-break-inside: avoid; }
  .mois-header { display: flex; justify-content: space-between; align-items: center; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; color: #CC9933; border-bottom: 2px solid #CC9933; padding-bottom: 6px; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { padding: 6px 8px; text-align: left; background: #F0EDE6; font-weight: 600; font-size: 11px; color: #2C2416; }
  td { padding: 6px 8px; }
  tfoot td { font-size: 12px; }
  .total-global { margin-top: 24px; border-top: 3px solid #2C2416; padding-top: 12px; display: flex; justify-content: space-between; align-items: center; }
  .total-global .label { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
  .total-global .montant { font-size: 22px; font-weight: 700; color: #CC9933; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #E0D9CC; font-size: 10px; color: #9C8E7D; text-align: center; }
  @media print {
    body { padding: 16px 20px; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  }
</style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h1>${proprio.nom}${proprio.prenom ? ' ' + proprio.prenom : ''}</h1>
      <p>Prévisionnel NET propriétaire · ${periode}</p>
    </div>
    <div class="header-right">
      Destination Côte Basque<br/>
      Généré le ${new Date().toLocaleDateString('fr-FR')}
    </div>
  </div>

  <div class="disclaimer">
    ⚠️ Document prévisionnel basé sur les réservations confirmées à ce jour. Les montants "estimés" seront calculés précisément après clôture du mois. Les virements réels peuvent varier en cas d'annulation, nouvelles réservations ou frais à déduire.
  </div>

  ${sectionsHTML}

  ${nbMois > 1 ? `
  <div class="total-global">
    <span class="label">Total estimé sur la période</span>
    <span class="montant">${totalStr} €</span>
  </div>` : ''}

  <div class="footer">
    Document non contractuel · Destination Côte Basque · oihan@destinationcotebasque.com
  </div>
</body>
</html>`
}

function genererEmailPrevisionnel(proprio, moisDebut, nbMois, data, taux) {
  const periode = nbMois === 1
    ? moisLabel(moisDebut)
    : `${moisLabel(moisDebut)} – ${moisLabel(addMois(moisDebut, nbMois - 1))}`

  const moisList = Array.from({ length: nbMois }, (_, i) => addMois(moisDebut, i))

  const sectionsHTML = moisList.map(mois => {
    const resasMois = data.filter(r => r.mois_comptable === mois)
    const totalLoy = resasMois.reduce((s, r) => s + r.loy, 0)

    if (resasMois.length === 0) return `
      <div style="margin-bottom:24px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#CC9933;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid #CC9933;">
          ${moisLabel(mois)}
        </div>
        <p style="color:#9C8E7D;font-style:italic;font-size:12px;">Aucune réservation confirmée.</p>
      </div>`

    const rows = resasMois.map((r, i) => {
      const arrFR = r.arrival_date ? r.arrival_date.substring(5).split('-').reverse().join('/') : '—'
      const depFR = r.departure_date ? r.departure_date.substring(5).split('-').reverse().join('/') : '—'
      const bg = i % 2 === 0 ? '#F7F4EF' : '#fff'
      return `<tr style="background:${bg};">
        <td style="padding:5px 8px;color:#2C2416;font-size:12px;">${arrFR}</td>
        <td style="padding:5px 8px;color:#4A3728;font-size:12px;">${depFR}</td>
        <td style="padding:5px 8px;color:#2C2416;font-size:12px;">${r.guest_name || '—'}</td>
        <td style="padding:5px 8px;text-align:center;color:#4A3728;font-size:12px;">${r.nights || '—'}</td>
        <td style="padding:5px 8px;text-align:right;color:#9C8E7D;font-size:12px;">${fmtEur(r.hon)}</td>
        <td style="padding:5px 8px;text-align:right;font-weight:600;color:#CC9933;font-size:12px;">${fmtEur(r.loy)}</td>
      </tr>`
    }).join('')

    return `
      <div style="margin-bottom:28px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#CC9933;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid #CC9933;">
          ${moisLabel(mois)}
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="background:#EDEBE5;">
              <th style="padding:6px 8px;text-align:left;font-weight:600;font-size:11px;color:#2C2416;">Arrivée</th>
              <th style="padding:6px 8px;text-align:left;font-weight:600;font-size:11px;color:#2C2416;">Départ</th>
              <th style="padding:6px 8px;text-align:left;font-weight:600;font-size:11px;color:#2C2416;">Voyageur</th>
              <th style="padding:6px 8px;text-align:center;font-weight:600;font-size:11px;color:#2C2416;">Nuits</th>
              <th style="padding:6px 8px;text-align:right;font-weight:600;font-size:11px;color:#9C8E7D;">Honoraires DCB</th>
              <th style="padding:6px 8px;text-align:right;font-weight:600;font-size:11px;color:#CC9933;">Net propriétaire</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr>
              <td colspan="5" style="padding:8px;font-weight:700;border-top:2px solid #CC9933;background:#E8E2D6;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;color:#2C2416;">
                Total estimé ${moisLabel(mois)}
              </td>
              <td style="padding:8px;font-weight:700;border-top:2px solid #CC9933;background:#E8E2D6;text-align:right;color:#CC9933;font-size:14px;">
                ${fmtEur(totalLoy)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>`
  }).join('')

  const totalGlobal = data.reduce((s, r) => s + r.loy, 0)

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Prévisionnel ${proprio.nom} — ${periode}</title>
</head>
<body style="margin:0;padding:0;background:#F7F4EF;font-family:Arial,sans-serif;">
<div style="max-width:640px;margin:0 auto;background:#fff;">

  <!-- Header -->
  <div style="background:#2C2416;padding:28px 32px;">
    <div style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#CC9933;margin-bottom:6px;">Destination Côte Basque · Prévisionnel</div>
    <div style="font-size:22px;font-weight:400;color:#fff;">${proprio.nom}${proprio.prenom ? ' ' + proprio.prenom : ''}</div>
    <div style="font-size:13px;color:rgba(255,255,255,0.6);margin-top:4px;">${periode}</div>
  </div>

  <!-- Intro -->
  <div style="padding:20px 32px 0;">
    <p style="font-size:13px;color:#4A3728;line-height:1.7;margin:0 0 4px;">
      Voici une estimation de vos revenus nets pour la période à venir, basée sur les réservations <strong>actuellement confirmées</strong> dans notre système.
    </p>
    <div style="background:#FEF9EC;border:1px solid #CC9933;border-radius:6px;padding:10px 14px;margin:14px 0 0;font-size:12px;color:#92400E;line-height:1.6;">
      ⚠️ <strong>Ces montants sont indicatifs.</strong> Ils peuvent évoluer en fonction des nouvelles réservations, des annulations ou des ajustements tarifaires jusqu'à la date de versement.
      Le taux de commission appliqué est de <strong>${taux}%</strong>.
    </div>
  </div>

  <!-- Sections par mois -->
  <div style="padding:20px 32px;">
    ${sectionsHTML}
  </div>

  <!-- Total global (si plusieurs mois) -->
  ${nbMois > 1 ? `
  <div style="margin:0 32px 24px;background:#2C2416;border-radius:8px;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;">
    <span style="font-size:13px;color:#CC9933;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Total estimé sur la période</span>
    <span style="font-size:20px;font-weight:700;color:#fff;">${fmtEur(totalGlobal)}</span>
  </div>` : ''}

  <!-- Footer -->
  <div style="padding:16px 32px;background:#F7F4EF;border-top:2px solid #CC9933;text-align:center;">
    <div style="font-size:11px;color:#9C8E7D;">Destination Côte Basque — Conciergerie de prestige, Biarritz</div>
    <div style="font-size:11px;color:#9C8E7D;margin-top:3px;">oihan@destinationcotebasque.com</div>
    <div style="font-size:10px;color:#C4B89A;margin-top:8px;">Document généré le ${new Date().toLocaleDateString('fr-FR')} · Estimation non contractuelle</div>
  </div>

</div>
</body>
</html>`
}

function ModalPrevisionnel({ proprio, onClose }) {
  const today = new Date()
  const moisCourant = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

  const [moisDebut, setMoisDebut] = useState(moisCourant)
  const [nbMois, setNbMois]       = useState(3)
  const [loading, setLoading]     = useState(false)
  const [resas, setResas]         = useState(null)
  const [sending, setSending]     = useState(false)
  const [sent, setSent]           = useState(false)
  const [err, setErr]             = useState(null)

  const bienIds = (proprio.bien || []).map(b => b.id)
  // Taux par bien (taux_commission_override du bien > mandat actif > proprio > 25)
  // proprio.bien n'a pas taux_commission_override → on le récupère dans chargerResas
  const mandatActif = (proprio.mandat_gestion || []).find(m => m.statut === 'actif')
  const tauxDefaut = mandatActif?.taux_commission ?? proprio.taux_commission ?? 25

  useEffect(() => {
    if (bienIds.length === 0) return
    chargerResas()
  }, [moisDebut, nbMois])

  async function chargerResas() {
    setLoading(true); setErr(null); setResas(null)
    try {
      const biens = proprio.bien || []
      const moisList = Array.from({ length: nbMois }, (_, i) => addMois(moisDebut, i))

      // Appeler buildRapportData (source de vérité) pour chaque bien × mois
      const calls = biens.flatMap(bien =>
        moisList.map(mois =>
          buildRapportData(bien.id, proprio.id, mois)
            .then(data => ({ mois, data }))
            .catch(() => ({ mois, data: null }))
        )
      )
      const results = await Promise.all(calls)

      // Aplatir les resasEnrichies — loy/hon/base_comm viennent directement de buildRapportData
      const enriched = results
        .filter(r => r.data)
        .flatMap(({ mois, data }) =>
          (data.resas || [])
            .filter(r => !r.owner_stay)
            .map(r => ({
              ...r,
              mois_comptable: mois,
              taux: data.tauxCommission,
              // loy > 0 = ventilation calculée ; sinon mois futur sans ventilation
              isEstimated: (r.loy || 0) === 0 && (r.base_comm || 0) > 0,
            }))
        )
        .sort((a, b) => (a.arrival_date || '').localeCompare(b.arrival_date || ''))

      setResas(enriched)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  function telechargerPDF() {
    const html = genererHTMLPrevisionnel(proprio, moisDebut, nbMois, resas || [])
    const w = window.open('', '_blank')
    w.document.write(html)
    w.document.close()
    w.onload = () => { w.focus(); w.print() }
  }

  async function envoyer() {
    if (!proprio.email) return
    setSending(true); setErr(null)
    try {
      const periode = nbMois === 1
        ? moisLabel(moisDebut)
        : `${moisLabel(moisDebut)} – ${moisLabel(addMois(moisDebut, nbMois - 1))}`
      const html = genererEmailPrevisionnel(proprio, moisDebut, nbMois, resas || [], tauxDefaut)
      const res = await fetch(`${SUPABASE_URL}/functions/v1/smtp-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
        body: JSON.stringify({
          to: [proprio.email],
          subject: `Estimation de vos revenus ${periode} — Destination Côte Basque`,
          html,
        }),
      })
      if (!res.ok) { const t = await res.text(); throw new Error(t) }
      setSent(true)
    } catch (e) { setErr(e.message) }
    finally { setSending(false) }
  }

  const moisList = Array.from({ length: nbMois }, (_, i) => addMois(moisDebut, i))
  const totalGlobal = (resas || []).reduce((s, r) => s + (r.vir > 0 ? r.vir : r.loy), 0)

  // Options mois de début : mois courant + 5 suivants
  const moisOptions = Array.from({ length: 6 }, (_, i) => addMois(moisCourant, i))

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 780 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 style={{ margin: 0 }}>Prévisionnel — {proprio.nom}{proprio.prenom ? ' ' + proprio.prenom : ''}</h2>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Estimation basée sur les réservations confirmées · Taux {Number(tauxDefaut).toFixed(1)}%
            </span>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {/* Sélecteurs */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Début</label>
              <select className="form-select" value={moisDebut} onChange={e => setMoisDebut(e.target.value)} style={{ minWidth: 160 }}>
                {moisOptions.map(m => <option key={m} value={m}>{moisLabel(m)}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Durée</label>
              <select className="form-select" value={nbMois} onChange={e => setNbMois(Number(e.target.value))}>
                {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n} mois</option>)}
              </select>
            </div>
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>NET estimé total</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--brand)' }}>
                {loading ? '…' : fmtEur(totalGlobal)}
              </div>
            </div>
          </div>

          {err && <div className="alert alert-error" style={{ marginBottom: 12 }}>✗ {err}</div>}
          {sent && <div className="alert alert-success" style={{ marginBottom: 12 }}>✓ Email envoyé à {proprio.email}</div>}

          {/* Disclaimer */}
          <div style={{ background: '#FEF9EC', border: '1px solid var(--brand)', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#92400E', marginBottom: 16 }}>
            ⚠️ Estimation basée sur les réservations actuellement confirmées. Les montants peuvent varier suite à des annulations ou nouvelles réservations.
          </div>

          {/* Tableau par mois */}
          {loading ? (
            <div className="loading-state"><span className="spinner" /> Chargement des réservations…</div>
          ) : bienIds.length === 0 ? (
            <div className="empty-state" style={{ padding: 24 }}>
              <div className="empty-state-title">Aucun bien associé</div>
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Ce propriétaire n'a pas de bien dans cette agence.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {moisList.map(mois => {
                const resasMois = (resas || []).filter(r => r.mois_comptable === mois)
                const totalMois = resasMois.reduce((s, r) => s + (r.vir > 0 ? r.vir : r.loy), 0)
                return (
                  <div key={mois}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, paddingBottom: 6, borderBottom: '2px solid var(--brand)' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--brand)' }}>
                        {moisLabel(mois)}
                      </span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--brand)' }}>
                        {fmtEur(totalMois)}
                      </span>
                    </div>
                    {resasMois.length === 0 ? (
                      <p style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', padding: '8px 0' }}>Aucune réservation confirmée.</p>
                    ) : (
                      <table>
                        <thead>
                          <tr>
                            <th>Arrivée</th>
                            <th>Départ</th>
                            <th>Voyageur</th>
                            <th style={{ textAlign: 'center' }}>Nuits</th>
                            <th style={{ textAlign: 'right', color: 'var(--text-muted)' }}>Base comm.</th>
                            <th style={{ textAlign: 'right', color: 'var(--text-muted)' }}>Hon. DCB</th>
                            <th style={{ textAlign: 'right', color: 'var(--brand)' }}>NET proprio</th>
                          </tr>
                        </thead>
                        <tbody>
                          {resasMois.map(r => {
                            const net = r.vir > 0 ? r.vir : r.loy
                            const raison = raisonZero(r)
                            return (
                            <tr key={r.id}>
                              <td style={{ whiteSpace: 'nowrap' }}>{r.arrival_date ? r.arrival_date.substring(5).split('-').reverse().join('/') : '—'}</td>
                              <td style={{ whiteSpace: 'nowrap' }}>{r.departure_date ? r.departure_date.substring(5).split('-').reverse().join('/') : '—'}</td>
                              <td style={{ fontSize: 12 }}>{r.guest_name || '—'}</td>
                              <td style={{ textAlign: 'center' }}>{r.nights || '—'}</td>
                              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtEur(r.base_comm)}</td>
                              <td style={{ textAlign: 'right', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{fmtEur(r.hon)}</td>
                              <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                                {raison
                                  ? <span style={{ fontSize: 11, color: '#dc2626' }}>{raison}</span>
                                  : <span style={{ color: 'var(--brand)' }}>{fmtEur(net)}</span>}
                              </td>
                            </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Fermer</button>
          <button className="btn btn-secondary" disabled={loading || !resas}
            onClick={telechargerPDF}>
            📥 PDF
          </button>
          {proprio.email ? (
            <button className="btn btn-primary" disabled={sending || loading || !resas}
              onClick={envoyer}>
              {sending ? 'Envoi…' : `📧 Envoyer à ${proprio.email}`}
            </button>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>
              Pas d'email renseigné
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Page principale ────────────────────────────────────────────────────────────

export default function PageProprietaires() {
  const [proprios, setProprios]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [err, setErr]             = useState(null)
  const [recherche, setRecherche] = useState('')
  const [filtreActif, setFiltreActif] = useState('actif') // 'actif' | 'archive' | 'tous'
  const [selected, setSelected]   = useState(null)
  const [previsionnel, setPrevisionnel] = useState(null)

  useEffect(() => { charger() }, [])

  async function charger() {
    setLoading(true); setErr(null)
    try { setProprios(await getProprietairesComplets()) }
    catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  function handleSaved(updated) {
    setProprios(prev => prev.map(p => p.id === updated.id ? { ...p, ...updated } : p))
    setSelected(prev => prev ? { ...prev, ...updated } : prev)
  }

  const filtres = proprios
    .filter(p => {
      if (filtreActif === 'actif')   return p.actif !== false
      if (filtreActif === 'archive') return p.actif === false
      return true
    })
    .filter(p => {
      if (!recherche) return true
      const q = recherche.toLowerCase()
      return (
        p.nom?.toLowerCase().includes(q) ||
        p.prenom?.toLowerCase().includes(q) ||
        p.email?.toLowerCase().includes(q) ||
        p.id_evoliz?.includes(q)
      )
    })

  const stats = {
    total:        proprios.filter(p => p.actif !== false).length,
    sansIban:     proprios.filter(p => p.actif !== false && !p.iban).length,
    sansMandat:   proprios.filter(p => p.actif !== false && (!p.mandat_gestion || p.mandat_gestion.length === 0)).length,
    sansEvoliz:   proprios.filter(p => p.actif !== false && !p.id_evoliz).length,
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Propriétaires</h1>
          <p className="page-subtitle">Fiches, mandats et coordonnées bancaires</p>
        </div>
      </div>

      {err && <div className="alert alert-error">{err}</div>}

      {/* Stats */}
      <div className="stats-row" style={{ marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-label">Propriétaires actifs</div>
          <div className="stat-value">{stats.total}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Sans IBAN</div>
          <div className="stat-value" style={{ color: stats.sansIban > 0 ? '#dc2626' : 'var(--brand)' }}>
            {stats.sansIban}
          </div>
          <div className="stat-sub">virements SCT bloqués</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Sans mandat</div>
          <div className="stat-value" style={{ color: stats.sansMandat > 0 ? '#d97706' : 'var(--brand)' }}>
            {stats.sansMandat}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Sans lien Evoliz</div>
          <div className="stat-value" style={{ color: stats.sansEvoliz > 0 ? '#d97706' : 'var(--brand)' }}>
            {stats.sansEvoliz}
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        <input className="form-input" placeholder="Rechercher un propriétaire…"
          value={recherche} onChange={e => setRecherche(e.target.value)}
          style={{ maxWidth: 280 }} />
        <div style={{ display: 'flex', gap: 4 }}>
          {[['actif', 'Actifs'], ['archive', 'Archivés'], ['tous', 'Tous']].map(([v, l]) => (
            <button key={v} className={`btn btn-sm ${filtreActif === v ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFiltreActif(v)}>{l}</button>
          ))}
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {filtres.length} propriétaire{filtres.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Tableau */}
      {loading ? (
        <div className="loading-state"><span className="spinner" /> Chargement…</div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Propriétaire</th>
                <th>Type</th>
                <th>Biens</th>
                <th>IBAN</th>
                <th>Mandat</th>
                <th>Evoliz</th>
                <th>Commission</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtres.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
                  Aucun résultat
                </td></tr>
              )}
              {filtres.map(p => {
                const biensAgence = (p.bien || []).filter(b => b.agence === AGENCE)
                const biensListed = biensAgence.filter(b => b.listed)
                const mandatActif = (p.mandat_gestion || []).find(m => m.statut === 'actif')
                const taux = mandatActif?.taux_commission ?? p.taux_commission

                return (
                  <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(p)}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{p.nom}{p.prenom ? ' ' + p.prenom : ''}</div>
                      {p.email && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.email}</div>}
                    </td>
                    <td>
                      <span className="badge badge-neutral">{TYPE_LABELS[p.type_proprio] || 'Particulier'}</span>
                    </td>
                    <td>
                      {biensListed.length > 0 ? (
                        <span style={{ fontSize: 13 }}>
                          {biensListed.length} actif{biensListed.length > 1 ? 's' : ''}
                          {biensAgence.length > biensListed.length && (
                            <span style={{ color: 'var(--text-muted)' }}> +{biensAgence.length - biensListed.length}</span>
                          )}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                      )}
                    </td>
                    <td>
                      {p.iban
                        ? <span className="badge badge-success">✓ IBAN</span>
                        : <span className="badge badge-danger">✗ Manquant</span>}
                    </td>
                    <td>
                      {mandatActif
                        ? <span className="badge badge-success">{mandatActif.numero ? `n° ${mandatActif.numero}` : 'Actif'}</span>
                        : (p.mandat_gestion || []).length > 0
                          ? <span className="badge badge-warning">Résilié</span>
                          : <span className="badge badge-neutral">—</span>}
                    </td>
                    <td>
                      {p.id_evoliz
                        ? <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-muted)' }}>#{p.id_evoliz}</span>
                        : <span className="badge badge-warning">Non lié</span>}
                    </td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {taux != null ? `${Number(taux).toFixed(1)}%` : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-secondary btn-sm" onClick={e => { e.stopPropagation(); setSelected(p) }}>
                          Voir
                        </button>
                        <button className="btn btn-secondary btn-sm" title="Envoyer prévisionnel NET"
                          onClick={e => { e.stopPropagation(); setPrevisionnel(p) }}>
                          📊
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal fiche */}
      {selected && (
        <ModalFiche
          proprio={selected}
          onClose={() => setSelected(null)}
          onSaved={handleSaved}
        />
      )}

      {/* Modal prévisionnel */}
      {previsionnel && (
        <ModalPrevisionnel
          proprio={previsionnel}
          onClose={() => setPrevisionnel(null)}
        />
      )}
    </div>
  )
}
