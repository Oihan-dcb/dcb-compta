/**
 * Service Evoliz Ã¢ÂÂ cÃÂ´tÃÂ© React
 * Toutes les opÃÂ©rations passent par la Supabase Edge Function 'evoliz-proxy'
 * Base URL rÃÂ©elle : https://www.evoliz.io/
 * Auth : POST /api/login avec public_key + secret_key Ã¢ÂÂ token 20 min
 *
 * IMPORTANT : les montants sont en centimes dans Supabase, en euros dans Evoliz.
 * La conversion centimes Ã¢ÂÂ euros se fait ici avant l'appel Edge Function.
 *
 * Le companyId Evoliz est un entier numÃÂ©rique (pas le slug "destinationcotebasque1").
 * Il est visible dans Evoliz > ParamÃÂ¨tres > Informations sociÃÂ©tÃÂ© (coin bas gauche).
 */

import { supabase } from '../lib/supabase'

const COMPANY_ID = import.meta.env.VITE_EVOLIZ_COMPANY_ID // ex: "12345"

// ============================================================
// APPEL GÃÂNÃÂRIQUE
// ============================================================

async function evolizCall(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('evoliz-proxy', {
    body: { action, payload, companyId: COMPANY_ID },
  })

  if (error) throw new Error(`Edge Function: ${error.message}`)
  if (data?.error) throw new Error(`Evoliz API: ${data.error}`)
  if (data?.data?.error) throw new Error(`Evoliz: ${JSON.stringify(data.data.error)}`)

  // VÃÂ©rifier le status HTTP retournÃÂ© par la Edge Function
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
// CLIENTS (PropriÃÂ©taires)
// ============================================================

/**
 * RÃÂ©cupÃÂ¨re le companyid Evoliz numÃÂ©rique depuis l'URL du compte.
 * Note : ÃÂ  configurer manuellement dans VITE_EVOLIZ_COMPANY_ID.
 * Visible dans Evoliz : bas gauche Ã¢ÂÂ "114158-144311" Ã¢ÂÂ le premier chiffre est le companyid.
 */

/**
 * CrÃÂ©e ou rÃÂ©cupÃÂ¨re un client Evoliz pour un propriÃÂ©taire
 * @param {Object} proprietaire - Objet depuis Supabase
 * @returns {string} ID client Evoliz (numÃÂ©rique)
 */
export async function getOuCreerClientEvoliz(proprietaire) {
  if (proprietaire.id_evoliz) return proprietaire.id_evoliz

  return creerClientEvoliz(proprietaire)
}

/**
 * CrÃÂ©e un client Evoliz depuis un propriÃÂ©taire Supabase
 */
export async function creerClientEvoliz(proprietaire) {
  const nomComplet = [proprietaire.nom, proprietaire.prenom].filter(Boolean).join(' ')

  const result = await evolizCall('createClient', {
    name: nomComplet,
    type: 'Particulier', // Les propriÃÂ©taires sont des particuliers
    address: proprietaire.adresse || '',
    postcode: proprietaire.code_postal || '64200',
    town: proprietaire.ville || 'Biarritz',
    country: 'FR',
    phone: proprietaire.telephone || undefined,
  })

  // L'API retourne l'objet client Ã¢ÂÂ extraire le clientid
  const clientId = result?.clientid
  if (!clientId) {
    console.warn('Structure rÃÂ©ponse client Evoliz:', JSON.stringify(result).substring(0, 200))
    throw new Error('clientid non retournÃÂ© par Evoliz')
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
 * 1. CrÃÂ©er le client Evoliz si nÃÂ©cessaire
 * 2. CrÃÂ©er la facture (statut "filled" = brouillon)
 * 3. Sauvegarder (statut "create" = numÃÂ©ro dÃÂ©finitif attribuÃÂ©)
 * 4. Mettre ÃÂ  jour Supabase avec l'ID et le numÃÂ©ro Evoliz
 *
 * @param {Object} facture - Objet facture_evoliz avec lignes et propriÃÂ©taire
 */
export async function creerFactureEvoliz(facture) {
  // CF-F2 niveau 1 - guard idempotence : ne pas recreer si deja envoye vers Evoliz
  if (facture.id_evoliz) {
    throw new Error(
      `CF-F2 : facture deja envoyee dans Evoliz - push ignore.\n` +
      `  facture.id=${facture.id} | proprietaire_id=${facture.proprietaire_id} | mois=${facture.mois} | id_evoliz=${facture.id_evoliz}`
    )
  }

  // CF-F2 verrou pre-envoi : statut → 'envoi_en_cours' avant tout appel Evoliz
  // Si saveInvoice réussit mais UPDATE final échoue, la facture reste 'envoi_en_cours'
  // et n'est plus repêchée par pousserFacturesMoisVersEvoliz (query statut='valide').
  await supabase.from('facture_evoliz')
    .update({ statut: 'envoi_en_cours' })
    .eq('id', facture.id)
    .eq('statut', 'valide')

  const proprio = facture.proprietaire
  if (!proprio) throw new Error('PropriÃÂ©taire manquant dans la facture')

  // 1. S'assurer que le client existe dans Evoliz
  const clientId = await getOuCreerClientEvoliz(proprio)

  // 2. Date d'ÃÂ©mission
  const dateEmission = facture.date_emission || new Date().toISOString().substring(0, 10)

  // 3. Construire les lignes de facture
  // Evoliz attend les prix en euros HT, on convertit depuis centimes
  const lignes = (facture.facture_evoliz_ligne || [])
    .sort((a, b) => a.ordre - b.ordre)
    .filter(l => l.montant_ht > 0)
    .map(l => ({
      designation: l.libelle,
      reference: l.code,
      quantity: 1,
      unitPrice: l.montant_ht / 100,
      vatRate: l.taux_tva ?? 20,
    }))

  if (lignes.length === 0) throw new Error('Aucune ligne non nulle dans la facture')

  // 4. Note de bas de facture
  const comment = facture.solde_negatif
    ? `Remboursement de frais avancés — mois ${facture.mois}`
    : `Honoraires de gestion locative — ${facture.mois}\n\nConformément au mandat de gestion, les honoraires de gestion sont directement prélevés sur le loyer encaissé avant reversement au propriétaire.`

  // 5 & 6. Créer et sauvegarder la facture dans Evoliz
  // Si Evoliz échoue ici : reset à 'valide' — relance possible sans doublon.
  let invoiceId, invoiceNumber
  try {
    const createdInvoice = await evolizCall('createInvoice', {
      clientId: parseInt(clientId),
      documentdate: dateEmission,
      paytermid: 1,
      comment,
      items: lignes,
    })
    invoiceId = createdInvoice?.invoiceid
    if (!invoiceId) throw new Error('invoiceid non retourné après création')

    // saveInvoice : passe de filled → create, numéro définitif attribué
    const savedInvoice = await evolizCall('saveInvoice', { invoiceId })
    invoiceNumber = savedInvoice?.document_number

    // Paiement automatique — virement compte de gestion DCB
    const montantTTC = (facture.facture_evoliz_ligne || [])
      .filter(l => l.montant_ttc > 0)
      .reduce((s, l) => s + l.montant_ttc, 0) / 100
    if (montantTTC > 0) {
      await evolizCall('createPayment', {
        invoiceId,
        paydate: dateEmission,
        label: 'Virement compte de gestion DCB',
        paytypeid: 4,
        amount: montantTTC,
      })
    }
  } catch (evolizErr) {
    // Evoliz a échoué — aucune facture finalisée côté Evoliz : reset à 'valide'
    await supabase.from('facture_evoliz')
      .update({ statut: 'valide' })
      .eq('id', facture.id)
    throw evolizErr
  }

  // 7. Mettre a jour Supabase - avec retry (CF-F2 niveau 2)
  let updateError = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await supabase
      .from('facture_evoliz')
      .update({
        id_evoliz: String(invoiceId),
        numero_facture: invoiceNumber || null,
        statut: 'payee',
        date_emission: dateEmission,
      })
      .eq('id', facture.id)
    if (!error) { updateError = null; break }
    updateError = error
    await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)))
  }
  if (updateError) {
    throw new Error(
      `CF-F2 : UPDATE Supabase echoue apres 3 tentatives - facture orpheline cote Evoliz.\n` +
      `  RECONCILIATION MANUELLE REQUISE :\n` +
      `  invoiceId Evoliz    = ${invoiceId}\n` +
      `  document_number     = ${invoiceNumber || 'non disponible'}\n` +
      `  facture.id (DCB)    = ${facture.id}\n` +
      `  proprietaire_id     = ${facture.proprietaire_id}\n` +
      `  mois                = ${facture.mois}\n` +
      `  Action : UPDATE facture_evoliz SET id_evoliz='${invoiceId}', statut='envoye_evoliz' WHERE id='${facture.id}'`
    )
  }

  return { invoiceId, invoiceNumber }
}

/**
 * Envoie toutes les factures validÃÂ©es d'un mois vers Evoliz
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
    // CF-F2 niveau 1 - skip si deja envoye (guard redondant avec creerFactureEvoliz)
    if (facture.id_evoliz) {
      results.skipped = (results.skipped || 0) + 1
      continue
    }
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
 * Utilisé pour joindre le PDF de la facture dans les rapports propriétaires
 * @param {string|number} clientId - ID client Evoliz
 * @param {Object} opts - Options supplémentaires (ex: { status: 'create' })
 */
export async function getFacturesClientEvoliz(clientId, opts = {}) {
  return evolizCall('listInvoices', { clientId, ...opts })
}

/**
 * Télécharge le PDF d'une facture Evoliz et retourne son contenu en base64
 * @param {string|number} invoiceId - ID de la facture dans Evoliz
 * @returns {string|null} Contenu PDF en base64, ou null si non disponible
 */
export async function getInvoicePDFBase64(invoiceId) {
  const result = await evolizCall('getInvoicePDF', { invoiceId })
  return result?.pdf_base64 || null
}

/**
 * RÃÂ©cupÃÂ¨re les conditions de paiement disponibles dans Evoliz
 * (utile pour configurer paytermid)
 */
export async function getPaytermsEvoliz() {
  return evolizCall('getPayterms')
}

// ── FACTURE COM ──────────────────────────────────────────────────────────────

/**
 * Pousse la facture COM (commissions web directes) vers Evoliz
 * Client cible : CLI-RESA-WEB-DCB (recherche par nom)
 */
export async function pousserFactureCOMVersEvoliz(factureId, totals, mois) {
  // Verrou anti-doublon
  await supabase.from('facture_evoliz')
    .update({ statut: 'envoi_en_cours' })
    .eq('id', factureId)
    .eq('statut', 'valide')

  try {
    // 1. Trouver le client CLI-RESA-WEB-DCB dans Evoliz
    const listResult = await evolizCall('listClients', { search: 'CLI-RESA-WEB-DCB' })
    const clients = listResult?.data || []
    if (!clients.length) throw new Error('Client CLI-RESA-WEB-DCB introuvable dans Evoliz — vérifier le nom exact.')
    const clientId = clients[0].clientid

    // 2. Créer la facture
    const createdInvoice = await evolizCall('createInvoice', {
      clientId: parseInt(clientId),
      documentdate: new Date().toISOString().substring(0, 10),
      paytermid: 1,
      comment: `Commissions sur réservations web directes — ${mois}`,
      items: [{
        designation: 'Commission gestion réservations directes',
        reference: 'COM',
        quantity: 1,
        unitPrice: totals.ht / 100,
        vatRate: 20,
      }],
    })

    const invoiceId = createdInvoice?.invoiceid
    if (!invoiceId) throw new Error('invoiceid non retourné par Evoliz')

    // 3. Sauvegarder (numéro définitif)
    const savedInvoice = await evolizCall('saveInvoice', { invoiceId })
    const invoiceNumber = savedInvoice?.document_number
    const dateEmission = new Date().toISOString().substring(0, 10)

    // 4. Solder automatiquement — virement compte de gestion DCB
    const montantTTC = totals.ttc / 100
    if (montantTTC > 0) {
      await evolizCall('createPayment', {
        invoiceId,
        paydate: dateEmission,
        label: 'Virement compte de gestion DCB',
        paytypeid: 4,
        amount: montantTTC,
      })
    }

    // 5. Mettre à jour Supabase
    await supabase.from('facture_evoliz').update({
      statut: 'payee',
      id_evoliz: String(invoiceId),
      numero_facture: invoiceNumber || null,
      date_emission: dateEmission,
    }).eq('id', factureId)

    return { invoiceId, invoiceNumber }
  } catch (err) {
    // Reset si échec
    await supabase.from('facture_evoliz').update({ statut: 'valide' }).eq('id', factureId)
    throw err
  }
}
