import { supabase } from '../lib/supabase'
import { AGENCE } from '../lib/agence'
import { planifierSynchro, emailDepuisClientEvoliz, CHAMPS_SYNC } from './proprietaireSyncCore'

const EVOLIZ_COMPANY_ID = parseInt(import.meta.env.VITE_EVOLIZ_COMPANY_ID || '114158')

/**
 * Appelle la Edge Function evoliz-proxy via supabase.functions.invoke
 * (évite les problèmes CORS et de variables d'env)
 */
async function evolizCall(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('evoliz-proxy', {
    body: { action, companyId: EVOLIZ_COMPANY_ID, payload },
  })
  if (error) throw new Error(`Evoliz proxy error: ${error.message}`)
  return data
}

/**
 * Synchronise les clients Evoliz → table proprietaire.
 *
 * La logique de fusion vit dans proprietaireSyncCore.js (partagée avec le cron
 * api/sync-proprietaires.js) : complète les champs vides, ne remplace un champ que s'il a
 * changé chez Evoliz depuis la dernière synchro, ne touche jamais actif/agence, bloque les
 * homonymes (garde-fou anti-doublon du 05/08/2026) — I-148, 24/09/2026. Avant, cette version
 * faisait un upsert onConflict id_evoliz qui réécrivait toute la fiche (actif=true compris).
 */
export async function syncProprietairesEvoliz() {
  // 1. Tous les clients Evoliz (pagination)
  // Structure réponse : { status, data: { data: [...], meta: { last_page, total }, links } }
  let allClients = []
  let page = 1
  while (true) {
    const resp = await evolizCall('listClients', { page })
    const clients = resp?.data?.data
    if (!Array.isArray(clients) || clients.length === 0) break
    allClients = allClients.concat(clients)
    const lastPage = resp?.data?.meta?.last_page || 1
    if (page >= lastPage) break
    page++
  }
  if (allClients.length === 0) {
    throw new Error('Aucun client retourné par Evoliz — vérifier les clés API')
  }
  const seen = new Set()
  allClients = allClients.filter(c => {
    if (seen.has(c.clientid)) return false
    seen.add(c.clientid)
    return true
  })

  // 2. Fiches existantes (agence courante) + id_evoliz des autres agences (contrainte UNIQUE globale)
  const { data: existingProps, error: e0 } = await supabase
    .from('proprietaire')
    .select(`id, nom, prenom, id_evoliz, email, actif, duplicate_of_id, evoliz_snapshot, ${CHAMPS_SYNC.join(', ')}`)
    .eq('agence', AGENCE)
  if (e0) throw e0
  const { data: autres, error: e00 } = await supabase
    .from('proprietaire').select('id_evoliz').neq('agence', AGENCE).not('id_evoliz', 'is', null)
  if (e00) throw e00

  const actifsEvoliz = allClients.filter(c => c.enabled !== false)
  const { inserts, updates, collisions } = planifierSynchro(
    actifsEvoliz, existingProps || [], new Set((autres || []).map(p => p.id_evoliz)), AGENCE)

  // 3. Écritures
  if (inserts.length) {
    const { error: e1 } = await supabase.from('proprietaire').insert(inserts)
    if (e1) throw new Error(`Erreur insert: ${e1.message}`)
  }
  let erreurs = 0
  for (const u of updates) {
    const { error: e2 } = await supabase.from('proprietaire').update(u.patch).eq('id', u.id)
    if (e2) { erreurs++; console.warn('syncProprietaires update:', e2.message) }
  }

  // 4. Emails manquants : getClient (listClients ne les renvoie pas)
  let emailsCompletes = 0
  const sansEmail = (existingProps || []).filter(p => p.id_evoliz && !p.email && p.actif && !p.duplicate_of_id).slice(0, 25)
  for (const p of sansEmail) {
    try {
      const resp = await evolizCall('getClient', { clientId: p.id_evoliz })
      const email = emailDepuisClientEvoliz(resp?.data)
      if (email) {
        const { error: e3 } = await supabase.from('proprietaire').update({ email }).eq('id', p.id).is('email', null)
        if (!e3) emailsCompletes++
      }
    } catch (e) { console.warn('syncProprietaires getClient:', p.id_evoliz, e.message) }
  }

  return {
    total_evoliz: allClients.length,
    synced: actifsEvoliz.length,
    created: inserts.length,
    updated: updates.length,
    erreurs,
    emails_completes: emailsCompletes,
    collisions,
  }
}

/**
 * Récupère les propriétaires depuis la base (avec cache)
 */
export async function getProprietaires() {
  const { data, error } = await supabase
    .from('proprietaire')
    .select('*')
    .eq('actif', true)
    .eq('agence', AGENCE)
    .is('duplicate_of_id', null) // fiches fusionnées : jamais proposées au rattachement (I-148)
    .order('nom')
  if (error) throw error
  return data || []
}
