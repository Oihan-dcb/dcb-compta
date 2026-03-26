/**
 * Service de génération des factures Evoliz DCB → Propriétaire
 *
 * Workflow :
 * 1. En début de mois : générer les brouillons pour tous les proprios actifs
 * 2. Vérification : statements finalisés, montants AE validés (non bloquant)
 * 3. Validation manuelle par Oihan
 * 4. Push vers Evoliz via API
 * 5. Tracking statut paiement
 *
 * Structure facture :
 * - Ligne COM : Σ reservation_commissions × taux — TVA 20%
 * - Ligne MEN : Σ (guest_fees - provision AE) + management_fees — TVA 20%
 * - Ligne DIV : Σ expenses [DCB] — TVA 20%
 * - Mention : "Conformément au mandat de gestion..."
 */

import { supabase } from '../lib/supabase'

const MENTION_MANDAT = "Conformément au mandat de gestion, les honoraires de gestion sont directement prélevés sur le loyer encaissé avant reversement au propriétaire."

/**
 * Génère les brouillons de factures pour tous les propriétaires actifs d'un mois
 * @param {string} mois - YYYY-MM
 */
export async function genererFacturesMois(mois) {
  const log = { created: 0, updated: 0, errors: 0 }

  // Récupérer tous les propriétaires avec des biens actifs
  const { data: proprietaires, error: propErr } = await supabase
    .from('proprietaire')
    .select(`
      id, nom, prenom, id_evoliz, iban,
      bien!inner (
        id, hospitable_name, code, listed, agence,
        provision_ae_ref, forfait_dcb_ref, has_ae
      )
    `)
    .eq('bien.listed', true)
    .eq('bien.agence', 'dcb')

  if (propErr) throw propErr

  // Dédupliquer (un proprio peut avoir plusieurs biens)
  const propMap = new Map()
  for (const p of (proprietaires || [])) {
    if (!propMap.has(p.id)) propMap.set(p.id, { ...p, biens: [] })
    propMap.get(p.id).biens.push(...p.bien)
  }

  for (const [propId, proprio] of propMap) {
    try {
      const facture = await genererFactureProprietaire(proprio, mois)
      if (facture.created) log.created++
      else log.updated++
    } catch (err) {
      console.error(`Erreur facture ${proprio.nom}:`, err)
      log.errors++
    }
  }

  return log
}

/**
 * Génère ou met à jour la facture mensuelle d'un propriétaire
 */
async function genererFactureProprietaire(proprio, mois) {
  const bienIds = proprio.biens.map(b => b.id)

  // Récupérer les réservations du mois pour ces biens
  const { data: reservations, error: resaErr } = await supabase
    .from('reservation')
    .select(`
      id, code, platform, fin_revenue, mois_comptable,
      reservation_fee (fee_type, label, amount, category)
    `)
    .in('bien_id', bienIds)
    .eq('mois_comptable', mois)
    .eq('owner_stay', false)
    .neq('final_status', 'cancelled')
    .gt('fin_revenue', 0)

  if (resaErr) throw resaErr

  // Récupérer les expenses [DCB] du mois pour ces biens
  const { data: expenses, error: expErr } = await supabase
    .from('expense')
    .select('amount, description, type_expense')
    .in('bien_id', bienIds)
    .eq('mois_comptable', mois)
    .eq('type_expense', 'DCB')
    .eq('validee', true)

  if (expErr) throw expErr

  // CF-FACAE : facture_ae non implémenté — aeParBien = Map vide (table absente en base)
  const aeParBien = new Map()

  // --- Calculer les 3 lignes ---

  // COM : Σ ventilation COM du mois
  const { data: lignesVentil } = await supabase
    .from('ventilation')
    .select('code, montant_ht, montant_tva, montant_ttc, bien_id')
    .in('bien_id', bienIds)
    .eq('mois_comptable', mois)

  const ventilation = lignesVentil || []

  const sumByCode = (code) => ventilation
    .filter(l => l.code === code)
    .reduce((s, l) => ({
      ht: s.ht + l.montant_ht,
      tva: s.tva + l.montant_tva,
      ttc: s.ttc + l.montant_ttc,
    }), { ht: 0, tva: 0, ttc: 0 })

  const com = sumByCode('HON')
  const men = sumByCode('FMEN')
  const mgt = sumByCode('MGT')
  const ae  = sumByCode('AE')
  const loy = sumByCode('LOY')

  // DIV : expenses [DCB]
  const divHT = (expenses || []).reduce((s, e) => s + (e.amount || 0), 0)
  const divTVA = Math.round(divHT * 0.20)
  const div = { ht: divHT, tva: divTVA, ttc: divHT + divTVA }

  // MEN consolidé = MEN + MGT
  const menConsolide = {
    ht: men.ht + mgt.ht,
    tva: men.tva + mgt.tva,
    ttc: men.ttc + mgt.ttc,
  }

  // Totaux facture
  const totalHT = com.ht + menConsolide.ht + div.ht
  const totalTVA = com.tva + menConsolide.tva + div.tva
  const totalTTC = totalHT + totalTVA

  // Reversement proprio = LOY total
  const montantReversement = loy.ht

  // Cas solde négatif : uniquement des expenses, pas de réservations
  const soldeNegatif = totalHT === 0 && div.ht > 0

  // Vérifier si facture existante
  const { data: existingFacture } = await supabase
    .from('facture_evoliz')
    .select('id, statut')
    .eq('proprietaire_id', proprio.id)
    .eq('mois', mois)
    .single()

  // Ne pas écraser une facture déjà envoyée ou payée
  if (existingFacture && ['envoye_evoliz', 'payee'].includes(existingFacture.statut)) {
    return { created: false, skipped: true, raison: 'Facture déjà envoyée' }
  }

  const factureData = {
    mois,
    proprietaire_id: proprio.id,
    mois,
    total_ht: totalHT,
    total_tva: totalTVA,
    total_ttc: totalTTC,
    montant_reversement: montantReversement,
    statut: totalHT === 0 && div.ht === 0 ? 'calcul_en_cours' : 'brouillon',
    solde_negatif: soldeNegatif,
    montant_reclame: soldeNegatif ? div.ht : null,
  }

  let factureId
  let created = false

  if (existingFacture) {
    await supabase.from('facture_evoliz')
      .update(factureData)
      .eq('id', existingFacture.id)
    factureId = existingFacture.id
  } else {
    const { data: newFacture, error } = await supabase
      .from('facture_evoliz')
      .insert(factureData)
      .select('id')
      .single()
    if (error) throw error
    factureId = newFacture.id
    created = true
  }

  // Supprimer et recréer les lignes
  await supabase.from('facture_evoliz_ligne').delete().eq('facture_id', factureId)

  const lignes = []
  let ordre = 1

  if (com.ht > 0) {
    lignes.push({
      facture_id: factureId,
      code: 'HON',
      libelle: 'Honoraires de gestion',
      description: `${reservations?.length || 0} réservation(s) — ${mois}`,
      montant_ht: com.ht,
      taux_tva: 20,
      montant_tva: com.tva,
      montant_ttc: com.ttc,
      ordre: ordre++,
    })
  }

  if (menConsolide.ht > 0) {
    lignes.push({
      facture_id: factureId,
      code: 'FMEN',
      libelle: 'Forfait ménage, linge et frais de service',
      description: MENTION_MANDAT,
      montant_ht: menConsolide.ht,
      taux_tva: 20,
      montant_tva: menConsolide.tva,
      montant_ttc: menConsolide.ttc,
      ordre: ordre++,
    })
  }

  if (div.ht > 0) {
    lignes.push({
      facture_id: factureId,
      code: 'DIV',
      libelle: soldeNegatif ? 'Frais avancés — remboursement demandé' : 'Frais divers avancés',
      description: (expenses || []).map(e => e.description).join(', ') || 'Frais divers',
      montant_ht: div.ht,
      taux_tva: 20,
      montant_tva: div.tva,
      montant_ttc: div.ttc,
      ordre: ordre++,
    })
  }

  if (lignes.length > 0) {
    await supabase.from('facture_evoliz_ligne').insert(lignes)
  }

  return { created, factureId, totalHT, totalTTC, soldeNegatif }
}

/**
 * Récupère toutes les factures d'un mois avec les détails
 */
export async function getFacturesMois(mois) {
  const { data, error } = await supabase
    .from('facture_evoliz')
    .select(`
      *,
      proprietaire (id, nom, prenom, email, iban, id_evoliz),
      facture_evoliz_ligne (*)
    `)
    .eq('mois', mois)
    .order('created_at')

  if (error) throw error
  return data || []
}

/**
 * Valide une facture (passage brouillon → validé)
 */
export async function validerFacture(factureId) {
  const { error } = await supabase
    .from('facture_evoliz')
    .update({ statut: 'valide' })
    .eq('id', factureId)
    .eq('statut', 'brouillon')

  if (error) throw error
}

/**
 * Marque une facture comme envoyée dans Evoliz
 * @param {string} factureId
 * @param {string} idEvoliz - ID attribué par Evoliz
 * @param {string} numeroFacture
 */
export async function marquerEnvoyeeEvoliz(factureId, idEvoliz, numeroFacture) {
  const { error } = await supabase
    .from('facture_evoliz')
    .update({
      statut: 'envoye_evoliz',
      id_evoliz: idEvoliz,
      numero_facture: numeroFacture,
      date_emission: new Date().toISOString().substring(0, 10),
    })
    .eq('id', factureId)

  if (error) throw error
}

/**
 * Génère l'export CSV pour l'expert-comptable
 * Une ligne par code ventilation par réservation
 */
export async function exportCSVComptable(mois) {
  const { data: ventilation, error } = await supabase
    .from('ventilation')
    .select(`
      code, libelle, montant_ht, taux_tva, montant_tva, montant_ttc, mois_comptable,
      reservation (code, platform, arrival_date, departure_date),
      bien (hospitable_name, code),
      proprietaire (nom)
    `)
    .eq('mois_comptable', mois)
    .order('code')

  if (error) throw error

  const lignes = [
    // En-tête
    ['Mois', 'Code comptable', 'Libellé', 'Bien', 'Propriétaire', 'Plateforme',
     'Référence résa', 'Check-in', 'Check-out', 'HT (€)', 'TVA %', 'TVA (€)', 'TTC (€)'],
    // Données
    ...(ventilation || []).map(l => [
      l.mois_comptable,
      l.code,
      l.libelle,
      l.bien?.code || l.bien?.hospitable_name || '',
      l.proprietaire?.nom || '',
      l.reservation?.platform || '',
      l.reservation?.code || '',
      l.reservation?.arrival_date || '',
      l.reservation?.departure_date || '',
      (l.montant_ht / 100).toFixed(2),
      l.taux_tva,
      (l.montant_tva / 100).toFixed(2),
      (l.montant_ttc / 100).toFixed(2),
    ])
  ]

  // Convertir en CSV
  const csv = lignes
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
    .join('\n')

  // Ajouter BOM UTF-8 pour Excel
  return '\uFEFF' + csv
}

/**
 * Télécharge le CSV dans le navigateur
 */
export function telechargerCSV(contenu, nomFichier) {
  const blob = new Blob([contenu], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomFichier
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Stats factures Evoliz d'un mois
 */
export async function getStatsFactures(mois) {
  const { data: factures } = await supabase
    .from('facture_evoliz')
    .select('statut, total_ttc, solde_negatif')
    .eq('mois', mois)

  const all = factures || []
  return {
    total: all.length,
    brouillons: all.filter(f => f.statut === 'brouillon').length,
    valides: all.filter(f => f.statut === 'valide').length,
    envoyes: all.filter(f => f.statut === 'envoye_evoliz').length,
    payes: all.filter(f => f.statut === 'payee').length,
    soldes_negatifs: all.filter(f => f.solde_negatif).length,
    total_ttc: all.reduce((s, f) => s + (f.total_ttc || 0), 0),
  }
}
