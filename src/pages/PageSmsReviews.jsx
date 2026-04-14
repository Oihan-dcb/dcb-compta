import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

const TABS = ['Dashboard', 'Logs', 'Test', 'Campagnes']

const STATUS_LABEL = { sent: 'Envoyé', error: 'Erreur', no_phone: 'Pas de tél.', skipped: 'Ignoré' }
const STATUS_COLOR = { sent: '#5a8a5a', error: '#b94a4a', no_phone: '#8a7a4a', skipped: '#888' }
const LANG_FLAG   = { FR: '🇫🇷', EN: '🇬🇧', ES: '🇪🇸' }

export default function PageSmsReviews() {
  const [tab, setTab]         = useState('Dashboard')
  const [logs, setLogs]       = useState([])
  const [stats, setStats]     = useState(null)
  const [loading, setLoading] = useState(false)

  // Test
  const [testPhone, setTestPhone]   = useState('')
  const [testLang, setTestLang]     = useState('FR')
  const [testResult, setTestResult] = useState(null)

  // Campagnes
  const [candidats, setCandidats]     = useState([])
  const [selected, setSelected]       = useState(new Set())
  const [campResult, setCampResult]   = useState(null)
  const [loadingCamp, setLoadingCamp] = useState(false)
  const [rowStatus, setRowStatus]     = useState({}) // hospitable_id → 'sending'|'sent'|'error'

  const chargerLogs = useCallback(async () => {
    const { data } = await supabase
      .from('sms_logs')
      .select('*')
      .order('sent_at', { ascending: false })
      .limit(200)
    setLogs(data || [])

    // Stats
    const all = data || []
    const sent    = all.filter(l => l.status === 'sent').length
    const error   = all.filter(l => l.status === 'error').length
    const noPhone = all.filter(l => l.status === 'no_phone').length
    const byLang  = { FR: 0, EN: 0, ES: 0 }
    all.filter(l => l.status === 'sent').forEach(l => { if (l.language) byLang[l.language] = (byLang[l.language] || 0) + 1 })
    setStats({ total: all.length, sent, error, noPhone, byLang, taux: all.length ? Math.round(sent / all.length * 100) : 0 })
  }, [])

  const chargerCandidats = useCallback(async () => {
    setLoadingCamp(true)
    try {
      // Source : reservation (review_rating + guest_phone depuis CSV Hospitable)
      const { data: resas } = await supabase
        .from('reservation')
        .select('hospitable_id, guest_name, guest_phone, guest_country, guest_locale, review_rating, departure_date, bien_id, bien(hospitable_name)')
        .gte('review_rating', 5)
        .order('departure_date', { ascending: false })
        .limit(500)

      if (!resas?.length) { setCandidats([]); return }

      // Dédup par guest_phone — SMS déjà envoyés
      const phones = [...new Set(resas.map(r => r.guest_phone).filter(Boolean))]
      const { data: sentLogs } = phones.length
        ? await supabase.from('sms_logs').select('guest_phone').eq('status', 'sent').in('guest_phone', phones)
        : { data: [] }
      const sentPhones = new Set((sentLogs || []).map(l => l.guest_phone))

      // Commentaires depuis reservation_review par bien_id + proximité date départ
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
          guest_phone:   r.guest_phone || null,
          guest_country: r.guest_country || null,
          guest_locale:  r.guest_locale  || null,
          property_name: r.bien?.hospitable_name || '—',
          rating:        r.review_rating,
          comment,
          submitted_at:  r.departure_date,
          already_sent:  sentPhones.has(r.guest_phone),
        }
      })

      setCandidats(liste)
      setSelected(new Set())
    } finally {
      setLoadingCamp(false)
    }
  }, [])

  useEffect(() => {
    chargerLogs()
  }, [chargerLogs])

  useEffect(() => {
    if (tab === 'Campagnes') chargerCandidats()
  }, [tab, chargerCandidats])

  const callEdgeFn = async (body) => {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${SUPABASE_URL}/functions/v1/review-sms-trigger`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(body),
    })
    return res.json()
  }

  const handleTest = async () => {
    if (!testPhone) return
    setLoading(true)
    setTestResult(null)
    try {
      const data = await callEdgeFn({ mode: 'test', phone: testPhone, language: testLang })
      setTestResult(data)
      if (data.ok) chargerLogs()
    } catch (e) {
      setTestResult({ ok: false, error: e.message })
    } finally {
      setLoading(false)
    }
  }

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
        const data = await callEdgeFn({ mode: 'campaign', reservations: [r] })
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

  const smsCost = (phone) => {
    if (!phone) return 0.095
    const p = phone.replace(/\s/g, '')
    if (/^\+33/.test(p) || /^\+32/.test(p)) return 0.075
    if (/^\+34/.test(p) || /^\+52/.test(p)) return 0.085
    if (/^\+44/.test(p) || /^\+1/.test(p))  return 0.085
    return 0.095
  }

  const totalCost = candidats
    .filter(c => selected.has(c.hospitable_id))
    .reduce((sum, c) => sum + smsCost(c.guest_phone), 0)

  const toggleAll = () => {
    const selectable = candidats.filter(c => c.guest_phone && !c.already_sent)
    if (selected.size === selectable.length) setSelected(new Set())
    else setSelected(new Set(selectable.map(c => c.hospitable_id)))
  }

  const toggleOne = (id) => {
    const s = new Set(selected)
    s.has(id) ? s.delete(id) : s.add(id)
    setSelected(s)
  }

  return (
    <div style={{ padding: '2rem', maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text)', marginBottom: '0.25rem' }}>
        SMS Reviews
      </h1>
      <p style={{ color: '#888', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
        Remerciements automatiques après avis 5⭐ Airbnb
      </p>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '2px solid var(--border)' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '0.5rem 1.25rem',
            background: 'none', border: 'none', cursor: 'pointer',
            fontWeight: tab === t ? 700 : 400,
            color: tab === t ? 'var(--brand)' : 'var(--text)',
            borderBottom: tab === t ? '2px solid var(--brand)' : '2px solid transparent',
            marginBottom: -2,
            fontSize: '0.9rem',
          }}>
            {t}
          </button>
        ))}
      </div>

      {/* ── DASHBOARD ── */}
      {tab === 'Dashboard' && stats && stats.total === 0 && (
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '2rem', textAlign: 'center', color: '#999' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📭</div>
          <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: '0.5rem' }}>Aucun SMS envoyé pour le moment</div>
          <div style={{ fontSize: '0.875rem' }}>Utilisez l'onglet <strong>Test</strong> pour envoyer un premier SMS, ou l'onglet <strong>Campagnes</strong> pour contacter vos clients.</div>
        </div>
      )}
      {tab === 'Dashboard' && stats && stats.total > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
          {[
            { label: 'SMS envoyés',   value: stats.sent,    sub: 'total' },
            { label: 'Taux succès',   value: stats.taux + '%', sub: `${stats.total} traitées` },
            { label: 'Sans téléphone', value: stats.noPhone, sub: 'no_phone' },
            { label: 'Erreurs',       value: stats.error,   sub: 'à vérifier' },
          ].map(({ label, value, sub }) => (
            <div key={label} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '1.25rem' }}>
              <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--brand)' }}>{value}</div>
              <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: '0.875rem' }}>{label}</div>
              <div style={{ color: '#999', fontSize: '0.75rem' }}>{sub}</div>
            </div>
          ))}
        </div>
      )}
      {tab === 'Dashboard' && stats && stats.total > 0 && (
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
      )}

      {/* ── LOGS ── */}
      {tab === 'Logs' && (
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ background: '#EAE3D4', borderBottom: '2px solid var(--border)' }}>
                {['Date', 'Client', 'Téléphone', 'Message envoyé', 'Langue', 'Statut'].map(h => (
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
                  <td style={{ padding: '0.6rem 1rem', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{l.guest_phone || '—'}</td>
                  <td style={{ padding: '0.6rem 1rem', maxWidth: 320 }}>
                    {l.sms_body ? (
                      <span title={l.sms_body} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: l.status === 'error' ? '#b94a4a' : 'inherit', fontSize: '0.82rem' }}>
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
                <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#999' }}>Aucun log pour le moment</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── TEST ── */}
      {tab === 'Test' && (
        <div style={{ maxWidth: 480 }}>
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem', fontSize: '0.875rem' }}>
                Numéro de téléphone
              </label>
              <input
                type="tel"
                placeholder="+33612345678"
                value={testPhone}
                onChange={e => setTestPhone(e.target.value)}
                style={{ width: '100%', padding: '0.6rem 0.75rem', border: '1px solid var(--border)', borderRadius: 8, fontSize: '0.9rem', background: '#fff', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem', fontSize: '0.875rem' }}>Langue du SMS</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {['FR', 'EN', 'ES'].map(l => (
                  <button key={l} onClick={() => setTestLang(l)} style={{
                    padding: '0.4rem 1rem', borderRadius: 8, cursor: 'pointer',
                    background: testLang === l ? 'var(--brand)' : 'transparent',
                    color: testLang === l ? '#fff' : 'var(--text)',
                    border: `1px solid ${testLang === l ? 'var(--brand)' : 'var(--border)'}`,
                    fontWeight: testLang === l ? 700 : 400,
                  }}>
                    {LANG_FLAG[l]} {l}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={handleTest}
              disabled={loading || !testPhone}
              style={{
                padding: '0.75rem', background: loading || !testPhone ? '#ccc' : 'var(--brand)',
                color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700,
                cursor: loading || !testPhone ? 'not-allowed' : 'pointer', fontSize: '0.9rem',
              }}>
              {loading ? 'Envoi...' : 'Envoyer SMS de test'}
            </button>
            {testResult && (
              <div style={{
                padding: '0.75rem', borderRadius: 8,
                background: testResult.ok ? '#5a8a5a22' : '#b94a4a22',
                color: testResult.ok ? '#5a8a5a' : '#b94a4a',
                border: `1px solid ${testResult.ok ? '#5a8a5a55' : '#b94a4a55'}`,
                fontWeight: 600, fontSize: '0.875rem',
              }}>
                {testResult.ok ? '✓ SMS envoyé avec succès !' : `✗ Erreur : ${testResult.error}`}
              </div>
            )}
          </div>
          <p style={{ color: '#888', fontSize: '0.8rem', marginTop: '0.75rem' }}>
            Envoie un SMS de test (loggé avec statut "sent" dans la table sms_logs).
          </p>
        </div>
      )}

      {/* ── CAMPAGNES ── */}
      {tab === 'Campagnes' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <span style={{ fontWeight: 600 }}>{candidats.filter(c => !c.already_sent).length} avis 5⭐ </span>
              <span style={{ color: '#888', fontSize: '0.875rem' }}>
                non encore contactés ({candidats.filter(c => c.guest_phone && !c.already_sent).length} avec téléphone)
              </span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {selected.size > 0 && (
                <span style={{ color: '#888', fontSize: '0.875rem' }}>
                  {selected.size} SMS · <span style={{ color: 'var(--brand)', fontWeight: 600 }}>~{totalCost.toFixed(2)} €</span>
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
                {loadingCamp ? 'Envoi...' : `Envoyer (${selected.size})`}
              </button>
            </div>
          </div>

          {campResult && (
            <div style={{ marginBottom: '1rem', padding: '0.75rem', borderRadius: 8, background: '#5a8a5a22', color: '#5a8a5a', border: '1px solid #5a8a5a55', fontSize: '0.875rem', fontWeight: 600 }}>
              {campResult.results
                ? `${campResult.results.filter(r => r.ok).length} SMS envoyés, ${campResult.results.filter(r => !r.ok).length} erreurs`
                : `Erreur : ${campResult.error}`}
            </div>
          )}

          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: '#EAE3D4', borderBottom: '2px solid var(--border)' }}>
                  <th style={{ padding: '0.65rem 1rem', textAlign: 'left' }}>
                    <input type="checkbox" checked={selected.size === candidats.length && candidats.length > 0}
                      onChange={toggleAll} style={{ cursor: 'pointer' }} />
                  </th>
                  {['Client', 'Propriété', 'Téléphone', 'Pays', 'Date avis', 'Statut'].map(h => (
                    <th key={h} style={{ padding: '0.65rem 1rem', textAlign: 'left', fontWeight: 600, color: 'var(--text)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loadingCamp && (
                  <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#999' }}>Chargement...</td></tr>
                )}
                {!loadingCamp && candidats.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#999' }}>Aucun candidat — tous les avis 5⭐ ont déjà été contactés ou le téléphone est manquant.</td></tr>
                )}
                {[...candidats].sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at)).map((c, i) => {
                  const status     = rowStatus[c.hospitable_id]
                  const selectable = !!c.guest_phone && !c.already_sent && !status
                  const isSelected = selected.has(c.hospitable_id)
                  const statusBadge = status === 'sending' ? { label: '⏳', color: '#8a7a4a' }
                    : status === 'sent'    ? { label: '✓ envoyé',  color: '#5a8a5a' }
                    : status === 'error'   ? { label: '✗ erreur',  color: '#b94a4a' }
                    : c.already_sent       ? { label: '✓ déjà envoyé', color: '#999' }
                    : null
                  return (
                    <tr key={c.hospitable_id}
                      onClick={() => selectable && toggleOne(c.hospitable_id)}
                      style={{
                        borderBottom: '1px solid var(--border)',
                        cursor: selectable ? 'pointer' : 'default',
                        opacity: !c.guest_phone ? 0.35 : 1,
                        background: isSelected ? 'rgba(204,153,51,0.08)' : i % 2 === 0 ? 'transparent' : '#faf8f4',
                      }}>
                      <td style={{ padding: '0.6rem 1rem' }}>
                        <input type="checkbox" checked={isSelected} disabled={!selectable}
                          onChange={() => selectable && toggleOne(c.hospitable_id)}
                          style={{ cursor: selectable ? 'pointer' : 'not-allowed' }} />
                      </td>
                      <td style={{ padding: '0.6rem 1rem', fontWeight: 600 }}>{c.guest_name}</td>
                      <td style={{ padding: '0.6rem 1rem' }}>{c.property_name}</td>
                      <td style={{ padding: '0.6rem 1rem', fontFamily: 'monospace', color: c.guest_phone ? 'inherit' : '#aaa' }}>
                        {c.guest_phone || 'pas de tél.'}
                      </td>
                      <td style={{ padding: '0.6rem 1rem' }}>{c.guest_country || '—'}</td>
                      <td style={{ padding: '0.6rem 1rem', color: '#888' }}>
                        {c.submitted_at ? new Date(c.submitted_at).toLocaleDateString('fr-FR') : '—'}
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
        </div>
      )}
    </div>
  )
}
