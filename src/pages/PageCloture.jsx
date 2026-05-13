import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import {
  ETAPES, getAllClotures, getAuditLog, getWebhooksPending,
  cloturerEtape, rouvrirEtape, marquerWebhookTraite,
  isEtapeCloturee,
} from '../services/cloture'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

const AGENCES = ['dcb', 'lauian']
const AGENCE_LABELS = { dcb: 'DCB', lauian: 'Lauian' }

// Génère les N derniers mois + mois courant
function derniersMois(n = 8) {
  const mois = []
  const now = new Date()
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    mois.push(d.toISOString().substring(0, 7))
  }
  return mois
}

function formatMois(m) {
  const [y, mo] = m.split('-')
  return format(new Date(+y, +mo - 1, 1), 'MMMM yyyy', { locale: fr })
}

function formatDt(ts) {
  if (!ts) return '—'
  return format(new Date(ts), 'dd/MM/yyyy HH:mm', { locale: fr })
}

// ── Composant principal ────────────────────────────────────────────────────────
export default function PageCloture() {
  const [clotures, setClotures]       = useState([])
  const [audit, setAudit]             = useState([])
  const [pending, setPending]         = useState([])
  const [userEmail, setUserEmail]     = useState('')
  const [loading, setLoading]         = useState(true)
  const [modal, setModal]             = useState(null)   // {mois, agence, etape, action: 'cloture'|'reouverture'}
  const [noteModal, setNoteModal]     = useState('')
  const [working, setWorking]         = useState(false)
  const [errModal, setErrModal]       = useState('')
  const [showAudit, setShowAudit]     = useState(false)

  const mois = derniersMois(10)

  const charger = useCallback(async () => {
    setLoading(true)
    const [cl, au, pe, { data: { session } }] = await Promise.all([
      getAllClotures(),
      getAuditLog(80),
      getWebhooksPending(),
      supabase.auth.getSession(),
    ])
    setClotures(cl)
    setAudit(au)
    setPending(pe)
    setUserEmail(session?.user?.email || 'admin')
    setLoading(false)
  }, [])

  useEffect(() => { charger() }, [charger])

  // Index rapide (mois, agence) → cloture row
  const idx = {}
  clotures.forEach(c => { idx[`${c.mois}/${c.agence}`] = c })

  function getCloture(m, agence) { return idx[`${m}/${agence}`] || null }

  // ── Actions ─────────────────────────────────────────────────────────────────

  function ouvrirModal(mois, agence, etape, action) {
    setNoteModal('')
    setErrModal('')
    setModal({ mois, agence, etape, action })
  }

  async function confirmerAction() {
    if (!modal) return
    if (modal.action === 'reouverture' && !noteModal.trim()) {
      setErrModal('Une note est obligatoire pour rouvrir')
      return
    }
    setWorking(true)
    setErrModal('')
    try {
      if (modal.action === 'cloture') {
        await cloturerEtape(modal.mois, modal.agence, modal.etape, userEmail, noteModal)
      } else {
        await rouvrirEtape(modal.mois, modal.agence, modal.etape, userEmail, noteModal)
      }
      setModal(null)
      await charger()
    } catch (e) {
      setErrModal(e.message)
    } finally {
      setWorking(false)
    }
  }

  async function traiterWebhook(id, action) {
    await marquerWebhookTraite(id, action, userEmail)
    setPending(p => p.filter(w => w.id !== id))
  }

  // ── Rendu ────────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 16px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
        Clôture comptable
      </h1>
      <p style={{ color: '#8C7B65', fontSize: 14, marginBottom: 24 }}>
        Verrou mensuel en 3 étapes séquentielles. Les étapes doivent être clôturées dans l'ordre (Ventilation → Rapprochement → Facturation) et rouvertes dans l'ordre inverse.
      </p>

      {/* Légende étapes */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {ETAPES.map((e, i) => (
          <div key={e.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: '#FFF8EC', border: '1px solid #E4D9C8', borderRadius: 8, padding: '8px 12px', fontSize: 13, flex: 1, minWidth: 200 }}>
            <span style={{ fontWeight: 700, color: 'var(--brand)', minWidth: 18 }}>{i + 1}</span>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text)' }}>{e.label}</div>
              <div style={{ color: '#8C7B65', fontSize: 12, marginTop: 2 }}>{e.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {loading ? (
        <div style={{ color: '#8C7B65', padding: 24 }}>Chargement…</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#EAE3D4' }}>
                <th style={thStyle}>Mois</th>
                {AGENCES.map(agence => (
                  ETAPES.map(etape => (
                    <th key={`${agence}-${etape.id}`} style={{ ...thStyle, borderLeft: etape.id === 'ventil' ? '2px solid var(--border)' : undefined }}>
                      <div style={{ fontWeight: 700, color: '#8C7B65', fontSize: 11 }}>{AGENCE_LABELS[agence]}</div>
                      <div style={{ fontWeight: 600, fontSize: 12 }}>{etape.label}</div>
                    </th>
                  ))
                ))}
              </tr>
            </thead>
            <tbody>
              {mois.map((m, rowIdx) => (
                <tr key={m} style={{ background: rowIdx % 2 === 0 ? '#fff' : '#FAFAF7', borderBottom: '1px solid #F0EBE0' }}>
                  <td style={{ ...tdStyle, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                    {formatMois(m)}
                  </td>
                  {AGENCES.map(agence => {
                    const cloture = getCloture(m, agence)
                    return ETAPES.map((etape, etapeIdx) => {
                      const fermee = isEtapeCloturee(cloture, etape.id)
                      const etapePrecedente = etapeIdx > 0 ? ETAPES[etapeIdx - 1] : null
                      const etapeSuivante   = etapeIdx < ETAPES.length - 1 ? ETAPES[etapeIdx + 1] : null
                      const peutCloture = !fermee && (etapeIdx === 0 || isEtapeCloturee(cloture, etapePrecedente.id))
                      const peutRouvrir = fermee && (!etapeSuivante || !isEtapeCloturee(cloture, etapeSuivante.id))
                      const ts = cloture?.[`cloture_${etape.id}`]

                      return (
                        <td key={`${agence}-${etape.id}`}
                          style={{ ...tdStyle, textAlign: 'center', borderLeft: etape.id === 'ventil' ? '2px solid #E4D9C8' : undefined }}>
                          {fermee ? (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                              <span style={{ fontSize: 18 }}>🔒</span>
                              <span style={{ fontSize: 10, color: '#059669', fontWeight: 600 }}>
                                {formatDt(ts).split(' ')[0]}
                              </span>
                              {peutRouvrir && (
                                <button onClick={() => ouvrirModal(m, agence, etape.id, 'reouverture')}
                                  style={btnSmallStyle('#FEF3C7', '#D97706')}>
                                  Rouvrir
                                </button>
                              )}
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                              <span style={{ fontSize: 18, opacity: 0.25 }}>🔓</span>
                              {peutCloture ? (
                                <button onClick={() => ouvrirModal(m, agence, etape.id, 'cloture')}
                                  style={btnSmallStyle('#DCFCE7', '#16a34a')}>
                                  Clôturer
                                </button>
                              ) : (
                                <span style={{ fontSize: 11, color: '#D9CEB8' }}>—</span>
                              )}
                            </div>
                          )}
                        </td>
                      )
                    })
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Webhooks en attente */}
      {pending.length > 0 && (
        <section style={{ marginTop: 32 }}>
          <h2 style={sectionTitle}>⏳ Webhooks en attente ({pending.length})</h2>
          <p style={{ color: '#8C7B65', fontSize: 13, marginBottom: 12 }}>
            Ces webhooks Hospitable sont arrivés sur un mois clôturé. Traite-les manuellement.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pending.map(w => (
              <div key={w.id} style={{ background: '#FFF8EC', border: '1.5px solid #E4A853', borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
                    {w.event} — {w.mois} / {AGENCE_LABELS[w.agence] || w.agence}
                  </div>
                  <div style={{ fontSize: 12, color: '#8C7B65', marginTop: 2 }}>
                    Reçu le {formatDt(w.received_at)} · Raison : {w.reason}
                  </div>
                  <div style={{ fontSize: 11, color: '#8C7B65', marginTop: 4, fontFamily: 'monospace', background: '#F7F3EC', borderRadius: 4, padding: '4px 6px', maxHeight: 60, overflow: 'hidden' }}>
                    {JSON.stringify(w.payload).substring(0, 200)}…
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                  <button onClick={() => traiterWebhook(w.id, 'ignore')}
                    style={btnSmallStyle('#FEE2E2', '#DC2626')}>
                    Ignorer
                  </button>
                  <button onClick={() => traiterWebhook(w.id, 'integre_manuellement')}
                    style={btnSmallStyle('#DCFCE7', '#16a34a')}>
                    Intégré ✓
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Journal d'audit */}
      <section style={{ marginTop: 32 }}>
        <button onClick={() => setShowAudit(v => !v)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text)', fontWeight: 600, fontSize: 15, padding: 0, marginBottom: 12 }}>
          <span style={{ fontSize: 13, opacity: 0.5 }}>{showAudit ? '▾' : '▸'}</span>
          Journal d'audit ({audit.length} entrées)
        </button>
        {showAudit && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#EAE3D4' }}>
                  {['Date', 'Mois', 'Agence', 'Action', 'Par', 'Note'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {audit.map((row, i) => (
                  <tr key={row.id} style={{ background: i % 2 === 0 ? '#fff' : '#FAFAF7', borderBottom: '1px solid #F0EBE0' }}>
                    <td style={tdStyle}>{formatDt(row.at)}</td>
                    <td style={tdStyle}>{formatMois(row.mois)}</td>
                    <td style={tdStyle}>{AGENCE_LABELS[row.agence] || row.agence}</td>
                    <td style={{ ...tdStyle, fontWeight: 600, color: row.action.startsWith('reouverture') ? '#D97706' : '#16a34a' }}>
                      {row.action}
                    </td>
                    <td style={tdStyle}>{row.by}</td>
                    <td style={{ ...tdStyle, color: '#8C7B65' }}>{row.note || '—'}</td>
                  </tr>
                ))}
                {audit.length === 0 && (
                  <tr><td colSpan={6} style={{ ...tdStyle, color: '#8C7B65', textAlign: 'center' }}>Aucune entrée</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Modal confirmation */}
      {modal && (
        <div onClick={() => !working && setModal(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 14, padding: '24px 24px', maxWidth: 440, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,.2)' }}>

            <h3 style={{ margin: '0 0 6px', fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>
              {modal.action === 'cloture' ? '🔒 Clôturer' : '🔓 Réouvrir'} — {ETAPES.find(e => e.id === modal.etape)?.label}
            </h3>
            <p style={{ color: '#8C7B65', fontSize: 14, margin: '0 0 16px' }}>
              {formatMois(modal.mois)} · {AGENCE_LABELS[modal.agence]}
            </p>

            {modal.action === 'reouverture' && (
              <p style={{ background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#92400E', marginBottom: 14 }}>
                ⚠ La réouverture sera tracée de façon permanente dans le journal d'audit.
              </p>
            )}

            <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
              Note {modal.action === 'reouverture' ? '(obligatoire)' : '(optionnelle)'}
            </label>
            <textarea
              value={noteModal}
              onChange={e => setNoteModal(e.target.value)}
              rows={3}
              placeholder={modal.action === 'reouverture' ? 'Raison de la réouverture…' : 'Note optionnelle…'}
              style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 14, fontFamily: 'inherit', resize: 'vertical' }}
            />

            {errModal && (
              <p style={{ color: '#DC2626', fontSize: 13, marginTop: 8 }}>{errModal}</p>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
              <button onClick={() => setModal(null)} disabled={working}
                style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', fontSize: 14 }}>
                Annuler
              </button>
              <button onClick={confirmerAction} disabled={working}
                style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600,
                  background: modal.action === 'reouverture' ? '#D97706' : '#16a34a', color: '#fff' }}>
                {working ? 'En cours…' : modal.action === 'cloture' ? 'Clôturer' : 'Réouvrir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const thStyle = {
  padding: '8px 10px', textAlign: 'left', fontWeight: 600,
  fontSize: 12, color: '#5C4D3A', borderBottom: '2px solid var(--border)',
}
const tdStyle = { padding: '8px 10px', verticalAlign: 'middle' }
const sectionTitle = { fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }

function btnSmallStyle(bg, color) {
  return {
    background: bg, color, border: 'none', borderRadius: 5,
    padding: '3px 9px', fontSize: 11, fontWeight: 600,
    cursor: 'pointer', whiteSpace: 'nowrap',
  }
}
