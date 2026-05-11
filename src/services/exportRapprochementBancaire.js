/**
 * exportRapprochementBancaire(mois)
 * Export du rapprochement bancaire mensuel.
 *
 * Colonnes : version_export / date_export / mois_comptable / uuid_ligne /
 *            id_mouvement / id_reservations / code_reservations /
 *            Date opération / Libellé virement / Référence /
 *            Entrée EUR / Sortie EUR / Statut / canal_bancaire_detecte /
 *            date_operation_iso / montant_signe_eur / sens_mouvement / Bien(s) /
 *            Voyageur(s) / Plateforme / Date arrivée / Date départ / Nuits /
 *            Revenu net EUR / Nb réservations
 */
import { getMouvementsMois } from './rapprochement'

const VERSION_EXPORT = '1'

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
  const dateExport = new Date().toISOString().slice(0, 10)

  const headers = [
    'version_export',
    'date_export',
    'mois_comptable',
    'uuid_ligne',
    'id_mouvement',
    'id_reservations',
    'code_reservations',
    'Date opération',
    'Libellé virement',
    'Référence',
    'Entrée EUR',
    'Sortie EUR',
    'Statut',
    'canal_bancaire_detecte',
    'date_operation_iso',
    'montant_signe_eur',
    'sens_mouvement',
    'Bien(s)',
    'Voyageur(s)',
    'Plateforme',
    'Date arrivée',
    'Date départ',
    'Nuits',
    'Revenu net EUR',
    'Nb réservations',
  ]

  const rows = mouvements.map(m => {
    const r = m._resa
    const credit = m.credit || 0
    const debit  = m.debit  || 0
    const sens   = credit > 0 ? 'CREDIT' : 'DEBIT'
    const montantSigne = credit > 0
      ? fmtMontant(credit)
      : debit > 0 ? '-' + fmtMontant(debit) : '0.00'
    return [
      VERSION_EXPORT,
      dateExport,
      mois,
      m.id || '',
      m.id || '',
      r?.reservation_ids?.join(', ') || '',
      r?.codes?.join(', ') || '',
      fmtDate(m.date_operation),
      m.libelle || '',
      m.numero_operation || '',
      credit > 0 ? fmtMontant(credit) : '',
      debit  > 0 ? fmtMontant(debit)  : '',
      fmtStatut(m.statut_matching),
      m.canal || '',
      String(m.date_operation || '').slice(0, 10),
      montantSigne,
      sens,
      r?.bien_name || '',
      r?.guest_name || '',
      r?.platform || '',
      fmtDate(r?.arrival_date),
      fmtDate(r?.departure_date),
      r?.nights != null ? String(r.nights) : '',
      r?.fin_revenue != null ? fmtMontant(r.fin_revenue) : '',
      r?.nb_resas != null ? String(r.nb_resas) : '',
    ]
  })

  const lines = [headers, ...rows].map(row => row.map(q).join(';')).join('\n')
  return '\uFEFF' + lines
}
