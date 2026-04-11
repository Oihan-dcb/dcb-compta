import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function BugReportButton({ source = 'compta' }) {
  const [open, setOpen]       = useState(false)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent]       = useState(false)
  const [errSend, setErrSend] = useState(false)

  async function envoyer() {
    if (!message.trim()) return
    setSending(true)
    setErrSend(false)
    const { error } = await supabase.from('bug_report').insert({
      message: message.trim(),
      page_url: window.location.pathname,
      source,
    })
    setSending(false)
    if (error) {
      console.error('bug_report:', error)
      setErrSend(true)
      return
    }
    setSent(true)
    setMessage('')
    setTimeout(() => { setSent(false); setOpen(false) }, 2000)
  }

  return (
    <>
      {/* Bubble */}
      <button
        onClick={() => setOpen(o => !o)}
        title="Signaler un bug"
        style={{
          position: 'fixed', bottom: 70, left: 20, zIndex: 999,
          width: 40, height: 40, borderRadius: '50%',
          background: 'var(--brand, #CC9933)', color: '#fff',
          border: 'none', cursor: 'pointer',
          fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
          opacity: 0.75,
          transition: 'opacity 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.opacity = '1'}
        onMouseLeave={e => e.currentTarget.style.opacity = '0.75'}
      >
        🐛
      </button>

      {/* Popover */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 118, left: 20, zIndex: 1000,
          background: 'var(--bg-card, #fff)', border: '1px solid var(--border, #D9CEB8)',
          borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          width: 280, padding: 16,
        }}>
          <div style={{ fontWeight: 700, fontSize: '0.9em', marginBottom: 8, color: 'var(--text, #2C2416)' }}>
            Signaler un bug
          </div>
          {sent ? (
            <div style={{ color: '#059669', fontWeight: 600, fontSize: '0.85em', padding: '8px 0' }}>
              ✓ Signalement envoyé
            </div>
          ) : errSend ? (
            <div style={{ color: '#DC2626', fontSize: '0.82em', padding: '8px 0' }}>
              ✗ Erreur lors de l'envoi — réessaie ou contacte directement.
            </div>
          ) : (
            <>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Décris le problème…"
                rows={4}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '8px 10px', borderRadius: 7,
                  border: '1px solid var(--border, #D9CEB8)',
                  background: 'var(--bg, #F7F3EC)',
                  fontSize: '0.82em', color: 'var(--text, #2C2416)',
                  resize: 'vertical', fontFamily: 'inherit',
                }}
                autoFocus
              />
              <div style={{ fontSize: '0.72em', color: '#9C8E7D', marginTop: 4, marginBottom: 10 }}>
                Page : {window.location.pathname}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setOpen(false)}
                  style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', fontSize: '0.82em' }}>
                  Annuler
                </button>
                <button
                  onClick={envoyer}
                  disabled={sending || !message.trim()}
                  style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: 'var(--brand, #CC9933)', color: '#fff', cursor: sending ? 'not-allowed' : 'pointer', fontSize: '0.82em', fontWeight: 600 }}>
                  {sending ? '…' : 'Envoyer'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}
