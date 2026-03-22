import { useState, useEffect } from 'react'
import { setToken, formatMontant } from '../lib/hospitable'
import { syncPayouts, lancerMatching, marquerNonRapprochable, getPayoutsMois, getMatchingStats, validerMatchManuelResas } from '../services/matching'
import { getMouvementsARapprocher } from '../services/banque'
import { supabase } from '../lib/supabase'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import MoisSelector from '../components/MoisSelector'

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
  const [reservations, setReservations] = useState([])
  const [moisDispos, setMoisDispos] = useState([moisCourant])

  useEffect(() => {
    if (HOSP_TOKEN) setToken(HOSP_TOKEN)
    charger()
    const channel = supabase.channel('matching-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mouvement_bancaire' }, () => charger())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservation' }, () => charger())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
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
      // Charger les resas non rapprochées avec airbnb_account du bien
      const { data: resas } = await supabase
        .from('reservation')
        .select('id, code, platform, fin_revenue, arrival_date, guest_name, bien(code, airbnb_account)')
        .eq('mois_comptable', mois)
        .eq('rapprochee', false)
        .eq('owner_stay', false)
      setReservations((resas || []).map(r => ({
        ...r,
        airbnb_account: r.bien?.airbnb_account || null,
        bien_code: r.bien?.code || null,
      })))
      // Mois dispos pour le sélecteur
      const { data: moisData } = await supabase
        .from('mouvement_bancaire')
        .select('mois_releve')
      if (moisData) {
        const uniq = [...new Set(moisData.map(m => m.mois_releve))].sort((a,b) => b.localeCompare(a))
        if (uniq.length) setMoisDispos([...new Set([...uniq, moisCourant])])
      }
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
      setError('Sélectionne au moins une réservation à associer')
      return
    }
    try {
      await validerMatchManuelResas(mvtId, selectedPayouts)
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
          <MoisSelector mois={mois} setMois={setMois} moisDispos={moisDispos} />
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
                reservations={reservations}
                selected={selectedMvt === mvt.id}
                selectedResas={selectedPayouts}
                onSelect={() => {
                  setSelectedMvt(selectedMvt === mvt.id ? null : mvt.id)
                  setSelectedPayouts([])
                  setError(null)
                }}
                onToggleResa={rid => setSelectedPayouts(prev =>
                  prev.includes(rid) ? prev.filter(r => r !== rid) : [...prev, rid]
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

// Mapping canal → plateforme de réservation
const CANAL_PLATFORM = {
  airbnb: ['airbnb'],
  booking: ['booking'],
  stripe: ['direct', 'manual'],
  sepa_manuel: ['direct', 'manual', 'airbnb', 'booking'],
  interne: [],
}

function MvtCard({ mvt, reservations, selected, selectedResas, onSelect, onToggleResa, onValider, onIgnorer }) {
  const canalColors = {
    airbnb: '#FFE8E0', booking: '#E0EEFF', stripe: '#D1FAE5',
    sepa_manuel: '#FEF3C7', interne: '#F3F4F6',
  }
  const bg = canalColors[mvt.canal] || '#F9FAFB'

  // Filtrer les resas pertinentes selon le canal du virement
  const platformsFiltrees = CANAL_PLATFORM[mvt.canal] || []
  const resasFiltrees = platformsFiltrees.length === 0 ? [] :
    reservations.filter(r => platformsFiltrees.includes(r.platform))

  // Pour Airbnb : grouper par airbnb_account pour aider au rapprochement groupé
  const groupesAirbnb = {}
  if (mvt.canal === 'airbnb') {
    for (const r of resasFiltrees) {
      const g = r.airbnb_account || '— sans groupe'
      if (!groupesAirbnb[g]) groupesAirbnb[g] = []
      groupesAirbnb[g].push(r)
    }
  }

  return (
    <div style={{
      background: selected ? '#FFF8EC' : 'var(--white)',
      border: `1px solid ${selected ? '#CC9933' : 'var(--border)'}`,
      borderRadius: 'var(--radius)',
      padding: '12px 16px',
      cursor: 'pointer',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        onClick={onSelect}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span className={`badge badge-${mvt.canal}`}>{mvt.canal}</span>
          <span style={{ fontWeight: 600, fontSize: 15 }}>{formatMontant(mvt.credit)}</span>
          <span style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {mvt.libelle}
          </span>
          {mvt.detail && mvt.detail !== mvt.libelle && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
              {mvt.detail.substring(0, 40)}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
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
            Associe ce virement à une ou plusieurs réservations :
          </div>

          {resasFiltrees.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              Aucune réservation disponible pour ce canal ({mvt.canal}).
            </p>
          ) : mvt.canal === 'airbnb' ? (
            /* Airbnb : afficher par groupe pour faciliter l'identification */
            Object.entries(groupesAirbnb).sort(([a],[b]) => a.localeCompare(b)).map(([groupe, resas]) => (
              <div key={groupe} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--brand)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ background: 'var(--brand-pale)', padding: '1px 8px', borderRadius: 10 }}>{groupe}</span>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                    — somme sélectionnée : {formatMontant(resas.filter(r => selectedResas.includes(r.id)).reduce((s,r) => s+(r.fin_revenue||0), 0))}
                  </span>
                </div>
                {resas.map(r => <ResaRow key={r.id} r={r} checked={selectedResas.includes(r.id)} onToggle={() => onToggleResa(r.id)} mvtMontant={mvt.credit} />)}
              </div>
            ))
          ) : (
            /* Autres canaux : liste simple */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
              {resasFiltrees.map(r => <ResaRow key={r.id} r={r} checked={selectedResas.includes(r.id)} onToggle={() => onToggleResa(r.id)} mvtMontant={mvt.credit} />)}
            </div>
          )}

          {/* Résumé sélection */}
          {selectedResas.length > 0 && (
            <div style={{ marginTop: 10, padding: '8px 12px', background: '#F0FDF4', borderRadius: 6, fontSize: 13 }}>
              {(() => {
                const sumSel = reservations.filter(r => selectedResas.includes(r.id)).reduce((s,r) => s+(r.fin_revenue||0), 0)
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
            <button className="btn btn-primary btn-sm" onClick={onValider} disabled={selectedResas.length === 0}>
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

function ResaRow({ r, checked, onToggle, mvtMontant }) {
  const ecart = Math.abs((r.fin_revenue||0) - mvtMontant)
  const estProche = ecart <= 2
  return (
    <label style={{
      display: 'flex', gap: 10, alignItems: 'center',
      padding: '6px 10px', borderRadius: 6, marginBottom: 4,
      background: checked ? '#FFF8EC' : '#F9FAFB',
      border: `1px solid ${checked ? '#CC9933' : 'var(--border)'}`,
      cursor: 'pointer', fontSize: 13,
    }}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>{r.code}</span>
      {r.bien_code && <span style={{ fontSize: 11, background: '#F3F4F6', padding: '1px 6px', borderRadius: 8 }}>{r.bien_code}</span>}
      {r.airbnb_account && <span style={{ fontSize: 11, color: 'var(--brand)', background: 'var(--brand-pale)', padding: '1px 6px', borderRadius: 8 }}>{r.airbnb_account}</span>}
      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
        {r.arrival_date ? format(new Date(r.arrival_date), 'd MMM', { locale: fr }) : '—'}
      </span>
      <span style={{ marginLeft: 'auto', fontWeight: 600, color: estProche ? 'var(--success)' : 'inherit' }}>
        {formatMontant(r.fin_revenue || 0)}
      </span>
      {r.guest_name && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.guest_name}</span>}
    </label>
  )
}
