import { useState, useEffect, useCallback } from 'react'
import MoisSelector, { MOIS_FR } from '../components/MoisSelector'
import { supabase } from '../lib/supabase'
import {
  getBienNote, saveBienNote, getReviewsMois,
  getKPIsMois, genererRapportHTML, envoyerRapportEmail
} from '../services/rapportProprietaire'

const moisCourant = new Date().toISOString().substring(0, 7)

const STATUTS = {
  idle:    { label: 'Non envoyé', color: '#9C8E7D', bg: '#F0EBE1' },
  sending: { label: 'Envoi…',     color: '#D97706', bg: '#FEF3C7' },
  sent:    { label: 'Envoyé ✓',   color: '#059669', bg: '#D1FAE5' },
  error:   { label: 'Erreur',     color: '#DC2626', bg: '#FEE2E2' },
}

export default function PageRapports() {
  const [mois, setMois] = useState(moisCourant)
  const [moisDispos, setMoisDispos] = useState([moisCourant])
  const [proprietaires, setProprietaires] = useState([])
  const [reviews, setReviews] = useState([])
  const [notes, setNotes]    = useState({})
  const [kpis, setKpis]      = useState({})
  const [statuts, setStatuts] = useState({})
  const [emails, setEmails] = useState({})
  const [previewProp, setPreviewProp] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]    = useState(null)

  useEffect(() => {
    supabase.from('reservation').select('mois_comptable').then(res => {
      if (res.data) {
        const uniq = [...new Set(res.data.map(d => d.mois_comptable).filter(Boolean))].sort((a, b) => b.localeCompare(a))
        if (uniq.length) setMoisDispos(uniq)
      }
    })
  }, [])

  const charger = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: props } = await supabase
        .from('proprietaire')
        .select('id, nom, email, bien(id, hospitable_name, actif)')
        .eq('actif', true)
        .order('nom')
      setProprietaires(props || [])
      const emailMap = {}
      for (const p of props || []) emailMap[p.id] = p.email || ''
      setEmails(emailMap)

      const kpisMap = {}
      await Promise.all((props || []).map(async p => {
        kpisMap[p.id] = await getKPIsMois(p.id, mois)
      }))
      setKpis(kpisMap)

      const bienIds = (props || []).flatMap(p => (p.bien || []).map(b => b.id))
      if (bienIds.length) {
        const { data: notesData } = await supabase
          .from('bien_notes')
          .select('bien_id, note_marche')
          .in('bien_id', bienIds)
          .eq('mois', mois)
        const notesMap = {}
        for (const n of notesData || []) notesMap[n.bien_id] = n.note_marche || ''
        setNotes(notesMap)
      }

      setReviews(await getReviewsMois(mois))
      setStatuts({})
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [mois])

  useEffect(() => { charger() }, [charger])

  function handleNoteChange(bienId, val) {
    setNotes(n => ({ ...n, [bienId]: val }))
  }
  async function handleNoteBlur(bienId) {
    try { await saveBienNote(bienId, mois, notes[bienId] || '') } catch (e) { console.error(e) }
  }

  async function handleEmailBlur(proprioId) {
    const val = (emails[proprioId] || '').trim()
    try {
      await supabase.from('proprietaire').update({ email: val || null }).eq('id', proprioId)
    } catch (e) { console.error('saveEmail:', e) }
  }

  function buildRapportData(proprio) {
    const propReviews = reviews.filter(r => r.reservation?.bien?.proprietaire_id === proprio.id)
    const propNotes   = (proprio.bien || []).map(b => ({ bienName: b.hospitable_name, note: notes[b.id] || '' }))
    return { kpis: kpis[proprio.id] || {}, resas: [], reviews: propReviews, notes: propNotes }
  }

  async function envoyer(proprio) {
    setStatuts(s => ({ ...s, [proprio.id]: 'sending' }))
    try {
      const data = buildRapportData(proprio)
      const { data: resas } = await supabase
        .from('reservation')
        .select('id, fin_revenue, nights, arrival_date, bien:bien_id(hospitable_name)')
        .eq('mois_comptable', mois)
        .neq('final_status', 'cancelled')
        .in('bien_id', (proprio.bien || []).map(b => b.id))
      data.resas = resas || []
      const html = genererRapportHTML(proprio, mois, data)
      await envoyerRapportEmail({ ...proprio, email: emails[proprio.id] }, mois, html)
      setStatuts(s => ({ ...s, [proprio.id]: 'sent' }))
    } catch (e) {
      console.error(e)
      setStatuts(s => ({ ...s, [proprio.id]: 'error' }))
    }
  }

  async function envoyerATous() {
    const cibles = proprietaires.filter(p => emails[p.id] && (kpis[p.id]?.nbResas || 0) > 0)
    if (!cibles.length) return
    if (!confirm(`Envoyer le rapport à ${cibles.length} propriétaire(s) pour ${mois} ?`)) return
    for (const p of cibles) await envoyer(p)
  }

  const [year, monthIdx] = mois.split('-')
  const moisLabel = MOIS_FR[parseInt(monthIdx) - 1] + ' ' + year
  const fmt = c => ((c || 0) / 100).toFixed(2).replace('.', ',') + ' €'

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '1.4em', fontWeight: 700, color: 'var(--text)', flex: 1 }}>
          Rapports propriétaires
        </h1>
        <MoisSelector mois={mois} setMois={setMois} moisDispos={moisDispos} />
        <button className="btn btn-primary" onClick={envoyerATous} disabled={loading}
          style={{ background: 'var(--brand)', color: '#fff', border: 'none' }}>
          Envoyer à tous
        </button>
      </div>

      {error && <div style={{ background: '#FEE2E2', color: '#DC2626', padding: '10px 14px', borderRadius: 8, marginBottom: 16 }}>{error}</div>}
      {loading && <div style={{ color: 'var(--text-muted)', marginBottom: 16 }}>Chargement…</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {proprietaires.map(proprio => {
          const k = kpis[proprio.id] || {}
          const statut = statuts[proprio.id] || 'idle'
          const st = STATUTS[statut]
          const propReviews = reviews.filter(r => r.reservation?.bien?.proprietaire_id === proprio.id)

          return (
            <div key={proprio.id} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', background: '#EAE3D4', borderBottom: '2px solid var(--brand)', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: '1.05em' }}>{proprio.nom}</span>
                  <input
                    type="email"
                    value={emails[proprio.id] ?? ''}
                    onChange={e => setEmails(em => ({ ...em, [proprio.id]: e.target.value }))}
                    onBlur={() => handleEmailBlur(proprio.id)}
                    placeholder="Email (pour les rapports)"
                    style={{
                      fontSize: '0.83em', padding: '3px 8px',
                      border: `1px solid ${emails[proprio.id] ? '#059669' : '#D97706'}`,
                      borderRadius: 6,
                      background: emails[proprio.id] ? '#F0FDF4' : '#FFFBEB',
                      color: 'var(--text)', width: 220, outline: 'none',
                    }}
                  />
                  <span style={{ fontSize: '0.9em', color: emails[proprio.id] ? '#059669' : '#D97706' }}>
                    {emails[proprio.id] ? '✓' : '⚠'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 16, fontSize: '0.85em', color: '#4A3728' }}>
                  <span><strong>{k.nbResas || 0}</strong> rés.</span>
                  <span><strong>{fmt(k.caHeb)}</strong> CA</span>
                  <span><strong>{fmt(k.loyTotal)}</strong> LOY</span>
                </div>
                <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: '0.8em', fontWeight: 600, background: st.bg, color: st.color }}>
                  {st.label}
                </span>
                <button className="btn btn-secondary" style={{ fontSize: '0.85em', padding: '4px 12px' }}
                  onClick={() => setPreviewProp(previewProp?.id === proprio.id ? null : proprio)}>
                  {previewProp?.id === proprio.id ? 'Fermer' : 'Aperçu'}
                </button>
                <button className="btn btn-primary" style={{ fontSize: '0.85em', padding: '4px 12px', background: 'var(--brand)', color: '#fff', border: 'none', opacity: statut === 'sending' ? 0.6 : 1 }}
                  onClick={() => envoyer(proprio)} disabled={statut === 'sending' || !emails[proprio.id]}>
                  {statut === 'sending' ? '…' : 'Envoyer'}
                </button>
              </div>

              <div style={{ padding: '14px 20px' }}>
                {(proprio.bien || []).filter(b => b.actif).map(bien => (
                  <div key={bien.id} style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: '0.82em', fontWeight: 600, color: 'var(--brand)', display: 'block', marginBottom: 4 }}>
                      {bien.hospitable_name} — Note de marché
                    </label>
                    <textarea
                      value={notes[bien.id] || ''}
                      onChange={e => handleNoteChange(bien.id, e.target.value)}
                      onBlur={() => handleNoteBlur(bien.id)}
                      placeholder="Commentaire sur le marché, la saison, les tendances…"
                      rows={2}
                      style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px', fontSize: '0.88em', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical', fontFamily: 'inherit' }}
                    />
                  </div>
                ))}

                {propReviews.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: '0.82em', fontWeight: 600, color: '#9C8E7D', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Avis reçus ce mois ({propReviews.length})
                    </div>
                    {propReviews.slice(0, 3).map(r => (
                      <div key={r.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', borderTop: '1px solid var(--border)' }}>
                        <span style={{ color: 'var(--brand)', fontSize: '1em', whiteSpace: 'nowrap' }}>{'★'.repeat(Math.round(r.rating || 0))}</span>
                        <span style={{ fontSize: '0.85em', color: '#4A3728', fontStyle: 'italic' }}>"{r.comment?.substring(0, 100)}{r.comment?.length > 100 ? '…' : ''}"</span>
                        <span style={{ fontSize: '0.78em', color: '#9C8E7D', whiteSpace: 'nowrap' }}>{r.reviewer_name || ''}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {previewProp && (() => {
        const data = buildRapportData(previewProp)
        const html = genererRapportHTML(previewProp, mois, data)
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(44,36,22,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
            onClick={() => setPreviewProp(null)}>
            <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 740, height: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
              onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', background: '#EAE3D4', borderBottom: '2px solid var(--brand)' }}>
                <span style={{ fontWeight: 700, color: 'var(--text)' }}>Aperçu — {previewProp.nom} — {moisLabel}</span>
                <button onClick={() => setPreviewProp(null)} style={{ background: 'none', border: 'none', fontSize: '1.3em', cursor: 'pointer', color: 'var(--text)' }}>✕</button>
              </div>
              <iframe srcDoc={html} style={{ flex: 1, border: 'none', width: '100%' }} title="Aperçu rapport" />
            </div>
          </div>
        )
      })()}
    </div>
  )
}
