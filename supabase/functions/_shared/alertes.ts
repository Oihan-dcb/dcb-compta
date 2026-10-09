/**
 * Alertes compta — mémoire partagée + destinataires centralisés (audit des mails, 09/10/2026).
 *
 * Avant : chaque alerte-* envoyait chaque matin la liste COMPLÈTE par mail (55 mails pour 6
 * contenus distincts sur booking-platform, 19 fois la même ligne pour virement-orphelin…), à des
 * adresses codées en dur (dont lauracoursan@hotmail.fr).
 *
 * Désormais : chaque contrôle publie sa liste complète dans alerte_etat via alerte_signaler()
 * (migration 371) — nouveau → ligne créée, toujours présent → last_seen, disparu → clôturé —
 * et SEUL le Point du matin (edge function point-du-matin, 08:00 Paris) écrit aux humains.
 */
// deno-lint-ignore no-explicit-any
type Supa = any

export type ItemAlerte = {
  cle: string                 // identifiant STABLE de l'anomalie dans sa source (ex. 'resa:HOST-AX90XD')
  libelle: string             // une ligne lisible, montant compris si utile
  montant_cts?: number | null // pour trier et pour le seuil week-end
  detail?: Record<string, unknown>
}

/** Publie la liste complète d'une source (une agence). complet=false : ne clôture pas les absents. */
export async function signaler(supabase: Supa, source: string, agence: string, items: ItemAlerte[], complet = true) {
  const { data, error } = await supabase.rpc('alerte_signaler', {
    p_source: source, p_agence: agence, p_items: items, p_complet: complet,
  })
  if (error) throw new Error(`alerte_signaler(${source}/${agence}) : ${error.message}`)
  return data as { nouveaux: number; maj: number; resolus: number }
}

/** Adresses d'un rôle (notification_destinataire). Repli unique si la table est illisible. */
export async function destinataires(supabase: Supa, role: string, agence = '*'): Promise<string[]> {
  const { data, error } = await supabase.rpc('destinataires', { p_role: role, p_agence: agence })
  if (!error && Array.isArray(data) && data.length) return data
  console.error(`[destinataires] ${role}/${agence} : ${error?.message || 'aucune adresse'} — repli`)
  return ['oihan@destinationcotebasque.com'] // seul repli codé en dur (table illisible)
}

export function fmtEur(cts: number | null | undefined) {
  if (cts == null) return '—'
  return (cts / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

export function fmtDateFr(iso: string | null | undefined) {
  if (!iso) return '—'
  const [y, m, d] = String(iso).slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}
