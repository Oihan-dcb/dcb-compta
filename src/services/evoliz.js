/**
 * Service Evoliz — côté React
 * Toutes les opérations passent par la Supabase Edge Function 'evoliz-proxy'
 * Base URL réelle : https://www.evoliz.io/
 * Auth : POST /api/login avec public_key + secret_key → token 20 min
 *
 * IMPORTANT : les montants sont en centimes dans Supabase, en euros dans Evoliz.
 * La conversion centimes → euros se fait ici avant l'appel Edge Function.
 *
 * Le companyId Evoliz est un entier numérique (pas le slug "destinationcotebasque1").
 * Il est visible dans Evoliz > Paramètres > Informations société (coin bas gauche).
 */

import { supabase } from '../lib/supabase'

const COMPANY_ID = import.meta.env.VITE_EVOLIZ_COMPANY_ID // ex: "12345"

// ============================================================
// APPEL GÉNÉRIQUE
// ============================================================

async function evolizCall(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('evoliz-proxy', {
    body: { action, payload, companyId: COMPANY_ID },
  })

  if (error) throw new Error(`Edge Function: ${error.message}`)
  if (data?.error) throw new Error(`Evoliz API: ${data.error}`)
  if (data?.data?.error) throw new Error(`Evoliz: ${JSON.stringify(data.data.error)}`)

  // Vérifier le status HTTP retourné par la Edge Function
  if (data?.status && data.status >= 400) {
    const msg = data.data?.message || data.data?.error || `HTTP ${data.status}`
    throw new Error(`Evoliz ${data.status}: ${typeof msg === 'object' ? JSON.stringify(msg) : msg}`)
  }

  return data?.data
}

// ============================================================
// TEST DE CONNEXION
// ============================================================

export async function pingEvoliz() {
  return evolizCall('ping')
}

// ============================================================
// CLIENTS (Propriétaires)
// ============================================================

/**
 * Récupère le companyid Evoliz numérique depuis l'URL du compte.
 * Note : à configurer manuellement dans VITE_EVOLIZ_COMPANY_ID.
 * Visible dans Evoliz : bas gauche → "114158-144311" → le premier chiffre est le companyid.
 */

/**
 * Crée ou récupère un client Evoliz pour un propriétaire
 * @param {Object} proprietaire - Objet depuis Supabase
 * @returns {string} ID client Evoliz (numérique)
 */
export async function getOuCreerClientEvoliz(proprietaire) {
  if (proprietaire.id_evoliz) return proprietaire.id_evoliz

  return creerClientEvoliz(proprietaire)
}

/**
 * Crée un client Evoliz depuis un propriétaire Supabase
 */
export async function creerClientEvoliz(proprietaire) {
  const nomComplet = [proprietaire.nom, proprietaire.prenom].filter(Boolean).join(' ')

  const result = await evolizCall('createClient', {
    name: nomComplet,
    type: 'Particulier', // Les propriétaires sont des particuliers
    address: proprietaire.adresse || '',
    postcode: proprietaire.code_postal || '64200',
    town: proprietaire.ville || 'Biarritz',
    country: 'FR',
    phone: proprietaire.telephone || undefined,
  })

  // L'API retourne l'objet client — extraire le clientid
  const clientId = result?.clientid
  if (!clientId) {
    console.warn('Structure réponse client Evoliz:', JSON.stringify(result).substring(0, 200))
    throw new Error('clientid non retourné par Evoliz')
  }

  // Sauvegarder l'ID dans Supabase
  await supabase
    .from('proprietaire')
    .update({ id_evoliz: String(clientId) })
    .eq('id', proprietaire.id)

  return String(clientId)
}

// ============================================================
// FACTURES
// ============================================================

/**
 * Workflow complet pour envoyer une facture vers Evoliz :
 * 1. Créer le client Evoliz si nécessaire
 * 2. Créer la facture (statut "filled" = brouillon)
 * 3. Sauvegarder (statut "create" = numéro définitif attribué)
 * 4. Mettre à jour Supabase avec l'ID et le numéro Evoliz
 *
 * @param {Object} facture - Objet facture_evoliz avec lignes et propriétaire
 */
export async function creerFactureEvoliz(facture) {
  const proprio = facture.proprietaire
  if (!proprio) throw new Error('Propriétaire manquant dans la facture')

  // 1. S'assurer que le client existe dans Evoliz
  const clientId = await getOuCreerClientEvoliz(proprio)

  // 2. Date d'émission
  const dateEmission = facture.date_emission || new Date().toISOString().substring(0, 10)

  // 3. Construire les lignes de facture
  // Evoliz attend les prix en euros HT, on convertit depuis centimes
  const lignes = (facture.facture_evoliz_ligne || [])
    .sort((a, b) => a.ordre - b.ordre)
    .filter(l => l.montant_ht > 0)
    .map(l => ({
      designation: l.libelle,
      quantity: 1,
      unitPrice: l.montant_ht / 100,   // centimes → euros
      vatRate: l.taux_tva || 20,
    }))

  if (lignes.length === 0) throw new Error('Aucune ligne non nulle dans la facture')

  // 4. Note de bas de facture
  const comment = facture.solde_negatif
    ? `Remboursement de frais avancés — mois ${facture.mois}`
    : `Honoraires de gestion locative — ${facture.mois}\n\nConformément au mandat de gestion, les honoraires de gestion sont directement prélevés sur le loyer encaissé avant reversement au propriétaire.`

  // 5. Créer la facture (brouillon)
  const createdInvoice = await evolizCall('createInvoice', {
    clientId: parseInt(clientId),
    documentdate: dateEmission,
    paytermid: 1,  // Comptant — à ajuster si besoin
    comment,
    items: lignes,
  })

  const invoiceId = createdInvoice?.invoiceid
  if (!invoiceId) throw new Error('invoiceid non retourné après création')

  // 6. Sauvegarder (passe de filled → create, numéro définitif)
  const savedInvoice = await evolizCall('saveInvoice', { invoiceId })
  const invoiceNumber = savedInvoice?.document_number

  // 7. Mettre à jour Supabase
  await supabase
    .from('facture_evoliz')
    .update({
      id_evoliz: String(invoiceId),
      numero_facture: invoiceNumber || null,
      statut: 'envoye_evoliz',
      date_emission: dateEmission,
    })
    .eq('id', facture.id)

  return { invoiceId, invoiceNumber }
}

/**
 * Envoie toutes les factures validées d'un mois vers Evoliz
 * @param {string} mois - YYYY-MM
 */
export async function pousserFacturesMoisVersEvoliz(mois) {
  const { data: factures, error } = await supabase
    .from('facture_evoliz')
    .select(`
      *,
      proprietaire (id, nom, prenom, email, adresse, ville, code_postal, telephone, iban, id_evoliz),
      facture_evoliz_ligne (*)
    `)
    .eq('mois', mois)
    .eq('statut', 'valide')

  if (error) throw error

  const results = { pushed: 0, errors: [] }

  for (const facture of (factures || [])) {
    try {
      await creerFactureEvoliz(facture)
      results.pushed++
    } catch (err) {
      console.error(`Erreur facture ${facture.id}:`, err)
      results.errors.push({ proprio: facture.proprietaire?.nom, error: err.message })
    }
  }

  return results
}

/**
 * Récupère les factures d'un client depuis Evoliz
 */
export async function getFacturesClientEvoliz(clientId, opts = {}) {
  return evolizCall('listInvoices', { clientId, ...opts })
}

/**
 * Récupère les conditions de paiement disponibles dans Evoliz
 * (utile pour configurer paytermid)
 */
export async function getPaytermsEvoliz() {
  return evolizCall('getPayterms')
}
