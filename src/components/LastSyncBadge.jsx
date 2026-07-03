import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Badge « ⏱ Dernier sync » — dernière exécution (cron nightly ou clic manuel) d'un
 * type d'import_log. À placer à côté de tout bouton doublé par un cron journalier
 * (Sync Airbnb → 'airbnb_payouts', Sync Hospitable → 'hospitable_reservations').
 * `refreshKey` : changer sa valeur force un rechargement (ex. après un sync manuel).
 */
export default function LastSyncBadge({ type, refreshKey }) {
  const [last, setLast] = useState(null)

  useEffect(() => {
    let alive = true
    supabase
      .from('import_log')
      .select('created_at, statut, message')
      .eq('type', type)
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => { if (alive) setLast(data?.[0] || null) })
    return () => { alive = false }
  }, [type, refreshKey])

  if (!last) return null
  const d = new Date(last.created_at)
  const quand = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
    + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

  return (
    <span title={last.message || ''} style={{ fontSize: 11, color: last.statut === 'success' ? '#8C7B65' : '#B45309', whiteSpace: 'nowrap' }}>
      ⏱ Dernier sync : {quand}
    </span>
  )
}
