/**
 * Vercel API Route — Powens OAuth Callback
 * Reçoit le redirect après autorisation bancaire Powens
 * Échange le code contre des tokens et ferme la popup
 */

const SUPABASE_URL = 'https://omuncchvypbtxkpalwcr.supabase.co'
const REDIRECT_URI = 'https://dcb-compta.vercel.app/api/powens-callback'

export default async function handler(req, res) {
  const { code, state, error: oauthError, agence, account_label } = req.query

  // Erreur renvoyée par Powens
  if (oauthError) {
    return res.send(htmlClose('error', `Erreur Powens : ${oauthError}`))
  }

  if (!state || !code) {
    return res.send(htmlClose('error', `Paramètres manquants (state=${state}, code=${!!code})`))
  }

  const targetAgence = agence || 'dcb'
  const targetLabel  = account_label || 'seq_lc'

  try {
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
    const fnRes = await fetch(`${SUPABASE_URL}/functions/v1/powens-auth`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'verify_callback',
        agence: targetAgence,
        accountLabel: targetLabel,
        state,
        code,
      }),
    })

    const data = await fnRes.json()
    if (!data.ok) {
      return res.send(htmlClose('error', data.error || 'Échange de code échoué'))
    }

    return res.send(htmlClose('success', 'Banque connectée avec succès !'))
  } catch (err) {
    return res.send(htmlClose('error', err.message))
  }
}

function htmlClose(status, message) {
  const color = status === 'success' ? '#CC9933' : '#dc2626'
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>DCB Compta — Connexion bancaire</title></head>
<body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#F7F3EC">
  <div style="text-align:center;padding:2rem;background:white;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.1)">
    <div style="font-size:3rem">${status === 'success' ? '✓' : '✗'}</div>
    <p style="color:${color};font-weight:600;font-size:1.1rem">${message}</p>
    <p style="color:#666;font-size:.9rem">Cette fenêtre va se fermer automatiquement…</p>
  </div>
  <script>
    window.opener && window.opener.postMessage({ type: 'powens_callback', status: '${status}' }, '*');
    setTimeout(() => window.close(), 2000);
  </script>
</body>
</html>`
}
