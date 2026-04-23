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
      await syncProprietairesEvoliz()
      const { data } = await supabase
        .from('proprietaire').select('*').eq('id', proprio.id).single()
      if (data) {
        setForm(f => ({
          ...f,
          nom:         data.nom || f.nom,
          prenom:      data.prenom || f.prenom,
          email:       data.email || f.email,
          telephone:   data.telephone || f.telephone,
          adresse:     data.adresse || f.adresse,
          code_postal: data.code_postal || f.code_postal,
          ville:       data.ville || f.ville,
          pays:        data.pays || f.pays,
        }))
        onSaved({ ...proprio, ...data })
        setOk(true); setTimeout(() => setOk(false), 2000)
      }
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

// ── Page principale ────────────────────────────────────────────────────────────

export default function PageProprietaires() {
  const [proprios, setProprios]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [err, setErr]             = useState(null)
  const [recherche, setRecherche] = useState('')
  const [filtreActif, setFiltreActif] = useState('actif') // 'actif' | 'archive' | 'tous'
  const [selected, setSelected]   = useState(null)

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
                      <button className="btn btn-secondary btn-sm" onClick={e => { e.stopPropagation(); setSelected(p) }}>
                        Voir
                      </button>
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
    </div>
  )
}
