import { useState, useEffect } from 'react'
import { getAutoEntrepreneurs, saveAutoEntrepreneur, deleteAutoEntrepreneur } from '../services/autoEntrepreneurs'

const EMPTY = {
  nom: '', prenom: '', siret: '', adresse: '', code_postal: '', ville: '',
  email: '', telephone: '', iban: '', ical_url: '', taux_horaire: 2500, note: ''
}

export default function PageAutoEntrepreneurs() {
  const [aes, setAes] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  useEffect(() => { charger() }, [])

  async function charger() {
    setLoading(true)
    try { setAes(await getAutoEntrepreneurs()) }
    catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  function ouvrir(ae) { setForm(ae ? { ...ae } : EMPTY); setEditing(ae ? ae.id : 'new'); setError(null); setSuccess(null) }
  function fermer() { setEditing(null); setError(null) }
  function change(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function sauvegarder() {
    if (!form.nom.trim()) { setError('Le nom est requis'); return }
    setSaving(true); setError(null)
    try {
      const data = { ...form, taux_horaire: parseInt(form.taux_horaire) || 2500 }
      if (editing !== 'new') data.id = editing
      await saveAutoEntrepreneur(data)
      setSuccess(editing === 'new' ? 'Auto-entrepreneur créé' : 'Fiche mise à jour')
      await charger()
      setTimeout(() => { fermer(); setSuccess(null) }, 1200)
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  async function supprimer(id) {
    if (!confirm('Supprimer cet auto-entrepreneur ?')) return
    try { await deleteAutoEntrepreneur(id); await charger() }
    catch (err) { setError(err.message) }
  }

  const inp = (k, label, opts = {}) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>{label}</label>
      <input value={form[k] ?? ''} onChange={e => change(k, e.target.value)}
        style={{ padding: '8px 10px', borderRadius: 7, border: '1.5px solid #e5e7eb', fontSize: 13, outline: 'none' }}
        {...opts} />
    </div>
  )

  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Auto-entrepreneurs</h1>
          <p style={{ margin: '4px 0 0', color: '#666', fontSize: 14 }}>Prestataires ménage — {aes.length} configuré(s)</p>
        </div>
        <button onClick={() => ouvrir(null)} style={{ background: '#1a3a6e', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          + Ajouter AE
        </button>
      </div>
      {error && !editing && <div style={{ background: '#FEE2E2', border: '1px solid #EF4444', borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: 13, color: '#B91C1C' }}>✕ {error}</div>}
      {loading ? <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>Chargement...</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {aes.length === 0 && (
            <div style={{ textAlign: 'center', padding: 60, color: '#aaa', background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🧹</div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Aucun auto-entrepreneur configuré</div>
              <div style={{ fontSize: 13 }}>Cliquez sur "+ Ajouter AE" pour créer votre première fiche</div>
            </div>
          )}
          {aes.map(ae => (
            <div key={ae.id} style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 44, height: 44, borderRadius: 22, background: '#1a3a6e', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, flexShrink: 0 }}>
                {(ae.prenom?.[0] || ae.nom[0]).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{ae.prenom} {ae.nom}</div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {ae.siret && <span>SIRET: {ae.siret}</span>}
                  {ae.email && <span>{ae.email}</span>}
                  {ae.ville && <span>📍 {ae.ville}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                <div style={{ background: '#f0fdf4', color: '#16a34a', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600 }}>
                  {((ae.taux_horaire || 2500) / 100).toFixed(0)} €/h
                </div>
                {ae.ical_url && <div style={{ background: '#eff6ff', color: '#2563eb', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600 }}>📅 iCal</div>}
                <button onClick={() => ouvrir(ae)} style={{ background: '#f3f4f6', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>Modifier</button>
                <button onClick={() => supprimer(ae.id)} style={{ background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 28, width: '100%', maxWidth: 600, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{editing === 'new' ? 'Nouvel AE' : 'Modifier la fiche'}</h2>
              <button onClick={fermer} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#888' }}>✕</button>
            </div>
            {error && <div style={{ background: '#FEE2E2', borderRadius: 7, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#B91C1C' }}>✕ {error}</div>}
            {success && <div style={{ background: '#DCFCE7', borderRadius: 7, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#15803D' }}>✓ {success}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {inp('nom', 'Nom *')}
              {inp('prenom', 'Prénom')}
              {inp('siret', 'SIRET', { placeholder: '000 000 000 00000' })}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>Taux horaire (€/h)</label>
                <input type="number" step="0.5" min="0" value={(form.taux_horaire || 2500) / 100}
                  onChange={e => change('taux_horaire', Math.round(parseFloat(e.target.value || 0) * 100))}
                  style={{ padding: '8px 10px', borderRadius: 7, border: '1.5px solid #e5e7eb', fontSize: 13 }} />
              </div>
              <div style={{ gridColumn: '1/-1' }}>{inp('adresse', 'Adresse')}</div>
              {inp('code_postal', 'Code postal')}
              {inp('ville', 'Ville')}
              {inp('email', 'Email', { type: 'email' })}
              {inp('telephone', 'Téléphone')}
              <div style={{ gridColumn: '1/-1' }}>{inp('iban', 'IBAN', { placeholder: 'FR76 0000 0000 0000 0000 0000 000' })}</div>
              <div style={{ gridColumn: '1/-1', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>URL iCal missions 📅</label>
                <input value={form.ical_url ?? ''} onChange={e => change('ical_url', e.target.value)}
                  placeholder="https://calendar.google.com/calendar/ical/..."
                  style={{ padding: '8px 10px', borderRadius: 7, border: '1.5px solid #e5e7eb', fontSize: 13 }} />
                <div style={{ fontSize: 11, color: '#888' }}>Lien iCal pour pré-remplir les missions dans les factures</div>
              </div>
              <div style={{ gridColumn: '1/-1', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>Note</label>
                <textarea value={form.note ?? ''} onChange={e => change('note', e.target.value)} rows={2}
                  style={{ padding: '8px 10px', borderRadius: 7, border: '1.5px solid #e5e7eb', fontSize: 13, resize: 'vertical' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={fermer} style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>Annuler</button>
              <button onClick={sauvegarder} disabled={saving}
                style={{ background: '#1a3a6e', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? .7 : 1 }}>
                {saving ? 'Enregistrement...' : '✓ Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
