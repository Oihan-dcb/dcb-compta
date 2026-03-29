{f.montant_reversement !== null && (
import { useState, useEffect } from 'react'
import MoisSelector from '../components/MoisSelector'
import {
  getFacturesMois, genererFacturesMois, validerFacture,
  getStatsFactures, exportCSVComptable, telechargerCSV
} from '../services/facturesEvoliz'
import { pousserFacturesMoisVersEvoliz, pingEvoliz } from '../services/evoliz'
import { formatMontant } from '../lib/hospitable'

const moisCourant = new Date().toISOString().substring(0, 7)

const STATUTS = {
  calcul_en_cours: { label: 'Calcul en cours', color: 'var(--text-muted)', bg: '#F3F4F6' },
  brouillon: { label: 'Brouillon', color: '#D97706', bg: '#FEF3C7' },
  valide: { label: 'ValidÃÂ©e', color: '#059669', bg: '#D1FAE5' },
  envoye_evoliz: { label: 'EnvoyÃÂ©e Evoliz', color: '#EA580C', bg: '#FFF7ED' },
  payee: { label: 'PayÃÂ©e', color: '#059669', bg: '#D1FAE5' },
  solde_negatif: { label: 'Solde nÃÂ©gatif', color: '#DC2626', bg: '#FEE2E2' },
}

export default function PageFactures() {
  const [mois, setMois] = useState(moisCourant)
  const [moisDispos, setMoisDispos] = useState([moisCourant])
  const [factures, setFactures] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [showConfirmEvoliz, setShowConfirmEvoliz] = useState(false)
  const [pushResult, setPushResult] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [warning, setWarning] = useState(null)

  useEffect(() => { charger() }, [mois])
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
      setSuccess(`${result.created} factures crÃÂ©ÃÂ©es, ${result.updated} mises ÃÂ  jour${result.errors > 0 ? `, ${result.errors} erreurs` : ''}`)
      if ((result.resteAPayer || 0) > 0) {
        setWarning(`â  Reversement entierement absorbe sur certaines factures. Reste total a payer : ${(result.resteAPayer / 100).toFixed(2)} â¬`)
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
      setSuccess('Facture validÃÂ©e Ã¢ÂÂ prÃÂªte pour envoi dans Evoliz')
      await charger()
    } catch (err) {
      setError(err.message)
    }
  }

  async function exporterCSV() {
    setExporting(true)
    try {
      const csv = await exportCSVComptable(mois)
      telechargerCSV(csv, `DCB_Compta_${mois}_export.csv`)
    } catch (err) {
      setError(err.message)
    } finally {
      setExporting(false)
    }
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

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Factures</h1>
          <p className="page-subtitle">
            Factures DCB Ã¢ÂÂ PropriÃÂ©taires Ã¢ÂÂ {factures.length} factures ÃÂ· {formatMontant(totalTTC)} TTC
          </p>
        </div>
)}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <MoisSelector mois={mois} setMois={setMois} moisDispos={moisDispos} />
          <button className="btn btn-secondary" onClick={charger} disabled={loading}>Ã¢ÂÂº</button>
          <button className="btn btn-secondary" onClick={exporterCSV} disabled={exporting || factures.length === 0}>
            {exporting ? <><span className="spinner" /> ExportÃ¢ÂÂ¦</> : 'Ã¢ÂÂ Export comptable'}
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setShowConfirmEvoliz(true)}
            disabled={pushing || stats?.valides === 0}
            title={stats?.valides === 0 ? 'Aucune facture validÃÂ©e ÃÂ  envoyer' : `Envoyer ${stats?.valides} facture(s) validÃÂ©e(s) vers Evoliz`}
          >
            {pushing ? <><span className="spinner" /> EvolizÃ¢ÂÂ¦</> : 'Ã¢ÂÂ Pousser vers Evoliz'}
          </button>
          <button className="btn btn-primary" onClick={generer} disabled={generating}>
            {generating ? <><span className="spinner" /> GÃÂ©nÃÂ©rationÃ¢ÂÂ¦</> : 'Ã¢ÂÂ¡ GÃÂ©nÃÂ©rer factures'}
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-label">Factures</div>
            <div className="stat-value">{stats.total}</div>
            <div className="stat-sub">propriÃÂ©taires facturÃÂ©s</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Brouillons</div>
            <div className="stat-value" style={{ color: stats.brouillons > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>
              {stats.brouillons}
            </div>
            <div className="stat-sub">ÃÂ  valider avant envoi</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">ValidÃÂ©es / EnvoyÃÂ©es</div>
            <div className="stat-value" style={{ color: 'var(--success)' }}>
              {stats.valides + stats.envoyes + stats.payes}
            </div>
            <div className="stat-sub">traitÃÂ©es</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total TTC facturÃÂ©</div>
            <div className="stat-value" style={{ fontSize: 18 }}>{formatMontant(stats.total_ttc)}</div>
            <div className="stat-sub">revenus DCB du mois</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total ÃÂ  reverser</div>
            <div className="stat-value" style={{ fontSize: 18, color: 'var(--brand)' }}>
              {formatMontant(totalReversement)}
            </div>
            <div className="stat-sub">aux propriÃÂ©taires</div>
          </div>
          {stats.soldes_negatifs > 0 && (
            <div className="stat-card">
              <div className="stat-label">Soldes nÃÂ©gatifs</div>
              <div className="stat-value" style={{ color: 'var(--danger)' }}>{stats.soldes_negatifs}</div>
              <div className="stat-sub">ÃÂ  rÃÂ©clamer au proprio</div>
            </div>
          )}
        </div>
      )}

      {/* Alertes */}
      {error && <div className="alert alert-error">Ã¢ÂÂ {error}</div>}
      {pushResult && (
        <div className={`alert ${pushResult.errors.length > 0 ? 'alert-warning' : 'alert-success'}`}>
          {pushResult.errors.length === 0
            ? `Ã¢ÂÂ ${pushResult.pushed} facture(s) envoyÃÂ©e(s) dans Evoliz`
            : `Ã¢ÂÂ  ${pushResult.pushed} envoyÃÂ©e(s), ${pushResult.errors.length} erreur(s) : ${pushResult.errors.map(e => `${e.proprio}: ${e.error}`).join(' | ')}`
          }
        </div>
      )}
      {success && <div className="alert alert-success">Ã¢ÂÂ {success}</div>}
      {stats?.brouillons > 0 && (
        <div className="alert alert-warning">
          Ã¢ÂÂ  {stats.brouillons} facture(s) en brouillon Ã¢ÂÂ ÃÂ  valider avant envoi dans Evoliz.
          Assure-toi que la ventilation et les factures AE sont correctes avant de valider.
        </div>
      )}

      {warning && (
        <div className="alert alert-warning">
          {warning}
        </div>
      )}

      {loading ? (
        <div className="loading-state"><span className="spinner" /> ChargementÃ¢ÂÂ¦</div>
      ) : factures.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">Aucune facture pour ce mois</div>
          <p>Lance la gÃÂ©nÃÂ©ration aprÃÂ¨s avoir synchronisÃÂ© les rÃÂ©servations et calculÃÂ© la ventilation.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {factures.map(f => {
            const statutInfo = f.solde_negatif ? STATUTS.solde_negatif : (STATUTS[f.statut] || STATUTS.brouillon)
            const isExpanded = expanded === f.id
            const proprio = f.proprietaire

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
                        {proprio?.nom} {proprio?.prenom || ''}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {f.numero_facture || `Brouillon Ã¢ÂÂ ${mois}`}
                        {proprio?.iban && <span> ÃÂ· IBAN : {proprio.iban.substring(0, 12)}Ã¢ÂÂ¦</span>}
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
                        <div style={{ fontSize: 11, color: 'var(--danger)', textTransform: 'uppercase' }}>ÃÂ rÃÂ©clamer</div>
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
                        Ã¢ÂÂ Valider
                      </button>
                    )}

                    <span style={{ color: 'var(--text-muted)' }}>{isExpanded ? 'Ã¢ÂÂ²' : 'Ã¢ÂÂ¼'}</span>
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
                            <th>LibellÃÂ©</th>
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
                                  {l.description?.substring(0, 80)}{l.description?.length > 80 ? 'Ã¢ÂÂ¦' : ''}
                                </td>
                                <td className="right montant">{formatMontant(l.montant_ht)}</td>
                                <td className="right montant" style={{ color: 'var(--text-muted)' }}>
                                  {l.taux_tva > 0 ? formatMontant(l.montant_tva) : 'Ã¢ÂÂ'}
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
                        <strong>Ordre de virement ÃÂ  prÃÂ©parer :</strong> {formatMontant(f.montant_reversement)} vers{' '}
                        {proprio?.iban || <span style={{ color: 'var(--warning)' }}>Ã¢ÂÂ  IBAN non renseignÃÂ©</span>}
                      </div>
                    )}
                    {f.solde_negatif && (
                      <div style={{ marginTop: 12, padding: '10px 14px', background: '#FEF2F2', borderRadius: 6, fontSize: 13 }}>
                        <strong style={{ color: 'var(--danger)' }}>Solde nÃÂ©gatif :</strong>{' '}
                        {formatMontant(f.montant_reclame)} ÃÂ  rÃÂ©clamer au propriÃÂ©taire Ã¢ÂÂ envoyer cette facture pour remboursement.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

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
                {stats?.valides ?? 0} facture{(stats?.valides ?? 0) > 1 ? 's' : ''} validÃÂ©e{(stats?.valides ?? 0) > 1 ? 's' : ''}
              </strong>{' '}
              vers Evoliz pour le mois de <strong style={{ color: 'var(--text, #2C2416)' }}>{mois}</strong>.
              <br /><br />
              <span style={{ color: '#B45309', fontWeight: 600 }}>Ã¢ÂÂ  Cette action est irrÃÂ©versible</span> Ã¢ÂÂ les factures seront crÃÂ©ÃÂ©es dans Evoliz.
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
                {pushing ? 'EnvoiÃ¢ÂÂ¦' : "Confirmer l'envoi"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
