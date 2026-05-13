import { supabase } from '../lib/supabase'

// Étapes dans l'ordre séquentiel obligatoire
export const ETAPES = [
  { id: 'ventil',   label: 'Ventilation',    desc: 'Bloque sync webhooks, reventilation, import CSV' },
  { id: 'rappro',   label: 'Rapprochement',  desc: 'Bloque mouvements bancaires et rapprochements' },
  { id: 'facturat', label: 'Facturation',    desc: 'Bloque prestations AE et push Evoliz' },
]

// ── Lecture ───────────────────────────────────────────────────────────────────

export async function getAllClotures() {
  const { data } = await supabase
    .from('cloture_comptable')
    .select('*')
    .order('mois', { ascending: false })
  return data || []
}

export async function getCloture(mois, agence) {
  const { data } = await supabase
    .from('cloture_comptable')
    .select('*')
    .eq('mois', mois)
    .eq('agence', agence)
    .maybeSingle()
  return data || null
}

// Vérification rapide (pour les autres pages avant écriture)
export async function isMoisCloture(mois, agence, etape = 'ventil') {
  const c = await getCloture(mois, agence)
  return !!(c && c[`cloture_${etape}`])
}

export function isEtapeCloturee(cloture, etape) {
  return !!(cloture && cloture[`cloture_${etape}`])
}

// ── Audit ─────────────────────────────────────────────────────────────────────

export async function getAuditLog(limit = 50) {
  const { data } = await supabase
    .from('cloture_audit')
    .select('*')
    .order('at', { ascending: false })
    .limit(limit)
  return data || []
}

// ── Webhooks en attente ────────────────────────────────────────────────────────

export async function getWebhooksPending() {
  const { data } = await supabase
    .from('webhook_pending')
    .select('*')
    .is('treated_at', null)
    .order('received_at', { ascending: false })
  return data || []
}

export async function marquerWebhookTraite(id, actionTaken, treatedBy) {
  await supabase
    .from('webhook_pending')
    .update({ treated_at: new Date().toISOString(), treated_by: treatedBy, action_taken: actionTaken })
    .eq('id', id)
}

// ── Écriture ──────────────────────────────────────────────────────────────────

export async function cloturerEtape(mois, agence, etape, userEmail, note = '') {
  // Vérifier la séquence : rappro nécessite ventil, facturat nécessite rappro
  const current = await getCloture(mois, agence)
  const idx = ETAPES.findIndex(e => e.id === etape)
  if (idx > 0) {
    const etapePrecedente = ETAPES[idx - 1].id
    if (!isEtapeCloturee(current, etapePrecedente)) {
      throw new Error(`Impossible : clôturer d'abord l'étape "${ETAPES[idx - 1].label}"`)
    }
  }

  const now = new Date().toISOString()
  const row = { mois, agence, cloture_by: userEmail }
  row[`cloture_${etape}`] = now

  const { error } = await supabase
    .from('cloture_comptable')
    .upsert(row, { onConflict: 'mois,agence' })

  if (error) throw new Error('Erreur clôture : ' + JSON.stringify(error))

  await supabase.from('cloture_audit').insert({
    mois, agence,
    action: `cloture_${etape}`,
    by: userEmail,
    note: note || null,
  })
}

export async function rouvrirEtape(mois, agence, etape, userEmail, note) {
  if (!note?.trim()) throw new Error('Une note est obligatoire pour rouvrir')

  // Vérifier la séquence inverse : ne pas rouvrir ventil si rappro est encore fermé
  const current = await getCloture(mois, agence)
  const idx = ETAPES.findIndex(e => e.id === etape)
  if (idx < ETAPES.length - 1) {
    const etapeSuivante = ETAPES[idx + 1].id
    if (isEtapeCloturee(current, etapeSuivante)) {
      throw new Error(`Impossible : rouvrir d'abord l'étape "${ETAPES[idx + 1].label}"`)
    }
  }

  // Append dans reouvertures (ne jamais écraser)
  const reouvertures = [...(current?.reouvertures || []), {
    etape, at: new Date().toISOString(), by: userEmail, note,
  }]

  const update = { reouvertures, cloture_by: userEmail }
  update[`cloture_${etape}`] = null

  const { error } = await supabase
    .from('cloture_comptable')
    .update(update)
    .eq('mois', mois)
    .eq('agence', agence)

  if (error) throw new Error('Erreur réouverture : ' + JSON.stringify(error))

  await supabase.from('cloture_audit').insert({
    mois, agence,
    action: `reouverture_${etape}`,
    by: userEmail,
    note,
  })
}
