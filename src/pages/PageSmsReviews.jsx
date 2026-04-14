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
      // 1. Avis 5 étoiles
      const { data: reviews } = await supabase
        .from('reservation_review')
        .select('hospitable_reservation_id, reviewer_name, rating, comment, submitted_at')
        .gte('rating', 5)
        .order('submitted_at', { ascending: false })
        .limit(500)

      if (!reviews?.length) { setCandidats([]); return }

      // 2. Réservations correspondantes (phone + bien)
      const hospIds = reviews.map(r => r.hospitable_reservation_id).filter(Boolean)
      const { data: resas } = await supabase
        .from('reservation')
        .select('hospitable_id, guest_name, guest_phone, guest_country, bien(hospitable_name)')
        .in('hospitable_id', hospIds)

      const resaMap = {}
      ;(resas || []).forEach(r => { resaMap[r.hospitable_id] = r })

      // 3. SMS déjà envoyés
      const { data: sentLogs } = await supabase
        .from('sms_logs')
        .select('hospitable_reservation_id')
        .eq('status', 'sent')
        .in('hospitable_reservation_id', hospIds)

      const sentIds = new Set((sentLogs || []).map(l => l.hospitable_reservation_id))

      // 4. Construire la liste des candidats
      const liste = reviews
        .filter(r => {
          const resa = resaMap[r.hospitable_reservation_id]
          return resa?.guest_phone && !sentIds.has(r.hospitable_reservation_id)
        })
        .map(r => {
          const resa = resaMap[r.hospitable_reservation_id]
          return {
            hospitable_id:  r.hospitable_reservation_id,
            guest_name:     resa.guest_name || r.reviewer_name || '—',
            guest_phone:    resa.guest_phone,
            guest_country:  resa.guest_country,
            property_name:  resa.bien?.hospitable_name || '—',
            rating:         r.rating,
            comment:        r.comment || null,
            submitted_at:   r.submitted_at,
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
    const reservations = candidats.filter(c => selected.has(c.hospitable_id))
    try {
      const data = await callEdgeFn({ mode: 'campaign', reservations })
      setCampResult(data)
      chargerLogs()
      chargerCandidats()
    } catch (e) {
      setCampResult({ error: e.message })
    } finally {
      setLoadingCamp(false)
    }
  }

  const toggleAll = () => {
    if (selected.size === candidats.length) setSelected(new Set())
    else setSelected(new Set(candidats.map(c => c.hospitable_id)))
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
      {tab === 'Dashboard' && stats && (
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
      {tab === 'Dashboard' && stats && (
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
                {['Date', 'Client', 'Téléphone', 'Propriété', 'Langue', 'Statut'].map(h => (
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
                  <td style={{ padding: '0.6rem 1rem', fontFamily: 'monospace' }}>{l.guest_phone || '—'}</td>
                  <td style={{ padding: '0.6rem 1rem', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {l.sms_body ? l.sms_body.split(' sur ')[1]?.split('.')[0] || '—' : '—'}
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
              <span style={{ fontWeight: 600 }}>{candidats.length} avis 5⭐ </span>
              <span style={{ color: '#888', fontSize: '0.875rem' }}>non encore contactés (avec téléphone)</span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {selected.size > 0 && (
                <span style={{ color: '#888', fontSize: '0.875rem' }}>{selected.size} sélectionné{selected.size > 1 ? 's' : ''}</span>
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
                  {['Client', 'Propriété', 'Téléphone', 'Pays', 'Date avis'].map(h => (
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
                {candidats.map((c, i) => (
                  <tr key={c.hospitable_id} onClick={() => toggleOne(c.hospitable_id)}
                    style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', background: selected.has(c.hospitable_id) ? 'rgba(204,153,51,0.08)' : i % 2 === 0 ? 'transparent' : '#faf8f4' }}>
                    <td style={{ padding: '0.6rem 1rem' }}>
                      <input type="checkbox" checked={selected.has(c.hospitable_id)} onChange={() => toggleOne(c.hospitable_id)} style={{ cursor: 'pointer' }} />
                    </td>
                    <td style={{ padding: '0.6rem 1rem', fontWeight: 600 }}>{c.guest_name}</td>
                    <td style={{ padding: '0.6rem 1rem' }}>{c.property_name}</td>
                    <td style={{ padding: '0.6rem 1rem', fontFamily: 'monospace' }}>{c.guest_phone}</td>
                    <td style={{ padding: '0.6rem 1rem' }}>{c.guest_country || '—'}</td>
                    <td style={{ padding: '0.6rem 1rem', color: '#888' }}>
                      {c.submitted_at ? new Date(c.submitted_at).toLocaleDateString('fr-FR') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
