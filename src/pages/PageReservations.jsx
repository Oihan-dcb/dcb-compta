import { useState, useEffect } from 'react'
import { syncReservations, getReservationsMois } from '../services/syncReservations'
import { calculerVentilationMois, getRecapVentilation } from '../services/ventilation'
import { setToken, formatMontant } from '../lib/hospitable'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

const HOSP_TOKEN = import.meta.env.VITE_HOSPITABLE_TOKEN

// Mois courant par défaut
const moisCourant = new Date().toISOString().substring(0, 7)

export default function PageReservations() {
  const [mois, setMois] = useState(moisCourant)
  const [reservations, setReservations] = useState([])
  const [recap, setRecap] = useState([])
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [calculant, setCalculant] = useState(false)
  const [syncResult, setSyncResult] = useState(null)
  const [error, setError] = useState(null)
  const [onglet, setOnglet] = useState('reservations') // reservations | ventilation

  useEffect(() => {
    if (HOSP_TOKEN) setToken(HOSP_TOKEN)
    charger()
  }, [mois])

  async function charger() {
    setLoading(true)
    setError(null)
    try {
      const [resas, recapData] = await Promise.all([
        getReservationsMois(mois),
        getRecapVentilation(mois),
      ])
      setReservations(resas)
      setRecap(recapData)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function lancerSync() {
    setSyncing(true)
    setSyncResult(null)
    setError(null)
    try {
      const result = await syncReservations(mois)
      setSyncResult(result)
      await charger()
    } catch (err) {
      setError(err.message)
    } finally {
      setSyncing(false)
    }
  }

  async function lancerVentilation() {
    setCalculant(true)
    setError(null)
    try {
      await calculerVentilationMois(mois)
      await charger()
    } catch (err) {
      setError(err.message)
    } finally {
      setCalculant(false)
    }
  }

  const nbVentilees = reservations.filter(r => r.ventilation_calculee).length
  const nbRapprochees = reservations.filter(r => r.rapprochee).length
  const totalRevenue = reservations.reduce((s, r) => s + (r.fin_revenue || 0), 0)
  const nbDirectes = reservations.filter(r => r.platform === 'direct' || r.platform === 'manual').length

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Réservations</h1>
          <p className="page-subtitle">{reservations.length} réservations · {formatMontant(totalRevenue)} encaissé</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            type="month"
            className="form-input"
            style={{ width: 160 }}
            value={mois}
            onChange={e => setMois(e.target.value)}
          />
          <button className="btn btn-secondary" onClick={charger} disabled={loading}>↺</button>
          <button className="btn btn-secondary" onClick={lancerSync} disabled={syncing}>
            {syncing ? <><span className="spinner" /> Sync…</> : '⟳ Sync Hospitable'}
          </button>
          <button
            className="btn btn-primary"
            onClick={lancerVentilation}
            disabled={calculant || reservations.length === 0}
          >
            {calculant ? <><span className="spinner" /> Calcul…</> : '⚡ Ventiler'}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-label">Réservations</div>
          <div className="stat-value">{reservations.length}</div>
          <div className="stat-sub">{nbDirectes} directes/manuelles</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Revenue total</div>
          <div className="stat-value" style={{ fontSize: 20 }}>{formatMontant(totalRevenue)}</div>
          <div className="stat-sub">net reçu en banque</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Ventilées</div>
          <div className="stat-value" style={{ color: nbVentilees === reservations.length && reservations.length > 0 ? 'var(--success)' : 'var(--warning)' }}>
            {nbVentilees}/{reservations.length}
          </div>
          <div className="stat-sub">calcul effectué</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Rapprochées</div>
          <div className="stat-value">{nbRapprochees}/{reservations.length}</div>
          <div className="stat-sub">virement identifié</div>
        </div>
      </div>

      {/* Alertes */}
      {syncResult && (
        <div className="alert alert-success">
          ✓ Sync {mois} — {syncResult.created} créées, {syncResult.updated} mises à jour
          {syncResult.errors > 0 && ` — ⚠ ${syncResult.errors} erreurs`}
        </div>
      )}
      {error && <div className="alert alert-error">✕ {error}</div>}

      {/* Onglets */}
      <div className="toolbar">
        <button
          className={`btn ${onglet === 'reservations' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setOnglet('reservations')}
        >
          Réservations ({reservations.length})
        </button>
        <button
          className={`btn ${onglet === 'ventilation' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setOnglet('ventilation')}
        >
          Ventilation ({recap.length} codes)
        </button>
      </div>

      {loading ? (
        <div className="loading-state"><span className="spinner" /> Chargement…</div>
      ) : onglet === 'reservations' ? (
        <TableReservations reservations={reservations} />
      ) : (
        <TableVentilation recap={recap} mois={mois} />
      )}
    </div>
  )
}

function TableReservations({ reservations }) {
  if (reservations.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">Aucune réservation</div>
        <p>Lance une sync Hospitable pour ce mois.</p>
      </div>
    )
  }

  return (
    <div className="table-container">
      <table>
        <thead>
          <tr>
            <th>Code</th>
            <th>Plateforme</th>
            <th>Bien</th>
            <th>Voyageur</th>
            <th>Check-in</th>
            <th>Nuits</th>
            <th className="right">Revenue net</th>
            <th>Statut</th>
          </tr>
        </thead>
        <tbody>
          {reservations.map(r => (
            <tr key={r.id}>
              <td><span className="mono">{r.code}</span></td>
              <td>
                <span className={`badge badge-${r.platform}`}>{r.platform}</span>
              </td>
              <td>{r.bien?.code || r.bien?.hospitable_name?.substring(0, 15) || '—'}</td>
              <td>{r.guest_name || '—'}</td>
              <td>{r.arrival_date ? format(new Date(r.arrival_date), 'd MMM', { locale: fr }) : '—'}</td>
              <td>{r.nights}</td>
              <td className="right montant">
                {r.fin_revenue ? formatMontant(r.fin_revenue) : '—'}
              </td>
              <td>
                {r.owner_stay ? (
                  <span className="badge badge-neutral">Séjour proprio</span>
                ) : r.rapprochee ? (
                  <span className="badge badge-success">✓ Rapprochée</span>
                ) : r.ventilation_calculee ? (
                  <span className="badge badge-warning">Ventilée</span>
                ) : (
                  <span className="badge badge-info">Importée</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TableVentilation({ recap, mois }) {
  if (recap.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">Aucune ventilation calculée</div>
        <p>Clique sur "Ventiler" pour calculer la ventilation du mois.</p>
      </div>
    )
  }

  const totalHT = recap.reduce((s, r) => s + r.ht, 0)
  const totalTVA = recap.reduce((s, r) => s + r.tva, 0)
  const totalTTC = recap.reduce((s, r) => s + r.ttc, 0)

  const codeOrder = ['COM', 'MEN', 'MGT', 'AE', 'LOY', 'DIV', 'TAX']
  const sorted = [...recap].sort((a, b) =>
    codeOrder.indexOf(a.code) - codeOrder.indexOf(b.code)
  )

  return (
    <div className="table-container">
      <table>
        <thead>
          <tr>
            <th>Code</th>
            <th>Libellé</th>
            <th className="right">Lignes</th>
            <th className="right">Montant HT</th>
            <th className="right">TVA</th>
            <th className="right">TTC</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => (
            <tr key={r.code}>
              <td><span className={`code-${r.code}`}>{r.code}</span></td>
              <td>{r.libelle}</td>
              <td className="right">{r.nb}</td>
              <td className="right montant">{formatMontant(r.ht)}</td>
              <td className="right montant" style={{ color: 'var(--text-muted)' }}>
                {r.tva > 0 ? formatMontant(r.tva) : '—'}
              </td>
              <td className="right montant">{formatMontant(r.ttc)}</td>
            </tr>
          ))}
          <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--brand-pale)' }}>
            <td colSpan={3} style={{ fontWeight: 600 }}>Total</td>
            <td className="right montant" style={{ fontWeight: 700 }}>{formatMontant(totalHT)}</td>
            <td className="right montant" style={{ fontWeight: 700, color: 'var(--text-muted)' }}>{formatMontant(totalTVA)}</td>
            <td className="right montant" style={{ fontWeight: 700 }}>{formatMontant(totalTTC)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
