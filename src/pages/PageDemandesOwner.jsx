import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { AGENCE } from '../lib/agence'

const PORTAIL_OWNER_API = import.meta.env.VITE_PORTAIL_OWNER_URL || 'https://dcb-portail-owner.vercel.app'

const TYPE_LABELS = {
  blocage_dates: 'Blocage de dates',
  intervention:  'Intervention',
  probleme:      'Signalement',
  estimation:    'Estimation revenus',
  document:      'Demande document',
  question:      'Question',
  autre:         'Autre',
}

const STATUT_CONFIG = {
  recu:     { label: 'Reçu',     bg: '#DBEAFE', color: '#1D4ED8' },
  en_cours: { label: 'En cours', bg: '#FEF3C7', color: '#D97706' },
  traite:   { label: 'Traité',   bg: '#DCFCE7', color: '#15803D' },
  ferme:    { label: 'Fermé',    bg: '#F3F4F6', color: '#6B7280' },
}

const PRIORITE_CONFIG = {
  basse:    { label: 'Basse',   color: '#9CA3AF' },
  normale:  { label: 'Normale', color: '#6B7280' },
  haute:    { label: 'Haute',   color: '#D97706' },
  urgente:  { label: 'Urgente', color: '#DC2626' },
}

export default function PageDemandesOwner() {
  const [demandes, setDemandes] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [filtreStatut, setFiltreStatut] = useState('ouvert') // ouvert | ferme | tout
  const [filtreType, setFiltreType] = useState('')
  const [stats, setStats] = useState({ recu: 0, en_cours: 0, traite: 0, ferme: 0 })

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('owner_requests')
      .select(`
        *,
        proprietaire(id, nom, prenom, email),
        bien(id, code, hospitable_name)
      `)
      .eq('agence', AGENCE)
      .order('created_at', { ascending: false })

    setDemandes(data || [])

    const s = { recu: 0, en_cours: 0, traite: 0, ferme: 0 }
    for (const d of (data || [])) s[d.statut] = (s[d.statut] ?? 0) + 1
    setStats(s)
    setLoading(false)
  }

  const filtrees = demandes.filter(d => {
    if (filtreStatut === 'ouvert' && !['recu', 'en_cours'].includes(d.statut)) return false
    if (filtreStatut === 'ferme' && !['traite', 'ferme'].includes(d.statut)) return false
    if (filtreType && d.type !== filtreType) return false
    return true
  })

  return (
    <div className="page-container">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>Demandes propriétaires</h1>
        <button className="btn btn-secondary btn-sm" onClick={load}>↺ Actualiser</button>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {Object.entries(STATUT_CONFIG).map(([key, c]) => (
          <div key={key} style={{ background: c.bg, color: c.color, borderRadius: 8, padding: '10px 16px', minWidth: 90 }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{stats[key] ?? 0}</div>
            <div style={{ fontSize: 11, fontWeight: 600, marginTop: 2 }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* Filtres */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {[['ouvert','En cours'], ['ferme','Traités'], ['tout','Tout']].map(([val, label]) => (
            <button key={val} onClick={() => setFiltreStatut(val)}
              style={{ padding: '7px 14px', border: 'none', background: filtreStatut === val ? 'var(--brand)' : 'white', color: filtreStatut === val ? 'white' : 'var(--text-muted)', fontSize: 13, fontWeight: filtreStatut === val ? 700 : 400, cursor: 'pointer' }}>
              {label}
            </button>
          ))}
        </div>
        <select value={filtreType} onChange={e => setFiltreType(e.target.value)}
          style={{ padding: '7px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, color: 'var(--text)', background: 'white' }}>
          <option value="">Tous types</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {/* Liste */}
      {loading && <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement…</div>}

      {!loading && filtrees.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', background: 'white', borderRadius: 12, border: '1px solid var(--border)' }}>
          Aucune demande
        </div>
      )}

      {!loading && (
        <div style={{ display: 'flex', gap: 16 }}>
          {/* Liste */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {filtrees.map(d => {
              const sc = STATUT_CONFIG[d.statut] ?? STATUT_CONFIG.recu
              const pc = PRIORITE_CONFIG[d.priorite] ?? PRIORITE_CONFIG.normale
              const isSelected = selected?.id === d.id
              return (
                <div key={d.id}
                  onClick={() => setSelected(isSelected ? null : d)}
                  style={{
                    background: isSelected ? '#FFFBF0' : 'white',
                    border: `1.5px solid ${isSelected ? 'var(--brand)' : 'var(--border)'}`,
                    borderRadius: 10, padding: '14px 16px', marginBottom: 8, cursor: 'pointer',
                    transition: 'all 0.1s',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                          {d.proprietaire?.nom} {d.proprietaire?.prenom}
                        </span>
                        {d.bien && (
                          <span style={{ fontSize: 11, background: '#E8E0D0', color: '#6B5E4E', padding: '2px 7px', borderRadius: 4, fontWeight: 600 }}>
                            {d.bien.code || d.bien.hospitable_name}
                          </span>
                        )}
                        <span style={{ fontSize: 11, color: pc.color, fontWeight: 600 }}>● {pc.label}</span>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--brand)', marginBottom: 4 }}>
                        {TYPE_LABELS[d.type] || d.type}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {d.message}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                      <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 100, background: sc.bg, color: sc.color, fontWeight: 600 }}>
                        {sc.label}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {new Date(d.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Panneau détail + réponse */}
          {selected && (
            <div style={{ width: 360, flexShrink: 0 }}>
              <PanneauReponse
                demande={selected}
                onUpdated={updated => {
                  setDemandes(prev => prev.map(d => d.id === updated.id ? { ...d, ...updated } : d))
                  setSelected(prev => ({ ...prev, ...updated }))
                }}
                onClose={() => setSelected(null)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PanneauReponse({ demande, onUpdated, onClose }) {
  const [reponse, setReponse] = useState(demande.reponse_dcb || '')
  const [statut, setStatut] = useState(demande.statut)
  const [priorite, setPriorite] = useState(demande.priorite)
  const [saving, setSaving] = useState(false)
  const [ok, setOk] = useState(false)

  const sc = STATUT_CONFIG[statut] ?? STATUT_CONFIG.recu

  async function sauvegarder() {
    setSaving(true)
    const { data: { session } } = await supabase.auth.getSession()
    const payload = {
      statut,
      priorite,
      reponse_dcb: reponse.trim() || null,
      repondu_le:  reponse.trim() ? new Date().toISOString() : demande.repondu_le,
      repondu_par: session?.user?.id ?? null,
    }
    const { error } = await supabase
      .from('owner_requests')
      .update(payload)
      .eq('id', demande.id)

    if (!error) {
      onUpdated(payload)
      setOk(true)
      setTimeout(() => setOk(false), 2000)

      // Notifier le proprio si une réponse vient d'être rédigée (fire & forget)
      const aRepondu = reponse.trim() && reponse.trim() !== (demande.reponse_dcb || '').trim()
      if (aRepondu && demande.proprietaire_id) {
        fetch(`${PORTAIL_OWNER_API}/api/notify-proprio`, {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            proprio_id: demande.proprietaire_id,
            type: 'demande_reponse',
            extra: { reponse: reponse.trim() },
          }),
        }).catch(() => {})
      }
    }
    setSaving(false)
  }

  return (
    <div style={{ background: 'white', border: '1.5px solid var(--border)', borderRadius: 12, overflow: 'hidden', position: 'sticky', top: 80 }}>
      {/* Header */}
      <div style={{ background: 'var(--cream-dark, #EAE3D4)', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>
          {demande.proprietaire?.nom} {demande.proprietaire?.prenom}
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: 'var(--text-muted)', cursor: 'pointer' }}>✕</button>
      </div>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Infos demande */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--brand)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>
            {TYPE_LABELS[demande.type]}
          </div>
          {demande.bien && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
              Bien : {demande.bien.code || demande.bien.hospitable_name}
            </div>
          )}
          {(demande.date_debut || demande.date_fin) && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
              Dates : {demande.date_debut} → {demande.date_fin}
            </div>
          )}
          <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, background: 'var(--cream, #F7F3EC)', borderRadius: 8, padding: '10px 12px' }}>
            {demande.message}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
            {new Date(demande.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: 0 }} />

        {/* Statut + Priorité */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 5, letterSpacing: 1, textTransform: 'uppercase' }}>Statut</label>
            <select value={statut} onChange={e => setStatut(e.target.value)}
              style={{ width: '100%', padding: '7px 10px', border: `1.5px solid ${sc.color}`, borderRadius: 7, fontSize: 13, color: sc.color, fontWeight: 600, background: sc.bg }}>
              {Object.entries(STATUT_CONFIG).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 5, letterSpacing: 1, textTransform: 'uppercase' }}>Priorité</label>
            <select value={priorite} onChange={e => setPriorite(e.target.value)}
              style={{ width: '100%', padding: '7px 10px', border: '1.5px solid var(--border)', borderRadius: 7, fontSize: 13 }}>
              {Object.entries(PRIORITE_CONFIG).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
            </select>
          </div>
        </div>

        {/* Réponse */}
        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 5, letterSpacing: 1, textTransform: 'uppercase' }}>
            Réponse DCB {demande.repondu_le && <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· répondu le {new Date(demande.repondu_le).toLocaleDateString('fr-FR')}</span>}
          </label>
          <textarea
            value={reponse}
            onChange={e => setReponse(e.target.value)}
            placeholder="Votre réponse au propriétaire…"
            style={{ width: '100%', minHeight: 100, padding: '10px 12px', border: '1.5px solid var(--border)', borderRadius: 8, fontSize: 13, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
          />
        </div>

        {ok && <div style={{ background: '#DCFCE7', color: '#15803D', borderRadius: 7, padding: '8px 12px', fontSize: 13 }}>✓ Sauvegardé</div>}

        <button className="btn btn-primary" disabled={saving} onClick={sauvegarder} style={{ width: '100%' }}>
          {saving ? 'Enregistrement…' : 'Sauvegarder'}
        </button>
      </div>
    </div>
  )
}
