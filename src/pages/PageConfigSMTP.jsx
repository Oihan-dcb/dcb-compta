import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function PageConfigSMTP() {
  const [smtpConfig, setSmtpConfig] = useState({ host: '', port: '465', user: '', pass: '', from: '' })
  const [smtpSaving, setSmtpSaving] = useState(false)
  const [smtpTestResult, setSmtpTestResult] = useState(null)

  async function sauvegarderSMTP() {
    setSmtpSaving(true)
    setSmtpTestResult(null)
    try {
      const fields = []
      if (smtpConfig.host) fields.push({ name: 'SMTP_HOST', value: smtpConfig.host })
      if (smtpConfig.port) fields.push({ name: 'SMTP_PORT', value: smtpConfig.port })
      if (smtpConfig.user) fields.push({ name: 'SMTP_USER', value: smtpConfig.user })
      if (smtpConfig.from) fields.push({ name: 'SMTP_FROM', value: smtpConfig.from })
      if (smtpConfig.pass) fields.push({ name: 'SMTP_PASS', value: smtpConfig.pass })
      if (fields.length === 0) { alert('Aucun champ à sauvegarder'); return }
      const res = await fetch(
        'https://api.supabase.com/v1/projects/omuncchvypbtxkpalwcr/secrets',
        {
          method: 'POST',
          headers: { 'Authorization': 'Bearer REMOVED_TOKEN', 'Content-Type': 'application/json' },
          body: JSON.stringify(fields),
        }
      )
      if (!res.ok) throw new Error('Erreur Supabase ' + res.status)
      setSmtpConfig(p => ({ ...p, pass: '' }))
      alert('✅ Configuration SMTP sauvegardée')
    } catch(e) {
      alert('❌ Erreur: ' + e.message)
    } finally {
      setSmtpSaving(false)
    }
  }

  async function testerSMTP() {
    setSmtpSaving(true)
    setSmtpTestResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY
      const res = await fetch(
        'https://omuncchvypbtxkpalwcr.supabase.co/functions/v1/smtp-send',
        {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: smtpConfig.user || 'oihan@destinationcotebasque.com',
            subject: 'Test SMTP — DCB Compta',
            html: '<p>Test de configuration email — Destination Côte Basque</p><p>Si vous recevez ce message, la configuration SMTP est correcte.</p>',
          }),
        }
      )
      const json = await res.json()
      if (res.ok) {
        setSmtpTestResult({ ok: true, msg: 'Email envoyé avec succès' })
      } else {
        setSmtpTestResult({ ok: false, msg: json.error || 'Erreur inconnue' })
      }
    } catch(e) {
      setSmtpTestResult({ ok: false, msg: e.message })
    } finally {
      setSmtpSaving(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Configuration email</h1>
          <p className="page-subtitle">Paramètres SMTP pour l'envoi des rapports propriétaires</p>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 600 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div>
            <label style={{ fontSize: '0.8em', color: 'var(--text-muted, #7a6e62)', display: 'block', marginBottom: 4 }}>SMTP_HOST</label>
            <input
              value={smtpConfig.host}
              onChange={e => setSmtpConfig(p => ({ ...p, host: e.target.value }))}
              placeholder="ssl0.ovh.net"
              style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: '0.85em', boxSizing: 'border-box' }}
            />
          </div>
          <div>
            <label style={{ fontSize: '0.8em', color: 'var(--text-muted, #7a6e62)', display: 'block', marginBottom: 4 }}>SMTP_PORT</label>
            <input
              value={smtpConfig.port}
              onChange={e => setSmtpConfig(p => ({ ...p, port: e.target.value }))}
              placeholder="465"
              style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: '0.85em', boxSizing: 'border-box' }}
            />
          </div>
          <div>
            <label style={{ fontSize: '0.8em', color: 'var(--text-muted, #7a6e62)', display: 'block', marginBottom: 4 }}>SMTP_USER</label>
            <input
              value={smtpConfig.user}
              onChange={e => setSmtpConfig(p => ({ ...p, user: e.target.value }))}
              placeholder="rapports@destinationcotebasque.com"
              style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: '0.85em', boxSizing: 'border-box' }}
            />
          </div>
          <div>
            <label style={{ fontSize: '0.8em', color: 'var(--text-muted, #7a6e62)', display: 'block', marginBottom: 4 }}>SMTP_FROM</label>
            <input
              value={smtpConfig.from}
              onChange={e => setSmtpConfig(p => ({ ...p, from: e.target.value }))}
              placeholder="rapports@destinationcotebasque.com"
              style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: '0.85em', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ fontSize: '0.8em', color: 'var(--text-muted, #7a6e62)', display: 'block', marginBottom: 4 }}>
              SMTP_PASS{' '}
              <span style={{ fontWeight: 400, color: '#9c8c7a' }}>(chiffré dans Supabase — non lisible après sauvegarde)</span>
            </label>
            <input
              type="password"
              value={smtpConfig.pass}
              onChange={e => setSmtpConfig(p => ({ ...p, pass: e.target.value }))}
              placeholder="••••••••"
              style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: '0.85em', boxSizing: 'border-box' }}
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={sauvegarderSMTP}
            disabled={smtpSaving}
            style={{ padding: '8px 14px', background: 'var(--brand)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: '0.85em', opacity: smtpSaving ? 0.6 : 1 }}
          >
            💾 Sauvegarder
          </button>
          <button
            onClick={testerSMTP}
            disabled={smtpSaving}
            style={{ padding: '8px 14px', background: 'none', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: '0.85em', opacity: smtpSaving ? 0.6 : 1 }}
          >
            🧪 Tester l'envoi
          </button>
          <a href="https://www.ovh.com/manager/web/#/email" target="_blank" rel="noreferrer"
            style={{ fontSize: '0.78em', color: 'var(--brand)', textDecoration: 'none' }}>
            → Gérer les emails OVH
          </a>
        </div>
        {smtpTestResult && (
          <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, fontSize: '0.82em',
            background: smtpTestResult.ok ? '#f0fdf4' : '#fff0f0',
            border: `1px solid ${smtpTestResult.ok ? '#86efac' : '#f5c6c6'}`,
            color: smtpTestResult.ok ? '#15803d' : '#c0392b' }}>
            {smtpTestResult.ok ? '✅' : '❌'} {smtpTestResult.msg}
          </div>
        )}
      </div>
    </div>
  )
}
