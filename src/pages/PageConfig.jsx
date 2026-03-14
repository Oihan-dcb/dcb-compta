import { useState } from 'react'
import { pingEvoliz, getPaytermsEvoliz } from '../services/evoliz'
import { syncProprietairesEvoliz } from '../services/syncProprietaires'
import { formatMontant } from '../lib/hospitable'

export default function PageConfig() {
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [payterms, setPayterms] = useState(null)
  const [error, setError] = useState(null)

  const companyId = import.meta.env.VITE_EVOLIZ_COMPANY_ID
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL

  const [syncingProprio, setSyncingProprio] = useState(false)
  const [syncProprioResult, setSyncProprioResult] = useState(null)

  async function syncProprio() {
    setSyncingProprio(true)
    setSyncProprioResult(null)
    try {
      const result = await syncProprietairesEvoliz()
      setSyncProprioResult({ ok: true, ...result })
    } catch (err) {
      setSyncProprioResult({ ok: false, error: err.message })
    } finally {
      setSyncingProprio(false)
    }
  }

  async function testerEvoliz() {
    setTesting(true)
    setTestResult(null)
    setError(null)
    try {
      const result = await pingEvoliz()
      setTestResult(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setTesting(false)
    }
  }

  async function chargerPayterms() {
    try {
      const result = await getPaytermsEvoliz()
      setPayterms(result?.data || [])
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Configuration</h1>
          <p className="page-subtitle">Paramètres de connexion et tests d'intégration</p>
        </div>
      </div>

      {error && <div className="alert alert-error">✕ {error}</div>}

      {/* Statut des variables d'env */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: 'var(--brand)' }}>
          Variables d'environnement
        </h2>
        <table>
          <thead>
            <tr><th>Variable</th><th>Statut</th><th>Valeur</th></tr>
          </thead>
          <tbody>
            {[
              { key: 'VITE_SUPABASE_URL', val: import.meta.env.VITE_SUPABASE_URL },
              { key: 'VITE_SUPABASE_ANON_KEY', val: import.meta.env.VITE_SUPABASE_ANON_KEY },
              { key: 'VITE_HOSPITABLE_TOKEN', val: import.meta.env.VITE_HOSPITABLE_TOKEN },
              { key: 'VITE_EVOLIZ_COMPANY_ID', val: import.meta.env.VITE_EVOLIZ_COMPANY_ID },
            ].map(({ key, val }) => (
              <tr key={key}>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{key}</td>
                <td>
                  {val
                    ? <span className="badge badge-success">✓ Configuré</span>
                    : <span className="badge badge-danger">✕ Manquant</span>
                  }
                </td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                  {val ? val.substring(0, 30) + (val.length > 30 ? '…' : '') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Sync Propriétaires Evoliz */}
      <div className="card" style={{marginBottom: 24}}>
        <div className="card-header" style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
          <div>
            <h3 style={{margin:0}}>Propriétaires Evoliz</h3>
            <p style={{margin:'4px 0 0', color:'var(--text-muted)', fontSize:'0.9em'}}>
              Synchronise automatiquement les clients Evoliz → table propriétaires
            </p>
          </div>
          <button
            className="btn btn-primary"
            onClick={syncProprio}
            disabled={syncingProprio}>
            {syncingProprio ? '⏳ Sync…' : '⟳ Sync depuis Evoliz'}
          </button>
        </div>
        {syncProprioResult && (
          <div style={{padding:'12px 16px'}}>
            {syncProprioResult.ok ? (
              <div className="alert alert-success">
                ✓ {syncProprioResult.synced} propriétaires synchronisés depuis Evoliz ({syncProprioResult.total_evoliz} clients au total)
              </div>
            ) : (
              <div className="alert alert-error">✕ {syncProprioResult.error}</div>
            )}
          </div>
        )}
      </div>

      {/* Comment trouver le Company ID Evoliz */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: 'var(--brand)' }}>
          Comment trouver ton Company ID Evoliz
        </h2>
        <p style={{ marginBottom: 12, lineHeight: 1.6 }}>
          Le Company ID est un entier numérique visible dans Evoliz en bas à gauche de l'écran,
          sous ton nom. Il s'affiche comme <strong>"114158-144311"</strong> — le premier nombre
          (ici <code>114158</code>) est ton Company ID à renseigner dans{' '}
          <code>VITE_EVOLIZ_COMPANY_ID</code>.
        </p>
        <div style={{ background: '#F5F5F5', padding: '10px 14px', borderRadius: 6, fontFamily: 'monospace', fontSize: 13 }}>
          VITE_EVOLIZ_COMPANY_ID=114158
        </div>
        <p style={{ marginTop: 12, fontSize: 13, color: 'var(--text-muted)' }}>
          Les clés API publique et secrète Evoliz sont stockées dans les secrets Supabase
          (EVOLIZ_PUBLIC_KEY et EVOLIZ_SECRET_KEY), jamais exposées côté client.
        </p>
      </div>

      {/* Test connexion Evoliz */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--brand)' }}>
            Test connexion Evoliz
          </h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary btn-sm" onClick={chargerPayterms}>
              Voir conditions de paiement
            </button>
            <button className="btn btn-primary btn-sm" onClick={testerEvoliz} disabled={testing || !companyId}>
              {testing ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Test…</> : '⚡ Tester la connexion'}
            </button>
          </div>
        </div>

        {!companyId && (
          <div className="alert alert-warning">
            ⚠ VITE_EVOLIZ_COMPANY_ID n'est pas configuré dans .env.local
          </div>
        )}

        {testResult && (
          <div>
            <div className="alert alert-success" style={{ marginBottom: 12 }}>
              ✓ Connexion Evoliz réussie
            </div>
            <div style={{ background: '#F5F5F5', padding: 12, borderRadius: 6, fontSize: 12, fontFamily: 'monospace', maxHeight: 200, overflowY: 'auto' }}>
              {JSON.stringify(testResult, null, 2)}
            </div>
          </div>
        )}

        {payterms && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 500, marginBottom: 8 }}>Conditions de paiement disponibles :</div>
            <table>
              <thead><tr><th>ID</th><th>Libellé</th></tr></thead>
              <tbody>
                {payterms.map(p => (
                  <tr key={p.paytermid}>
                    <td style={{ fontFamily: 'monospace' }}>{p.paytermid}</td>
                    <td>{p.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Secrets Supabase à configurer */}
      <div className="card">
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: 'var(--brand)' }}>
          Secrets Supabase à configurer (Edge Function)
        </h2>
        <p style={{ marginBottom: 12, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Ces secrets doivent être configurés dans Supabase Dashboard → Edge Functions → Secrets,
          ou via <code>supabase secrets set</code> :
        </p>
        <div style={{ background: '#F5F5F5', padding: '10px 14px', borderRadius: 6, fontFamily: 'monospace', fontSize: 12, lineHeight: 2 }}>
          EVOLIZ_PUBLIC_KEY=69b5a37e65e3c834574294RouQHO6sIJ<br/>
          EVOLIZ_SECRET_KEY=f8ddf69f0e28adb267e449ece5b1ad724d2cb42eUpYoKZ01gz4WjQikyO<br/>
          EVOLIZ_COMPANY_ID=114158 <span style={{ color: '#999' }}># ou le bon ID</span>
        </div>
        <p style={{ marginTop: 12, fontSize: 13, color: 'var(--text-muted)' }}>
          La clé secrète n'est jamais envoyée au browser — elle reste côté serveur dans la Edge Function.
        </p>
      </div>
    </div>
  )
}
