import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function PortailAE({ token }) {
  const [ae, setAe] = useState(null)
  const [missions, setMissions] = useState([])
  const [prestationTypes, setPrestationTypes] = useState([])
  const [biens, setBiens] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [mois, setMois] = useState(() => new Date().toISOString().slice(0, 7))
  const [showAddPrestation, setShowAddPrestation] = useState(null) // mission_id
  const [formPrestation, setFormPrestation] = useState({ prestation_type_id: '', duree_minutes: 30, description: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (token) charger() }, [token, mois])

  async function charger() {
    setLoading(true)
    setError(null)
    try {
      // Charger l'AE par token
      const { data: aeData, error: aeErr } = await supabase
        .from('auto_entrepreneur')
        .select('*')
        .eq('token_acces', token)
        .single()
      if (aeErr || !aeData) throw new Error('Lien invalide ou expiré')
      setAe(aeData)

      // Charger missions du mois
      const { data: missionsData } = await supabase
        .from('mission_menage')
        .select(`*, bien:bien_id(code, hospitable_name), prestations:prestation_hors_forfait(*,type:prestation_type_id(nom,unite))`)
        .eq('ae_id', aeData.id)
        .eq('mois', mois)
        .order('bien_id')
        .order('date_mission')
      setMissions(missionsData || [])

      // Charger types de prestations
      const { data: ptData } = await supabase
        .from('prestation_type')
        .select('*')
        .eq('actif', true)
        .order('nom')
      setPrestationTypes(ptData || [])

      // Charger biens
      const { data: biensData } = await supabase
        .from('bien')
        .select('id, code, hospitable_name')
        .eq('agence', 'dcb')
        .eq('listed', true)
        .order('code')
      setBiens(biensData || [])

    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  async function sauvegarderDuree(missionId, duree) {
    if (!ae) return
    const taux = ae.taux_horaire || 2500
    const montant = Math.round((parseFloat(duree) || 0) * taux)
    await supabase.from('mission_menage')
      .update({ duree_heures: parseFloat(duree) || null, montant, updated_at: new Date().toISOString() })
      .eq('id', missionId)
    setMissions(ms => ms.map(m => m.id === missionId ? { ...m, duree_heures: duree, montant } : m))
  }

  async function ajouterPrestation(missionId) {
    if (!formPrestation.prestation_type_id) { setError('Sélectionnez un type de prestation'); return }
    setSaving(true); setError(null)
    try {
      const mission = missions.find(m => m.id === missionId)
      const pt = prestationTypes.find(p => p.id === formPrestation.prestation_type_id)
      const taux = ae.taux_horaire || 2500
      const montant = pt?.unite === 'forfait'
        ? (pt.taux_defaut || taux)
        : Math.round((formPrestation.duree_minutes / 60) * taux)

      await supabase.from('prestation_hors_forfait').insert({
        ae_id: ae.id,
        mission_id: missionId,
        prestation_type_id: formPrestation.prestation_type_id,
        bien_id: mission?.bien_id,
        date_prestation: mission?.date_mission,
        duree_minutes: formPrestation.duree_minutes,
        montant,
        description: formPrestation.description,
        statut: 'en_attente',
        mois
      })
      setSuccess('Prestation ajoutée — en attente de validation DCB')
      setShowAddPrestation(null)
      setFormPrestation({ prestation_type_id: '', duree_minutes: 30, description: '' })
      await charger()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  const fmt = (centimes) => centimes ? (centimes / 100).toFixed(2) + ' €' : '—'

  // Grouper missions par bien
  const missionsByBien = missions.reduce((acc, m) => {
    const key = m.bien?.code || 'Inconnu'
    if (!acc[key]) acc[key] = { bien: m.bien, missions: [] }
    acc[key].missions.push(m)
    return acc
  }, {})

  const totalMois = missions.reduce((s, m) => {
    const mt = m.montant || 0
    const extras = (m.prestations || []).filter(p => p.statut === 'valide').reduce((a, p) => a + (p.montant || 0), 0)
    return s + mt + extras
  }, 0)

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
      <div style={{ textAlign: 'center', color: '#888' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🌅</div>
        <div>Chargement...</div>
      </div>
    </div>
  )

  if (error && !ae) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
      <div style={{ textAlign: 'center', background: '#fff', borderRadius: 16, padding: 40, boxShadow: '0 4px 24px rgba(0,0,0,.08)' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>⛔</div>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Lien invalide</div>
        <div style={{ color: '#888', fontSize: 14 }}>{error}</div>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#f0f4f8', fontFamily: 'Arial, sans-serif' }}>
      {/* Header */}
      <div style={{ background: '#1a3a6e', color: '#fff', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 22, fontWeight: 900, letterSpacing: 2 }}>DCB</span>
          <span style={{ fontSize: 13, opacity: .7 }}>Destination Côte Basque</span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 700 }}>{ae?.prenom} {ae?.nom}</div>
          <div style={{ fontSize: 12, opacity: .7 }}>{(ae?.taux_horaire / 100).toFixed(0)} €/h</div>
        </div>
      </div>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: 20 }}>
        {/* Sélecteur mois + total */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => { const d = new Date(mois + '-01'); d.setMonth(d.getMonth()-1); setMois(d.toISOString().slice(0,7)) }}
              style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 16 }}>‹</button>
            <span style={{ fontWeight: 700, fontSize: 16, minWidth: 120, textAlign: 'center' }}>
              {new Date(mois + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
            </span>
            <button onClick={() => { const d = new Date(mois + '-01'); d.setMonth(d.getMonth()+1); setMois(d.toISOString().slice(0,7)) }}
              style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 16 }}>›</button>
          </div>
          <div style={{ background: '#1a3a6e', color: '#fff', borderRadius: 10, padding: '10px 20px', textAlign: 'right' }}>
            <div style={{ fontSize: 11, opacity: .7, textTransform: 'uppercase' }}>Total estimé</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(totalMois)}</div>
          </div>
        </div>

        {success && <div style={{ background: '#DCFCE7', borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: 13, color: '#15803D' }}>✓ {success}</div>}
        {error && <div style={{ background: '#FEE2E2', borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: 13, color: '#B91C1C' }}>✕ {error}</div>}

        {missions.length === 0 && (
          <div style={{ textAlign: 'center', padding: 60, background: '#fff', borderRadius: 12, color: '#aaa' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📅</div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Aucune mission ce mois</div>
            <div style={{ fontSize: 13 }}>Les missions sont synchronisées depuis votre calendrier iCal</div>
          </div>
        )}

        {/* Missions groupées par bien */}
        {Object.entries(missionsByBien).map(([bienCode, { bien, missions: bMissions }]) => (
          <div key={bienCode} style={{ background: '#fff', borderRadius: 12, marginBottom: 16, overflow: 'hidden', boxShadow: '0 1px 6px rgba(0,0,0,.06)' }}>
            <div style={{ background: '#1a3a6e', color: '#fff', padding: '10px 16px', fontWeight: 700, fontSize: 14 }}>
              🏠 {bien?.hospitable_name || bienCode}
            </div>
            {bMissions.map(m => (
              <div key={m.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flexShrink: 0, background: '#f0f4f8', borderRadius: 8, padding: '6px 10px', textAlign: 'center', minWidth: 56 }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#1a3a6e' }}>{new Date(m.date_mission + 'T12:00:00').getDate()}</div>
                    <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase' }}>{new Date(m.date_mission + 'T12:00:00').toLocaleDateString('fr-FR', { month: 'short' })}</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: '#555', marginBottom: 6 }}>{m.titre_ical || 'Ménage départ'}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, color: '#888' }}>Durée :</span>
                      <input
                        type="number" step="0.25" min="0" max="24"
                        defaultValue={m.duree_heures || ''}
                        placeholder="0.00"
                        onBlur={e => sauvegarderDuree(m.id, e.target.value)}
                        style={{ width: 70, padding: '4px 8px', borderRadius: 6, border: '1.5px solid #e5e7eb', fontSize: 13, textAlign: 'center' }}
                      />
                      <span style={{ fontSize: 12, color: '#888' }}>h</span>
                      {m.montant > 0 && <span style={{ fontSize: 13, fontWeight: 700, color: '#16a34a', marginLeft: 4 }}>{fmt(m.montant)}</span>}
                    </div>
                  </div>
                  <button onClick={() => { setShowAddPrestation(m.id); setFormPrestation({ prestation_type_id: '', duree_minutes: 30, description: '' }); setError(null) }}
                    style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', borderRadius: 7, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600, flexShrink: 0 }}>
                    + Prestation
                  </button>
                </div>

                {/* Prestations hors forfait liées */}
                {(m.prestations || []).length > 0 && (
                  <div style={{ padding: '0 16px 12px 84px' }}>
                    {m.prestations.map(p => (
                      <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12 }}>
                        <span style={{ color: p.statut === 'valide' ? '#16a34a' : p.statut === 'annule' ? '#dc2626' : '#f59e0b', fontWeight: 700, fontSize: 10 }}>
                          {p.statut === 'valide' ? '✓' : p.statut === 'annule' ? '✕' : '⏳'}
                        </span>
                        <span style={{ color: '#555' }}>{p.type?.nom || '—'}</span>
                        {p.duree_minutes && <span style={{ color: '#888' }}>{p.duree_minutes} min</span>}
                        <span style={{ color: '#16a34a', fontWeight: 600 }}>{fmt(p.montant)}</span>
                        <span style={{ fontSize: 10, color: '#aaa', background: '#f3f4f6', borderRadius: 4, padding: '1px 5px' }}>
                          {p.statut === 'en_attente' ? 'En attente DCB' : p.statut === 'valide' ? 'Validé' : 'Annulé'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Formulaire ajout prestation */}
                {showAddPrestation === m.id && (
                  <div style={{ margin: '0 16px 14px', background: '#f0f7ff', borderRadius: 10, padding: 14, border: '1px solid #bfdbfe' }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10, color: '#1a3a6e' }}>Ajouter une prestation hors forfait</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: '#666', display: 'block', marginBottom: 4 }}>Type *</label>
                        <select value={formPrestation.prestation_type_id} onChange={e => setFormPrestation(f => ({ ...f, prestation_type_id: e.target.value }))}
                          style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1.5px solid #e5e7eb', fontSize: 13 }}>
                          <option value="">Choisir...</option>
                          {prestationTypes.map(pt => <option key={pt.id} value={pt.id}>{pt.nom} ({(pt.taux_defaut/100).toFixed(0)}€/{pt.unite === 'forfait' ? 'forfait' : 'h'})</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: '#666', display: 'block', marginBottom: 4 }}>Durée (min)</label>
                        <input type="number" min="0" step="5" value={formPrestation.duree_minutes}
                          onChange={e => setFormPrestation(f => ({ ...f, duree_minutes: parseInt(e.target.value) || 0 }))}
                          style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1.5px solid #e5e7eb', fontSize: 13 }} />
                      </div>
                    </div>
                    <div style={{ marginBottom: 10 }}>
                      <label style={{ fontSize: 11, fontWeight: 600, color: '#666', display: 'block', marginBottom: 4 }}>Description (optionnel)</label>
                      <input value={formPrestation.description} onChange={e => setFormPrestation(f => ({ ...f, description: e.target.value }))}
                        placeholder="Ex: Vitres très encrassées, four très sale..."
                        style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1.5px solid #e5e7eb', fontSize: 13 }} />
                    </div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button onClick={() => setShowAddPrestation(null)} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 7, padding: '7px 14px', fontSize: 12, cursor: 'pointer' }}>Annuler</button>
                      <button onClick={() => ajouterPrestation(m.id)} disabled={saving}
                        style={{ background: '#1a3a6e', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                        {saving ? '...' : 'Envoyer pour validation'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}

        <div style={{ textAlign: 'center', fontSize: 11, color: '#aaa', marginTop: 20, paddingBottom: 20 }}>
          Portail Destination Côte Basque 🌅 — Les montants sont indicatifs et sujets à validation
        </div>
      </div>
    </div>
  )
}