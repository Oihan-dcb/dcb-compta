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
  let entries = data || []

  // Merger import_log si catégorie = '' ou 'import'
  if (!categorie || categorie === 'import') {
    let ilQuery = supabase
      .from('import_log')
      .select('*')
      .order('created_at', { ascending: false })
      .range(0, limit - 1)
    if (mois) ilQuery = ilQuery.eq('mois_concerne', mois)
    const { data: importLogs } = await ilQuery
    const importEntries = (importLogs || []).map(r => ({
      id: 'il-' + r.id,
      created_at: r.created_at,
      categorie: 'import',
      action: r.type || 'import',
      statut: r.statut === 'error' ? 'error' : r.statut === 'partial' ? 'warning' : 'ok',
      source: 'import',
      message: r.message || r.type,
      mois_comptable: r.mois_concerne,
      meta: r,
      reservation: null,
      bien: null,
    }))
    entries = [...entries, ...importEntries]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit)
  }

  return entries
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
