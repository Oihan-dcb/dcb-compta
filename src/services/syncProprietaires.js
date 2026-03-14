import { supabase } from '../lib/supabase'

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
 * Synchronise les clients Evoliz → table proprietaire
 * Crée les nouveaux, met à jour les existants (par id_evoliz)
 */
export async function syncProprietairesEvoliz() {
  // 1. Récupérer tous les clients Evoliz avec pagination
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

  // Dédupliquer par clientid (sécurité si pagination retourne des doublons)
  const seen = new Set()
  allClients = allClients.filter(c => {
    if (seen.has(c.clientid)) return false
    seen.add(c.clientid)
    return true
  })

  // 2. Préparer les lignes à upsert
  // Structure Evoliz : { clientid, name, civility, type, mobile, phone, address:{addr, postcode, town}, enabled }
  const rows = allClients
    .filter(c => c.enabled !== false)
    .map(c => {
      const name = (c.name || '').trim()
      const parts = name.split(/\s+/)
      let nom = name
      let prenom = null

      if (c.type === 'Particulier' && parts.length >= 2) {
        const upperParts = parts.filter(p => p === p.toUpperCase() && p.length > 1)
        const mixedParts = parts.filter(p => p !== p.toUpperCase() || p.length <= 1)
        if (upperParts.length > 0 && mixedParts.length > 0) {
          nom = upperParts.join(' ')
          prenom = mixedParts.join(' ')
        } else {
          nom = parts[parts.length - 1]
          prenom = parts.slice(0, -1).join(' ')
        }
      }

      const addr = c.address || {}
      // Evoliz v1 : mobile, phone directs (pas de tableau phones/emails)
      const tel = (c.mobile || c.phone || '').trim() || null
      const email = (c.email || '').trim() || null

      return {
        id_evoliz: String(c.clientid),
        nom: nom.trim(),
        prenom: prenom?.trim() || null,
        email: email || null,
        telephone: tel,
        adresse: addr.addr || null,
        code_postal: addr.postcode || null,
        ville: addr.town || null,
        pays: addr.country?.label || 'France',
        actif: true,
      }
    })

  // 3. Upsert en base par id_evoliz
  const { error, count } = await supabase
    .from('proprietaire')
    .upsert(rows, { onConflict: 'id_evoliz', ignoreDuplicates: false })
    .select('id', { count: 'exact', head: true })

  if (error) throw new Error(`Erreur upsert: ${error.message}`)

  return {
    total_evoliz: allClients.length,
    synced: rows.length,
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
    .order('nom')
  if (error) throw error
  return data || []
}
