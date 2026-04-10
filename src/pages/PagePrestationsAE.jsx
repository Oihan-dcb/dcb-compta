import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useMoisPersisted } from '../hooks/useMoisPersisted'

const STATUT_LABEL = { en_attente: 'En attente', valide: 'Validé', annule: 'Annulé' }
const STATUT_COLOR = { en_attente: '#f59e0b', valide: '#16a34a', annule: '#dc2626' }
const IMPUTATION_LABEL = { deduction_loy: 'Déduction LOY proprio', debours_proprio: 'Facture débours proprio', dcb_direct: 'Facturé à DCB 🌅' }

export default function PagePrestationsAE() {
  const [prestations, setPrestations] = useState([])
  const [aes, setAes] = useState([])
  const [biens, setBiens] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtre, setFiltre] = useState('en_attente') // 'en_attente' | 'valide' | 'annule' | 'tous'
  const [mois, setMois] = useMoisPersisted()
  const [editing, setEditing] = useState(null)
  const [formEdit, setFormEdit] = useState({})
  const [resasDisponibles, setResasDisponibles] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [confirmModal, setConfirmModal] = useState(null)

  useEffect(() => {
    charger()
    // Realtime : rafraîchit automatiquement quand une prestation est créée/modifiée
    const channel = supabase.channel('phf-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prestation_hors_forfait' },
        () => charger()
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [mois, filtre])

  async function charger() {
    setLoading(true)
    setError(null)
    try {
      let q = supabase
        .from('prestation_hors_forfait')
        .select(`
          *,
          ae:ae_id(nom, prenom, taux_horaire),
          bien:bien_id(code, hospitable_name),
          type:prestation_type_id(nom, unite, taux_defaut),
          mission:mission_id(date_mission, titre_ical)
        `)
        .eq('mois', mois)
        .order('created_at', { ascending: false })

      if (filtre !== 'tous') q = q.eq('statut', filtre)

      const { data, error: err } = await q
      if (err) throw err
      setPrestations(data || [])

      const [{ data: aesData }, { data: biensData }] = await Promise.all([
        supabase.from('auto_entrepreneur').select('id, nom, prenom').order('nom'),
        supabase.from('bien').select('id, code, hospitable_name').eq('agence', 'dcb').eq('listed', true).order('code')
      ])
      setAes(aesData || [])
      setBiens(biensData || [])
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  async function chargerResasBien(bienId) {
    if (!bienId) { setResasDisponibles([]); return }
    const [annee, moisNum] = mois.split('-').map(Number)
    const prevMois = moisNum === 1
      ? `${annee-1}-12-01`
      : `${annee}-${String(moisNum-1).padStart(2,'0')}-01`
    const nextMois = moisNum === 12
      ? `${annee+1}-01-28`
      : `${annee}-${String(moisNum+1).padStart(2,'0')}-28`
    const { data } = await supabase
      .from('reservation')
      .select('id, guest_name, arrival_date, departure_date, nights')
      .eq('bien_id', bienId)
      .gte('departure_date', prevMois)
      .lte('arrival_date', nextMois)
      .not('final_status', 'in', '("cancelled","not_accepted","declined","expired")')
      .order('arrival_date')
    setResasDisponibles(data || [])
  }

  async function valider(id) {
    setSaving(true)
    try {
      await supabase.from('prestation_hors_forfait')
        .update({ statut: 'valide', valide_par: 'DCB', valide_at: new Date().toISOString() })
        .eq('id', id)
      setSuccess('Prestation validée ✓')
      await charger()
      setTimeout(() => setSuccess(null), 2000)
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  async function annuler(id) {
    setConfirmModal({
      message: 'Annuler cette prestation ?\nElle passera en statut \u00ab annulée \u00bb.',
      onConfirm: async () => {
        setConfirmModal(null)
        setSaving(true)
        try {
          await supabase.from('prestation_hors_forfait')
            .update({ statut: 'annule', valide_par: 'DCB', valide_at: new Date().toISOString() })
            .eq('id', id)
          setSuccess('Prestation annulée')
          await charger()
          setTimeout(() => setSuccess(null), 2000)
        } catch (err) { setError(err.message) }
        finally { setSaving(false) }
      }
    })
  }

  async function sauvegarderModif() {
    setSaving(true)
    setError(null)
    try {
      const updates = {
        bien_id: formEdit.bien_id || null,
        date_prestation: formEdit.date_prestation || null,
        mois: formEdit.date_prestation ? formEdit.date_prestation.slice(0, 7) : null,
        duree_minutes: parseInt(formEdit.duree_minutes) || null,
        montant: Math.round(parseFloat(formEdit.montant_eur || 0) * 100),
        description: formEdit.description || null,
        type_imputation: formEdit.type_imputation || 'deduction_loy',
        reservation_id: formEdit.reservation_id || null,
        updated_at: new Date().toISOString()
      }
      await supabase.from('prestation_hors_forfait').update(updates).eq('id', editing)
      setSuccess('Modifications enregistrées ✓')
      setEditing(null)
      await charger()
      setTimeout(() => setSuccess(null), 2000)
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  const fmt = c => c ? (c / 100).toFixed(2) + ' €' : '—'
  const totalEnAttente = prestations.filter(p => p.statut === 'en_attente').reduce((s, p) => s + (p.montant || 0), 0)
  const totalValide = prestations.filter(p => p.statut === 'valide').reduce((s, p) => s + (p.montant || 0), 0)

  const TAB = (val, label, count) => (
    <button onClick={() => setFiltre(val)}
      style={{ padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
        background: filtre === val ? '#1a3a6e' : '#f3f4f6', color: filtre === val ? '#fff' : '#555' }}>
      {label} {count !== undefined && <span style={{ opacity: .7 }}>({count})</span>}
    </button>
  )

  const nbEnAttente = prestations.filter(p => p.statut === 'en_attente').length

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Prestations hors forfait</h1>
          <p style={{ margin: '4px 0 0', color: '#666', fontSize: 14 }}>Soumises par les AEs — à valider avant imputation</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => { const d = new Date(mois + '-01'); d.setMonth(d.getMonth()-1); setMois(d.toISOString().slice(0,7)) }}
            style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 7, padding: '6px 12px', cursor: 'pointer' }}>‹</button>
          <span style={{ fontWeight: 700, fontSize: 15, minWidth: 110, textAlign: 'center' }}>
            {new Date(mois + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
          </span>
          <button onClick={() => { const d = new Date(mois + '-01'); d.setMonth(d.getMonth()+1); setMois(d.toISOString().slice(0,7)) }}
            style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 7, padding: '6px 12px', cursor: 'pointer' }}>›</button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 20 }}>
        {[
          { label: 'En attente', val: totalEnAttente, count: prestations.filter(p=>p.statut==='en_attente').length, color: '#f59e0b', bg: '#fffbeb' },
          { label: 'Validées', val: totalValide, count: prestations.filter(p=>p.statut==='valide').length, color: '#16a34a', bg: '#f0fdf4' },
          { label: 'Annulées', val: prestations.filter(p=>p.statut==='annule').reduce((s,p)=>s+(p.montant||0),0), count: prestations.filter(p=>p.statut==='annule').length, color: '#dc2626', bg: '#fef2f2' },
        ].map(s => (
          <div key={s.label} style={{ background: s.bg, borderRadius: 10, padding: '14px 18px', border: `1px solid ${s.color}33` }}>
            <div style={{ fontSize: 12, color: '#666', textTransform: 'uppercase', fontWeight: 600 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.color, margin: '4px 0 2px' }}>{fmt(s.val)}</div>
            <div style={{ fontSize: 12, color: '#888' }}>{s.count} prestation(s)</div>
          </div>
        ))}
      </div>

      {success && <div style={{ background: '#DCFCE7', borderRadius: 8, padding: '10px 16px', marginBottom: 14, fontSize: 13, color: '#15803D' }}>✓ {success}</div>}
      {error && <div style={{ background: '#FEE2E2', borderRadius: 8, padding: '10px 16px', marginBottom: 14, fontSize: 13, color: '#B91C1C' }}>✕ {error}</div>}

      {/* Filtres */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {TAB('en_attente', '⏳ En attente', prestations.filter(p=>p.statut==='en_attente').length)}
        {TAB('valide', '✓ Validées', prestations.filter(p=>p.statut==='valide').length)}
        {TAB('annule', '✕ Annulées', prestations.filter(p=>p.statut==='annule').length)}
        {TAB('tous', 'Toutes')}
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>Chargement...</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {prestations.length === 0 && (
            <div style={{ textAlign: 'center', padding: 60, background: '#fff', borderRadius: 12, color: '#aaa', border: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
              <div style={{ fontWeight: 600 }}>Aucune prestation {filtre !== 'tous' ? STATUT_LABEL[filtre]?.toLowerCase() : ''} ce mois</div>
            </div>
          )}
          {prestations.map(p => (
            <div key={p.id} style={{ background: '#fff', borderRadius: 10, border: `1.5px solid ${STATUT_COLOR[p.statut]}33`, overflow: 'hidden' }}>
              <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                {/* Indicateur statut */}
                <div style={{ width: 4, alignSelf: 'stretch', borderRadius: 4, background: STATUT_COLOR[p.statut], flexShrink: 0, minHeight: 40 }} />

                {/* Infos principales */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{p.type?.nom || 'Prestation'}</span>
                    <span style={{ background: '#f3f4f6', borderRadius: 5, padding: '2px 8px', fontSize: 12, color: '#555' }}>
                      🏠 {p.bien?.hospitable_name || p.bien?.code || '—'}
                    </span>
                    <span style={{ background: '#FFF8EC', borderRadius: 5, padding: '2px 8px', fontSize: 12, color: '#CC9933', border: '1px solid #E4A853' }}>
                      🧹 {p.ae?.prenom} {p.ae?.nom}
                    </span>
                    {p.mission?.date_mission && (
                      <span style={{ fontSize: 12, color: '#888' }}>
                        📅 {new Date(p.mission.date_mission + 'T12:00:00').toLocaleDateString('fr-FR')}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 16, fontSize: 13, color: '#666', flexWrap: 'wrap' }}>
                    {p.duree_minutes && <span>⏱ {p.duree_minutes} min</span>}
                    {p.description && <span style={{ fontStyle: 'italic' }}>"{p.description}"</span>}
                    <span style={{ color: '#888', fontSize: 12 }}>
                      Imputation : {IMPUTATION_LABEL[p.type_imputation] || p.type_imputation}
                    </span>
                  </div>
                  {p.valide_par && (
                    <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>
                      {p.statut === 'valide' ? 'Validé' : 'Annulé'} par {p.valide_par} le {new Date(p.valide_at).toLocaleDateString('fr-FR')}
                    </div>
                  )}
                </div>

                {/* Montant + actions */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: STATUT_COLOR[p.statut] }}>{fmt(p.montant)}</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => { setEditing(p.id); setFormEdit({ bien_id: p.bien_id, date_prestation: p.date_prestation, duree_minutes: p.duree_minutes, montant_eur: p.montant ? (p.montant/100).toFixed(2) : '', description: p.description || '', type_imputation: p.type_imputation || 'deduction_loy', reservation_id: p.reservation_id || '' }); chargerResasBien(p.bien_id) }}
                      style={{ background: '#f3f4f6', border: 'none', borderRadius: 6, padding: '5px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
                      ✏️ Modifier
                    </button>
                    {p.statut === 'en_attente' && <>
                      <button onClick={() => valider(p.id)} disabled={saving}
                        style={{ background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0', borderRadius: 6, padding: '5px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}>
                        ✓ Valider
                      </button>
                      <button onClick={() => annuler(p.id)} disabled={saving}
                        style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 6, padding: '5px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}>
                        ✕ Annuler
                      </button>
                    </>}
                    {p.statut === 'valide' && (
                      <button onClick={() => annuler(p.id)} disabled={saving}
                        style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 6, padding: '5px 10px', fontSize: 12, cursor: 'pointer' }}>
                        Annuler
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal modification */}
      {editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 28, width: '100%', maxWidth: 500, boxShadow: '0 20px 60px rgba(0,0,0,.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Modifier la prestation</h2>
              <button onClick={() => setEditing(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#888' }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>Bien</label>
                <select value={formEdit.bien_id || ''} onChange={e => { const v = e.target.value; setFormEdit(f => ({ ...f, bien_id: v, reservation_id: '' })); chargerResasBien(v) }}
                  style={{ padding: '8px 10px', borderRadius: 7, border: '1.5px solid #e5e7eb', fontSize: 13 }}>
                  <option value="">— Sélectionner —</option>
                  {biens.map(b => <option key={b.id} value={b.id}>{b.code} — {b.hospitable_name}</option>)}
                </select>
              </div>
              {['deduction_loy','debours_proprio'].includes(formEdit.type_imputation) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>Réservation liée (optionnel)</label>
                  <select
                    value={formEdit.reservation_id || ''}
                    onChange={e => setFormEdit(f => ({ ...f, reservation_id: e.target.value }))}
                    disabled={!formEdit.bien_id}
                    style={{ padding: '8px 10px', borderRadius: 7, border: '1.5px solid #e5e7eb', fontSize: 13, background: formEdit.bien_id ? '#fff' : '#f9fafb', color: '#2C2416' }}
                  >
                    <option value="">— Sans réservation liée —</option>
                    {resasDisponibles.map(r => {
                      const fmtD = d => d ? d.substring(5).split('-').reverse().join('/') : '?'
                      return (
                        <option key={r.id} value={r.id}>
                          {r.guest_name} · {fmtD(r.arrival_date)} → {fmtD(r.departure_date)} ({r.nights}n)
                        </option>
                      )
                    })}
                  </select>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>Date</label>
                  <input type="date" value={formEdit.date_prestation || ''} onChange={e => setFormEdit(f => ({ ...f, date_prestation: e.target.value }))}
                    style={{ padding: '8px 10px', borderRadius: 7, border: '1.5px solid #e5e7eb', fontSize: 13 }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>Durée (min)</label>
                  <input type="number" min="0" value={formEdit.duree_minutes || ''} onChange={e => setFormEdit(f => ({ ...f, duree_minutes: e.target.value }))}
                    style={{ padding: '8px 10px', borderRadius: 7, border: '1.5px solid #e5e7eb', fontSize: 13 }} />
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>Montant (€)</label>
                <input type="number" step="0.01" min="0" value={formEdit.montant_eur || ''} onChange={e => setFormEdit(f => ({ ...f, montant_eur: e.target.value }))}
                  style={{ padding: '8px 10px', borderRadius: 7, border: '1.5px solid #e5e7eb', fontSize: 13 }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>Description</label>
                <input value={formEdit.description || ''} onChange={e => setFormEdit(f => ({ ...f, description: e.target.value }))}
                  style={{ padding: '8px 10px', borderRadius: 7, border: '1.5px solid #e5e7eb', fontSize: 13 }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>Imputation comptable</label>
                <select value={formEdit.type_imputation || 'deduction_loy'} onChange={e => { const v = e.target.value; setFormEdit(f => ({ ...f, type_imputation: v, ...(!['deduction_loy','debours_proprio'].includes(v) && { reservation_id: '' }) })) }}
                  style={{ padding: '8px 10px', borderRadius: 7, border: '1.5px solid #e5e7eb', fontSize: 13 }}>
                  <option value="deduction_loy">Déduction LOY propriétaire</option>
                  <option value="debours_proprio">Facture débours propriétaire</option>
                  <option value="dcb_direct">Facturé à DCB 🌅 (Pick'n'Drop, Lingerie)</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={() => setEditing(null)} style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>Annuler</button>
              <button onClick={sauvegarderModif} disabled={saving}
                style={{ background: '#1a3a6e', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                {saving ? '...' : '✓ Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}
          {confirmModal && (
        <div style={{ position:'fixed',inset:0,background:'rgba(44,36,22,0.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000 }}>
          <div style={{ background:'var(--bg,#F7F3EC)',border:'2px solid var(--brand,#CC9933)',borderRadius:16,padding:'28px 32px',maxWidth:400,width:'90%',boxShadow:'0 8px 32px rgba(44,36,22,0.18)' }}>
            <p style={{ margin:'0 0 24px',color:'var(--text,#2C2416)',fontSize:14,lineHeight:1.6,whiteSpace:'pre-line' }}>{confirmModal.message}</p>
            <div style={{ display:'flex',gap:10,justifyContent:'flex-end' }}>
              <button onClick={() => setConfirmModal(null)}
                style={{ padding:'9px 18px',borderRadius:8,border:'1.5px solid var(--border,#D9CEB8)',background:'white',color:'var(--text,#2C2416)',cursor:'pointer',fontWeight:600,fontSize:13 }}>
                Annuler
              </button>
              <button onClick={confirmModal.onConfirm}
                style={{ padding:'9px 18px',borderRadius:8,border:'none',background:'#DC2626',color:'white',cursor:'pointer',fontWeight:700,fontSize:13 }}>
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}
</div>
  )
}