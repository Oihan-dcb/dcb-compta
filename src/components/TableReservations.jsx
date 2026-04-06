import { useRef } from 'react'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { formatMontant } from '../lib/hospitable'
import { toggleOwnerStay } from '../hooks/useOwnerStay'

function BadgeStatut({ r, onToggle }) {
  // Séjour proprio
  if (r.owner_stay) return (
    <span className="badge badge-neutral"
      onClick={r.platform === 'manual' ? (e) => { e.stopPropagation(); onToggle(r) } : undefined}
      style={{ cursor: r.platform === 'manual' ? 'pointer' : 'default' }}
      title={r.platform === 'manual' ? 'Cliquer pour retirer le statut séjour proprio' : ''}>
      🏠 Séjour proprio
    </span>
  )
  // Manuel sans statut
  if (r.platform === 'manual' && !r.owner_stay && !r.ventilation_calculee) return (
    <span className="badge"
      onClick={(e) => { e.stopPropagation(); onToggle(r) }}
      style={{ background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa', borderRadius: 4, padding: '2px 6px', fontSize: '0.75em', fontWeight: 600, cursor: 'pointer' }}
      title="Cliquer pour marquer comme séjour propriétaire">
      🔧 à saisir
    </span>
  )
  // Rapprochée (priorité max — état final)
  if (r.rapprochee) return (
    <span className="badge badge-success"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      ✅ Rapprochée
    </span>
  )
  // Ventilée mais pas encore rapprochée
  const STATUTS_NON_VENTILABLES = ['cancelled', 'not_accepted', 'not accepted', 'declined', 'expired']
  if (r.ventilation_calculee && !STATUTS_NON_VENTILABLES.includes(r.final_status)) return (
    <span className="badge badge-warning"
      onClick={r.platform === 'manual' ? (e) => { e.stopPropagation(); onToggle(r) } : undefined}
      style={{ cursor: r.platform === 'manual' ? 'pointer' : 'default' }}
      title={r.platform === 'manual' ? 'Cliquer pour marquer comme séjour propriétaire' : ''}>
      Ventilée
    </span>
  )
  // Importée — pas encore traitée
  return <span className="badge badge-info">Importée</span>
}


export default function TableReservations({ reservations, onSelect, onRefresh }) {
  const toggling = useRef(false)

  async function handleToggle(r) {
    if (toggling.current) return
    toggling.current = true
    try {
      await toggleOwnerStay(r)
      if (onRefresh) onRefresh()
    } catch (e) {
      alert('Erreur : ' + e.message)
    } finally {
      toggling.current = false
    }
  }

  if (reservations.length === 0) return (
    <div className="empty-state">
      <div className="empty-state-title">Aucune réservation</div>
      <p>Lance une sync Hospitable pour ce mois.</p>
    </div>
  )

  return (
    <div className="table-container">
      <table>
        <thead>
          <tr>
            <th>Code</th><th>Plateforme</th><th>Bien</th><th>Voyageur</th>
            <th>Statut</th><th>Check-in</th><th>Nuits</th>
            <th className="right">Revenue net</th><th className="right" title="AUTO réel vs provision">AUTO</th><th className="right">Taux COM</th><th>Compta</th>
          </tr>
        </thead>
        <tbody>
          {reservations.map(r => (
            <tr key={r.id} onClick={() => onSelect(r)} style={{ cursor: 'pointer' }}>
              <td><span className="mono">{r.code}</span></td>
              <td><span className={`badge badge-${r.platform}`}>{r.platform}</span></td>
              <td title={r.bien?.hospitable_name}>
                <span className="mono">{r.bien?.code || '—'}</span>
                {r.bien?.hospitable_name && (
                  <div style={{ fontSize: '0.75em', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>
                    {r.bien.hospitable_name}
                  </div>
                )}
              </td>
              <td>{r.guest_name || '—'}</td>
              <td>
                {r.final_status === 'cancelled'
                  ? <span className="badge" style={{ background: '#fee2e2', color: '#dc2626', borderRadius: 4, padding: '2px 6px', fontSize: '0.75em', fontWeight: 600 }}>Annulée</span>
                  : r.final_status === 'accepted'
                  ? <span className="badge" style={{ background: '#dcfce7', color: '#16a34a', borderRadius: 4, padding: '2px 6px', fontSize: '0.75em', fontWeight: 600 }}>Confirmée</span>
                  : r.final_status === 'request'
                  ? <span className="badge" style={{ background: '#e0f2fe', color: '#0369a1', borderRadius: 4, padding: '2px 6px', fontSize: '0.75em', fontWeight: 600 }}>En attente</span>
                  : <span className="badge" style={{ background: '#fef9c3', color: '#ca8a04', borderRadius: 4, padding: '2px 6px', fontSize: '0.75em', fontWeight: 600 }}>{r.final_status || '—'}</span>
                }
              </td>
              <td>{r.arrival_date ? format(new Date(r.arrival_date), 'd MMM', { locale: fr }) : '—'}</td>
              <td>{r.nights}</td>
              <td className="right montant">{r.fin_revenue ? formatMontant(r.fin_revenue) : '—'}</td>
              <td className="right" style={{ padding: '0 8px' }}>
                {(() => {
                  if (!r.ventilation_calculee) return <span style={{ color: 'var(--text-muted)' }}>—</span>
                  const vAuto = (r.ventilation || []).find(v => v.code === 'AUTO')
                  if (!vAuto) return <span style={{ color: 'var(--text-muted)' }}>—</span>
                  const provision = vAuto.montant_ht
                  const reel = vAuto.montant_reel
                  if (reel == null) return <span style={{ color: 'var(--text-muted)', fontSize: '0.8em' }}>non saisi</span>
                  const ecart = reel - provision
                  if (ecart === 0) return <span title="AUTO réel = provision" style={{ color: '#888', fontSize: '0.85em' }}>✓</span>
                  const color = ecart > 0 ? '#dc2626' : '#16a34a'
                  const sign = ecart > 0 ? '+' : ''
                  const label = ecart > 0 ? '🔴' : '🟢'
                  return <span title={`Provision: ${(provision/100).toFixed(2)}€ → Réel: ${(reel/100).toFixed(2)}€ (${sign}${(ecart/100).toFixed(2)}€)`}
                    style={{ color, fontSize: '0.85em', fontWeight: 600, cursor: 'default' }}>
                    {label} {sign}{(ecart/100).toFixed(0)}€
                  </span>
                })()}
              </td>
              <td className="right">
                {r.bien?.taux_commission_override != null
                  ? <span title="Override bien" style={{ fontWeight: 600 }}>{Math.round(r.bien.taux_commission_override * 100)}%</span>
                  : r.bien?.proprietaire?.taux_commission != null
                  ? <span title="Taux proprio">{r.bien.proprietaire.taux_commission}%</span>
                  : r.ventilation_calculee ? <span title="Taux défaut">25%</span> : '—'}
              </td>
              <td><BadgeStatut r={r} onToggle={handleToggle} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
