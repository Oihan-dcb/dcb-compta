/**
 * Service de synchronisation des réservations Hospitable → Supabase
 * Délègue toute la logique à api/sync-reservations.js (serveur)
 * pour éviter la duplication et garder le token Hospitable côté serveur.
 */
import { supabase } from '../lib/supabase'
import { AGENCE } from '../lib/agence'

export async function syncReservations(mois) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Session expirée')

  const res = await fetch('/api/sync-reservations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + session.access_token,
    },
    body: JSON.stringify({ mois, agence: AGENCE }),
  })

  const log = await res.json()
  if (!res.ok) throw new Error(log?.error || `Erreur serveur ${res.status}`)
  return log
}

/**
 * Récupère les réservations d'un mois depuis Supabase (avec fees et bien)
 */
export async function getReservationsMois(mois) {
  const { data, error } = await supabase
    .from('reservation')
    .select(`
      id, code, platform, arrival_date, departure_date, nights, guest_name,
      fin_revenue, fin_accommodation, owner_stay, ventilation_calculee, rapprochee,
      final_status, mois_comptable,
      bien (
        id, hospitable_name, code, proprietaire_id, agence,
        provision_ae_ref, forfait_dcb_ref, has_ae,
        taux_commission_override,
        proprietaire!proprietaire_id (id, nom, prenom, taux_commission)
      ),
      reservation_fee (*),
      ventilation (code, taux_calcule, montant_ht, montant_tva, montant_ttc, libelle),
      hospitable_raw
    `)
    .eq('mois_comptable', mois)
    .order('arrival_date')

  if (error) throw error
  return (data || []).filter(r => (r.bien?.agence || AGENCE) === AGENCE)
}
