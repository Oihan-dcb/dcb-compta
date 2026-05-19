import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { AGENCE } from '../lib/agence'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

const AGENCE_LABELS = { dcb: 'Destination Côte Basque', lauian: 'Lauian Immo', bordeaux: 'Destination Bordeaux' }
const agenceLabel = AGENCE_LABELS[AGENCE] || AGENCE.toUpperCase()

const TABS = ['Dashboard', 'Queue', 'Logs', 'Test', 'Campagnes']

const STATUS_LABEL = { sent: 'Envoyé', error: 'Erreur', no_phone: 'Ignoré', skipped: 'Ignoré', preview: 'Aperçu' }
const STATUS_COLOR = { sent: '#5a8a5a', error: '#b94a4a', no_phone: '#888', skipped: '#888', preview: '#8a7a4a' }
const LANG_FLAG    = { FR: '🇫🇷', EN: '🇬🇧', ES: '🇪🇸' }

export default function PageSmsReviews() {
  const [tab, setTab] = useState(() => localStorage.getItem('tab_msg') || 'Dashboard')
  useEffect(() => localStorage.setItem('tab_msg', tab), [tab])
  const [logs, setLogs]         = useState([])
  const [stats, setStats]       = useState(null)
  const [expandedLog, setExpandedLog] = useState(null)

  // ── Test ──────────────────────────────────────────────────
  const [testHospId, setTestHospId]   = useState('')
  const [testLoading, setTestLoading] = useState(false)
  const [testResult, setTestResult]   = useState(null)  // { preview, lang, guest, property }

  const handleTest = async () => {
    if (!testHospId.trim()) return
    setTestLoading(true)
    setTestResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${SUPABASE_URL}/functions/v1/review-sms-trigger`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ mode: 'test', hospitable_id: testHospId.trim(), agence: AGENCE }),
      })
      const data = await res.json()
      setTestResult(data)
    } catch (e) {
      setTestResult({ ok: false, error: e.message })
    } finally {
      setTestLoading(false)
    }
  }

  // ── Queue ─────────────────────────────────────────────────
  const [queue, setQueue]             = useState([])
  const [loadingQueue, setLoadingQueue] = useState(false)
  const [flushResult, setFlushResult] = useState(null)
  const [flushing, setFlushing]       = useState(false)
  const [expandedQueue, setExpandedQueue] = useState(null)
  const [generatingPreviews, setGeneratingPreviews] = useState(false)
  const [previewResult, setPreviewResult] = useState(null)

  const chargerQueue = useCallback(async () => {
    setLoadingQueue(true)
    try {
      const { data } = await supabase.from('sms_queue').select('*').order('created_at', { ascending: false }).limit(100)
      setQueue(data || [])
    } finally {
      setLoadingQueue(false)
    }
  }, [])

  const callEdge = async (fn, body) => {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(body || {}),
    })
    return res.json()
  }

  const genererApercus = async () => {
    setGeneratingPreviews(true)
    setPreviewResult(null)
    try {
      const data = await callEdge('generate-sms-previews', {})
      setPreviewResult(data)
      chargerQueue()
    } finally {
      setGeneratingPreviews(false)
    }
  }

  const flushQueue = async () => {
    setFlushResult(null)
    setFlushing(true)
    const poll = setInterval(() => chargerQueue(), 800)
    try {
      const data = await callEdge('process-sms-queue', { force: true })
      setFlushResult(data)
    } finally {
      clearInterval(poll)
      setFlushing(false)
      chargerQueue()
      chargerLogs()
    }
  }

  // ── Logs ──────────────────────────────────────────────────
  const chargerLogs = useCallback(async () => {
    const { data } = await supabase.from('sms_logs').select('*').order('sent_at', { ascending: false }).limit(200)
    setLogs(data || [])

    const all  = data || []
    const sent = all.filter(l => l.status === 'sent').length
    const error = all.filter(l => l.status === 'error').length
    const byLang = { FR: 0, EN: 0, ES: 0 }
    all.filter(l => l.status === 'sent').forEach(l => { if (l.language) byLang[l.language] = (byLang[l.language] || 0) + 1 })
    setStats({ total: all.length, sent, error, byLang, taux: all.length ? Math.round(sent / all.length * 100) : 0 })
  }, [])

  // ── Campagnes ─────────────────────────────────────────────
  const [candidats, setCandidats]     = useState([])
  const [selected, setSelected]       = useState(new Set())
  const [campResult, setCampResult]   = useState(null)
  const [loadingCamp, setLoadingCamp] = useState(false)
  const [rowStatus, setRowStatus]     = useState({})

  const chargerCandidats = useCallback(async () => {
    setLoadingCamp(true)
    try {
      const { data: resas } = await supabase
        .from('reservation')
        .select('hospitable_id, guest_name, guest_country, guest_locale, review_rating, departure_date, bien_id, bien!inner(hospitable_name, agence)')
        .eq('bien.agence', AGENCE)
        .gte('review_rating', 5)
        .not('hospitable_id', 'is', null)
        .order('departure_date', { ascending: false })
        .limit(500)

      if (!resas?.length) { setCandidats([]); return }

      // Dédup par hospitable_id déjà contacté
      const hospIds = resas.map(r => r.hospitable_id).filter(Boolean)
      const { data: sentLogs } = hospIds.length
        ? await supabase.from('sms_logs').select('hospitable_reservation_id').eq('status', 'sent').in('hospitable_reservation_id', hospIds)
        : { data: [] }
      const sentIds = new Set((sentLogs || []).map(l => l.hospitable_reservation_id))

      // Commentaires depuis reservation_review
      const bienIds = [...new Set(resas.map(r => r.bien_id).filter(Boolean))]
      const { data: revRows } = await supabase
        .from('reservation_review')
        .select('bien_id, comment, submitted_at')
        .in('bien_id', bienIds)
        .gte('rating', 5)
        .not('comment', 'is', null)

      const commentsByBien = {}
      ;(revRows || []).forEach(r => {
        if (!commentsByBien[r.bien_id]) commentsByBien[r.bien_id] = []
        commentsByBien[r.bien_id].push(r)
      })

      const liste = resas.map(r => {
        const depTs = r.departure_date ? new Date(r.departure_date).getTime() : null
        let comment = null
        if (depTs && commentsByBien[r.bien_id]) {
          const match = commentsByBien[r.bien_id]
            .map(rev => ({ ...rev, diff: new Date(rev.submitted_at).getTime() - depTs }))
            .filter(rev => rev.diff >= 0 && rev.diff < 30 * 86400_000)
            .sort((a, b) => a.diff - b.diff)[0]
          comment = match?.comment || null
        }
        return {
          hospitable_id: r.hospitable_id,
          guest_name:    r.guest_name || '—',
          guest_country: r.guest_country || null,
          guest_locale:  r.guest_locale || null,
          property_name: r.bien?.hospitable_name || '—',
          rating:        r.review_rating,
          comment,
          departure_date: r.departure_date,
          already_sent:  sentIds.has(r.hospitable_id),
        }
      })

      setCandidats(liste)
      setSelected(new Set())
    } finally {
      setLoadingCamp(false)
    }
  }, [])

  const handleCampagne = async () => {
    if (!selected.size) return
    setLoadingCamp(true)
    setCampResult(null)
    setRowStatus({})
    const toSend = candidats.filter(c => selected.has(c.hospitable_id))
    const results = []

    for (const r of toSend) {
      setRowStatus(prev => ({ ...prev, [r.hospitable_id]: 'sending' }))
      try {
        const data = await callEdge('review-sms-trigger', {
          mode: 'campaign',
          agence: AGENCE,
          reservations: [r],
        })
        const res = data.results?.[0]
        setRowStatus(prev => ({ ...prev, [r.hospitable_id]: res?.ok ? 'sent' : 'error' }))
        results.push({ ...res, hospitable_id: r.hospitable_id })
      } catch (e) {
        setRowStatus(prev => ({ ...prev, [r.hospitable_id]: 'error' }))
        results.push({ hospitable_id: r.hospitable_id, ok: false, error: e.message })
      }
    }

    setCampResult({ results })
    setLoadingCamp(false)
    chargerLogs()
    chargerCandidats()
  }

  const toggleAll = () => {
    const selectable = candidats.filter(c => !c.already_sent)
    if (selected.size === selectable.length) setSelected(new Set())
    else setSelected(new Set(selectable.map(c => c.hospitable_id)))
  }

  const toggleOne = (id) => {
    const s = new Set(selected)
    s.has(id) ? s.delete(id) : s.add(id)
    setSelected(s)
  }

  useEffect(() => { chargerLogs() }, [chargerLogs])

  useEffect(() => {
    if (tab === 'Campagnes') chargerCandidats()
    if (tab === 'Queue') chargerQueue()
  }, [tab, chargerCandidats, chargerQueue])

  // ── Rendu ─────────────────────────────────────────────────
  return (
    <div style={{ padding: '2rem', maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text)', marginBottom: '0.25rem' }}>
        Messages Reviews
      </h1>
      <p style={{ color: '#888', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
        Remerciements personnalisés via Hospitable après avis 5⭐
      </p>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '2px solid var(--border)' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '0.5rem 1.25rem', background: 'none', border: 'none', cursor: 'pointer',
            fontWeight: tab === t ? 700 : 400,
            color: tab === t ? 'var(--brand)' : 'var(--text)',
            borderBottom: tab === t ? '2px solid var(--brand)' : '2px solid transparent',
            marginBottom: -2, fontSize: '0.9rem',
          }}>
            {t}
          </button>
        ))}
      </div>

      {/* ── DASHBOARD ── */}
      {tab === 'Dashboard' && stats && stats.total === 0 && (
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '2rem', textAlign: 'center', color: '#999' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📭</div>
          <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: '0.5rem' }}>Aucun message envoyé pour le moment</div>
          <div style={{ fontSize: '0.875rem' }}>Utilisez l'onglet <strong>Test</strong> pour prévisualiser un message, ou <strong>Campagnes</strong> pour contacter vos clients.</div>
        </div>
      )}
      {tab === 'Dashboard' && stats && stats.total > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
            {[
              { label: 'Messages envoyés', value: stats.sent,          sub: 'via Hospitable' },
              { label: 'Taux succès',       value: stats.taux + '%',   sub: `${stats.total} traitées` },
              { label: 'Erreurs',           value: stats.error,        sub: 'à vérifier' },
            ].map(({ label, value, sub }) => (
              <div key={label} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '1.25rem' }}>
                <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--brand)' }}>{value}</div>
                <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: '0.875rem' }}>{label}</div>
                <div style={{ color: '#999', fontSize: '0.75rem' }}>{sub}</div>
              </div>
            ))}
          </div>
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '1.25rem' }}>
            <div style={{ fontWeight: 600, marginBottom: '1rem' }}>Envois par langue</div>
            <div style={{ display: 'flex', gap: '2rem' }}>
              {Object.entries(stats.byLang).map(([lang, count]) => (
                <div key={lang} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.5rem' }}>{LANG_FLAG[lang]}</div>
                  <div style={{ fontWeight: 700, fontSize: '1.25rem' }}>{count}</div>
                  <div style={{ color: '#888', fontSize: '0.75rem' }}>{lang}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── QUEUE ── */}
      {tab === 'Queue' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ color: '#888', fontSize: '0.875rem' }}>
              Messages en attente ({queue.filter(q => q.status === 'pending').length} pending,{' '}
              {queue.filter(q => q.status === 'error').length} erreurs)
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={chargerQueue} style={{ padding: '0.4rem 0.75rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: '0.8rem' }}>
                ↻ Rafraîchir
              </button>
              <button onClick={genererApercus} disabled={generatingPreviews} style={{ padding: '0.4rem 0.75rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, cursor: generatingPreviews ? 'not-allowed' : 'pointer', fontSize: '0.8rem', opacity: generatingPreviews ? 0.6 : 1 }}>
                {generatingPreviews ? '⏳ Génération…' : '💬 Générer aperçus'}
              </button>
              <button onClick={flushQueue} disabled={flushing} style={{ padding: '0.4rem 1rem', background: 'var(--brand)', color: '#fff', border: 'none', borderRadius: 8, cursor: flushing ? 'not-allowed' : 'pointer', fontSize: '0.8rem', fontWeight: 700, opacity: flushing ? 0.7 : 1 }}>
                {flushing ? '⏳ Envoi…' : '▶ Traiter maintenant'}
              </button>
            </div>
          </div>
          {previewResult && (
            <div style={{ marginBottom: '0.5rem', padding: '0.5rem 1rem', borderRadius: 8, fontSize: '0.875rem', fontWeight: 600, background: '#5a8a5a22', color: '#5a8a5a', border: '1px solid #5a8a5a55' }}>
              {previewResult.error ? `Erreur : ${previewResult.error}` : `✓ ${previewResult.updated} aperçu${previewResult.updated !== 1 ? 's' : ''} généré${previewResult.updated !== 1 ? 's' : ''}`}
            </div>
          )}
          {flushResult && (
            <div style={{ marginBottom: '1rem', padding: '0.65rem 1rem', borderRadius: 8, fontSize: '0.875rem', fontWeight: 600,
              background: flushResult.error ? '#b94a4a22' : '#5a8a5a22',
              color: flushResult.error ? '#b94a4a' : '#5a8a5a',
              border: `1px solid ${flushResult.error ? '#b94a4a55' : '#5a8a5a55'}` }}>
              {flushResult.error ? `Erreur : ${flushResult.error}` : `Traité : ${flushResult.processed} · Envoyés : ${flushResult.sent} · Erreurs : ${flushResult.failed}`}
            </div>
          )}
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: '#EAE3D4', borderBottom: '2px solid var(--border)' }}>
                  {['Créé le', 'Envoi prévu', 'Client', 'Propriété', 'Note', 'Aperçu message', 'Statut'].map(h => (
                    <th key={h} style={{ padding: '0.65rem 1rem', textAlign: 'left', fontWeight: 600, color: 'var(--text)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loadingQueue && <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: '#999' }}>Chargement…</td></tr>}
                {!loadingQueue && queue.length === 0 && <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: '#999' }}>Queue vide</td></tr>}
                {queue.map((q, i) => {
                  const isPending  = q.status === 'pending'
                  const isReady    = isPending && new Date(q.send_at) <= new Date()
                  const color      = q.status === 'sent' ? '#5a8a5a' : q.status === 'error' ? '#b94a4a' : isReady ? 'var(--brand)' : '#888'
                  const label      = q.status === 'sent' ? 'Envoyé' : q.status === 'error' ? 'Erreur' : isReady ? 'Prêt' : 'En attente'
                  const isExpanded = expandedQueue === q.id
                  const preview    = q.preview_body || q.comment
                  return (
                    <>
                      <tr key={q.id} style={{ borderBottom: isExpanded ? 'none' : '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : '#faf8f4' }}>
                        <td style={{ padding: '0.6rem 1rem', color: '#888', whiteSpace: 'nowrap' }}>
                          {new Date(q.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td style={{ padding: '0.6rem 1rem', color: isReady ? 'var(--brand)' : '#888', whiteSpace: 'nowrap', fontWeight: isReady ? 700 : 400 }}>
                          {new Date(q.send_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td style={{ padding: '0.6rem 1rem' }}>{q.guest_name || '—'}</td>
                        <td style={{ padding: '0.6rem 1rem' }}>{q.property_name || '—'}</td>
                        <td style={{ padding: '0.6rem 1rem' }}>{q.rating ? '⭐'.repeat(Math.min(q.rating, 5)) : '—'}</td>
                        <td style={{ padding: '0.6rem 1rem', maxWidth: 260 }}>
                          {preview ? (
                            <span onClick={() => setExpandedQueue(isExpanded ? null : q.id)}
                              style={{ cursor: 'pointer', color: q.preview_body ? 'var(--text)' : '#999', fontSize: '0.8rem',
                                display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {q.preview_body ? '💬 ' : '📝 '}{preview}
                            </span>
                          ) : <span style={{ color: '#ccc', fontSize: '0.8rem' }}>—</span>}
                        </td>
                        <td style={{ padding: '0.6rem 1rem' }}>
                          <span style={{ background: color + '22', color, borderRadius: 6, padding: '2px 8px', fontWeight: 600, fontSize: '0.78rem' }}>{label}</span>
                          {q.error_message && <div style={{ fontSize: '0.72rem', color: '#b94a4a', marginTop: 2 }}>{q.error_message}</div>}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={q.id + '-exp'} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : '#faf8f4' }}>
                          <td colSpan={7} style={{ padding: '0 1rem 0.75rem 1rem' }}>
                            <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '0.75rem 1rem',
                              fontSize: '0.85rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', color: 'var(--text)', maxWidth: 600 }}>
                              {q.preview_body || q.comment}
                            </div>
                            {!q.preview_body && <div style={{ fontSize: '0.75rem', color: '#aaa', marginTop: 4 }}>Commentaire Airbnb — le message final sera généré par IA via Hospitable à l'envoi</div>}
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── LOGS ── */}
      {tab === 'Logs' && (
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ background: '#EAE3D4', borderBottom: '2px solid var(--border)' }}>
                {['Date', 'Client', 'Message envoyé', 'Langue', 'Statut'].map(h => (
                  <th key={h} style={{ padding: '0.65rem 1rem', textAlign: 'left', fontWeight: 600, color: 'var(--text)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((l, i) => (
                <tr key={l.id} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : '#faf8f4' }}>
                  <td style={{ padding: '0.6rem 1rem', color: '#666', whiteSpace: 'nowrap' }}>
                    {l.sent_at ? new Date(l.sent_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                  </td>
                  <td style={{ padding: '0.6rem 1rem' }}>{l.guest_name || '—'}</td>
                  <td style={{ padding: '0.6rem 1rem', maxWidth: 380, cursor: 'pointer' }}
                    onClick={() => setExpandedLog(expandedLog === l.id ? null : l.id)}>
                    {l.sms_body ? (
                      <span style={{
                        display: 'block',
                        overflow: expandedLog === l.id ? 'visible' : 'hidden',
                        textOverflow: expandedLog === l.id ? 'unset' : 'ellipsis',
                        whiteSpace: expandedLog === l.id ? 'pre-wrap' : 'nowrap',
                        color: l.status === 'error' ? '#b94a4a' : 'inherit',
                        fontSize: '0.82rem',
                        lineHeight: expandedLog === l.id ? 1.5 : 'inherit',
                      }}>
                        {l.status === 'error' ? (l.error_message || l.sms_body) : l.sms_body}
                      </span>
                    ) : l.error_message ? (
                      <span style={{ color: '#b94a4a', fontSize: '0.82rem' }}>{l.error_message}</span>
                    ) : '—'}
                  </td>
                  <td style={{ padding: '0.6rem 1rem' }}>{LANG_FLAG[l.language] || '—'} {l.language || '—'}</td>
                  <td style={{ padding: '0.6rem 1rem' }}>
                    <span style={{ background: STATUS_COLOR[l.status] + '22', color: STATUS_COLOR[l.status], borderRadius: 6, padding: '2px 8px', fontWeight: 600, fontSize: '0.78rem' }}>
                      {STATUS_LABEL[l.status] || l.status}
                    </span>
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr><td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: '#999' }}>Aucun log pour le moment</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── TEST ── */}
      {tab === 'Test' && (
        <div style={{ maxWidth: 580 }}>
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem', fontSize: '0.875rem' }}>
                UUID de réservation Hospitable
              </label>
              <input
                type="text"
                placeholder="ex: 550e8400-e29b-41d4-a716-446655440000"
                value={testHospId}
                onChange={e => setTestHospId(e.target.value)}
                style={{ width: '100%', padding: '0.6rem 0.75rem', border: '1px solid var(--border)', borderRadius: 8, fontSize: '0.875rem', background: '#fff', boxSizing: 'border-box', fontFamily: 'monospace' }}
              />
              <div style={{ fontSize: '0.75rem', color: '#aaa', marginTop: '0.3rem' }}>
                Génère un aperçu du message (sans envoyer). L'UUID vient de la colonne hospitable_id de la table reservation.
              </div>
            </div>
            <button
              onClick={handleTest}
              disabled={testLoading || !testHospId.trim()}
              style={{
                padding: '0.75rem', background: testLoading || !testHospId.trim() ? '#ccc' : 'var(--brand)',
                color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700,
                cursor: testLoading || !testHospId.trim() ? 'not-allowed' : 'pointer', fontSize: '0.9rem',
              }}>
              {testLoading ? 'Génération…' : '✨ Générer aperçu'}
            </button>
            {testResult && (
              <div>
                {testResult.error ? (
                  <div style={{ padding: '0.75rem', borderRadius: 8, background: '#b94a4a22', color: '#b94a4a', border: '1px solid #b94a4a55', fontWeight: 600, fontSize: '0.875rem' }}>
                    Erreur : {testResult.error}
                  </div>
                ) : (
                  <div>
                    <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.5rem', fontSize: '0.8rem', color: '#888' }}>
                      {testResult.guest && <span>👤 {testResult.guest}</span>}
                      {testResult.property && <span>🏠 {testResult.property}</span>}
                      {testResult.lang && <span>{LANG_FLAG[testResult.lang]} {testResult.lang}</span>}
                    </div>
                    <div style={{
                      background: '#fff', border: '1px solid var(--border)', borderRadius: 8,
                      padding: '1rem', fontSize: '0.875rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', color: 'var(--text)',
                    }}>
                      {testResult.preview}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#5a8a5a', marginTop: '0.4rem' }}>
                      ✓ Aperçu généré — aucun message envoyé
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── CAMPAGNES ── */}
      {tab === 'Campagnes' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <span style={{ fontWeight: 600 }}>{candidats.filter(c => !c.already_sent).length} avis 5⭐ </span>
              <span style={{ color: '#888', fontSize: '0.875rem' }}>
                non encore contactés ({candidats.length} au total)
              </span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {selected.size > 0 && (
                <span style={{ color: '#888', fontSize: '0.875rem' }}>
                  {selected.size} message{selected.size > 1 ? 's' : ''} à envoyer
                </span>
              )}
              <button onClick={chargerCandidats} style={{ padding: '0.4rem 0.75rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: '0.8rem' }}>
                ↻ Rafraîchir
              </button>
              <button
                onClick={handleCampagne}
                disabled={loadingCamp || selected.size === 0}
                style={{
                  padding: '0.5rem 1.25rem', fontWeight: 700,
                  background: loadingCamp || selected.size === 0 ? '#ccc' : 'var(--brand)',
                  color: '#fff', border: 'none', borderRadius: 8,
                  cursor: loadingCamp || selected.size === 0 ? 'not-allowed' : 'pointer',
                }}>
                {loadingCamp ? 'Envoi...' : `Envoyer via Hospitable (${selected.size})`}
              </button>
            </div>
          </div>

          {campResult && (
            <div style={{ marginBottom: '1rem', padding: '0.75rem', borderRadius: 8, background: '#5a8a5a22', color: '#5a8a5a', border: '1px solid #5a8a5a55', fontSize: '0.875rem', fontWeight: 600 }}>
              {campResult.results
                ? `${campResult.results.filter(r => r.ok).length} messages envoyés, ${campResult.results.filter(r => !r.ok).length} erreurs`
                : `Erreur : ${campResult.error}`}
            </div>
          )}

          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: '#EAE3D4', borderBottom: '2px solid var(--border)' }}>
                  <th style={{ padding: '0.65rem 1rem', textAlign: 'left' }}>
                    <input type="checkbox"
                      checked={selected.size === candidats.filter(c => !c.already_sent).length && candidats.length > 0}
                      onChange={toggleAll} style={{ cursor: 'pointer' }} />
                  </th>
                  {['Client', 'Propriété', 'Pays', 'Départ', 'Avis', 'Statut'].map(h => (
                    <th key={h} style={{ padding: '0.65rem 1rem', textAlign: 'left', fontWeight: 600, color: 'var(--text)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loadingCamp && (
                  <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: '#999' }}>Chargement...</td></tr>
                )}
                {!loadingCamp && candidats.length === 0 && (
                  <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: '#999' }}>Aucun candidat — tous les avis 5⭐ ont déjà été contactés ou n'ont pas d'ID Hospitable.</td></tr>
                )}
                {[...candidats].sort((a, b) => new Date(b.departure_date) - new Date(a.departure_date)).map((c, i) => {
                  const status      = rowStatus[c.hospitable_id]
                  const selectable  = !c.already_sent && !status
                  const isSelected  = selected.has(c.hospitable_id)
                  const statusBadge = status === 'sending' ? { label: '⏳', color: '#8a7a4a' }
                    : status === 'sent'  ? { label: '✓ envoyé',      color: '#5a8a5a' }
                    : status === 'error' ? { label: '✗ erreur',      color: '#b94a4a' }
                    : c.already_sent     ? { label: '✓ déjà envoyé', color: '#999' }
                    : null
                  return (
                    <tr key={c.hospitable_id}
                      onClick={() => selectable && toggleOne(c.hospitable_id)}
                      style={{
                        borderBottom: '1px solid var(--border)',
                        cursor: selectable ? 'pointer' : 'default',
                        background: isSelected ? 'rgba(204,153,51,0.08)' : i % 2 === 0 ? 'transparent' : '#faf8f4',
                      }}>
                      <td style={{ padding: '0.6rem 1rem' }}>
                        <input type="checkbox" checked={isSelected} disabled={!selectable}
                          onChange={() => selectable && toggleOne(c.hospitable_id)}
                          style={{ cursor: selectable ? 'pointer' : 'not-allowed' }} />
                      </td>
                      <td style={{ padding: '0.6rem 1rem', fontWeight: 600 }}>{c.guest_name}</td>
                      <td style={{ padding: '0.6rem 1rem' }}>{c.property_name}</td>
                      <td style={{ padding: '0.6rem 1rem' }}>{c.guest_country || '—'}</td>
                      <td style={{ padding: '0.6rem 1rem', color: '#888', whiteSpace: 'nowrap' }}>
                        {c.departure_date ? new Date(c.departure_date).toLocaleDateString('fr-FR') : '—'}
                      </td>
                      <td style={{ padding: '0.6rem 1rem' }}>
                        {'⭐'.repeat(c.rating || 5)}
                        {c.comment && <span style={{ marginLeft: 6, fontSize: '0.75rem', color: '#8a7a4a' }}>💬</span>}
                      </td>
                      <td style={{ padding: '0.6rem 1rem' }}>
                        {statusBadge && (
                          <span style={{ fontSize: '0.78rem', fontWeight: 600, color: statusBadge.color }}>
                            {statusBadge.label}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: '0.75rem', color: '#aaa', marginTop: '0.75rem' }}>
            Le message sera généré en temps réel via Hospitable (contexte de la réservation + avis + langue du voyageur).
          </div>
        </div>
      )}
    </div>
  )
}
