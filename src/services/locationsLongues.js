import { supabase } from '../lib/supabase'
import { AGENCE } from '../lib/agence'

// ── Étudiants ──────────────────────────────────────────────────────────────

export async function listerEtudiants(agence = AGENCE, statut = null) {
  let q = supabase
    .from('etudiant')
    .select('*, bien (id, code, hospitable_name), proprietaire (id, nom, prenom)')
    .eq('agence', agence)
    .order('nom')
  if (statut) q = q.eq('statut', statut)
  const { data, error } = await q
  if (error) throw error
  return data
}

export async function creerEtudiant(payload) {
  const { data, error } = await supabase
    .from('etudiant')
    .insert(payload)
    .select()
    .single()
  if (error) throw error
  // Créer automatiquement la caution_suivi associée
  await supabase.from('caution_suivi').insert({
    agence:      payload.agence || AGENCE,
    etudiant_id: data.id,
    statut:      'en_cours',
  })
  return data
}

export async function modifierEtudiant(id, payload) {
  const { error } = await supabase
    .from('etudiant')
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// ── Montants dérivés ───────────────────────────────────────────────────────

export function montantTotalEtudiant(e) {
  return (e.loyer_nu || 0) + (e.supplement_loyer || 0) +
         (e.charges_eau || 0) + (e.charges_copro || 0) + (e.charges_internet || 0)
}

export function montantVirementProprio(e) {
  return montantTotalEtudiant(e) - (e.honoraires_dcb || 0)
}

// ── Loyers du mois ────────────────────────────────────────────────────────

export async function listerLoyersMois(mois, agence = AGENCE) {
  const { data, error } = await supabase
    .from('loyer_suivi')
    .select('*, etudiant (id, nom, prenom, email, telephone, loyer_nu, supplement_loyer, charges_eau, charges_copro, charges_internet, honoraires_dcb, bien_id, proprietaire_id, jour_paiement_attendu, bien (code))')
    .eq('agence', agence)
    .eq('mois', mois)
    .order('created_at')
  if (error) throw error
  return data
}

export async function initialiserLoyersMois(mois, agence = AGENCE) {
  // Récupérer tous les étudiants actifs
  const etudiants = await listerEtudiants(agence, 'actif')
  if (!etudiants.length) return []

  // Upsert loyer_suivi pour chaque étudiant actif
  const rows = etudiants.map(e => ({
    agence,
    etudiant_id: e.id,
    mois,
    statut: 'attendu',
  }))

  const { error } = await supabase
    .from('loyer_suivi')
    .upsert(rows, { onConflict: 'etudiant_id,mois', ignoreDuplicates: true })
  if (error) throw error

  // Upsert virement_proprio_suivi
  const virements = etudiants.map(e => ({
    agence,
    etudiant_id: e.id,
    mois,
    statut:  'a_virer',
    montant: montantVirementProprio(e),
  }))
  const { error: errVir } = await supabase
    .from('virement_proprio_suivi')
    .upsert(virements, { onConflict: 'etudiant_id,mois', ignoreDuplicates: true })
  if (errVir) throw errVir

  return listerLoyersMois(mois, agence)
}

export async function marquerLoyerRecu(id, { montant_recu, date_reception }) {
  const { error } = await supabase
    .from('loyer_suivi')
    .update({ statut: 'recu', montant_recu, date_reception })
    .eq('id', id)
  if (error) throw error
}

export async function marquerLoyerStatut(id, statut) {
  const { error } = await supabase
    .from('loyer_suivi')
    .update({ statut })
    .eq('id', id)
  if (error) throw error
}

// ── Virements proprio ─────────────────────────────────────────────────────

export async function listerVirementsMois(mois, agence = AGENCE) {
  const { data, error } = await supabase
    .from('virement_proprio_suivi')
    .select('*, etudiant (id, nom, prenom, loyer_nu, supplement_loyer, charges_eau, charges_copro, charges_internet, honoraires_dcb, proprietaire (nom, prenom))')
    .eq('agence', agence)
    .eq('mois', mois)
    .order('created_at')
  if (error) throw error
  return data
}

export async function marquerVirementEffectue(id, date_virement) {
  const { error } = await supabase
    .from('virement_proprio_suivi')
    .update({ statut: 'vire', date_virement })
    .eq('id', id)
  if (error) throw error
}

// ── Caution ───────────────────────────────────────────────────────────────

export async function getCautionEtudiant(etudiant_id) {
  const { data, error } = await supabase
    .from('caution_suivi')
    .select('*')
    .eq('etudiant_id', etudiant_id)
    .single()
  if (error && error.code !== 'PGRST116') throw error
  return data
}

export async function mettreAJourCaution(id, payload) {
  const { error } = await supabase
    .from('caution_suivi')
    .update(payload)
    .eq('id', id)
  if (error) throw error
}

// ── Documents étudiant ────────────────────────────────────────────────────

export async function listerDocuments(etudiantId) {
  const { data, error } = await supabase
    .from('etudiant_document')
    .select('*')
    .eq('etudiant_id', etudiantId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function uploaderDocument(etudiantId, type, file, agence = AGENCE) {
  const ext = file.name.split('.').pop().toLowerCase()
  const path = `${etudiantId}/${type}_${Date.now()}.${ext}`
  const { error: uploadError } = await supabase.storage
    .from('etudiant-documents')
    .upload(path, file, { contentType: file.type })
  if (uploadError) throw uploadError
  const { data, error } = await supabase
    .from('etudiant_document')
    .insert({ agence, etudiant_id: etudiantId, type, file_url: path, notes: file.name })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function supprimerDocument(docId, filePath) {
  await supabase.storage.from('etudiant-documents').remove([filePath])
  const { error } = await supabase.from('etudiant_document').delete().eq('id', docId)
  if (error) throw error
}

export async function getSignedUrl(filePath) {
  const { data, error } = await supabase.storage
    .from('etudiant-documents')
    .createSignedUrl(filePath, 3600)
  if (error) throw error
  return data.signedUrl
}
