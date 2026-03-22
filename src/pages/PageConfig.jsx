import { useState } from 'react'
import { pingEvoliz, getPaytermsEvoliz } from '../services/evoliz'
import { syncProprietairesEvoliz } from '../services/syncProprietaires'
import { formatMontant } from '../lib/hospitable'
import { setToken } from '../lib/hospitable'

export default function PageConfig() {
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [payterms, setPayterms] = useState(null)
  const [error, setError] = useState(null)

  const companyId = import.meta.env.VITE_EVOLIZ_COMPANY_ID
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL

  // Global Update
  const [globalRunning, setGlobalRunning] = useState(false)
  const [globalSteps, setGlobalSteps] = useState([])
  const [globalDone, setGlobalDone] = useState(false)

  const GLOBAL_STEPS = [
    { id: 'biens',    label: 'Sync biens Hospitable' },
    { id: 'resas',    label: 'Sync réservations Hospitable' },
    { id: 'payouts',  label: 'Sync payouts (Airbnb / Stripe)' },
    { id: 'vent',     label: 'Ventilation comptable' },
    { id: 'matching', label: 'Matching bancaire automatique' },
  ]

  async function lancerGlobalUpdate() {
    setGlobalRunning(true)
    setGlobalDone(false)
    setGlobalSteps(GLOBAL_STEPS.map(s => ({ ...s, status: 'running' === s.id ? 'running' : 'pending' })))

    const update = (id, status, detail) => setGlobalSteps(prev =>
      prev.map(s => s.id === id ? { ...s, status, detail } : s)
    )

    // Marquer toutes les étapes comme "en cours"
    update('biens',    'running')
    update('resas',    'pending')
    update('payouts',  'pending')
    update('vent',     'pending')
    update('matching', 'pending')

    try {
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
      const ANON_KEY     = import.meta.env.VITE_SUPABASE_ANON_KEY

      const resp = await fetch(`${SUPABASE_URL}/functions/v1/global-sync`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({})
      })

      const result = await resp.json()

      if (!resp.ok || !result.success) {
        // Marquer tout en erreur
        GLOBAL_STEPS.forEach(s => update(s.id, 'error', result.error || 'Edge Function error'))
      } else {
        const { log } = result
        update('biens',    log.biens    ? 'ok' : 'error', log.biens    || 'Erreur')
        update('resas',    log.resas    ? 'ok' : 'error', log.resas    || 'Erreur')
        update('payouts',  log.payouts  ? 'ok' : 'error', log.payouts  || 'Erreur')
        update('vent',     log.vent     ? 'ok' : 'error', log.vent     || 'Erreur')
        update('matching', log.matching ? 'ok' : 'error', log.matching || 'Erreur')
        if (log.errors?.length) {
          console.warn('Global sync warnings:', log.errors)
        }
      }
    } catch(e) {
      GLOBAL_STEPS.forEach(s => update(s.id, 'error', e.message))
    }

    setGlobalRunning(false)
    setGlobalDone(true)
  }

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
      {/* Global Update */}
      <div className="card" style={{ marginBottom: 24, border: '2px solid var(--brand)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--brand)', margin: 0 }}>
              ⚡ Mise à jour globale
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
              Sync biens → réservations → payouts → ventilation → matching — all-time (depuis 2022) — tourne côté serveur
            </p>
          </div>
          <button onClick={lancerGlobalUpdate} disabled={globalRunning}
            style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: globalRunning ? '#aaa' : 'var(--brand)', color: 'white', fontWeight: 700, fontSize: 14, cursor: globalRunning ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
            {globalRunning ? <><span className="spinner" /> En cours...</> : '⚡ Lancer'}
          </button>
        </div>
        {(globalSteps.length > 0) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {globalSteps.map(step => (
              <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: step.status === 'ok' ? 'var(--success-bg)' : step.status === 'error' ? 'var(--danger-bg)' : step.status === 'running' ? 'var(--brand-pale)' : '#f9f9f9', border: `1px solid ${step.status === 'ok' ? '#bbf7d0' : step.status === 'error' ? '#fca5a5' : step.status === 'running' ? 'var(--brand)' : 'var(--border)'}` }}>
                <span style={{ fontSize: 16, width: 20, textAlign: 'center' }}>
                  {step.status === 'ok' ? '✅' : step.status === 'error' ? '❌' : step.status === 'running' ? '⏳' : '○'}
                </span>
                <span style={{ flex: 1, fontWeight: 500, fontSize: 13 }}>{step.label}</span>
                {step.detail && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{step.detail}</span>}
              </div>
            ))}
          </div>
        )}
        {globalDone && (
          <div className="alert alert-success" style={{ marginTop: 12 }}>
            ✅ Mise à jour terminée — toutes les données sont à jour pour {new Date().toISOString().slice(0,7)}
          </div>
        )}
      </div>

    </div>
  )
}
