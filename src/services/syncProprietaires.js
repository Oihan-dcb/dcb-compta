import { supabase } from '../lib/supabase'
import { AGENCE } from '../lib/agence'

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
 * Normalise un nom pour comparaison ("Hélène ELISSALT" == "elissalt   helene")
 * — même logique que syncBiens.js (accents, casse, ponctuation, espaces).
 */
function normalizeName(nom, prenom) {
  const s = `${nom || ''} ${prenom || ''}`
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Synchronise les clients Evoliz → table proprietaire
 * Crée les nouveaux, met à jour les existants (par id_evoliz)
 *
 * Garde-fou anti-doublon (2026-08-05, même incident-type que Villa Bacalan) :
 * une fiche proprietaire créée à la main (id_evoliz NULL — cas d'un propriétaire
 * pas encore facturé via Evoliz) qui apparaît ensuite comme client réel côté
 * Evoliz arriverait avec un id_evoliz inconnu → sans vérification elle serait
 * créée en doublon au lieu de compléter la fiche existante. On détecte ce cas
 * par nom normalisé ou email identique à une fiche existante de la même agence,
 * et on NE crée PAS : la collision est remontée pour résolution manuelle
 * (lier l'id_evoliz à la fiche existante).
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
      // Evoliz v1 : mobile, phone directs — mais PAS d'email sur l'objet client
      // (l'email vit dans /clients/{id}/contacts, pas dans listClients). Ne
      // jamais inclure `email` dans les lignes synchronisées ici : ça écraserait
      // à null l'email saisi à la main dans DCB Compta à chaque sync (bug
      // corrigé 2026-08-05 — cf. syncDepuisEvoliz dans PageProprietaires.jsx
      // pour le seul cas où l'email Evoliz est réellement récupéré, via getClient).
      const tel = (c.mobile || c.phone || '').trim() || null

      return {
        id_evoliz: String(c.clientid),
        nom: nom.trim(),
        prenom: prenom?.trim() || null,
        telephone: tel,
        adresse: addr.addr || null,
        code_postal: addr.postcode || null,
        ville: addr.town || null,
        pays: addr.country?.label || 'France',
        actif: true,
        agence: AGENCE,
      }
    })

  // 3. Récupérer les fiches existantes de l'agence pour détecter les collisions
  const { data: existingProps } = await supabase
    .from('proprietaire')
    .select('id, nom, prenom, id_evoliz')
    .eq('agence', AGENCE)

  const existingByEvolizId = new Map(
    (existingProps || []).filter(p => p.id_evoliz).map(p => [p.id_evoliz, p])
  )
  const existingByName = new Map(
    (existingProps || []).map(p => [normalizeName(p.nom, p.prenom), p])
  )

  const existants = rows.filter(r => existingByEvolizId.has(r.id_evoliz))
  const candidatsNouveaux = rows.filter(r => !existingByEvolizId.has(r.id_evoliz))

  const nouveaux = []
  const collisions = []
  for (const r of candidatsNouveaux) {
    const match = existingByName.get(normalizeName(r.nom, r.prenom))
    if (match) {
      collisions.push({
        nom: r.nom, prenom: r.prenom,
        id_evoliz_nouveau: r.id_evoliz,
        proprietaire_existant_id: match.id,
        proprietaire_existant_nom: `${match.nom} ${match.prenom || ''}`.trim(),
      })
    } else {
      nouveaux.push(r)
    }
  }

  // 4. Insert des nouveaux (jamais de collision) + update des existants (par id_evoliz)
  if (nouveaux.length) {
    const { error: e1 } = await supabase.from('proprietaire').insert(nouveaux)
    if (e1) throw new Error(`Erreur insert: ${e1.message}`)
  }
  if (existants.length) {
    const { error: e2 } = await supabase
      .from('proprietaire')
      .upsert(existants, { onConflict: 'id_evoliz', ignoreDuplicates: false })
    if (e2) throw new Error(`Erreur upsert: ${e2.message}`)
  }

  return {
    total_evoliz: allClients.length,
    synced: rows.length,
    created: nouveaux.length,
    updated: existants.length,
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
    .order('nom')
  if (error) throw error
  return data || []
}
