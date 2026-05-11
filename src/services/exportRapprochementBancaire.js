/**
 * exportRapprochementBancaire(mois)
 * Export simplifié des PAYINs séquestre.
 *
 * Colonnes : Canal / Bien / Date PAYIN / Date CI / Client / ID Réservation /
 *            Montant reçu (€) / Montant attendu (€) / Statut
 */
import { getMouvementsMois } from './rapprochement'

function q(v) {
  if (v == null || v === '') return '""'
  return '"' + String(v).replace(/"/g, '""') + '"'
}

function fmtDate(d) {
  if (!d) return ''
  const s = String(d).slice(0, 10)
  const [y, m, day] = s.split('-')
  return day ? `${day}/${m}/${y}` : s
}

function fmtMontant(cents) {
  if (cents == null || cents === '') return ''
  return (Number(cents) / 100).toFixed(2)
}

function fmtCanal(canal) {
  if (!canal) return ''
  const c = canal.toLowerCase()
  if (c === 'airbnb')  return 'Airbnb'
  if (c === 'booking') return 'Booking'
  if (c === 'stripe')  return 'Stripe'
  if (c === 'direct')  return 'Direct'
  return canal
}

function fmtStatut(statut) {
  if (!statut) return ''
  if (statut === 'rapproche')    return 'Rapproché'
  if (statut === 'en_attente')   return 'En attente'
  if (statut === 'partiel')      return 'Partiel'
  if (statut === 'non_gere')     return 'Non géré'
  if (statut === 'non_identifie') return 'Non identifié'
  return statut
}

export async function exportRapprochementBancaire(mois) {
  const mouvements = await getMouvementsMois(mois)

  const headers = [
    'Canal',
    'Bien',
    'Date PAYIN',
    'Date CI',
    'Client',
    'ID Réservation',
    'Montant reçu (€)',
    'Montant attendu (€)',
    'Statut',
  ]

  const rows = mouvements
    .filter(m => (m.credit || 0) > 0)
    .map(m => {
      const r = m._resa
      return [
        fmtCanal(m.canal),
        r?.bien_name   || '',
        fmtDate(m.date_operation),
        fmtDate(r?.arrival_date),
        r?.guest_name  || '',
        r?.codes?.join(', ') || '',
        fmtMontant(m.credit),
        r?.fin_revenue != null ? fmtMontant(r.fin_revenue) : '',
        fmtStatut(m.statut_matching),
      ]
    })

  const lines = [headers, ...rows].map(row => row.map(q).join(';')).join('\n')
  return '\uFEFF' + lines
}
