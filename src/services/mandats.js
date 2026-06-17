import { supabase } from '../lib/supabase'
import { AGENCE } from '../lib/agence'
import { authPost } from '../lib/authFetch'

// API PowerHouse (génération PDF + envoi mandat signable)
const PLANNING_API = import.meta.env.VITE_PLANNING_API || 'https://dcb-planning.vercel.app'

// ── Mandats signables PAR BIEN (table mandat_signature) ──────────────────────
export async function getMandatsSignature(proprietaireId) {
  const { data, error } = await supabase
    .from('mandat_signature')
    .select('id, bien_id, numero, statut, pdf_draft_url, pdf_signed_url, sent_at, signed_at, sign_token, updated_at')
    .eq('proprietaire_id', proprietaireId)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function genererMandatSignature(bien_id, config = {}) {
  const { ok, data } = await authPost(`${PLANNING_API}/api/generate-mandat`, { bien_id, config, regenerate: true })
  if (!ok) throw new Error(data?.error || 'Erreur lors de la génération du mandat')
  return data
}

export async function envoyerMandatSignature(mandat_id) {
  const { ok, data } = await authPost(`${PLANNING_API}/api/mandat-send`, { mandat_id })
  if (!ok) throw new Error(data?.error || "Erreur lors de l'envoi du mandat")
  return data
}

// Associer un mandat déjà signé (papier / ancien) à un bien : upload du PDF + ligne signée.
export async function importerMandatSigne({ bien_id, proprietaire_id, file, date_signature }) {
  if (!file) throw new Error('Aucun fichier')
  const ext = (file.name.split('.').pop() || 'pdf').toLowerCase()
  const path = `${proprietaire_id}/${bien_id}/import-${Date.now()}.${ext}`
  const up = await supabase.storage.from('mandats').upload(path, file, { upsert: true, contentType: file.type || 'application/pdf' })
  if (up.error) throw up.error
  const { data: signed } = await supabase.storage.from('mandats').createSignedUrl(path, 365 * 24 * 3600)
  const { error } = await supabase.from('mandat_signature').insert({
    agence: AGENCE,
    bien_id,
    proprietaire_id,
    statut: 'signe',
    signed_at: date_signature ? new Date(date_signature).toISOString() : new Date().toISOString(),
    pdf_signed_url: signed?.signedUrl || null,
    config: { _origine: 'import_manuel' },
  })
  if (error) throw error
}

export async function getProprietairesComplets() {
  const { data, error } = await supabase
    .from('proprietaire')
    .select(`
      *,
      bien!proprietaire_id(id, code, hospitable_name, listed, agence),
      mandat_gestion(*),
      owner_profile_config(profil),
      owner_requests(id, statut)
    `)
    .eq('agence', AGENCE)
    .order('nom')
  if (error) throw error

  // Filtre côté client : bien et mandat_gestion par agence courante
  return (data || []).map(p => ({
    ...p,
    bien:           (p.bien           || []).filter(b => b.agence === AGENCE),
    mandat_gestion: (p.mandat_gestion || []).filter(m => m.agence === AGENCE),
  }))
}

export async function updateProprietaire(id, payload) {
  const { error } = await supabase.from('proprietaire').update(payload).eq('id', id)
  if (error) throw error
}

export async function creerMandat(payload) {
  const { data, error } = await supabase
    .from('mandat_gestion')
    .insert({ ...payload, agence: AGENCE })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateMandat(id, payload) {
  const { error } = await supabase.from('mandat_gestion').update(payload).eq('id', id)
  if (error) throw error
}

export async function supprimerMandat(id) {
  const { error } = await supabase.from('mandat_gestion').delete().eq('id', id)
  if (error) throw error
}
