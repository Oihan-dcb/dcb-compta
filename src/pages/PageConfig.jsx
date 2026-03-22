import { useState } from 'react'
import { pingEvoliz, getPaytermsEvoliz } from '../services/evoliz'
import { syncProprietairesEvoliz } from '../services/syncProprietaires'
import { formatMontant, setToken } from '../lib/hospitable'
import { calculerVentilationMois } from '../services/ventilation'
import { syncPayouts, lancerMatching } from '../services/matching'

export default function PageConfig() {
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [payterms, setPayterms] = useState(null)
  const [error, setError] = useState(null)

  const companyId = import.meta.env.VITE_EVOLIZ_COMPANY_ID
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL

  // Ventiler + Matcher
  const [ventRunning, setVentRunning] = useState(false)
  const [ventSteps, setVentSteps] = useState([])
  const [ventDone, setVentDone] = useState(false)

  const VENT_STEPS = [
    { id: 'vent',     label: 'Ventilation comptable (all-time)' },
    { id: 'matching', label: 'Matching bancaire automatique (all-time)' },
  ]

  async function lancerVentMatcher() {
    setVentRunning(true)
    setVentDone(false)
    setVentSteps(VENT_STEPS.map(s => ({ ...s, status: 'pending' })))

    const update = (id, status, detail) => setVentSteps(prev =>
      prev.map(s => s.id === id ? { ...s, status, detail } : s)
    )

    // G\u00e9n\u00e9rer tous les mois depuis 2022-01
    const allMois = []
    const now = new Date()
    let y = 2022, m = 1
    while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
      allMois.push(`${y}-${String(m).padStart(2,'0')}`)
      m++; if (m > 12) { m = 1; y++ }
    }

    // 1. Ventilation
    update('vent', 'running')
    try {
      let total = 0, errors = 0
      for (const mois of allMois) {
        const v = await calculerVentilationMois(mois)
        total += (v?.total || 0)
        errors += (v?.errors || 0)
      }
      update('vent', 'ok', `${total} r\u00e9sa(s) ventil\u00e9e(s)${errors ? ` — ${errors} erreur(s)` : ''}`)
    } catch(e) { update('vent', 'error', e.message) }

    // 2. Matching
    update('matching', 'running')
    try {
      let total = 0
      for (const mois of allMois) {
        const r = await lancerMatching(mois)
        total += (r?.matched || 0)
      }
      update('matching', 'ok', `${total} virement(s) rapproch\u00e9(s)`)
    } catch(e) { update('matching', 'error', e.message) }

    setVentRunning(false)
    setVentDone(true)
  }

  // Global Update
  const [globalRunning, setGlobalRunning] = useState(false)
  const [globalSteps, setGlobalSteps] = useState([])
  const [globalDone, setGlobalDone] = useState(false)
  const [globalTimer, setGlobalTimer] = useState(0)
  const [globalError, setGlobalError] = useState(null)

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
    setGlobalError(null)
    setGlobalTimer(0)
    setGlobalSteps(GLOBAL_STEPS.map(s => ({ ...s, status: 'pending' })))

    const update = (id, status, detail) => setGlobalSteps(prev =>
      prev.map(s => s.id === id ? { ...s, status, detail } : s)
    )

    // Lancer le timer
    const startTime = Date.now()
    const timerInterval = setInterval(() => {
      setGlobalTimer(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)

    // Simuler la progression pendant que la Edge Function tourne
    // Ordre : biens (2s) -> resas (60s) -> payouts (30s) -> vent (20s) -> matching (10s)
    const delays = { biens: 0, resas: 2000, payouts: 62000, vent: 95000, matching: 120000 }
    for (const [id, delay] of Object.entries(delays)) {
      setTimeout(() => update(id, 'running'), delay)
    }

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

      clearInterval(timerInterval)
      const elapsed = Math.floor((Date.now() - startTime) / 1000)
      setGlobalTimer(elapsed)

      const result = await resp.json()

      if (!resp.ok || !result.success) {
        GLOBAL_STEPS.forEach(s => update(s.id, 'error', result.error || 'Erreur Edge Function'))
        setGlobalError(result.error || 'Erreur inconnue')
      } else {
        const { log } = result
        update('biens',    log.biens    ? 'ok' : 'error', log.biens    || 'Erreur')
        update('resas',    log.resas    ? 'ok' : 'error', log.resas    || 'Erreur')
        update('payouts',  log.payouts  ? 'ok' : 'error', log.payouts  || 'Erreur')
        update('vent',     log.vent     ? 'ok' : 'error', log.vent     || 'Erreur')
        update('matching', log.matching ? 'ok' : 'error', log.matching || 'Erreur')
        if (log.errors?.length) setGlobalError(`${log.errors.length} avertissement(s) — voir console`)
      }
    } catch(e) {
      clearInterval(timerInterval)
      GLOBAL_STEPS.forEach(s => update(s.id, s.status === 'running' ? 'error' : s.status, s.status === 'running' ? e.message : undefined))
      setGlobalError(e.message)
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
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: globalSteps.length > 0 ? 16 : 0 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--brand)', margin: 0 }}>
              ⚡ Mise à jour globale
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
              Sync biens → réservations → payouts → ventilation → matching — all-time (depuis 2022)
            </p>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap: 12 }}>
            {globalRunning && (
              <span style={{ fontSize: 13, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                ⏱ {globalTimer >= 60 ? Math.floor(globalTimer/60) + 'min ' + (globalTimer%60) + 's' : globalTimer + 's'}
              </span>
            )}
            {globalDone && !globalRunning && (
              <span style={{ fontSize: 12, color: '#059669', fontWeight: 600 }}>
                ✅ Terminé en {globalTimer >= 60 ? Math.floor(globalTimer/60) + 'min ' + (globalTimer%60) + 's' : globalTimer + 's'}
              </span>
            )}
            <button onClick={lancerGlobalUpdate} disabled={globalRunning}
              style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: globalRunning ? '#aaa' : 'var(--brand)', color: 'white', fontWeight: 700, fontSize: 14, cursor: globalRunning ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
              {globalRunning ? <>⏳ En cours...</> : '⚡ Lancer'}
            </button>
          </div>
        </div>
        {globalSteps.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {globalSteps.map(step => (
              <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: step.status === 'ok' ? '#F0FDF4' : step.status === 'error' ? '#FEF2F2' : step.status === 'running' ? '#FFFBEB' : '#F9FAFB', border: `1px solid ${step.status === 'ok' ? '#86EFAC' : step.status === 'error' ? '#FCA5A5' : step.status === 'running' ? 'var(--brand)' : '#E5E7EB'}` }}>
                <span style={{ fontSize: 16, width: 22, textAlign: 'center', flexShrink: 0 }}>
                  {step.status === 'ok' ? '✅' : step.status === 'error' ? '❌' : step.status === 'running' ? '⏳' : '○'}
                </span>
                <span style={{ flex: 1, fontWeight: step.status === 'running' ? 700 : 500, fontSize: 13, color: step.status === 'running' ? 'var(--brand)' : 'inherit' }}>{step.label}</span>
                {step.detail && <span style={{ fontSize: 12, color: step.status === 'error' ? '#DC2626' : '#6B7280' }}>{step.detail}</span>}
              </div>
            ))}
          </div>
        )}
        {globalDone && !globalError && (
          <div style={{ marginTop: 12, padding: '12px 16px', borderRadius: 8, background: '#F0FDF4', border: '1px solid #86EFAC', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>✅</span>
            <span style={{ fontWeight: 700, color: '#15803D' }}>Mise à jour terminée en {globalTimer >= 60 ? Math.floor(globalTimer/60) + 'min ' + (globalTimer%60) + 's' : globalTimer + 's'}</span>
          </div>
        )}
        {globalError && (
          <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: '#FEF2F2', border: '1px solid #FCA5A5', fontSize: 13, color: '#DC2626' }}>
            ⚠️ {globalError}
          </div>
        )}
      </div>

      {/* Ventiler + Matcher */}
      <div className="card" style={{ marginBottom: 24, border: '2px solid #059669' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#059669', margin: 0 }}>
              ⚡ Ventilation + Matching all-time
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
              Ventile toutes les réservations non ventilées + matching bancaire — all-time
            </p>
          </div>
          <button onClick={lancerVentMatcher} disabled={ventRunning}
            style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: ventRunning ? '#aaa' : '#059669', color: 'white', fontWeight: 700, fontSize: 14, cursor: ventRunning ? 'not-allowed' : 'pointer' }}>
            {ventRunning ? '⏳ En cours...' : '⚡ Lancer'}
          </button>
        </div>
        {ventSteps.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ventSteps.map(step => (
              <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: step.status === 'ok' ? 'var(--success-bg)' : step.status === 'error' ? 'var(--danger-bg)' : step.status === 'running' ? '#ECFDF5' : '#f9f9f9', border: `1px solid ${step.status === 'ok' ? '#bbf7d0' : step.status === 'error' ? '#fca5a5' : step.status === 'running' ? '#059669' : 'var(--border)'}` }}>
                <span style={{ fontSize: 16, width: 20, textAlign: 'center' }}>
                  {step.status === 'ok' ? '✅' : step.status === 'error' ? '❌' : step.status === 'running' ? '⏳' : '○'}
                </span>
                <span style={{ flex: 1, fontWeight: 500, fontSize: 13 }}>{step.label}</span>
                {step.detail && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{step.detail}</span>}
              </div>
            ))}
          </div>
        )}
        {ventDone && (
          <div className="alert alert-success" style={{ marginTop: 12 }}>
            ✅ Ventilation + matching terminés
          </div>
        )}
      </div>

    </div>
  )
}
