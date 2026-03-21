import { useState, useEffect } from 'react'
import { getAutoEntrepreneurs, saveAutoEntrepreneur, deleteAutoEntrepreneur, createAEWithAuth, resetAEPassword } from '../services/autoEntrepreneurs'
import { supabase } from '../lib/supabase'

const EMPTY_AE = {
  nom: '', prenom: '', siret: '', adresse: '', code_postal: '', ville: '',
  email: '', telephone: '', iban: '', ical_url: '', taux_horaire: 2500, note: '', actif: true, type: 'ae'
}

export default function PageAutoEntrepreneurs() {
  const [aes, setAes] = useState([])
  const [prestationTypes, setPrestationTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('aes') // 'aes' | 'prestations'
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_AE)
  const [saving, setSaving] = useState(false)
  const [credentials, setCredentials] = useState(null)
  const [syncMois, setSyncMois] = useState(() => new Date().toISOString().slice(0, 7))
  const [syncing, setSyncing] = useState(false)
  const [syncResults, setSyncResults] = useState(null) // { email, password, nom } après création
  const [moisBalance, setMoisBalance] = useState(() => new Date().toISOString().slice(0, 7))
  const [balance, setBalance] = useState(null) // { nb_auto, auto_provision, auto_saisis, auto_reel, fmen_provision, fmen_reel }
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  // Prestation type form
  const [editingPT, setEditingPT] = useState(null)
  const [formPT, setFormPT] = useState({ nom: '', description: '', taux_defaut: 2500, unite: 'heure' })

  useEffect(() => { charger() }, [])

  async function charger() {
    setLoading(true)
    try {
      const [aesData, ptData] = await Promise.all([
        getAutoEntrepreneurs(),
        supabase.from('prestation_type').select('*').order('nom').then(r => r.data || [])
      ])
      setAes(aesData)
      setPrestationTypes(ptData)
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  async function chargerBalance(mois) {
    const { data } = await supabase
      .from('ventilation')
      .select('code, montant_ht, montant_reel')
      .eq('mois_comptable', mois)
      .in('code', ['AUTO', 'FMEN'])
    if (!data) return
    const auto = data.filter(v => v.code === 'AUTO')
    const fmen = data.filter(v => v.code === 'FMEN')
    setBalance({
      mois,
      nb_auto: auto.length,
      auto_provision: auto.reduce((s, v) => s + (v.montant_ht || 0), 0),
      auto_saisis: auto.filter(v => v.montant_reel != null).length,
      auto_reel: auto.filter(v => v.montant_reel != null).reduce((s, v) => s + (v.montant_reel || 0), 0),
      fmen_provision: fmen.reduce((s, v) => s + (v.montant_ht || 0), 0),
      fmen_reel: fmen.filter(v => v.montant_reel != null).reduce((s, v) => s + (v.montant_reel || 0), 0),
    })
  }

  function ouvrir(ae) { setForm(ae ? { ...ae } : EMPTY_AE); setEditing(ae ? ae.id : 'new'); setError(null); setSuccess(null) }
  function fermer() { setEditing(null); setError(null) }
  function change(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function resetMdp(ae) {
    if (!ae.email) { setError('Email requis pour réinitialiser le mot de passe'); return }
    if (!confirm(`Réinitialiser le mot de passe de ${ae.prenom} ${ae.nom} ?`)) return
    setSaving(true); setError(null)
    try {
      const { password } = await resetAEPassword(ae.id, ae.email)
      await import('../lib/supabase').then(({ supabase }) =>
        supabase.from('auto_entrepreneur').update({ mdp_temporaire: password }).eq('id', ae.id)
      )
      await charger()
      setSuccess(`Mot de passe réinitialisé ✓ — Cliquez "📨 Identifiants" pour le récupérer`)
      setTimeout(() => setSuccess(null), 4000)
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  async function syncTousLesAEs() {
    setSyncing(true); setSyncResults(null); setError(null)
    const aesAvecICal = aes.filter(a => a.ical_url && a.actif !== false)
    const results = []
    for (const ae of aesAvecICal) {
      try {
        const r = await fetch('/api/ae-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'sync', ae_id: ae.id, mois: syncMois })
        })
        const d = await r.json()
        results.push({ nom: ae.prenom + ' ' + ae.nom, ...d })
      } catch (err) {
        results.push({ nom: ae.prenom + ' ' + ae.nom, error: err.message })
      }
    }
    setSyncResults(results)
    setSyncing(false)
  }

  async function sauvegarder() {
    if (!form.nom.trim()) { setError('Le nom est requis'); return }
    setSaving(true); setError(null)
    try {
      const data = { ...form, taux_horaire: parseInt(form.taux_horaire) || 2500 }
      // taux_horaire est en centimes en base mais on affiche en €
      if (editing !== 'new') data.id = editing
      await saveAutoEntrepreneur(data)
      setSuccess(editing === 'new' ? 'Auto-entrepreneur créé ✓' : 'Fiche mise à jour ✓')
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

  async function envoyerIdentifiants(ae) {
    const portailUrl = 'https://dcb-portail-ae.vercel.app'
    const mdp = ae.mdp_temporaire || '(non disponible - recréer le compte)'
    const msg = `Bonjour ${ae.prenom || ae.nom},\n\nVoici vos accès au portail Destination Côte Basque 🌅\n\nURL : ${portailUrl}\nEmail : ${ae.email}\nMot de passe : ${mdp}\n\nConnectez-vous pour voir vos missions et déclarer vos prestations.\n\nÀ bientôt,\nDestination Côte Basque`
    await navigator.clipboard.writeText(msg)
    setSuccess('Message copié ! Collez-le dans un SMS ou email.')
    setTimeout(() => setSuccess(null), 3000)
  }

  async function sauvegarderPT() {
    if (!formPT.nom.trim()) return
    setSaving(true)
    try {
      const data = { ...formPT, taux_defaut: Math.round(parseFloat(formPT.taux_defaut) * 100) || 2500 }
      if (editingPT && editingPT !== 'new') {
        await supabase.from('prestation_type').update(data).eq('id', editingPT)
      } else {
        await supabase.from('prestation_type').insert(data)
      }
      await charger()
      setEditingPT(null)
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  async function supprimerPT(id) {
    if (!confirm('Supprimer ce type de prestation ?')) return
    await supabase.from('prestation_type').delete().eq('id', id)
    await charger()
  }

  const inp = (k, label, opts = {}) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>{label}</label>
      <input value={form[k] ?? ''} onChange={e => change(k, e.target.value)}
        style={{ padding: '8px 10px', borderRadius: 7, border: '1.5px solid #e5e7eb', fontSize: 13, outline: 'none' }}
        {...opts} />
    </div>
  )

  const TAB_STYLE = active => ({
    padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
    background: active ? '#1a3a6e' : '#f3f4f6', color: active ? '#fff' : '#555'
  })

  return (
       <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Auto-entrepreneurs</h1>
          <p style={{ margin: '4px 0 0', color: '#666', fontSize: 14 }}>Prestataires ménage — {aes.length} configuré(s)</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {tab === 'aes' && <button onClick={() => ouvrir(null)} style={{ background: '#1a3a6e', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>+ Ajouter AE</button>}
          {tab === 'prestations' && <button onClick={() => { setFormPT({ nom: '', description: '', taux_defaut: 2500, unite: 'heure' }); setEditingPT('new') }} style={{ background: '#1a3a6e', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>+ Ajouter prestation</button>}
        </div>
      </div>

      {success && !editing && !editingPT && <div style={{ background: '#DCFCE7', borderRadius: 8, padding: '10px 16px', marginBottom: 14, fontSize: 13, color: '#15803D' }}>✓ {success}</div>}
      {error && !editing && <div style={{ background: '#FEE2E2', borderRadius: 8, padding: '10px 16px', marginBottom: 14, fontSize: 13, color: '#B91C1C' }}>✕ {error}</div>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button style={TAB_STYLE(tab === 'aes')} onClick={() => setTab('aes')}>🧹 Auto-entrepreneurs ({aes.length})</button>
        <button style={TAB_STYLE(tab === 'prestations')} onClick={() => setTab('prestations')}>⚙️ Types de prestations ({prestationTypes.length})</button>
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>Chargement...</div> : (
        <>
          {tab === 'aes' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {aes.length === 0 && (
                <div style={{ textAlign: 'center', padding: 60, color: '#aaa', background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb' }}>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>🧹</div>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>Aucun auto-entrepreneur configuré</div>
                  <div style={{ fontSize: 13 }}>Cliquez sur "+ Ajouter AE" pour créer la première fiche</div>
                </div>
              )}
              {/* Sync iCal global */}
              <div style={{ background: '#eff6ff', borderRadius: 10, padding: '12px 16px', marginBottom: 14, border: '1px solid #bfdbfe', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#1e40af' }}>📅 Sync iCal</span>
                <input type="month" value={syncMois} onChange={e => setSyncMois(e.target.value)}
                  style={{ padding: '4px 10px', borderRadius: 6, border: '1.5px solid #bfdbfe', fontSize: 13 }} />
                <button onClick={syncTousLesAEs} disabled={syncing}
                  style={{ background: syncing ? '#94a3b8' : '#1d4ed8', color: '#fff', border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: syncing ? 'not-allowed' : 'pointer' }}>
                  {syncing ? '⏳ En cours...' : '🔄 Sync tous'}
                </button>
                {syncResults && (
                  <div style={{ width: '100%', marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {syncResults.map((res, i) => (
                      <div key={i} style={{ fontSize: 12, display: 'flex', gap: 8 }}>
                        <span style={{ fontWeight: 600, color: '#1e40af', minWidth: 130 }}>{res.nom}</span>
                        {res.error
                          ? <span style={{ color: '#dc2626' }}>✕ {res.error}</span>
                          : <span style={{ color: '#16a34a' }}>✓ {res.created} nouvelle(s) / {res.total_events} événements iCal</span>
                        }
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {aes.map(ae => (
                <div key={ae.id} style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 22, background: ae.actif ? '#1a3a6e' : '#9ca3af', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, flexShrink: 0 }}>
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
                {ae.type === 'staff' && <div style={{ background: '#fef3c7', color: '#92400e', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 700 }}>🌅 DCB Staff</div>}
                    <button onClick={() => envoyerIdentifiants(ae)} title="Copier message avec identifiants" style={{ background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0', borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}>📨 Identifiants</button>
                    {(!ae.mdp_temporaire || !ae.ae_user_id) && ae.email && (
                      <button onClick={() => resetMdp(ae)} title="Créer/réinitialiser le mot de passe" style={{ background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa', borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}>🔑 {ae.ae_user_id ? 'Regen mdp' : 'Créer accès'}</button>
                    )}
                    <button onClick={() => ouvrir(ae)} style={{ background: '#f3f4f6', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>Modifier</button>
                    <button onClick={() => supprimer(ae.id)} style={{ background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'prestations' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {prestationTypes.map(pt => (
                <div key={pt.id} style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{pt.nom}</div>
                    {pt.description && <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{pt.description}</div>}
                  </div>
                  <div style={{ background: '#f0fdf4', color: '#16a34a', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600 }}>
                    {(pt.taux_defaut / 100).toFixed(0)} €/{pt.unite === 'forfait' ? 'forfait' : 'h'}
                  </div>
                  <div style={{ fontSize: 11, color: '#888', background: '#f3f4f6', borderRadius: 5, padding: '3px 8px' }}>{pt.unite}</div>
                  <button onClick={() => { setFormPT({ nom: pt.nom, description: pt.description || '', taux_defaut: pt.taux_defaut / 100, unite: pt.unite }); setEditingPT(pt.id) }} style={{ background: '#f3f4f6', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>Modifier</button>
                  <button onClick={() => supprimerPT(pt.id)} style={{ background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Modal AE */}
      {editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 28, width: '100%', maxWidth: 620, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{editing === 'new' ? 'Nouvel AE' : 'Modifier la fiche'}</h2>
              <button onClick={fermer} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#888' }}>✕</button>
            </div>
            {error && <div style={{ background: '#FEE2E2', borderRadius: 7, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#B91C1C' }}>✕ {error}</div>}
            {success && <div style={{ background: '#DCFCE7', borderRadius: 7, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#15803D' }}>✓ {success}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {inp('nom', 'Nom *')}
              {inp('prenom', 'Prénom')}
              {inp('siret', 'SIRET', { placeholder: '000 000 000 00000' })}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>Type</label>
                <select value={form.type || 'ae'} onChange={e => change('type', e.target.value)}
                  style={{ padding: '8px 10px', borderRadius: 7, border: '1.5px solid #e5e7eb', fontSize: 13 }}>
                  <option value="ae">🧹 Auto-entrepreneur</option>
                  <option value="staff">🌅 Staff DCB</option>
                </select>
              </div>
              {form.type !== 'staff' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>Taux horaire (€/h)</label>
                <input type="number" step="0.5" min="0" value={(form.taux_horaire || 2500) / 100}
                  onChange={e => change('taux_horaire', Math.round(parseFloat(e.target.value || 0) * 100))}
                  style={{ padding: '8px 10px', borderRadius: 7, border: '1.5px solid #e5e7eb', fontSize: 13 }} />
              </div>
              )}
              <div style={{ gridColumn: '1/-1' }}>{inp('adresse', 'Adresse')}</div>
              {inp('code_postal', 'Code postal')}
              {inp('ville', 'Ville')}
              {inp('email', 'Email', { type: 'email' })}
              {inp('telephone', 'Téléphone')}
              <div style={{ gridColumn: '1/-1' }}>{inp('iban', 'IBAN', { placeholder: 'FR76 0000 0000 0000 0000 0000 000' })}</div>
              <div style={{ gridColumn: '1/-1', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#2563eb', textTransform: 'uppercase' }}>URL iCal missions 📅</label>
                <input value={form.ical_url ?? ''} onChange={e => change('ical_url', e.target.value)}
                  placeholder="https://calendar.google.com/calendar/ical/..."
                  style={{ padding: '8px 10px', borderRadius: 7, border: '1.5px solid #93c5fd', fontSize: 13 }} />
                <div style={{ fontSize: 11, color: '#6b7280' }}>L'iCal sera lu pour pré-remplir les missions dans le portail AE</div>
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


      {/* Modal credentials après création AE */}
      {credentials && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 32, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Compte créé !</h2>
              <p style={{ margin: '8px 0 0', color: '#666', fontSize: 14 }}>{credentials.nom} peut maintenant accéder au portail</p>
            </div>
            <div style={{ background: '#f8fafc', borderRadius: 12, padding: 20, marginBottom: 20, border: '1px solid #e5e7eb' }}>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', marginBottom: 4 }}>URL du portail</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1a3a6e', wordBreak: 'break-all' }}>https://dcb-portail-ae.vercel.app</div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', marginBottom: 4 }}>Email</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{credentials.email}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', marginBottom: 4 }}>Mot de passe temporaire</div>
                <div style={{ fontSize: 18, fontWeight: 900, color: '#1a3a6e', letterSpacing: 2, fontFamily: 'monospace' }}>{credentials.password}</div>
                <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>⚠️ À communiquer à l'AE — il pourra le modifier depuis le portail</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => {
                const txt = `Portail DCB : https://dcb-portail-ae.vercel.app\nEmail : ${credentials.email}\nMot de passe : ${credentials.password}`
                navigator.clipboard.writeText(txt)
                setSuccess('Copié !')
                setTimeout(() => setSuccess(null), 2000)
              }} style={{ flex: 1, background: '#f3f4f6', border: 'none', borderRadius: 10, padding: '12px', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
                📋 Copier les infos
              </button>
              <button onClick={() => setCredentials(null)}
                style={{ flex: 1, background: '#1a3a6e', color: '#fff', border: 'none', borderRadius: 10, padding: '12px', fontSize: 13, cursor: 'pointer', fontWeight: 700 }}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal type de prestation */}
      {editingPT && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 28, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{editingPT === 'new' ? 'Nouvelle prestation' : 'Modifier prestation'}</h2>
              <button onClick={() => setEditingPT(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#888' }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>Nom *</label>
                <input value={formPT.nom} onChange={e => setFormPT(f => ({ ...f, nom: e.target.value }))}
                  style={{ padding: '8px 10px', borderRadius: 7, border: '1.5px solid #e5e7eb', fontSize: 13 }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>Description</label>
                <input value={formPT.description} onChange={e => setFormPT(f => ({ ...f, description: e.target.value }))}
                  style={{ padding: '8px 10px', borderRadius: 7, border: '1.5px solid #e5e7eb', fontSize: 13 }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>Taux défaut (€)</label>
                  <input type="number" step="0.5" min="0" value={formPT.taux_defaut}
                    onChange={e => setFormPT(f => ({ ...f, taux_defaut: parseFloat(e.target.value) || 0 }))}
                    style={{ padding: '8px 10px', borderRadius: 7, border: '1.5px solid #e5e7eb', fontSize: 13 }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>Unité</label>
                  <select value={formPT.unite} onChange={e => setFormPT(f => ({ ...f, unite: e.target.value }))}
                    style={{ padding: '8px 10px', borderRadius: 7, border: '1.5px solid #e5e7eb', fontSize: 13 }}>
                    <option value="heure">Par heure</option>
                    <option value="forfait">Forfait</option>
                  </select>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={() => setEditingPT(null)} style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>Annuler</button>
              <button onClick={sauvegarderPT} disabled={saving}
                style={{ background: '#1a3a6e', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                ✓ Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

    {balance && (() => {
      const ecartAuto = balance.auto_saisis > 0 ? balance.auto_reel - balance.auto_provision : null
      const ecartFmen = balance.auto_saisis > 0 ? balance.fmen_reel - balance.fmen_provision : null
      const fmt = v => (v / 100).toFixed(2) + ' €'
      const fmtEcart = v => (v >= 0 ? '+' : '') + (v / 100).toFixed(2) + ' €'
      return (
        <div style={{ display:'flex', gap:12, marginBottom:20, flexWrap:'wrap', alignItems:'center' }}>
          <input type="month" value={moisBalance}
            onChange={e => { setMoisBalance(e.target.value); chargerBalance(e.target.value) }}
            style={{ fontSize:13, padding:'3px 8px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg-input)' }}
          />
          <span style={{ fontSize:12, color:'var(--text-muted)' }}>{balance.auto_saisis}/{balance.nb_auto} missions saisies</span>
          {[
            { label: 'AUTO provision', val: fmt(balance.auto_provision), color: '#888', flag: null },
            { label: 'AUTO réel', val: ecartAuto != null ? fmt(balance.auto_reel) : '—',
              color: ecartAuto != null ? (ecartAuto > 0 ? '#dc2626' : '#16a34a') : '#888',
              flag: ecartAuto != null ? (ecartAuto > 0 ? '🔴 ' : '🟢 ') + fmtEcart(ecartAuto) : null },
            { label: 'FMEN provision', val: fmt(balance.fmen_provision), color: '#888', flag: null },
            { label: 'FMEN réel', val: ecartFmen != null ? fmt(balance.fmen_reel) : '—',
              color: ecartFmen != null ? (ecartFmen < 0 ? '#16a34a' : '#dc2626') : '#888',
              flag: ecartFmen != null ? (ecartFmen < 0 ? '🟢 ' : '🔴 ') + fmtEcart(ecartFmen) : null },
          ].map(item => (
            <div key={item.label} style={{ background:'var(--bg-card,#fff)', border:'1px solid var(--border,#e5e7eb)', borderRadius:10, padding:'10px 16px', minWidth:150 }}>
              <div style={{ fontSize:11, color:'var(--text-muted,#888)', marginBottom:4 }}>{item.label}</div>
              <div style={{ fontSize:18, fontWeight:600, color: item.color }}>{item.val}</div>
              {item.flag && <div style={{ fontSize:11, color: item.color, marginTop:2 }}>{item.flag}</div>}
            </div>
          ))}
        </div>
      )
    })()}
}