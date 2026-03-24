/**
 * Service journal des opérations — traçabilité NF
 * Toutes les opérations métier significatives sont loggées ici
 */
import { supabase } from '../lib/supabase'

/**
 * Ajoute une entrée dans le journal
 */
export async function logOp({
  categorie,  // ventilation | rapprochement | import | webhook | facture | correction
  action,     // create | update | delete | validate | cancel | link | unlink | compute
  statut = 'ok', // ok | error | warning
  mois_comptable,
  reservation_id,
  bien_id,
  mouvement_id,
  proprietaire_id,
  source = 'app', // app | webhook | cron | import | manual
  message,
  avant,
  apres,
  meta,
}) {
  const { error } = await supabase.from('journal_ops').insert({
    categorie, action, statut,
    mois_comptable, reservation_id, bien_id, mouvement_id, proprietaire_id,
    source, message, avant, apres, meta,
  })
  if (error) console.error('journal_ops insert error:', error)
}

/**
 * Récupère les entrées du journal avec filtres
 */
export async function getJournal({
  mois,
  categorie,
  reservation_id,
  bien_id,
  source,
  limit = 100,
  offset = 0,
} = {}) {
  let query = supabase
    .from('journal_ops')
    .select(`
      *,
      reservation:reservation_id (code, guest_name, platform),
      bien:bien_id (code, hospitable_name)
    `)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (mois)           query = query.eq('mois_comptable', mois)
  if (categorie)      query = query.eq('categorie', categorie)
  if (reservation_id) query = query.eq('reservation_id', reservation_id)
  if (bien_id)        query = query.eq('bien_id', bien_id)
  if (source)         query = query.eq('source', source)

  const { data, error } = await query
  if (error) throw error
  return data || []
}

/**
 * Compte les entrées par catégorie pour un mois
 */
export async function getJournalStats(mois) {
  const { data, error } = await supabase
    .from('journal_ops')
    .select('categorie, action, statut')
    .eq('mois_comptable', mois)

  if (error) throw error
  if (!data?.length) return {}

  return data.reduce((acc, row) => {
    const key = row.categorie
    if (!acc[key]) acc[key] = { total: 0, ok: 0, warning: 0, error: 0 }
    acc[key].total++
    acc[key][row.statut] = (acc[key][row.statut] || 0) + 1
    return acc
  }, {})
}
