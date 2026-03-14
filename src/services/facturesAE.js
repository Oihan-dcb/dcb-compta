/**
 * Service de gestion des factures auto-entrepreneurs
 *
 * Logique :
 * - Chaque bien avec has_ae=true a une provision_ae_ref théorique
 * - En fin de mois, l'AE envoie sa facture : une par bien par mois
 * - Si facture uploadée → montant_reel utilisé pour la ventilation
 * - Si pas de facture → montant_theorique = provision_ae_ref du bien
 * - La facture AE n'est PAS bloquante pour générer la facture Evoliz
 */

import { supabase } from '../lib/supabase'

/**
 * Initialise les enregistrements facture_ae pour un mois
 * Crée une ligne par bien avec AE qui n'en a pas encore
 *
 * @param {string} mois - YYYY-MM
 */
export async function initialiserFacturesAE(mois) {
  // Récupérer tous les biens avec AE
  const { data: biens, error: biensErr } = await supabase
    .from('bien')
    .select('id, hospitable_name, code, provision_ae_ref, proprietaire_id')
    .eq('listed', true)
    .eq('has_ae', true)

  if (biensErr) throw biensErr
  if (!biens || biens.length === 0) return { created: 0 }

  // Récupérer les factures AE déjà existantes pour ce mois
  const { data: existing } = await supabase
    .from('facture_ae')
    .select('bien_id')
    .eq('mois', mois)

  const existingBienIds = new Set((existing || []).map(f => f.bien_id))

  // Créer les manquantes avec les valeurs théoriques
  const toCreate = biens
    .filter(b => !existingBienIds.has(b.id))
    .map(b => ({
      bien_id: b.id,
      ae_nom: '',           // À renseigner via l'interface
      mois,
      montant_theorique: b.provision_ae_ref || 0,
      montant_reel: null,   // null = utiliser montant_theorique
      statut: 'theorique',
    }))

  if (toCreate.length > 0) {
    const { error } = await supabase.from('facture_ae').insert(toCreate)
    if (error) throw error
  }

  return { created: toCreate.length, existing: existingBienIds.size }
}

/**
 * Récupère toutes les factures AE d'un mois avec les infos du bien
 */
export async function getFacturesAE(mois) {
  const { data, error } = await supabase
    .from('facture_ae')
    .select(`
      *,
      bien (
        id, hospitable_name, code, provision_ae_ref,
        proprietaire (id, nom, prenom)
      )
    `)
    .eq('mois', mois)
    .order('bien_id')

  if (error) throw error
  return data || []
}

/**
 * Met à jour une facture AE avec le montant réel saisi
 *
 * @param {string} factureId - UUID de la facture
 * @param {Object} update - { ae_nom, ae_initiales, reference, montant_reel, pdf_url, note }
 */
export async function updateFactureAE(factureId, update) {
  // Récupérer la facture pour calculer l'écart
  const { data: facture } = await supabase
    .from('facture_ae')
    .select('montant_theorique')
    .eq('id', factureId)
    .single()

  const montantReel = update.montant_reel ?? null
  const montantTheo = facture?.montant_theorique ?? 0

  // Calculer l'écart et l'alerte
  const ecart = montantReel !== null ? montantReel - montantTheo : null
  const alerteEcart = ecart !== null && montantTheo > 0
    ? Math.abs(ecart / montantTheo) > 0.20
    : false

  // Déterminer le statut
  let statut = 'theorique'
  if (update.montant_reel !== undefined && update.montant_reel !== null) {
    statut = update.note?.includes('validé') ? 'valide' : 'saisi'
  }

  const { error } = await supabase
    .from('facture_ae')
    .update({
      ae_nom: update.ae_nom ?? undefined,
      ae_initiales: update.ae_initiales ?? undefined,
      reference: update.reference ?? undefined,
      montant_reel: montantReel,
      ecart,
      alerte_ecart: alerteEcart,
      statut,
      note: update.note ?? undefined,
      pdf_url: update.pdf_url ?? undefined,
    })
    .eq('id', factureId)

  if (error) throw error

  // Recalculer la ventilation des réservations liées si le montant a changé
  if (montantReel !== null) {
    await recalculerVentilationAE(factureId, montantReel)
  }

  return { ecart, alerteEcart, statut }
}

/**
 * Recalcule les lignes AE et MEN des réservations d'un bien pour un mois
 * quand le montant réel AE change
 */
async function recalculerVentilationAE(factureId, montantReel) {
  // Récupérer la facture avec le bien
  const { data: facture } = await supabase
    .from('facture_ae')
    .select('bien_id, mois')
    .eq('id', factureId)
    .single()

  if (!facture) return

  // Récupérer les réservations du bien pour ce mois
  const { data: reservations } = await supabase
    .from('reservation')
    .select('id, fin_revenue')
    .eq('bien_id', facture.bien_id)
    .eq('mois_comptable', facture.mois)
    .eq('owner_stay', false)
    .gt('fin_revenue', 0)

  if (!reservations || reservations.length === 0) return

  // Répartir le montant AE proportionnellement au revenue de chaque réservation
  const totalRevenue = reservations.reduce((s, r) => s + (r.fin_revenue || 0), 0)
  if (totalRevenue === 0) return

  const TVA = 0.20
  const updates = []

  for (const resa of reservations) {
    const partAE = totalRevenue > 0
      ? Math.round(montantReel * (resa.fin_revenue / totalRevenue))
      : 0

    // Récupérer la ligne AE existante
    const { data: ligneAE } = await supabase
      .from('ventilation')
      .select('id, montant_ht')
      .eq('reservation_id', resa.id)
      .eq('code', 'AE')
      .single()

    if (ligneAE) {
      const ancienAE = ligneAE.montant_ht
      // Mettre à jour AE
      await supabase.from('ventilation')
        .update({ montant_ht: partAE, montant_ttc: partAE })
        .eq('id', ligneAE.id)

      // Ajuster MEN en conséquence (MEN = provision totale ménage - AE)
      const { data: ligneMEN } = await supabase
        .from('ventilation')
        .select('id, montant_ht')
        .eq('reservation_id', resa.id)
        .eq('code', 'MEN')
        .single()

      if (ligneMEN) {
        const ajustement = ancienAE - partAE // Si AE baisse, MEN monte
        const nouvMEN = Math.max(0, ligneMEN.montant_ht + ajustement)
        const nouvTVA = Math.round(nouvMEN * TVA)
        await supabase.from('ventilation')
          .update({ montant_ht: nouvMEN, montant_tva: nouvTVA, montant_ttc: nouvMEN + nouvTVA })
          .eq('id', ligneMEN.id)
      }
    }
  }
}

/**
 * Valide une facture AE
 */
export async function validerFactureAE(factureId) {
  const { error } = await supabase
    .from('facture_ae')
    .update({ statut: 'valide' })
    .eq('id', factureId)

  if (error) throw error
}

/**
 * Retourne le montant effectif d'une facture AE (réel si saisi, théorique sinon)
 */
export function getMontantEffectifAE(facture) {
  return facture.montant_reel ?? facture.montant_theorique ?? 0
}

/**
 * Stats factures AE d'un mois
 */
export async function getStatsFacturesAE(mois) {
  const { data: factures } = await supabase
    .from('facture_ae')
    .select('statut, montant_theorique, montant_reel, alerte_ecart')
    .eq('mois', mois)

  const all = factures || []
  return {
    total: all.length,
    theoriques: all.filter(f => f.statut === 'theorique').length,
    saisis: all.filter(f => f.statut === 'saisi').length,
    valides: all.filter(f => f.statut === 'valide').length,
    alertes: all.filter(f => f.alerte_ecart).length,
    total_theorique: all.reduce((s, f) => s + (f.montant_theorique || 0), 0),
    total_reel: all.reduce((s, f) => s + (f.montant_reel ?? f.montant_theorique ?? 0), 0),
  }
}
