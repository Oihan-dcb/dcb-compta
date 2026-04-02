import { useState, useEffect } from 'react'
import { pingEvoliz, getPaytermsEvoliz } from '../services/evoliz'
import { syncProprietairesEvoliz } from '../services/syncProprietaires'
import { formatMontant, setToken } from '../lib/hospitable'
import { calculerVentilationMois } from '../services/ventilation'
import { lancerMatchingAuto } from '../services/rapprochement'
import { resetEtRematcher } from '../services/rapprochement'
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
  const [ventTimer, setVentTimer] = useState(0)
  const [ventError, setVentError] = useState(null)

  const VENT_STEPS = [
    { id: 'vent',     label: 'Ventilation comptable (all-time)' },
    { id: 'matching', label: 'Matching bancaire automatique (all-time)' },
  ]

  async function lancerVentMatcher() {
    setVentRunning(true)
    setVentDone(false)
    setVentError(null)
    setVentTimer(0)
    setVentSteps(VENT_STEPS.map(s => ({ ...s, status: 'pending' })))

    const update = (id, status, detail) => setVentSteps(prev =>
      prev.map(s => s.id === id ? { ...s, status, detail } : s)
    )

    const allMois = []
    const now = new Date()
    let y = 2022, m = 1
    while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
      allMois.push(`${y}-${String(m).padStart(2,'0')}`)
      m++; if (m > 12) { m = 1; y++ }
    }

    // Timer
    const startTime = Date.now()
    const timerInterval = setInterval(() => {
      setVentTimer(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)

    // 1. Ventilation
    update('vent', 'running')
    try {
      let total = 0, errors = 0
      for (const mois of allMois) {
        const v = await calculerVentilationMois(mois)
        total += (v?.total || 0)
        errors += (v?.errors || 0)
      }
      update('vent', 'ok', `${total} résa(s) ventilée(s)${errors ? ` — ${errors} erreur(s)` : ''}`)
    } catch(e) { update('vent', 'error', e.message); setVentError(e.message) }

    // 2. Matching
    update('matching', 'running')
    try {
      let total = 0
      for (const mois of allMois) {
        const r = await lancerMatchingAuto(mois)
        total += (r?.matched || 0)
      }
      update('matching', 'ok', `${total} virement(s) rapproché(s)`)
    } catch(e) { update('matching', 'error', e.message); setVentError(e.message) }

    clearInterval(timerInterval)
    setVentTimer(Math.floor((Date.now() - startTime) / 1000))
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

    // Générer tous les mois depuis 2022-01
    const allMois = []
    const now = new Date()
    let y = 2022, m = 1
    while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
      allMois.push(`${y}-${String(m).padStart(2,'0')}`)
      m++; if (m > 12) { m = 1; y++ }
    }

    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
    const ANON_KEY     = import.meta.env.VITE_SUPABASE_ANON_KEY

    // Timer
    const startTime = Date.now()
    const timerInterval = setInterval(() => {
      setGlobalTimer(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)

    // Compteurs globaux
    const totals = { biens: 0, resas: 0, payouts: 0, vent: 0, matching: 0 }
    let hasError = false

    // Appeler la Edge Function par chunks de 3 mois
    const CHUNK = 3
    const chunks = []
    for (let i = 0; i < allMois.length; i += CHUNK) {
      chunks.push({ debut: allMois[i], fin: allMois[Math.min(i + CHUNK - 1, allMois.length - 1)] })
    }
    const total = chunks.length

    // Ãtape 1-3 : sync via Edge Function par chunk
    update('biens', 'running', 'Sync en cours...')
    update('resas', 'running', 'Sync en cours...')
    update('payouts', 'running', 'Sync en cours...')

    for (let ci = 0; ci < chunks.length; ci++) {
      const { debut, fin } = chunks[ci]
      const progress = `chunk ${ci+1}/${total} (${debut})`
      update('resas', 'running', progress)
      try {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/global-sync`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ mois_debut: debut, mois_fin: fin })
        })
        if (resp.ok) {
          const result = await resp.json()
          if (result.success && result.log) {
            // Extraire les nombres des messages
            const extractNum = (s) => parseInt((s || '0').match(/\d+/)?.[0] || '0')
            if (ci === 0) totals.biens = extractNum(result.log.biens)
            totals.resas    += extractNum(result.log.resas)
            totals.payouts  += extractNum(result.log.payouts)
            totals.vent     += extractNum(result.log.vent)
            totals.matching += extractNum(result.log.matching)
          } else if (!result.success) {
            hasError = true
            setGlobalError(result.error || 'Erreur chunk ' + debut)
          }
        }
      } catch(e) {
        hasError = true
        setGlobalError(e.message)
        break
      }
    }

    clearInterval(timerInterval)
    setGlobalTimer(Math.floor((Date.now() - startTime) / 1000))

    if (!hasError) {
      update('biens',    'ok', `${totals.biens} biens vérifiés`)
      update('resas',    'ok', `${totals.resas} réservations syncées`)
      update('payouts',  'ok', `${totals.payouts} payouts syncés`)
      update('vent',     totals.vent > 0 ? 'ok' : 'ok', `${totals.vent} résa(s) ventilées`)
      update('matching', 'ok', `${totals.matching} virement(s) rapprochés`)
    } else {
      // Mettre à jour ce qu'on a réussi
      update('biens',   totals.biens > 0   ? 'ok' : 'error', `${totals.biens} biens`)
      update('resas',   totals.resas > 0   ? 'ok' : 'error', `${totals.resas} résas`)
      update('payouts', totals.payouts > 0 ? 'ok' : 'error', `${totals.payouts} payouts`)
      update('vent',    totals.vent > 0    ? 'ok' : 'error', `${totals.vent} ventilées`)
      update('matching','ok', `${totals.matching} rapprochés`)
    }

    setGlobalRunning(false)
    setGlobalDone(true)
  }

  const [syncingProprio, setSyncingProprio] = useState(false)
  const [syncProprioResult, setSyncProprioResult] = useState(null)
  const [syncingReviews, setSyncingReviews] = useState(false)
  const [reviewsResult, setReviewsResult] = useState(null)
  const [rematchRunning, setRematchRunning] = useState(false)
  const [rematchDone, setRematchDone] = useState(false)
  const [rematchSteps, setRematchSteps] = useState([])
  const [rematchTimer, setRematchTimer] = useState(0)
  const [rematchConfirmed, setRematchConfirmed] = useState(false)

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

  async function syncReviews() {
    setSyncingReviews(true)
    setReviewsResult(null)
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/sync-reviews`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setReviewsResult({ ok: true, ...data })
    } catch (err) {
      setReviewsResult({ ok: false, error: err.message })
    } finally {
      setSyncingReviews(false)
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


  // Re-matching complet all-time (overwrite)
  async function lancerReMatch() {
    if (!rematchConfirmed) return
    setRematchRunning(true)
    setRematchDone(false)
    setRematchSteps([])
    setRematchTimer(0)
    const startTime = Date.now()
    const timerInterval = setInterval(() => setRematchTimer(Math.floor((Date.now()-startTime)/1000)), 1000)
    const now = new Date()
    let y = 2025, m = 1  // partir de jan 2025
    const allMois = []
    while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
      allMois.push(`${y}-${String(m).padStart(2,'0')}`)
      m++; if (m > 12) { m = 1; y++ }
    }
    let totalReset = 0, totalMatched = 0
    for (const mois of allMois) {
      setRematchSteps(prev => [...prev, { mois, status: 'running', reset: 0, matched: 0 }])
      try {
        const res = await resetEtRematcher(mois)
        totalReset += res.reset || 0
        totalMatched += res.matched || 0
        setRematchSteps(prev => prev.map(s => s.mois === mois ? { ...s, status: 'ok', reset: res.reset, matched: res.matched } : s))
      } catch(e) {
        setRematchSteps(prev => prev.map(s => s.mois === mois ? { ...s, status: 'error', msg: e.message } : s))
      }
    }
    clearInterval(timerInterval)
    setRematchTimer(Math.floor((Date.now()-startTime)/1000))
    setRematchRunning(false)
    setRematchDone(true)
    setRematchConfirmed(false)
    window._rematchResult = { totalReset, totalMatched, mois: allMois.length }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Configuration</h1>
          <p className="page-subtitle">Paramètres de connexion et tests d'intégration</p>
        </div>
      </div>

      {error && <div className="alert alert-error">✗ {error}</div>}

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
                    : <span className="badge badge-danger">✗ Manquant</span>
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
              <div className="alert alert-error">✗ {syncProprioResult.error}</div>
            )}
          </div>
        )}
      </div>

      {/* Sync avis Hospitable */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0 }}>Sync avis Hospitable</h3>
            <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '0.9em' }}>
              Importe tous les avis voyageurs depuis l'API Hospitable vers reservation_review
            </p>
          </div>
          <button
            className="btn btn-primary"
            onClick={syncReviews}
            disabled={syncingReviews}
            style={{ minWidth: 160 }}>
            {syncingReviews ? '⏳ Sync…' : '⭐ Sync avis'}
          </button>
        </div>
        {reviewsResult && (
          <div style={{ padding: '12px 16px' }}>
            {reviewsResult.ok ? (
              <div className="alert alert-success">
                ✓ {reviewsResult.synced} avis synchronisés (total Hospitable : {reviewsResult.total})
              </div>
            ) : (
              <div className="alert alert-error">✗ {reviewsResult.error}</div>
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
          EVOLIZ_PUBLIC_KEY=&lt;votre_clé_publique&gt;<br/>
          EVOLIZ_SECRET_KEY=&lt;votre_clé_secrète&gt;<br/>
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
              ⚡ Mise à jour globale{/* CF-C8-DESACTIVE */}
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
            <button onClick={lancerGlobalUpdate}
              disabled={true}
              title="⛔ Désactivé — CF-C8 : logique dupliquée abandonnée. Utiliser Ventilation + Matching."
              style={{ opacity: 0.4, cursor: 'not-allowed' }} disabled={globalRunning}
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
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: ventSteps.length > 0 ? 16 : 0 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#059669', margin: 0 }}>
              ⚡ Ventilation + Matching all-time
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
              Ventile toutes les réservations non ventilées + matching bancaire — all-time
            </p>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap: 12 }}>
            {ventRunning && (
              <span style={{ fontSize: 13, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                ⏱ {ventTimer >= 60 ? Math.floor(ventTimer/60) + 'min ' + (ventTimer%60) + 's' : ventTimer + 's'}
              </span>
            )}
            {ventDone && !ventRunning && (
              <span style={{ fontSize: 12, color: '#059669', fontWeight: 600 }}>
                ✅ Terminé en {ventTimer >= 60 ? Math.floor(ventTimer/60) + 'min ' + (ventTimer%60) + 's' : ventTimer + 's'}
              </span>
            )}
            <button onClick={lancerVentMatcher} disabled={ventRunning}
              style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: ventRunning ? '#aaa' : '#059669', color: 'white', fontWeight: 700, fontSize: 14, cursor: ventRunning ? 'not-allowed' : 'pointer', minWidth: 120 }}>
              {ventRunning ? '⏳ En cours...' : '⚡ Lancer'}
            </button>
          </div>
        </div>
        {ventSteps.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ventSteps.map(step => (
              <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: step.status === 'ok' ? '#F0FDF4' : step.status === 'error' ? '#FEF2F2' : step.status === 'running' ? '#F0FDF4' : '#F9FAFB', border: `1px solid ${step.status === 'ok' ? '#86EFAC' : step.status === 'error' ? '#FCA5A5' : step.status === 'running' ? '#059669' : '#E5E7EB'}` }}>
                <span style={{ fontSize: 16, width: 22, textAlign: 'center', flexShrink: 0 }}>
                  {step.status === 'ok' ? '✅' : step.status === 'error' ? '❌' : step.status === 'running' ? '⏳' : '○'}
                </span>
                <span style={{ flex: 1, fontWeight: step.status === 'running' ? 700 : 500, fontSize: 13, color: step.status === 'running' ? '#059669' : 'inherit' }}>{step.label}</span>
                {step.detail && <span style={{ fontSize: 12, color: step.status === 'error' ? '#DC2626' : '#6B7280' }}>{step.detail}</span>}
              </div>
            ))}
          </div>
        )}
        {ventDone && !ventError && (
          <div style={{ marginTop: 12, padding: '12px 16px', borderRadius: 8, background: '#F0FDF4', border: '1px solid #86EFAC', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>✅</span>
            <span style={{ fontWeight: 700, color: '#15803D' }}>Ventilation + matching terminés en {ventTimer >= 60 ? Math.floor(ventTimer/60) + 'min ' + (ventTimer%60) + 's' : ventTimer + 's'}</span>
          </div>
        )}
        {ventError && (
          <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: '#FEF2F2', border: '1px solid #FCA5A5', fontSize: 13, color: '#DC2626' }}>
            ⚠️ {ventError}
          </div>
        )}
      </div>


      {/* Re-matching complet */}
      <div className="card" style={{ marginBottom: 24, border: '2px solid #DC2626', background: '#FFF5F5' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#DC2626', margin: 0 }}>
              ⚠️ Re-matching complet all-time
            </h2>
            <p style={{ margin: '4px 0 8px', fontSize: 13, color: '#7F1D1D' }}>
              Réinitialise et refait tous les rapprochements de jan 2025 à aujourd'hui, du plus ancien au plus récent.<br/>
              <strong>Overwrite des anciens matchings.</strong> Les rapprochements manuels seront écrasés.
            </p>
            <label style={{ display:'flex', alignItems:'center', gap: 8, cursor:'pointer', fontSize: 13, color: '#DC2626', fontWeight: 600 }}>
              <input type="checkbox" checked={rematchConfirmed} onChange={e => setRematchConfirmed(e.target.checked)} />
              Je comprends que cette opération est irréversible
            </label>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap: 12 }}>
            {rematchRunning && (
              <span style={{ fontSize: 13, color: '#DC2626', fontVariantNumeric: 'tabular-nums' }}>
                ⏱ {rematchTimer}s
              </span>
            )}
            <button onClick={lancerReMatch} disabled={rematchRunning || !rematchConfirmed}
              style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: rematchRunning || !rematchConfirmed ? '#aaa' : '#DC2626', color: 'white', fontWeight: 700, fontSize: 14, cursor: rematchRunning || !rematchConfirmed ? 'not-allowed' : 'pointer', minWidth: 120 }}>
              {rematchRunning ? '⏳ En cours...' : '⚡ Re-matcher'}
            </button>
          </div>
        </div>
        {rematchSteps.length > 0 && (
          <div style={{ maxHeight: 300, overflowY: 'auto', display:'flex', flexDirection:'column', gap: 4 }}>
            {rematchSteps.map(s => (
              <div key={s.mois} style={{ display:'flex', alignItems:'center', gap: 10, padding:'6px 10px', borderRadius: 6, fontSize: 12,
                background: s.status==='ok' ? '#F0FDF4' : s.status==='error' ? '#FEF2F2' : s.status==='running' ? '#FFF5F5' : '#F9FAFB',
                border: `1px solid ${s.status==='ok'?'#86EFAC':s.status==='error'?'#FCA5A5':s.status==='running'?'#DC2626':'#E5E7EB'}` }}>
                <span>{s.status==='ok'?'✅':s.status==='error'?'❌':s.status==='running'?'⏳':'⏸'}</span>
                <span style={{ fontWeight: 600, minWidth: 70 }}>{s.mois}</span>
                {s.status==='ok' && <span style={{ color:'#15803D' }}>{s.reset} reset → {s.matched} matchés</span>}
                {s.status==='running' && <span style={{ color:'#DC2626' }}>En cours...</span>}
                {s.status==='error' && <span style={{ color:'#DC2626' }}>{s.msg}</span>}
              </div>
            ))}
          </div>
        )}
        {rematchDone && (
          <div style={{ marginTop: 12, padding:'12px 16px', borderRadius: 8, background:'#F0FDF4', border:'1px solid #86EFAC', display:'flex', alignItems:'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>✅</span>
            <span style={{ fontWeight: 700, color:'#15803D' }}>Re-matching terminé en {rematchTimer}s</span>
          </div>
        )}
      </div>

    </div>
  )
}