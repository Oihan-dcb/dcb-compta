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
import { AGENCE } from '../lib/agence'

const COMPANY_ID = import.meta.env.VITE_EVOLIZ_COMPANY_ID // ex: "12345"

// Cache des IDs de comptes bancaires Evoliz (lus depuis agency_config au 1er appel)
let _agencyBankIds = null
async function getAgencyBankIds() {
  if (_agencyBankIds) return _agencyBankIds
  const { data } = await supabase
    .from('agency_config')
    .select('evoliz_bank_id_agence, evoliz_bank_id_seq_lc, evoliz_bank_id_seq_lld')
    .eq('agence', AGENCE)
    .single()
  _agencyBankIds = {
    agence:   data?.evoliz_bank_id_agence  || null,
    seq_lc:   data?.evoliz_bank_id_seq_lc  || null,
    seq_lld:  data?.evoliz_bank_id_seq_lld || null,
  }
  return _agencyBankIds
}

// ============================================================
// APPEL GÃÂNÃÂRIQUE
// ============================================================

async function evolizCall(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('evoliz-proxy', {
    body: { action, payload, companyId: COMPANY_ID },
  })

  if (error) throw new Error(`Edge Function: ${error.message}`)
  if (data?.error) throw new Error(`Evoliz API: ${data.error}`)
  // Retourner le corps complet Evoliz pour faciliter le débogage
  if (data?.status && data.status >= 400) {
    throw new Error(`Evoliz ${data.status}: ${JSON.stringify(data.data)}`)
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
  // Débours : DEB_AE autorisé (compte 467, TVA 0%) — Honoraires : DEB_AE filtré
  const isDebours = facture.type_facture === 'debours'
  // Codes mémo internes : jamais envoyés à Evoliz (taux_tva=null, informatif seulement)
  const CODES_MEMO = ['AUTO', 'VIRP']
  // Mapping codes DCB → accountingAccountId Evoliz (comptes créés le 2026-06-02)
  const ACCOUNT_MAP = {
    HON:     8677891, // 7061 — Gestion location saisonnière
    FMEN:    8677892, // 7062 — Forfait ménage
    COM:     8677893, // 7063 — Commission
    DIV:     8677895, // 7065 — Frais divers avancés
    HAOWNER: 8677896, // 7066 — Achats refacturés propriétaires (surfacturation)
    HON_ETU: 8677897, // 7067 — Honoraires locations étudiantes
    HON_MOB: 8677898, // 7068 — Honoraires contrats mobilité
    DEB_AE:  8629957, // 467  — Débours AE (compte séquestre)
  }
  const lignes = (facture.facture_evoliz_ligne || [])
    .sort((a, b) => a.ordre - b.ordre)
    .filter(l => l.montant_ht !== 0 && !CODES_MEMO.includes(l.code) && (isDebours || l.code !== 'DEB_AE'))
    .map(l => {
      const htCentimes = Math.round(l.montant_ht)
      if (!Number.isFinite(htCentimes) || htCentimes === 0) return null
      // Evoliz exige unitPrice >= 0 — lignes négatives (PREST, FRAIS, DEBP) : quantity=-1, prix absolu
      return {
        designation: l.libelle || `Ligne ${l.code || 'facturation'}`,
        reference: l.code,
        quantity: htCentimes < 0 ? -1 : 1,
        unitPrice: Math.abs(htCentimes) / 100,
        vatRate: l.taux_tva ?? 20,
        ...(ACCOUNT_MAP[l.code] ? { accountingAccountId: ACCOUNT_MAP[l.code] } : {}),
        // Article d'exonération TVA pour débours (art. 267-II-2° CGI) — obligatoire août 2026
        ...(l.code === 'DEB_AE' ? { vatExemption: 'AE267-2' } : {}),
      }
    })
    .filter(Boolean)

  if (lignes.length === 0) {
    // Facture sans ligne Evoliz (ex: que du DEB_AE) — on marque comme envoyée sans passer par Evoliz
    await supabase.from('facture_evoliz')
      .update({ statut: 'envoye_evoliz', id_evoliz: 'N/A', numero_facture: 'N/A' })
      .eq('id', facture.id)
    return { skipped: true, reason: 'no_billable_lines' }
  }

  // 4. Note de bas de facture
  const comment = isDebours
    ? `Remboursement de débours auto-entrepreneur — mois ${facture.mois}\n\n⚠ ATTENTION : ce règlement est à effectuer sur le compte séquestre, différent du compte courant utilisé pour les factures d'honoraires et de forfaits ménage.\n\nVirement à effectuer sur le compte séquestre :\nIBAN : FR76 1333 5000 4008 0030 4976 555\nBIC : CEPAFRPP333`
    : facture.solde_negatif
      ? `Remboursement de frais avancés — mois ${facture.mois}`
      : `Honoraires de gestion locative — ${facture.mois}\n\nConformément au mandat de gestion, les honoraires de gestion sont directement prélevés sur le loyer encaissé avant reversement au propriétaire.`

  // 4b. Objet de la facture
  const bienNomEvoliz = facture.bien?.hospitable_name || facture.proprietaire?.nom || 'bien'
  const objectFacture = isDebours
    ? `Facture de débours — mois ${facture.mois} — ${bienNomEvoliz}`
    : `Facture du mois ${facture.mois} pour ${bienNomEvoliz}`

  // 5 & 6. Créer et sauvegarder la facture dans Evoliz
  // Si Evoliz échoue ici : reset à 'valide' — relance possible sans doublon.
  let invoiceId, invoiceNumber
  try {
    const bankIds = await getAgencyBankIds()
    const createdInvoice = await evolizCall('createInvoice', {
      clientId: parseInt(clientId),
      documentdate: dateEmission,
      paytermid: 1,
      // businessProcess : ne pas envoyer avant août 2026 (valeur rejetée par Evoliz)
      object: objectFacture,
      comment,
      items: lignes,
      // IDs de comptes bancaires lus depuis agency_config (Agence > Comptes bancaires)
      ...(isDebours && bankIds.seq_lc  ? { bankAccountId: bankIds.seq_lc  } : {}),
      ...(!isDebours && bankIds.agence ? { bankAccountId: bankIds.agence } : {}),
    })
    invoiceId = createdInvoice?.invoiceid
    if (!invoiceId) throw new Error('invoiceid non retourné après création')
  } catch (evolizErr) {
    // createInvoice échoué — aucune facture créée côté Evoliz : reset à 'valide' (retry sûr)
    await supabase.from('facture_evoliz')
      .update({ statut: 'valide' })
      .eq('id', facture.id)
    throw evolizErr
  }

  // Facture créée en brouillon dans Evoliz (statut "filled") — validation manuelle intentionnelle
  // Ne pas appeler saveInvoice : l'utilisateur confirme lui-même dans Evoliz avant envoi.

  // 7. Mettre a jour Supabase - avec retry (CF-F2 niveau 2)
  let updateError = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await supabase
      .from('facture_evoliz')
      .update({
        id_evoliz: String(invoiceId),
        numero_facture: invoiceNumber || null,
        statut: 'envoye_evoliz',
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
      bien (hospitable_name),
      facture_evoliz_ligne (*)
    `)
    .eq('mois', mois)
    .eq('statut', 'valide')
    .eq('agence', AGENCE)

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
      // businessProcess : ne pas envoyer avant août 2026 (valeur rejetée par Evoliz)
      comment: `Commissions sur réservations web directes — ${mois}`,
      items: [{
        designation: 'Commission gestion réservations directes',
        reference: 'COM',
        quantity: 1,
        unitPrice: totals.ht / 100,
        vatRate: 20,
        accountingAccountId: 8677893, // 7063 — Commission
      }],
    })

    const invoiceId = createdInvoice?.invoiceid
    if (!invoiceId) throw new Error('invoiceid non retourné par Evoliz')

    const dateEmission = new Date().toISOString().substring(0, 10)

    // Facture créée en brouillon dans Evoliz — validation manuelle intentionnelle
    await supabase.from('facture_evoliz').update({
      statut: 'envoye_evoliz',
      id_evoliz: String(invoiceId),
      date_emission: dateEmission,
    }).eq('id', factureId)

    return { invoiceId }
  } catch (err) {
    // Reset si échec
    await supabase.from('facture_evoliz').update({ statut: 'valide' }).eq('id', factureId)
    throw err
  }
}

// ============================================================
// SYNC NUMÉROS DEPUIS EVOLIZ
// ============================================================

/**
 * Pour toutes les factures envoye_evoliz sans numero_facture,
 * récupère le document_number depuis Evoliz et met à jour la DB.
 * @param {string} mois - ex: "2026-05"
 * @returns {{ updated: number, skipped: number }}
 */
export async function syncNumerosEvoliz(mois) {
  const { data: factures, error } = await supabase
    .from('facture_evoliz')
    .select('id, id_evoliz')
    .eq('mois', mois)
    .eq('statut', 'envoye_evoliz')
    .is('numero_facture', null)
    .not('id_evoliz', 'is', null)
    .neq('id_evoliz', 'N/A')

  if (error) throw error
  if (!factures?.length) return { updated: 0, skipped: 0 }

  let updated = 0, skipped = 0
  for (const f of factures) {
    try {
      const inv = await evolizCall('getInvoice', { invoiceId: f.id_evoliz })
      const numero = inv?.document_number || null
      if (!numero) { skipped++; continue }
      await supabase.from('facture_evoliz')
        .update({ numero_facture: numero })
        .eq('id', f.id)
      updated++
    } catch {
      skipped++
    }
  }
  return { updated, skipped }
}
