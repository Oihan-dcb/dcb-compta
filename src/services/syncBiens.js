/**
 * Service de synchronisation des biens Hospitable → Supabase
 * Appelé au démarrage de l'app et via le bouton "Synchroniser"
 */

import { supabase } from '../lib/supabase'
import { fetchProperties } from '../lib/hospitable'

/**
 * Synchronise les biens Hospitable dans la table `bien`
 * Crée les nouveaux biens, met à jour les existants
 * Ne supprime jamais un bien (désactivation uniquement)
 *
 * @returns {Promise<{created: number, updated: number, total: number}>}
 */
export async function syncBiens() {
  const log = { created: 0, updated: 0, errors: 0, total: 0 }

  try {
    // 1. Récupérer tous les biens depuis Hospitable
    const properties = await fetchProperties()
    log.total = properties.length

    // 2. Récupérer les biens existants dans Supabase
    const { data: existingBiens } = await supabase
      .from('bien')
      .select('id, hospitable_id, listed')

    const existingMap = new Map(
      (existingBiens || []).map(b => [b.hospitable_id, b])
    )

    // 3. Préparer les upserts
    const toUpsert = properties.map(prop => ({
      hospitable_id: prop.id,
      hospitable_name: prop.name || prop.public_name,
      code: extractCode(prop.name),
      adresse: prop.address?.display,
      ville: prop.address?.city,
      timezone: prop.timezone,
      currency: prop.currency || 'EUR',
      listed: prop.listed !== false,
      derniere_sync: new Date().toISOString(),
    }))

    // 4. Upsert dans Supabase (conflit sur hospitable_id)
    const { data: upserted, error } = await supabase
      .from('bien')
      .upsert(toUpsert, {
        onConflict: 'hospitable_id',
        ignoreDuplicates: false,
      })
      .select('id, hospitable_id')

    if (error) throw error

    // Compter créations vs mises à jour
    for (const prop of properties) {
      if (existingMap.has(prop.id)) {
        log.updated++
      } else {
        log.created++
      }
    }

    // 5. Logger la sync
    await supabase.from('import_log').insert({
      type: 'hospitable_properties',
      statut: 'success',
      nb_lignes_traitees: log.total,
      nb_lignes_creees: log.created,
      nb_lignes_mises_a_jour: log.updated,
      message: `Sync biens OK — ${log.created} créés, ${log.updated} mis à jour`,
    })

    return log
  } catch (err) {
    console.error('Erreur sync biens:', err)

    await supabase.from('import_log').insert({
      type: 'hospitable_properties',
      statut: 'error',
      nb_erreurs: 1,
      message: err.message,
    } catch (_) {}

    throw err
  }
}

/**
 * Extrait un code court depuis le nom Hospitable
 * ex: '602 "Horizonte"' → '602'
 * ex: 'CERES' → 'CERES'
 * ex: 'Chambre Pantxika - Maison Maïté' → 'PANTXIKA'
 */
function extractCode(name) {
  if (!name) return null

  // Si commence par un nombre → utiliser ce nombre
  const numMatch = name.match(/^(\d+)/)
  if (numMatch) return numMatch[1]

  // Prendre le premier mot en majuscules
  const words = name.split(/[\s\-–_"«»]+/)
  const firstMeaningful = words.find(w => w.length > 2) || words[0]
  return firstMeaningful?.toUpperCase() || null
}

/**
 * Récupère tous les biens depuis Supabase (avec leur proprio)
 */
export async function getBiens() {
  const { data, error } = await supabase
    .from('bien')
    .select(`
      *,
      proprietaire (
        id, nom, prenom, email, iban, id_evoliz
      )
    `)
    .eq('listed', true)
    .order('hospitable_name')

  if (error) throw error
  return data || []
}

/**
 * Met à jour les paramètres ménage d'un bien
 */
export async function updateBienMenage(bienId, { hasAe, provisionAeRef, forfaitDcbRef }) {
  const { error } = await supabase
    .from('bien')
    .update({
      has_ae: hasAe,
      provision_ae_ref: provisionAeRef,
      forfait_dcb_ref: forfaitDcbRef,
    })
    .eq('id', bienId)

  if (error) throw error
}
