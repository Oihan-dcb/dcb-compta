import { useState, useEffect } from 'react'
import MoisSelector from '../components/MoisSelector'
import { useMoisPersisted } from '../hooks/useMoisPersisted'
import {
  getFacturesMois, genererFacturesMois, validerFacture,
  getStatsFactures,
  getFactureCOM, genererFactureCOM, validerFactureCOM,
} from '../services/facturesEvoliz'
import { pousserFacturesMoisVersEvoliz, pingEvoliz, pousserFactureCOMVersEvoliz } from '../services/evoliz'
import { formatMontant } from '../lib/hospitable'

const moisCourant = new Date().toISOString().substring(0, 7)

const STATUTS = {
  calcul_en_cours: { label: 'Calcul en cours', color: 'var(--text-muted)', bg: '#F3F4F6' },
  brouillon: { label: 'Brouillon', color: '#D97706', bg: '#FEF3C7' },
  valide: { label: 'Validée', color: '#059669', bg: '#D1FAE5' },
  envoi_en_cours: { label: 'Envoi en cours…', color: '#D97706', bg: '#FEF3C7' },
  envoye_evoliz: { label: 'Envoyée Evoliz', color: '#EA580C', bg: '#FFF7ED' },
  payee: { label: 'Payée', color: '#059669', bg: '#D1FAE5' },
  solde_negatif: { label: 'Solde négatif', color: '#DC2626', bg: '#FEE2E2' },
}

export default function PageFactures() {
  const [mois, setMois] = useMoisPersisted()
  const [moisDispos, setMoisDispos] = useState(() => {
    const [cy, cm] = moisCourant.split('-').map(Number)
    return Array.from({ length: cm }, (_, i) => `${cy}-${String(i + 1).padStart(2, '0')}`)
  })
  const [factures, setFactures] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
const [pushing, setPushing] = useState(false)
  const [showConfirmEvoliz, setShowConfirmEvoliz] = useState(false)
  const [pushResult, setPushResult] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [warning, setWarning] = useState(null)

  // COM
  const [comFacture, setComFacture] = useState(null)
  const [generatingCOM, setGeneratingCOM] = useState(false)
  const [pushingCOM, setPushingCOM] = useState(false)

  // Contrôle virements propriétaires
  const [virementsSortants, setVirementsSortants] = useState([])
  const [liensVirements, setLiensVirements] = useState({})   // proprio_id → mouvement_id
  const [commentairesCtrl, setCommentairesCtrl] = useState({}) // proprio_id → string
  const [loadingVirements, setLoadingVirements] = useState(false)

  useEffect(() => { charger(); chargerCOM(); chargerVirements() }, [mois])

  // Persistance localStorage pour liens et commentaires
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`dcb_ctrl_vir_${mois}`) || '{}')
      if (saved.liens) setLiensVirements(saved.liens)
      if (saved.commentaires) setCommentairesCtrl(saved.commentaires)
    } catch {}
  }, [mois])

  function sauvegarderCtrl(newLiens, newCommentaires) {
    try {
      localStorage.setItem(`dcb_ctrl_vir_${mois}`, JSON.stringify({
        liens: newLiens ?? liensVirements,
        commentaires: newCommentaires ?? commentairesCtrl,
      }))
    } catch {}
  }

  useEffect(() => {
    import('../lib/supabase').then(function(mod) {
      mod.supabase.from('facture_evoliz').select('mois').then(function(res) {
        if (res.data) {
          var uniq = [...new Set(res.data.map(function(d) { return d.mois }).filter(Boolean))].sort(function(a,b) { return b.localeCompare(a) })
          if (uniq.length) setMoisDispos(function(p) { return [...new Set([...p, ...uniq])] })
        }
      })
    })
  }, [])

  async function chargerCOM() {
    const f = await getFactureCOM(mois)
    setComFacture(f)
  }

  async function genererCOM() {
    setGeneratingCOM(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await genererFactureCOM(mois)
      setSuccess(`Facture COM ${result.created ? 'créée' : 'mise à jour'} — ${formatMontant(result.ttc)} TTC`)
      await chargerCOM()
    } catch (err) {
      setError(err.message)
    } finally {
      setGeneratingCOM(false)
    }
  }

  async function validerCOM() {
    if (!comFacture?.id) return
    try {
      await validerFactureCOM(comFacture.id)
      setSuccess('Facture COM validée — prête pour Evoliz')
      await chargerCOM()
    } catch (err) {
      setError(err.message)
    }
  }

  async function pousserCOM() {
    if (!comFacture?.id) return
    setPushingCOM(true)
    setError(null)
    try {
      const result = await pousserFactureCOMVersEvoliz(
        comFacture.id,
        { ht: comFacture.total_ht, tva: 0, ttc: comFacture.total_ttc },
        mois
      )
      setSuccess(`Facture COM envoyée dans Evoliz — n° ${result.invoiceNumber || result.invoiceId}`)
      await chargerCOM()
    } catch (err) {
      setError(err.message)
    } finally {
      setPushingCOM(false)
    }
  }

  async function chargerVirements() {
    setLoadingVirements(true)
    try {
      const { supabase } = await import('../lib/supabase')
      // Les virements du mois M sont souvent exécutés en M+1 → chercher sur mois ET mois+1
      const [y, m] = mois.split('-').map(Number)
      const moisSuivant = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
      const { data, error } = await supabase
        .from('mouvement_bancaire')
        .select('id, libelle, detail, debit, date_operation, canal, mois_releve')
        .in('mois_releve', [mois, moisSuivant])
        .gt('debit', 0)
        .order('date_operation', { ascending: true })
      if (error) throw error
      setVirementsSortants(data || [])
    } catch (err) {
      console.error('chargerVirements:', err)
    } finally {
      setLoadingVirements(false)
    }
  }

  async function charger() {
    setLoading(true)
    setError(null)
    try {
      const [f, s] = await Promise.all([getFacturesMois(mois), getStatsFactures(mois)])
      setFactures(f)
      setStats(s)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function generer() {
    setGenerating(true)
    setError(null)
    setSuccess(null)
    setWarning(null)
    try {
      const result = await genererFacturesMois(mois)
      setSuccess(`${result.created} factures créées, ${result.updated} mises à jour${result.skipped > 0 ? `, ${result.skipped} ignorée(s) (déjà envoyée(s))` : ''}${result.errors > 0 ? `, ${result.errors} erreurs` : ''}`)
      if ((result.resteAPayer || 0) > 0) {
        setWarning(`⚠ Reversement entierement absorbe sur certaines factures. Reste total a payer : ${(result.resteAPayer / 100).toFixed(2)} €`)
      }
      await charger()
    } catch (err) {
      setError(err.message)
    } finally {
      setGenerating(false)
    }
  }

  async function valider(factureId) {
    try {
      await validerFacture(factureId)
      setSuccess('Facture validée — prête pour envoi dans Evoliz')
      await charger()
    } catch (err) {
      setError(err.message)
    }
  }

  async function validerTout() {
    const brouillons = factures.filter(f => f.statut === 'brouillon' && f.total_ttc > 0)
    if (brouillons.length === 0) return
    if (!confirm(`Valider ${brouillons.length} facture(s) pour ${mois} ?`)) return
    setError(null)
    setSuccess(null)
    let ok = 0, ko = 0
    for (const f of brouillons) {
      try {
        await validerFacture(f.id)
        ok++
      } catch {
        ko++
      }
    }
    setSuccess(`${ok} facture(s) validée(s)${ko > 0 ? `, ${ko} erreur(s)` : ''}`)
    await charger()
  }

  async function executerPousserEvoliz() {
    setPushing(true)
    setPushResult(null)
    setError(null)
    try {
      const result = await pousserFacturesMoisVersEvoliz(mois)
      setPushResult(result)
      await charger()
    } catch (err) {
      setError(err.message)
    } finally {
      setPushing(false)
    }
  }

  const totalTTC = factures.reduce((s, f) => s + (f.total_ttc || 0), 0)
  const totalReversement = factures.reduce((s, f) => s + (f.montant_reversement || 0), 0)

  // Exclure les factures sans rien à facturer (calcul_en_cours = total zéro)
  const facturesVisibles = factures.filter(f => f.statut !== 'calcul_en_cours')

  const fmtDate = d => d ? d.split('-').reverse().join('/') : '—'

  // Tri : code bien direct, ou label groupe (Maison Maïté → "M..."), ou premier code proprio
  function labelFacture(f) {
    if (f.bien?.code) return f.bien.code
    const biens = f.proprietaire?.bien || []
    if (biens.some(b => b.groupe_facturation === 'MAITE')) return 'Maison Maïté'
    return biens.slice().sort((a,b)=>(a.code||'').localeCompare(b.code||''))[0]?.code || ''
  }
  const isMaiteFacture = f => (f.proprietaire?.bien || []).some(b => b.groupe_facturation === 'MAITE')
  const facturesTries = [...facturesVisibles].sort((a, b) => {
    const mA = isMaiteFacture(a) ? 0 : 1
    const mB = isMaiteFacture(b) ? 0 : 1
    if (mA !== mB) return mA - mB
    const c = labelFacture(a).localeCompare(labelFacture(b), 'fr', { numeric: true })
    if (c !== 0) return c
    return `${a.proprietaire?.nom}`.localeCompare(`${b.proprietaire?.nom}`, 'fr')
  })

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Factures</h1>
          <p className="page-subtitle">
            Factures DCB — Propriétaires — {factures.length} factures · {formatMontant(totalTTC)} TTC
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <MoisSelector mois={mois} setMois={setMois} moisDispos={moisDispos} />
          <button className="btn btn-secondary" onClick={charger} disabled={loading}>↺</button>
          <button
            className="btn btn-secondary"
            onClick={validerTout}
            disabled={generating || pushing || !stats?.brouillons}
            title={!stats?.brouillons ? 'Aucun brouillon à valider' : `Valider ${stats?.brouillons} brouillon(s)`}
          >
            ✓ Tout valider
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setShowConfirmEvoliz(true)}
            disabled={pushing || stats?.valides === 0}
            title={stats?.valides === 0 ? 'Aucune facture validée à envoyer' : `Envoyer ${stats?.valides} facture(s) validée(s) vers Evoliz`}
          >
            {pushing ? <><span className="spinner" /> Evoliz…</> : '— Pousser vers Evoliz'}
          </button>
          <button className="btn btn-primary" onClick={generer} disabled={generating}>
            {generating ? <><span className="spinner" /> Génération…</> : '⚡ Générer factures'}
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-label">Factures</div>
            <div className="stat-value">{stats.total}</div>
            <div className="stat-sub">propriétaires facturés</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Brouillons</div>
            <div className="stat-value" style={{ color: stats.brouillons > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>
              {stats.brouillons}
            </div>
            <div className="stat-sub">à valider avant envoi</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Validées / Envoyées</div>
            <div className="stat-value" style={{ color: 'var(--success)' }}>
              {stats.valides + stats.envoyes + stats.payes}
            </div>
            <div className="stat-sub">traitées</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total TTC facturé</div>
            <div className="stat-value" style={{ fontSize: 18 }}>{formatMontant(stats.total_ttc)}</div>
            <div className="stat-sub">revenus DCB du mois</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total à reverser</div>
            <div className="stat-value" style={{ fontSize: 18, color: 'var(--brand)' }}>
              {formatMontant(totalReversement)}
            </div>
            <div className="stat-sub">aux propriétaires</div>
          </div>
          {stats.soldes_negatifs > 0 && (
            <div className="stat-card">
              <div className="stat-label">Soldes négatifs</div>
              <div className="stat-value" style={{ color: 'var(--danger)' }}>{stats.soldes_negatifs}</div>
              <div className="stat-sub">à réclamer au proprio</div>
            </div>
          )}
        </div>
      )}

      {/* Alertes */}
      {error && <div className="alert alert-error">✗ {error}</div>}
      {pushResult && (
        <div className={`alert ${pushResult.errors.length > 0 ? 'alert-warning' : 'alert-success'}`}>
          {pushResult.errors.length === 0
            ? `✓ ${pushResult.pushed} facture(s) envoyée(s) dans Evoliz`
            : `⚠ ${pushResult.pushed} envoyée(s), ${pushResult.errors.length} erreur(s) : ${pushResult.errors.map(e => `${e.proprio}: ${e.error}`).join(' | ')}`
          }
        </div>
      )}
      {success && <div className="alert alert-success">✓ {success}</div>}
      {stats?.brouillons > 0 && (
        <div className="alert alert-warning">
          ⚠ {stats.brouillons} facture(s) en brouillon — à valider avant envoi dans Evoliz.
          Assure-toi que la ventilation et les factures AE sont correctes avant de valider.
        </div>
      )}

      {warning && (
        <div className="alert alert-warning">
          {warning}
        </div>
      )}

      {/* ── Bloc COM — Commissions Web Directes ── */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--white)', marginBottom: 16, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, background: '#F0EBE1', borderBottom: '2px solid var(--brand)' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Commissions Web Directes — CLI-RESA-WEB-DCB</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Réservations directes · code COM · TVA 20%
              {comFacture?.numero_facture && <span style={{ marginLeft: 8, fontWeight: 600 }}>· {comFacture.numero_facture}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {comFacture && (
              <>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>HT</div>
                  <div style={{ fontWeight: 500 }}>{formatMontant(comFacture.total_ht)}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>TTC</div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{formatMontant(comFacture.total_ttc)}</div>
                </div>
                <span style={{ padding: '4px 12px', borderRadius: 100, fontSize: 12, fontWeight: 600, background: (STATUTS[comFacture.statut] || STATUTS.brouillon).bg, color: (STATUTS[comFacture.statut] || STATUTS.brouillon).color }}>
                  {(STATUTS[comFacture.statut] || STATUTS.brouillon).label}
                </span>
              </>
            )}
            {!comFacture && <span style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>Non générée ce mois</span>}
            {(!comFacture || comFacture.statut === 'brouillon') && (
              <button className="btn btn-secondary" style={{ fontSize: 13 }} onClick={genererCOM} disabled={generatingCOM}>
                {generatingCOM ? <><span className="spinner" /> Génération…</> : '⚡ Générer'}
              </button>
            )}
            {comFacture?.statut === 'brouillon' && (
              <button className="btn btn-secondary" style={{ fontSize: 13 }} onClick={validerCOM}>
                ✓ Valider
              </button>
            )}
            {comFacture?.statut === 'valide' && (
              <button className="btn btn-primary" style={{ fontSize: 13 }} onClick={pousserCOM} disabled={pushingCOM}>
                {pushingCOM ? <><span className="spinner" /> Evoliz…</> : '— Pousser Evoliz'}
              </button>
            )}
          </div>
        </div>
      </div>

      {loading && factures.length === 0 ? (
        <div className="loading-state"><span className="spinner" /> Chargement…</div>
      ) : !loading && factures.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">Aucune facture pour ce mois</div>
          <p>Lance la génération après avoir synchronisé les réservations et calculé la ventilation.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {facturesTries.map(f => {
            const statutInfo = f.solde_negatif ? STATUTS.solde_negatif : (STATUTS[f.statut] || STATUTS.brouillon)
            const isExpanded = expanded === f.id
            const proprio = f.proprietaire
            // Label du bien : code direct, ou "Maison Maïté" pour le groupe, ou codes séparés
            const bienCodes = f.bien?.code
              ? f.bien.code
              : (proprio?.bien || []).some(b => b.groupe_facturation === 'MAITE')
                ? 'Maison Maïté'
                : (proprio?.bien || []).slice().sort((a,b)=>(a.code||'').localeCompare(b.code||'')).map(b=>b.code).filter(Boolean).join(', ')

            return (
              <div key={f.id} style={{
                background: 'var(--white)',
                border: `1px solid ${f.solde_negatif ? '#FCA5A5' : 'var(--border)'}`,
                borderRadius: 'var(--radius)',
                overflow: 'hidden',
              }}>
                {/* Header */}
                <div
                  style={{ padding: '14px 18px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  onClick={() => setExpanded(isExpanded ? null : f.id)}
                >
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>
                        {bienCodes && <span style={{ fontFamily: 'monospace', color: 'var(--brand)', marginRight: 8, fontSize: 13 }}>{bienCodes}</span>}
                        {proprio?.nom} {proprio?.prenom || ''}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {f.numero_facture || `Brouillon — ${mois}`}
                        {proprio?.iban && <span> · IBAN : {proprio.iban.substring(0, 12)}…</span>}
                        {f.type_facture === 'debours' && (
                          <span style={{ fontSize: 10, fontWeight: 700, background: '#e8f4f8',
                                         color: '#2c7da0', borderRadius: 4, padding: '2px 6px',
                                         marginLeft: 8, verticalAlign: 'middle' }}>
                            Débours AE
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
                    {/* Montants clÃÂ©s */}
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>HT</div>
                      <div style={{ fontWeight: 500 }}>{formatMontant(f.total_ht)}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>TTC</div>
                      <div style={{ fontWeight: 700, fontSize: 16 }}>{formatMontant(f.total_ttc)}</div>
                    </div>
                    {f.montant_reversement > 0 && (
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Reversement</div>
                        <div style={{ fontWeight: 600, color: 'var(--brand)' }}>{formatMontant(f.montant_reversement)}</div>
                      </div>
                    )}
                    {f.solde_negatif && (
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 11, color: 'var(--danger)', textTransform: 'uppercase' }}>À réclamer</div>
                        <div style={{ fontWeight: 700, color: 'var(--danger)' }}>{formatMontant(f.montant_reclame)}</div>
                      </div>
                    )}

                    {/* Statut */}
                    <span style={{
                      padding: '4px 12px', borderRadius: 100,
                      fontSize: 12, fontWeight: 600,
                      background: statutInfo.bg, color: statutInfo.color,
                    }}>
                      {statutInfo.label}
                    </span>

                    {/* Action valider */}
                    {f.statut === 'brouillon' && (
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={e => { e.stopPropagation(); valider(f.id) }}
                      >
                        ✓ Valider
                      </button>
                    )}

                    <span style={{ color: 'var(--text-muted)' }}>{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </div>

                {/* DÃÂ©tail lignes */}
                {isExpanded && (
                  <div style={{ padding: '0 18px 14px', borderTop: '1px solid var(--border)' }}>
                    <div style={{ marginTop: 12, marginBottom: 8, fontSize: 13, fontWeight: 500, color: 'var(--brand)' }}>
                      Lignes de facturation
                    </div>
                    <div className="table-container">
                      <table>
                        <thead>
                          <tr>
                            <th>Code</th>
                            <th>Libellé</th>
                            <th>Description</th>
                            <th className="right">HT</th>
                            <th className="right">TVA 20%</th>
                            <th className="right">TTC</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(f.facture_evoliz_ligne || [])
                            .sort((a, b) => a.ordre - b.ordre)
                            .map(l => (
                              <tr key={l.id}>
                                <td><span className={`code-${l.code}`}>{l.code}</span></td>
                                <td style={{ fontWeight: 500 }}>{l.libelle}</td>
                                <td style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 300 }}>
                                  {l.description?.substring(0, 80)}{l.description?.length > 80 ? '…' : ''}
                                </td>
                                <td className="right montant">{formatMontant(l.montant_ht)}</td>
                                <td className="right montant" style={{ color: 'var(--text-muted)' }}>
                                  {l.taux_tva > 0 ? formatMontant(l.montant_tva) : '—'}
                                </td>
                                <td className="right montant" style={{ fontWeight: 600 }}>
                                  {formatMontant(l.montant_ttc)}
                                </td>
                              </tr>
                            ))}
                          <tr style={{ background: 'var(--brand-pale)', borderTop: '2px solid var(--border)' }}>
                            <td colSpan={3} style={{ fontWeight: 600 }}>Total</td>
                            <td className="right montant" style={{ fontWeight: 700 }}>{formatMontant(f.total_ht)}</td>
                            <td className="right montant" style={{ fontWeight: 700, color: 'var(--text-muted)' }}>{formatMontant(f.total_tva)}</td>
                            <td className="right montant" style={{ fontWeight: 700 }}>{formatMontant(f.total_ttc)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    {/* Info reversement et IBAN */}
                    {f.montant_reversement > 0 && (
                      <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--bg, #F7F3EC)', borderRadius: 6, fontSize: 13, border: '1px solid var(--border, #D9CEB8)' }}>
                        <strong>Ordre de virement à préparer :</strong> {formatMontant(f.montant_reversement)} vers{' '}
                        {proprio?.iban || <span style={{ color: 'var(--warning)' }}>⚠ IBAN non renseigné</span>}
                      </div>
                    )}
                    {f.solde_negatif && (
                      <div style={{ marginTop: 12, padding: '10px 14px', background: '#FEF2F2', borderRadius: 6, fontSize: 13 }}>
                        <strong style={{ color: 'var(--danger)' }}>Solde négatif :</strong>{' '}
                        {formatMontant(f.montant_reclame)} à réclamer au propriétaire — envoyer cette facture pour remboursement.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Contrôle virements propriétaires ── */}
      {(() => {
        const facturesAvecReversement = facturesTries.filter(f => f.montant_reversement > 0)
        if (facturesAvecReversement.length === 0) return null

        // Normalisation pour matching
        const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()

        // Auto-match sur detail (ex: "Loyer Mars EKIA") — code du bien de la facture uniquement
        function autoMatchVirement(f) {
          // Si la facture est liée à un bien précis, matcher sur ce code ; sinon sur tous les biens du proprio
          const bienCode = f.bien?.code
          const tokens = bienCode
            ? [norm(bienCode)].filter(t => t.length >= 2)
            : (f.proprietaire?.bien || []).map(b => norm(b.code)).filter(t => t.length >= 2)

          let best = null, bestScore = 0
          for (const vir of virementsSortants) {
            if (Object.values(liensVirements).includes(vir.id)) continue
            const lib = norm((vir.detail || '') + ' ' + (vir.libelle || ''))
            const score = tokens.reduce((s, t) => s + (lib.includes(t) ? 1 : 0), 0)
            if (score > bestScore) { bestScore = score; best = vir }
          }
          return bestScore >= 1 ? best : null
        }

        // Résoudre le virement lié (manuel > auto) — clé = id facture
        // liensVirements[f.id] = 'none' → explicitement non lié (bloque l'auto-match)
        // liensVirements[f.id] = mouvement_id → lien manuel
        // absent → auto-match
        function getVirementLie(f) {
          const manuelId = liensVirements[f.id]
          if (manuelId === 'none') return null
          if (manuelId) return virementsSortants.find(v => v.id === manuelId) || null
          return autoMatchVirement(f)
        }

        const totalAttendu = facturesAvecReversement.reduce((s, f) => s + f.montant_reversement, 0)
        const virementsDejàLiés = new Set(facturesAvecReversement.map(f => getVirementLie(f)?.id).filter(Boolean))
        const virementsNonLiés = virementsSortants.filter(v => !virementsDejàLiés.has(v.id))

        return (
          <div style={{ marginTop: 32, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--white)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', background: '#F0EBE1', borderBottom: '2px solid var(--brand)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>Contrôle virements propriétaires</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  Rapprochement sorties de compte vs réversements attendus — {mois}
                  {loadingVirements && <span style={{ marginLeft: 8 }}><span className="spinner" /></span>}
                </div>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {virementsSortants.length} virement(s) sortant(s) · attendu : <strong>{(totalAttendu / 100).toFixed(2)} €</strong>
              </div>
            </div>

            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Propriétaire</th>
                    <th className="right">Attendu</th>
                    <th>Virement trouvé</th>
                    <th className="right">Montant virement</th>
                    <th className="right">Écart</th>
                    <th>Statut</th>
                    <th>Commentaires Oihan</th>
                  </tr>
                </thead>
                <tbody>
                  {facturesAvecReversement.map(f => {
                    const proprio = f.proprietaire
                    const bienCodes = f.bien?.code
                      ? f.bien.code
                      : (proprio?.bien || []).some(b => b.groupe_facturation === 'MAITE')
                        ? 'Maison Maïté'
                        : (proprio?.bien || []).slice().sort((a,b)=>(a.code||'').localeCompare(b.code||'')).map(b=>b.code).filter(Boolean).join(', ')
                    const vir = getVirementLie(f)
                    const ecart = vir ? f.montant_reversement - vir.debit : null
                    const ok = ecart !== null && Math.abs(ecart) <= 100 // tolérance 1€
                    const manuelLien = liensVirements[f.id]
                    const commentaire = commentairesCtrl[f.id] || ''

                    // Options : exclure les virements déjà pris par une autre facture (manuel ou auto)
                    const options = virementsSortants.filter(v =>
                      !virementsDejàLiés.has(v.id) || vir?.id === v.id
                    )

                    return (
                      <tr key={f.id}>
                        <td>
                          {bienCodes && <span style={{ fontFamily: 'monospace', color: 'var(--brand)', fontSize: 12, marginRight: 6 }}>{bienCodes}</span>}
                          <span style={{ fontWeight: 500 }}>{proprio?.nom} {proprio?.prenom || ''}</span>
                        </td>
                        <td className="right montant" style={{ fontWeight: 600 }}>{(f.montant_reversement / 100).toFixed(2)} €</td>
                        <td style={{ fontSize: 13, maxWidth: 220 }}>
                          <select
                            value={manuelLien === 'none' ? '' : (manuelLien || vir?.id || '')}
                            onChange={e => {
                              const val = e.target.value === '' ? 'none' : e.target.value
                              const newLiens = { ...liensVirements, [f.id]: val }
                              setLiensVirements(newLiens)
                              sauvegarderCtrl(newLiens, null)
                            }}
                            style={{ fontSize: 12, width: '100%', padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 4, background: 'white' }}
                          >
                            <option value="">— non lié</option>
                            {options.map(v => (
                              <option key={v.id} value={v.id}>
                                {(v.detail || v.libelle || '').substring(0, 45)} · {(v.debit / 100).toFixed(2)} € · {fmtDate(v.date_operation)}
                              </option>
                            ))}
                          </select>
                          {!manuelLien && vir && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>auto-match</div>}
                        </td>
                        <td className="right montant" style={{ color: vir ? 'var(--text)' : 'var(--text-muted)' }}>
                          {vir ? `${(vir.debit / 100).toFixed(2)} €` : '—'}
                        </td>
                        <td className="right montant" style={{ fontWeight: 600, color: ecart === null ? 'var(--text-muted)' : ok ? '#059669' : '#DC2626' }}>
                          {ecart === null ? '—' : ecart === 0 ? '✓ 0' : `${ecart > 0 ? '+' : ''}${(ecart / 100).toFixed(2)} €`}
                        </td>
                        <td>
                          {vir === null
                            ? <span style={{ padding: '3px 10px', borderRadius: 100, fontSize: 11, fontWeight: 600, background: '#FEF3C7', color: '#D97706' }}>Non trouvé</span>
                            : ok
                              ? <span style={{ padding: '3px 10px', borderRadius: 100, fontSize: 11, fontWeight: 600, background: '#D1FAE5', color: '#059669' }}>✓ OK</span>
                              : <span style={{ padding: '3px 10px', borderRadius: 100, fontSize: 11, fontWeight: 600, background: '#FEE2E2', color: '#DC2626' }}>Écart</span>
                          }
                        </td>
                        <td>
                          <input
                            type="text"
                            value={commentaire}
                            placeholder="Note…"
                            onChange={e => {
                              const newComm = { ...commentairesCtrl, [f.id]: e.target.value }
                              setCommentairesCtrl(newComm)
                              sauvegarderCtrl(null, newComm)
                            }}
                            style={{ fontSize: 12, width: '100%', padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 4, background: 'white' }}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--brand-pale)', borderTop: '2px solid var(--border)' }}>
                    <td style={{ fontWeight: 700 }}>Total</td>
                    <td className="right montant" style={{ fontWeight: 700 }}>{(totalAttendu / 100).toFixed(2)} €</td>
                    <td colSpan={2} className="right montant" style={{ fontWeight: 700 }}>
                      {(() => {
                        const totalVir = facturesAvecReversement.reduce((s, f) => s + (getVirementLie(f)?.debit || 0), 0)
                        return totalVir > 0 ? `${(totalVir / 100).toFixed(2)} €` : '—'
                      })()}
                    </td>
                    <td className="right montant" style={{ fontWeight: 700 }}>
                      {(() => {
                        const totalVir = facturesAvecReversement.reduce((s, f) => s + (getVirementLie(f)?.debit || 0), 0)
                        if (!totalVir) return '—'
                        const diff = totalAttendu - totalVir
                        return <span style={{ color: Math.abs(diff) <= 100 ? '#059669' : '#DC2626' }}>
                          {diff === 0 ? '✓ 0' : `${diff > 0 ? '+' : ''}${(diff / 100).toFixed(2)} €`}
                        </span>
                      })()}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Virements non liés */}
            {virementsNonLiés.length > 0 && (
              <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', background: '#FFFBEB' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#B45309', marginBottom: 6 }}>
                  ⚠ {virementsNonLiés.length} virement(s) sortant(s) non rapproché(s) :
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {virementsNonLiés.map(v => (
                    <div key={v.id} style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      {fmtDate(v.date_operation)} · <strong>{(v.debit / 100).toFixed(2)} €</strong> · {v.libelle}
                      {v.canal && <span style={{ marginLeft: 8, color: '#9CA3AF' }}>[{v.canal}]</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* Modal confirmation Evoliz */}
      {showConfirmEvoliz && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(44,36,22,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: 'var(--bg, #F7F3EC)',
            border: '2px solid var(--brand, #CC9933)',
            borderRadius: 16,
            padding: '32px 36px',
            maxWidth: 440,
            width: '90%',
            boxShadow: '0 8px 32px rgba(44,36,22,0.18)'
          }}>
            <h3 style={{ margin: '0 0 8px', color: 'var(--text, #2C2416)', fontSize: 18, fontWeight: 700 }}>
              Pousser vers Evoliz
            </h3>
            <p style={{ margin: '0 0 20px', color: 'var(--text-muted, #8C7B65)', lineHeight: 1.5 }}>
              Tu es sur le point d'envoyer{' '}
              <strong style={{ color: 'var(--text, #2C2416)' }}>
                {stats?.valides ?? 0} facture{(stats?.valides ?? 0) > 1 ? 's' : ''} validée{(stats?.valides ?? 0) > 1 ? 's' : ''}
              </strong>{' '}
              vers Evoliz pour le mois de <strong style={{ color: 'var(--text, #2C2416)' }}>{mois}</strong>.
              <br /><br />
              <span style={{ color: '#B45309', fontWeight: 600 }}>⚠ Cette action est irréversible</span> — les factures seront créées dans Evoliz.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowConfirmEvoliz(false)}
                disabled={pushing}
                style={{
                  padding: '10px 20px', borderRadius: 8,
                  border: '1.5px solid var(--border, #D9CEB8)',
                  background: 'white', color: 'var(--text, #2C2416)',
                  cursor: 'pointer', fontWeight: 600, fontSize: 14
                }}
              >
                Annuler
              </button>
              <button
                onClick={async () => {
                  setShowConfirmEvoliz(false)
                  await executerPousserEvoliz()
                }}
                disabled={pushing}
                style={{
                  padding: '10px 20px', borderRadius: 8,
                  border: 'none',
                  background: 'var(--brand, #CC9933)',
                  color: 'white',
                  cursor: pushing ? 'not-allowed' : 'pointer',
                  fontWeight: 700, fontSize: 14
                }}
              >
                {pushing ? 'Envoi…' : "Confirmer l'envoi"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
