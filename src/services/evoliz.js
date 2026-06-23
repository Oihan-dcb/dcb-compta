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

// Mapping code DCB → code classification Evoliz (colonne "Code" dans l'UI)
const CLASSIFICATION_CODE_MAP = {
  HON:     '01', // Gestion location saisonnière
  FMEN:    '04', // Forfait ménage
  COM:     '05', // Commission
  DIV:     '06', // Frais divers avancés
  HAOWNER: '07', // Achats refacturés propriétaires
  HON_ETU: '08', // Honoraires locations étudiantes
  HON_MOB: '09', // Honoraires contrats mobilité
  HON_LLD: '10', // Honoraires gestion longue durée (compte 7069)
  FRAIS:   '02', // Produits des activités annexes
  DEBP:    '02', // Produits des activités annexes (débours proprio)
}

// Cache des IDs numériques classifications (code "01" → id numérique Evoliz)
let _classifIdCache = null
async function getClassificationIdMap() {
  if (_classifIdCache) return _classifIdCache
  try {
    const result = await evolizCall('listClassifications', { per_page: 50 })
    const items = result?.data || []
    _classifIdCache = {}
    for (const c of items) {
      if (c.code != null) _classifIdCache[String(c.code).padStart(2, '0')] = c.classificationid
    }
  } catch {
    _classifIdCache = {}
  }
  return _classifIdCache
}

// Cache des IDs articles catalogue Evoliz (référence → itemid)
let _articleIdCache = null
async function getArticleIdMap() {
  if (_articleIdCache) return _articleIdCache
  try {
    const result = await evolizCall('listArticles', { per_page: 100 })
    const items = result?.data || []
    _articleIdCache = {}
    for (const item of items) {
      if (item.reference) _articleIdCache[item.reference.trim()] = item.articleid
    }
  } catch {
    _articleIdCache = {}
  }
  return _articleIdCache
}

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
// Clôture des biens d'une facture poussée à Evoliz (envoye_evoliz = bien figé,
// plus de saisie prestations/heures côté AE/admin — RLS, voir migration 193).
// Par bien (facture mono-bien) ou tout le groupe (Maïté : bien_id null → biens du proprio).
// COM exclu (facture globale, pas rattachée à un bien). Best-effort : n'interrompt jamais le push.
async function cloturerBiensFacture(facture) {
  try {
    if (!facture || facture.type_facture === 'com' || !facture.mois) return
    let bienIds = []
    if (facture.bien_id) {
      bienIds = [facture.bien_id]
    } else if (facture.proprietaire_id) {
      // Facture de groupe (Maïté) → tous les biens du propriétaire
      const { data } = await supabase.from('bien').select('id').eq('proprietaire_id', facture.proprietaire_id)
      bienIds = (data || []).map(b => b.id)
    }
    if (!bienIds.length) return
    // Idempotent : ne pas recréer une clôture active déjà présente
    const { data: existing } = await supabase.from('cloture_bien')
      .select('bien_id').in('bien_id', bienIds).eq('mois', facture.mois).eq('active', true)
    const have = new Set((existing || []).map(e => e.bien_id))
    const toInsert = bienIds.filter(id => !have.has(id)).map(id => ({
      agence: facture.agence || AGENCE,
      bien_id: id,
      mois: facture.mois,
      facture_id: facture.id,
      closed_by: 'evoliz_push',
    }))
    if (toInsert.length) {
      const { error } = await supabase.from('cloture_bien').insert(toInsert)
      if (error) console.error('[cloturerBiensFacture] insert', error.message)
    }
  } catch (e) {
    console.error('[cloturerBiensFacture]', e?.message || e)
  }
}

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

  // Le join peut échouer si le proprio est d'une autre agence (RLS) → fallback direct
  let proprio = facture.proprietaire
  if (!proprio && facture.proprietaire_id) {
    const { data: p } = await supabase
      .from('proprietaire')
      .select('id, nom, prenom, id_evoliz, adresse, ville, code_postal, telephone, agence')
      .eq('id', facture.proprietaire_id)
      .maybeSingle()
    proprio = p
  }
  if (!proprio) {
    await supabase.from('facture_evoliz').update({ statut: 'valide' }).eq('id', facture.id)
    throw new Error(`Propriétaire manquant — facture ${facture.id} (proprietaire_id=${facture.proprietaire_id})`)
  }

  // 1. S'assurer que le client existe dans Evoliz
  // Si le proprio est d'une autre agence (ex: proprio Lauian avec facture DCB pour FMEN),
  // chercher l'entrée proprio de la bonne agence pour obtenir le bon id_evoliz Evoliz.
  let proprioForEvoliz = proprio
  if (proprio.agence && facture.agence && proprio.agence !== facture.agence) {
    const { data: sameProprio } = await supabase
      .from('proprietaire')
      .select('id, nom, prenom, id_evoliz, adresse, ville, code_postal, telephone, agence')
      .eq('nom', proprio.nom)
      .eq('prenom', proprio.prenom)
      .eq('agence', facture.agence)
      .maybeSingle()
    if (sameProprio) proprioForEvoliz = sameProprio
  }
  const clientId = await getOuCreerClientEvoliz(proprioForEvoliz)

  // 2. Date d'ÃÂ©mission
  const dateEmission = facture.date_emission || new Date().toISOString().substring(0, 10)

  // 3. Construire les lignes de facture
  // Evoliz attend les prix en euros HT, on convertit depuis centimes
  // Débours : DEB_AE autorisé (compte 467, TVA 0%) — Honoraires : DEB_AE filtré
  const isDebours = facture.type_facture === 'debours'
  // Codes mémo internes : jamais envoyés à Evoliz (taux_tva=null, informatif seulement)
  const CODES_MEMO = ['AUTO', 'VIRP', 'PREST']
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
  // HON_LLD (7069) — sociétés Evoliz distinctes par agence → accountId distinct.
  // Si l'agence n'est pas renseignée ici, le push omet accountingAccountId et
  // s'appuie sur le compte porté par l'article HON_LLD (créé par Setup dans CETTE société).
  const HON_LLD_BY_AGENCE = {
    dcb: 8715495, // société 114158
    // lauian: <à renseigner après "⚙ Setup Evoliz" sur le déploiement Lauian (société 115576)>
  }
  if (HON_LLD_BY_AGENCE[AGENCE]) ACCOUNT_MAP.HON_LLD = HON_LLD_BY_AGENCE[AGENCE]
  // Charger les maps catalogue et classifications en parallèle
  const [articleIdMap, classifIdMap] = await Promise.all([getArticleIdMap(), getClassificationIdMap()])

  // Nom du bien à accoler aux libellés de lignes (factures mono-bien). Vide pour les factures
  // de groupe (Maïté, bien_id null) ou COM → pas de bien unique.
  const bienNom = facture.bien?.hospitable_name || ''

  const lignes = (facture.facture_evoliz_ligne || [])
    .sort((a, b) => a.ordre - b.ordre)
    .filter(l => l.montant_ht !== 0 && !CODES_MEMO.includes(l.code) && (isDebours || l.code !== 'DEB_AE'))
    .map(l => {
      const htCentimes = Math.round(l.montant_ht)
      if (!Number.isFinite(htCentimes) || htCentimes === 0) return null
      // Evoliz exige unitPrice >= 0 — lignes négatives (PREST, FRAIS, DEBP) : quantity=-1, prix absolu
      return {
        designation: (l.libelle || `Ligne ${l.code || 'facturation'}`) + (bienNom ? ` — ${bienNom}` : ''),
        reference: l.code,
        quantity: htCentimes < 0 ? -1 : 1,
        unitPrice: Math.abs(htCentimes) / 100,
        vatRate: l.taux_tva ?? 20,
        ...(ACCOUNT_MAP[l.code] ? { accountingAccountId: ACCOUNT_MAP[l.code] } : {}),
        // Lier l'article catalogue pour hériter la Classification vente Evoliz
        ...(articleIdMap[l.code] ? { articleId: articleIdMap[l.code] } : {}),
        // Classification vente directe (au cas où itemid ne suffit pas)
        ...(CLASSIFICATION_CODE_MAP[l.code] && classifIdMap[CLASSIFICATION_CODE_MAP[l.code]]
          ? { classificationId: classifIdMap[CLASSIFICATION_CODE_MAP[l.code]] }
          : {}),
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
    await cloturerBiensFacture(facture)
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

  await cloturerBiensFacture(facture)
  return { invoiceId, invoiceNumber }
}

/**
 * Envoie toutes les factures validÃÂ©es d'un mois vers Evoliz
 * @param {string} mois - YYYY-MM
 */

/**
 * Supprime les brouillons Evoliz d un mois et les repousse (pour rafraichir classifications etc.)
 * Ne touche pas aux factures deja validees/payees dans Evoliz.
 * @param {string} mois - YYYY-MM
 */
export async function refreshFacturesBrouillonsEvoliz(mois) {
  const { data: factures, error } = await supabase
    .from('facture_evoliz')
    .select('id, id_evoliz')
    .eq('mois', mois)
    .eq('statut', 'envoye_evoliz')
    .eq('agence', AGENCE)
    .neq('type_facture', 'com')
    .not('id_evoliz', 'is', null)
    .neq('id_evoliz', 'N/A')

  if (error) throw error

  const results = { deleted: 0, skipped: 0, errors: [] }

  for (const f of (factures || [])) {
    try {
      // Supprimer le brouillon Evoliz (echoue si deja valide/paye -> on skipe)
      await evolizCall('deleteInvoice', { invoiceId: f.id_evoliz })
      // Remettre en 'valide' dans notre DB pour permettre le repush
      await supabase.from('facture_evoliz')
        .update({ statut: 'valide', id_evoliz: null, numero_facture: null })
        .eq('id', f.id)
      results.deleted++
    } catch {
      // Deja valide/paye dans Evoliz ou autre erreur -> ne pas toucher
      results.skipped++
    }
  }

  // Repousser toutes les factures remises en 'valide'
  if (results.deleted > 0) {
    const pushResult = await pousserFacturesMoisVersEvoliz(mois)
    results.pushed = pushResult.pushed
    results.pushErrors = pushResult.errors
  }

  return results
}

export async function pousserFacturesMoisVersEvoliz(mois) {
  const { data: factures, error } = await supabase
    .from('facture_evoliz')
    .select(`
      *,
      proprietaire (id, nom, prenom, email, adresse, ville, code_postal, telephone, iban, id_evoliz, agence),
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

    // 2. Créer la facture (avec articleId et classificationId pour la classification Evoliz)
    const [articleIdMap, classifIdMap] = await Promise.all([getArticleIdMap(), getClassificationIdMap()])
    const comArticleId = articleIdMap['COM']
    const comClassifId = classifIdMap[CLASSIFICATION_CODE_MAP['COM']]
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
        ...(comArticleId ? { articleId: comArticleId } : {}),
        ...(comClassifId ? { classificationId: comClassifId } : {}),
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

// ============================================================
// SETUP CATALOGUE ARTICLES
// ============================================================

const ARTICLES_A_CREER = [
  { reference: 'COM',     designation: 'Commission',                         classifCode: '05', accountCode: '7063' },
  { reference: 'DIV',     designation: 'Frais divers avancés',               classifCode: '06', accountCode: '7065' },
  { reference: 'HAOWNER', designation: 'Achats refacturés propriétaires',    classifCode: '07', accountCode: '7066' },
  { reference: 'HON_ETU', designation: 'Honoraires locations étudiantes',    classifCode: '08', accountCode: '7067' },
  { reference: 'HON_MOB', designation: 'Honoraires contrats mobilité',       classifCode: '09', accountCode: '7068' },
  { reference: 'HON_LLD', designation: 'Honoraires gestion longue durée',    classifCode: '10', accountCode: '7069' },
  { reference: 'FRAIS',   designation: 'Frais divers propriétaire',           classifCode: '02', accountCode: null },
]

/**
 * Crée les articles manquants dans le catalogue Evoliz.
 * À appeler une seule fois depuis la console ou un bouton de setup.
 */
export async function creerArticlesManquantsEvoliz(accountIdOverrides = {}) {
  const [articleIdMap, classifIdMap] = await Promise.all([getArticleIdMap(), getClassificationIdMap()])
  const results = { created: [], skipped: [], errors: [] }

  for (const art of ARTICLES_A_CREER) {
    if (articleIdMap[art.reference]) {
      results.skipped.push(art.reference)
      continue
    }
    const classifId = classifIdMap[art.classifCode]
    // Résoudre accountId : override dynamique (setup complet) ou valeur statique
    const accountId = accountIdOverrides[art.accountCode] ?? art.accountId ?? null
    try {
      await evolizCall('createArticle', {
        reference:           art.reference,
        designation:         art.designation,
        unitPrice:           0,
        vatRate:             20,
        ...(accountId ? { accountingAccountId: accountId } : {}),
        ...(classifId ? { classificationId: classifId } : {}),
        nature:              'service',
      })
      results.created.push(art.reference)
    } catch (err) {
      if (err.message?.includes('already been taken') || err.message?.includes('already taken')) {
        results.skipped.push(art.reference)
      } else {
        results.errors.push({ reference: art.reference, error: err.message })
      }
    }
  }

  // Invalider le cache pour le prochain push
  _articleIdCache = null
  return results
}

// ============================================================
// SETUP COMPLET EVOLIZ (classifications + articles)
// ============================================================

const CLASSIFICATIONS_A_CREER = [
  { code: '01', label: 'Gestion location saisonnière (HON)',        accountCode: '7061', accountLabel: 'Gestion location saisonnière' },
  { code: '04', label: 'Forfait ménage (FMEN)',                     accountCode: '7062', accountLabel: 'Forfait ménage' },
  { code: '05', label: 'Commission (COM)',                          accountCode: '7063', accountLabel: 'Commission' },
  { code: '06', label: 'Frais divers avancés (DIV)',                accountCode: '7065', accountLabel: 'Frais divers avancés' },
  { code: '07', label: 'Achats refacturés propriétaires (HAOWNER)', accountCode: '7066', accountLabel: 'Achats refacturés propriétaires' },
  { code: '08', label: 'Honoraires locations étudiantes (HON_ETU)', accountCode: '7067', accountLabel: 'Honoraires locations étudiantes' },
  { code: '09', label: 'Honoraires contrats mobilité (HON_MOB)',    accountCode: '7068', accountLabel: 'Honoraires contrats mobilité' },
  { code: '10', label: 'Honoraires gestion longue durée (HON_LLD)', accountCode: '7069', accountLabel: 'Honoraires gestion longue durée' },
]

export async function setupEvolizComplet() {
  const results = { comptes: { created: [], skipped: [], errors: [] }, classifs: { created: [], skipped: [], errors: [] }, articles: null }

  // 1. Créer les comptes comptables si nécessaire et récupérer leurs IDs locaux
  const accountIdByCode = {}
  for (const c of CLASSIFICATIONS_A_CREER) {
    if (!c.accountCode) continue
    try {
      const created = await evolizCall('createAccount', { code: c.accountCode, label: c.accountLabel })
      accountIdByCode[c.accountCode] = created?.accountid
      results.comptes.created.push(c.accountCode)
    } catch (err) {
      if (err.message?.includes('already been taken') || err.message?.includes('already taken') || err.message?.includes('already exists')) {
        // Compte existant — chercher son ID via getAccounts
        try {
          const existing = await evolizCall('getAccounts', { search: c.accountCode })
          const found = (existing?.data || []).find(a => a.code === c.accountCode)
          if (found) accountIdByCode[c.accountCode] = found.accountid
        } catch { /* ignore */ }
        results.comptes.skipped.push(c.accountCode)
      } else {
        results.comptes.errors.push({ code: c.accountCode, error: err.message })
      }
    }
  }

  // 2. Créer les classifications manquantes avec les IDs locaux
  _classifIdCache = null
  const existingClassifs = await getClassificationIdMap()
  for (const c of CLASSIFICATIONS_A_CREER) {
    if (existingClassifs[c.code]) { results.classifs.skipped.push(c.code); continue }
    const accountId = c.accountCode ? accountIdByCode[c.accountCode] : null
    try {
      await evolizCall('createClassification', { code: c.code, label: c.label, ...(accountId ? { accountId } : {}) })
      results.classifs.created.push(c.code)
    } catch (err) {
      if (err.message?.includes('already been taken') || err.message?.includes('already taken')) {
        results.classifs.skipped.push(c.code)
      } else {
        results.classifs.errors.push({ code: c.code, error: err.message })
      }
    }
  }

  // Invalider les caches
  _classifIdCache = null
  _articleIdCache = null

  // 3. Créer les articles manquants (avec IDs comptes locaux)
  results.articles = await creerArticlesManquantsEvoliz(accountIdByCode)

  // Exposer les IDs comptables résolus (pour renseigner ACCOUNT_MAP, ex. HON_LLD → 7069)
  results.accountIds = accountIdByCode

  return results
}
