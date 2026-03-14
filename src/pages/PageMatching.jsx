import { useState, useEffect } from 'react'
import { setToken, formatMontant } from '../lib/hospitable'
import { syncPayouts, lancerMatching, validerMatchManuellement, marquerNonRapprochable, getPayoutsMois, getMatchingStats } from '../services/matching'
import { getMouvementsARapprocher, getMouvementsMois } from '../services/banque'
import { getReservationsMois } from '../services/syncReservations'
import { supabase } from '../lib/supabase'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

const HOSP_TOKEN = import.meta.env.VITE_HOSPITABLE_TOKEN
const moisCourant = new Date().toISOString().substring(0, 7)

export default function PageMatching() {
  const [mois, setMois] = useState(moisCourant)
  const [stats, setStats] = useState(null)
  const [mouvementsAR, setMouvementsAR] = useState([])
  const [payouts, setPayouts] = useState([])
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [matching, setMatching] = useState(false)
  const [matchResult, setMatchResult] = useState(null)
  const [error, setError] = useState(null)
  // Pour la validation manuelle
  const [selectedMvt, setSelectedMvt] = useState(null)
  const [selectedPayouts, setSelectedPayouts] = useState([])

  useEffect(() => {
    if (HOSP_TOKEN) setToken(HOSP_TOKEN)
    charger()
  }, [mois])

  async function charger() {
    setLoading(true)
    setError(null)
    try {
      const [s, mar, p] = await Promise.all([
        getMatchingStats(mois),
        getMouvementsARapprocher(mois),
        getPayoutsMois(mois),
      ])
      setStats(s)
      setMouvementsAR(mar)
      setPayouts(p)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function lancerSyncPayouts() {
    setSyncing(true)
    setError(null)
    try {
      await syncPayouts(mois)
      await charger()
    } catch (err) {
      setError(err.message)
    } finally {
      setSyncing(false)
    }
  }

  async function lancerMatchingAuto() {
    setMatching(true)
    setMatchResult(null)
    setError(null)
    try {
      const result = await lancerMatching(mois)
      setMatchResult(result)
      await charger()
    } catch (err) {
      setError(err.message)
    } finally {
      setMatching(false)
    }
  }

  async function validerManuellement(mvtId) {
    if (selectedPayouts.length === 0) {
      setError('Sélectionne au moins un payout à associer')
      return
    }
    try {
      await validerMatchManuellement(mvtId, selectedPayouts)
      setSelectedMvt(null)
      setSelectedPayouts([])
      await charger()
    } catch (err) {
      setError(err.message)
    }
  }

  async function ignorer(mvtId) {
    try {
      await marquerNonRapprochable(mvtId)
      await charger()
    } catch (err) {
      setError(err.message)
    }
  }

  const payoutsLibres = payouts.filter(p => p.statut_matching === 'en_attente')

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Rapprochement bancaire</h1>
          <p className="page-subtitle">
            {stats ? `${stats.auto + stats.manuel}/${stats.total} matchés (${stats.taux}%)` : '—'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input type="month" className="form-input" style={{ width: 160 }} value={mois} onChange={e => setMois(e.target.value)} />
          <button className="btn btn-secondary" onClick={charger} disabled={loading}>↺</button>
          <button className="btn btn-secondary" onClick={lancerSyncPayouts} disabled={syncing}>
            {syncing ? <><span className="spinner" /> Sync payouts…</> : '⟳ Sync payouts'}
          </button>
          <button className="btn btn-primary" onClick={lancerMatchingAuto} disabled={matching || mouvementsAR.length === 0}>
            {matching ? <><span className="spinner" /> Matching…</> : '⚡ Lancer matching auto'}
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-label">Total entrées</div>
            <div className="stat-value">{stats.total}</div>
            <div className="stat-sub">virements entrants</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Matchés auto</div>
            <div className="stat-value" style={{ color: 'var(--success)' }}>{stats.auto}</div>
            <div className="stat-sub">rapprochés automatiquement</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Matchés manuel</div>
            <div className="stat-value" style={{ color: 'var(--success)' }}>{stats.manuel}</div>
            <div className="stat-sub">validés manuellement</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">En attente</div>
            <div className="stat-value" style={{ color: stats.en_attente > 0 ? 'var(--warning)' : 'var(--success)' }}>
              {stats.en_attente}
            </div>
            <div className="stat-sub">à traiter</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Taux matching</div>
            <div className="stat-value" style={{ color: stats.taux >= 80 ? 'var(--success)' : 'var(--warning)' }}>
              {stats.taux}%
            </div>
            <div className="stat-sub">objectif ≥ 80%</div>
          </div>
        </div>
      )}

      {/* Alertes */}
      {error && <div className="alert alert-error">✕ {error}</div>}
      {matchResult && (
        <div className="alert alert-success">
          ✓ Matching terminé — {matchResult.matched} matchés automatiquement, {matchResult.unmatched} en attente de validation manuelle
          {matchResult.errors > 0 && ` — ⚠ ${matchResult.errors} erreurs`}
        </div>
      )}

      {/* Virements en attente */}
      {mouvementsAR.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">
            {stats?.en_attente === 0 ? '✓ Tous les virements sont rapprochés' : 'Aucun virement à rapprocher'}
          </div>
          <p>
            {stats?.en_attente === 0
              ? 'Le rapprochement de ce mois est complet.'
              : 'Importe un relevé bancaire et sync les payouts, puis lance le matching.'}
          </p>
        </div>
      ) : (
        <>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--brand)', marginBottom: 12 }}>
            Virements à rapprocher ({mouvementsAR.length})
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {mouvementsAR.map(mvt => (
              <MvtCard
                key={mvt.id}
                mvt={mvt}
                payoutsLibres={payoutsLibres}
                selected={selectedMvt === mvt.id}
                selectedPayouts={selectedPayouts}
                onSelect={() => {
                  setSelectedMvt(selectedMvt === mvt.id ? null : mvt.id)
                  setSelectedPayouts([])
                  setError(null)
                }}
                onTogglePayout={pid => setSelectedPayouts(prev =>
                  prev.includes(pid) ? prev.filter(p => p !== pid) : [...prev, pid]
                )}
                onValider={() => validerManuellement(mvt.id)}
                onIgnorer={() => ignorer(mvt.id)}
              />
            ))}
          </div>
        </>
      )}

      {/* Payouts libres */}
      {payoutsLibres.length > 0 && (
        <>
          <div style={{ height: 24 }} />
          <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--brand)', marginBottom: 12 }}>
            Payouts Hospitable non associés ({payoutsLibres.length})
          </h2>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Plateforme</th>
                  <th>Date</th>
                  <th className="right">Montant</th>
                  <th>Référence</th>
                  <th>IBAN</th>
                </tr>
              </thead>
              <tbody>
                {payoutsLibres.map(p => (
                  <tr key={p.id}>
                    <td><span className={`badge badge-${p.platform}`}>{p.platform}</span></td>
                    <td>{p.date_payout ? format(new Date(p.date_payout), 'd MMM', { locale: fr }) : '—'}</td>
                    <td className="right montant">{formatMontant(p.amount)}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{p.reference || '—'}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                      {p.bank_account?.substring(0, 30) || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function MvtCard({ mvt, payoutsLibres, selected, selectedPayouts, onSelect, onTogglePayout, onValider, onIgnorer }) {
  const canalColors = {
    airbnb: '#FFE8E0', booking: '#E0EEFF', stripe: '#D1FAE5',
    sepa_manuel: '#FEF3C7', interne: '#F3F4F6',
  }
  const bg = canalColors[mvt.canal] || '#F9FAFB'

  return (
    <div style={{
      background: selected ? '#EFF6FF' : 'var(--white)',
      border: `1px solid ${selected ? '#3B82F6' : 'var(--border)'}`,
      borderRadius: 'var(--radius)',
      padding: '12px 16px',
      cursor: 'pointer',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        onClick={onSelect}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span className={`badge badge-${mvt.canal}`}>{mvt.canal}</span>
          <div>
            <div style={{ fontWeight: 500 }}>{mvt.libelle}</div>
            {mvt.detail && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{mvt.detail}</div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--success)' }}>
            {formatMontant(mvt.credit)}
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {mvt.date_operation ? format(new Date(mvt.date_operation), 'd MMM', { locale: fr }) : '—'}
          </span>
          <span style={{ color: 'var(--text-muted)' }}>{selected ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Panel de validation manuelle */}
      {selected && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 500, color: 'var(--brand)' }}>
            Sélectionne le(s) payout(s) correspondant à ce virement :
          </div>
          {payoutsLibres.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              Aucun payout disponible — sync les payouts Hospitable d'abord.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
              {payoutsLibres.map(p => {
                const checked = selectedPayouts.includes(p.id)
                const sumSelected = payoutsLibres
                  .filter(x => selectedPayouts.includes(x.id))
                  .reduce((s, x) => s + x.amount, 0)
                const ecart = checked ? null : Math.abs(sumSelected + p.amount - mvt.credit)

                return (
                  <label key={p.id} style={{
                    display: 'flex', gap: 10, alignItems: 'center',
                    padding: '6px 10px', borderRadius: 6,
                    background: checked ? '#EFF6FF' : '#F9FAFB',
                    border: `1px solid ${checked ? '#3B82F6' : 'var(--border)'}`,
                    cursor: 'pointer', fontSize: 13,
                  }}>
                    <input type="checkbox" checked={checked} onChange={() => onTogglePayout(p.id)} />
                    <span className={`badge badge-${p.platform}`}>{p.platform}</span>
                    <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {p.date_payout?.substring(0, 10)}
                    </span>
                    <span style={{ fontWeight: 600, color: 'var(--success)' }}>
                      {formatMontant(p.amount)}
                    </span>
                    {p.reference && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>ref: {p.reference}</span>
                    )}
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
                      {p.bank_account?.substring(0, 25)}
                    </span>
                  </label>
                )
              })}
            </div>
          )}

          {/* Résumé sélection */}
          {selectedPayouts.length > 0 && (
            <div style={{ marginTop: 10, padding: '8px 12px', background: '#F0FDF4', borderRadius: 6, fontSize: 13 }}>
              {(() => {
                const sumSel = payoutsLibres
                  .filter(p => selectedPayouts.includes(p.id))
                  .reduce((s, p) => s + p.amount, 0)
                const ecart = Math.abs(sumSel - mvt.credit)
                return (
                  <span>
                    Sélection : <strong>{formatMontant(sumSel)}</strong> pour un virement de <strong>{formatMontant(mvt.credit)}</strong>
                    {ecart <= 2
                      ? <span style={{ color: 'var(--success)', marginLeft: 8 }}>✓ Correspond</span>
                      : <span style={{ color: 'var(--warning)', marginLeft: 8 }}>⚠ Écart {formatMontant(ecart)}</span>}
                  </span>
                )
              })()}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={onValider}
              disabled={selectedPayouts.length === 0}
            >
              ✓ Valider match
            </button>
            <button className="btn btn-secondary btn-sm" onClick={onIgnorer}>
              Marquer non-rapprochable
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
