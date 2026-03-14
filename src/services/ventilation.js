/**
 * Service de calcul de ventilation comptable
 * Transforme les financials Hospitable en lignes comptables DCB
 *
 * Codes ventilation :
 * COM  — Commission DCB (% accommodation) — TVA 20%
 * MEN  — Forfait ménage DCB (guest_fees - provision AE) — TVA 20%
 * MGT  — Management fee résa directe — TVA 20%
 * AE   — Débours auto-entrepreneur — Hors TVA
 * LOY  — Reversement propriétaire — Hors TVA
 * DIV  — Frais divers DCB (expenses [DCB]) — TVA 20%
 * TAX  — Taxe de séjour (pass-through) — Hors TVA, tracé uniquement
 */

import { supabase } from '../lib/supabase'

const TVA_RATE = 0.20

/**
 * Calcule et sauvegarde la ventilation pour toutes les réservations
 * d'un mois donné qui ne sont pas encore ventilées
 *
 * @param {string} mois - YYYY-MM
 */
export async function calculerVentilationMois(mois) {
  // Récupérer les réservations non ventilées du mois
  const { data: reservations, error } = await supabase
    .from('reservation')
    .select(`
      *,
      bien (
        id, proprietaire_id,
        provision_ae_ref, forfait_dcb_ref, has_ae,
        proprietaire (id, taux_commission)
      ),
      reservation_fee (*)
    `)
    .eq('mois_comptable', mois)
    .eq('ventilation_calculee', false)
    .eq('owner_stay', false)       // Ignorer séjours proprio
    .neq('reservation_status', 'cancelled')

  if (error) throw error

  let total = 0
  let errors = 0

  for (const resa of (reservations || [])) {
    try {
      await calculerVentilationResa(resa)
      total++
    } catch (err) {
      console.error(`Erreur ventilation résa ${resa.code}:`, err)
      errors++
    }
  }

  return { total, errors }
}

/**
 * Calcule la ventilation d'une réservation individuelle
 */
export async function calculerVentilationResa(resa) {
  const bien = resa.bien
  const fees = resa.reservation_fee || []

  if (!bien) throw new Error(`Bien manquant pour résa ${resa.code}`)

  // Revenue = montant net reçu en banque (en centimes)
  const revenue = resa.fin_revenue || 0
  if (revenue === 0) return // Réservation à €0, rien à ventiler

  // --- Extraire les fees ---

  // Guest fees = Cleaning Fee + Community Fee (= forfait ménage total facturé au voyageur)
  const guestFees = fees.filter(f => f.fee_type === 'guest_fee')
  const cleaningFee = guestFees.find(f => f.label?.toLowerCase().includes('cleaning'))
  const communityFee = guestFees.find(f => f.label?.toLowerCase().includes('community'))
  const managementFee = guestFees.find(f => f.label?.toLowerCase().includes('management'))

  const totalMenageProvision = (cleaningFee?.amount || 0) + (communityFee?.amount || 0)
  const mgmtFeeAmount = managementFee?.amount || 0

  // Taxes pass-through
  const taxes = fees.filter(f => f.fee_type === 'tax')
  const taxesTotal = taxes.reduce((s, t) => s + (t.amount || 0), 0)

  // Accommodation de base (sans fees ni taxes)
  const accommodation = resa.fin_accommodation || 0

  // --- Calculer COM (commission DCB) ---
  // = accommodation × taux_commission du proprio
  // Note : le taux est dans l'agreement Hospitable, stocké sur le bien via le proprio
  // TODO: récupérer le taux depuis bien.proprietaire.taux_commission
  // Pour l'instant on calcule COM = revenue - totalMenageProvision - mgmtFeeAmount
  // car revenue = accommodation_net - host_service_fee, et COM = accommodation × taux
  // On utilise une approximation jusqu'à avoir le taux exact dans Supabase

  // Taux de commission (à récupérer depuis bien.proprietaire ou bien directement)
  const tauxCom = bien.proprietaire?.taux_commission || 0.25 // 25% par défaut

  // Base de commission = accommodation (loyer brut nuitées)
  const comHT = Math.round(accommodation * tauxCom)

  // --- Calculer AE (provision auto-entrepreneur) ---
  const aeAmount = bien.has_ae
    ? (bien.provision_ae_ref || 0)
    : 0

  // --- Calculer MEN (forfait ménage DCB) ---
  // = Total forfait ménage voyageur - provision AE + management fee
  const menHT = totalMenageProvision - aeAmount + mgmtFeeAmount

  // --- Calculer LOY (reversement propriétaire) ---
  // = Revenue - COM - MEN - AE
  const loyAmount = revenue - comHT - menHT - aeAmount

  // --- Lignes de ventilation ---
  const lignes = []

  // COM — commission DCB
  if (comHT > 0) {
    lignes.push(ligneTVA('COM', 'Honoraires de gestion', comHT, bien, resa))
  }

  // MEN — forfait ménage DCB (sans AE)
  if (menHT > 0) {
    lignes.push(ligneTVA('MEN', 'Forfait ménage & frais', menHT, bien, resa))
  }

  // AE — provision auto-entrepreneur (hors TVA)
  if (aeAmount > 0) {
    lignes.push(ligneHorsTVA('AE', 'Débours auto-entrepreneur', aeAmount, bien, resa))
  }

  // LOY — reversement propriétaire (hors TVA)
  if (loyAmount > 0) {
    lignes.push(ligneHorsTVA('LOY', 'Reversement propriétaire', loyAmount, bien, resa))
  }

  // TAX — taxes pass-through (tracé, hors TVA)
  for (const tax of taxes) {
    if (tax.amount > 0) {
      lignes.push(ligneHorsTVA('TAX', tax.label || 'Taxe séjour', tax.amount, bien, resa))
    }
  }

  // Supprimer les ventilations existantes pour cette résa
  await supabase.from('ventilation').delete().eq('reservation_id', resa.id)

  // Insérer les nouvelles lignes
  if (lignes.length > 0) {
    const { error } = await supabase.from('ventilation').insert(lignes)
    if (error) throw error
  }

  // Marquer la résa comme ventilée
  await supabase
    .from('reservation')
    .update({ ventilation_calculee: true })
    .eq('id', resa.id)
}

// --- Helpers ---

function ligneTVA(code, libelle, montantHT, bien, resa) {
  const tva = Math.round(montantHT * TVA_RATE)
  return {
    reservation_id: resa.id,
    bien_id: bien.id,
    proprietaire_id: bien.proprietaire_id,
    code,
    libelle,
    montant_ht: montantHT,
    taux_tva: 20,
    montant_tva: tva,
    montant_ttc: montantHT + tva,
    mois_comptable: resa.mois_comptable,
    calcul_source: 'auto',
  }
}

function ligneHorsTVA(code, libelle, montant, bien, resa) {
  return {
    reservation_id: resa.id,
    bien_id: bien.id,
    proprietaire_id: bien.proprietaire_id,
    code,
    libelle,
    montant_ht: montant,
    taux_tva: 0,
    montant_tva: 0,
    montant_ttc: montant,
    mois_comptable: resa.mois_comptable,
    calcul_source: 'auto',
  }
}

/**
 * Récupère la ventilation d'un mois, groupée par propriétaire
 */
export async function getVentilationMois(mois) {
  const { data, error } = await supabase
    .from('ventilation')
    .select(`
      *,
      reservation (code, platform, arrival_date, departure_date),
      bien (hospitable_name, code)
    `)
    .eq('mois_comptable', mois)
    .order('code')

  if (error) throw error
  return data || []
}

/**
 * Récapitulatif de ventilation par code pour un mois
 */
export async function getRecapVentilation(mois) {
  const lignes = await getVentilationMois(mois)

  const recap = {}
  for (const l of lignes) {
    if (!recap[l.code]) {
      recap[l.code] = { code: l.code, libelle: l.libelle, ht: 0, tva: 0, ttc: 0, nb: 0 }
    }
    recap[l.code].ht += l.montant_ht
    recap[l.code].tva += l.montant_tva
    recap[l.code].ttc += l.montant_ttc
    recap[l.code].nb++
  }

  return Object.values(recap)
}
