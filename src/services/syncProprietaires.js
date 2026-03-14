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
  // 1. Récupérer tous les clients Evoliz (paginé)
  let allClients = []
  let page = 1
  while (true) {
    const data = await evolizCall('listClients', { page, per_page: 100 })
    const clients = data?.data || data || []
    if (!Array.isArray(clients) || clients.length === 0) break
    allClients = allClients.concat(clients)
    if (clients.length < 100) break
    page++
  }

  if (allClients.length === 0) {
    throw new Error('Aucun client retourné par Evoliz — vérifier les clés API')
  }

  // 2. Préparer les lignes à upsert
  const rows = allClients
    .filter(c => !c.disabled)
    .map(c => {
      // Evoliz retourne : clientid, name, civility, type, address{addr, postcode, town}, phones, emails
      const name = c.name || ''
      const parts = name.trim().split(/\s+/)
      let nom = name.trim()
      let prenom = null

      // Si particulier, essayer de séparer NOM Prénom
      if (c.type === 'Particulier' && parts.length >= 2) {
        // Convention Evoliz : NOM Prénom (NOM en MAJ ou premier mot)
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
      const email = (c.emails && c.emails[0]?.email) || null
      const tel = (c.phones && (c.phones.find(p => p.type === 'mobile') || c.phones[0])?.phone) || null

      return {
        id_evoliz: String(c.clientid),
        nom: nom.trim(),
        prenom: prenom?.trim() || null,
        email,
        telephone: tel,
        adresse: addr.addr || null,
        code_postal: addr.postcode || null,
        ville: addr.town || null,
        pays: 'France',
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
