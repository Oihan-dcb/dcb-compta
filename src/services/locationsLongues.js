import { supabase } from '../lib/supabase'
import { AGENCE } from '../lib/agence'

// ── Étudiants ──────────────────────────────────────────────────────────────

export async function listerEtudiants(agence = AGENCE, statut = null, inclureArchives = false) {
  let q = supabase
    .from('etudiant')
    .select('*, bien (id, code, hospitable_name), proprietaire (id, nom, prenom)')
    .eq('agence', agence)
    .order('nom')
  if (statut) q = q.eq('statut', statut)
  if (!inclureArchives) q = q.eq('archived', false)
  const { data, error } = await q
  if (error) throw error
  return data
}

export async function archiverEtudiant(id, archiver = true) {
  const { error } = await supabase
    .from('etudiant')
    .update({ archived: archiver, relances_actives: !archiver, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function supprimerEtudiant(id) {
  await supabase.from('lld_log').delete().eq('etudiant_id', id)
  await supabase.from('loyer_suivi').delete().eq('etudiant_id', id)
  await supabase.from('virement_proprio_suivi').delete().eq('etudiant_id', id)
  await supabase.from('caution_suivi').delete().eq('etudiant_id', id)
  const { data: docs } = await supabase.from('etudiant_document').select('file_url').eq('etudiant_id', id)
  if (docs?.length) {
    await supabase.storage.from('etudiant-documents').remove(docs.map(d => d.file_url))
  }
  await supabase.from('etudiant_document').delete().eq('etudiant_id', id)
  const { error } = await supabase.from('etudiant').delete().eq('id', id)
  if (error) throw error
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

// ── Prorata entrée / sortie (Laura 2026-06-11) ──────────────────────────────
// Loyer du mois = plein CC × jours occupés ÷ jours du mois. S'applique au CC
// complet (loyer + supplément + charges). Mois plein → facteur 1.
// Convention (Laura, confirmée par virement réel) : jour d'ENTRÉE ET jour de SORTIE
// inclus (facturés). Ex. sortie 19/06 → 1→19 = 19 jours (840×19/30 − 10% = 478,80 € reversés).
export function prorataMois(e, mois) {
  if (!mois) return { facteur: 1, joursOccupes: 0, joursMois: 0, jDebut: 0, jFin: 0, partiel: false }
  const [y, m] = String(mois).split('-').map(Number)
  const joursMois = new Date(y, m, 0).getDate()
  let jDebut = 1, jFin = joursMois
  const ymd = (s) => String(s).slice(0, 10).split('-').map(Number)
  const horsMois = { facteur: 0, joursOccupes: 0, joursMois, jDebut: 0, jFin: 0, partiel: true }
  if (e?.date_entree) {
    const [ay, am, ad] = ymd(e.date_entree)
    if (ay > y || (ay === y && am > m)) return horsMois          // entre après ce mois
    if (ay === y && am === m) jDebut = Math.max(jDebut, ad)
  }
  const sortie = e?.date_sortie_reelle || e?.date_sortie_prevue
  if (sortie) {
    const [sy, sm, sd] = ymd(sortie)
    if (sy < y || (sy === y && sm < m)) return horsMois          // parti avant ce mois
    if (sy === y && sm === m) jFin = Math.min(jFin, sd)           // jour de sortie inclus (facturé)
  }
  const joursOccupes = Math.max(0, jFin - jDebut + 1)
  return { facteur: joursMois ? joursOccupes / joursMois : 0, joursOccupes, joursMois, jDebut, jFin, partiel: joursOccupes < joursMois }
}

// ── Montants dérivés ───────────────────────────────────────────────────────

// CC plein du mois (sans prorata)
export function montantPleinEtudiant(e) {
  return (e.loyer_nu || 0) + (e.supplement_loyer || 0) +
         (e.charges_eau || 0) + (e.charges_copro || 0) + (e.charges_internet || 0)
}

// CC du mois — proratisé si entrée/sortie en cours de mois ; plein si `mois` omis
export function montantTotalEtudiant(e, mois = null) {
  const plein = montantPleinEtudiant(e)
  if (!mois) return plein
  return Math.round(plein * prorataMois(e, mois).facteur)
}

// Taux de commission DCB (0.10 étudiant/mobilité, 0.08 habitation, 0.05 Bitxi)
export function tauxCommission(e) {
  return e?.taux_commission != null ? Number(e.taux_commission) : 0.10
}

// Honoraires DCB = taux × CC (du mois si fourni, sinon plein)
export function honorairesEtudiant(e, mois = null) {
  return Math.round(montantTotalEtudiant(e, mois) * tauxCommission(e))
}

// Virement proprio = CC − honoraires (du mois si fourni)
export function montantVirementProprio(e, mois = null) {
  return montantTotalEtudiant(e, mois) - honorairesEtudiant(e, mois)
}

// ── Loyers du mois ────────────────────────────────────────────────────────

export async function listerLoyersMois(mois, agence = AGENCE) {
  const { data, error } = await supabase
    .from('loyer_suivi')
    .select('*, etudiant (id, nom, prenom, email, telephone, loyer_nu, supplement_loyer, charges_eau, charges_copro, charges_internet, honoraires_dcb, taux_commission, date_entree, date_sortie_prevue, date_sortie_reelle, bien_id, proprietaire_id, jour_paiement_attendu, archived, bien (code))')
    .eq('agence', agence)
    .eq('mois', mois)
    .order('created_at')
  if (error) throw error
  return (data || []).filter(l => !l.etudiant?.archived)
}

export async function initialiserLoyersMois(mois, agence = AGENCE) {
  // Récupérer tous les étudiants non archivés (actif + en_attente)
  // Les en_attente sont inclus seulement si leur date_entree est dans ou avant le mois
  const tous = await listerEtudiants(agence, null, false)
  const [y, m] = mois.split('-').map(Number)
  const dernierJour = `${mois}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
  const etudiants = tous.filter(e =>
    e.statut === 'actif' ||
    (e.statut === 'en_attente' && e.date_entree && e.date_entree <= dernierJour)
  )
  if (!etudiants.length) return []

  // Upsert loyer_suivi pour chaque locataire éligible (montant proratisé entrée/sortie)
  const rows = etudiants.map(e => ({
    agence,
    etudiant_id: e.id,
    mois,
    statut: 'attendu',
    montant_attendu: montantTotalEtudiant(e, mois),
  }))

  const { error } = await supabase
    .from('loyer_suivi')
    .upsert(rows, { onConflict: 'etudiant_id,mois', ignoreDuplicates: true })
  if (error) throw error

  // Upsert virement_proprio_suivi (CC proratisé − honoraires = taux × CC)
  const virements = etudiants.map(e => ({
    agence,
    etudiant_id: e.id,
    mois,
    statut:  'a_virer',
    montant: montantVirementProprio(e, mois),
  }))
  const { error: errVir } = await supabase
    .from('virement_proprio_suivi')
    .upsert(virements, { onConflict: 'etudiant_id,mois', ignoreDuplicates: true })
  if (errVir) throw errVir

  // Rafraîchir le montant proratisé des lignes encore "attendu"/"a_virer"
  // (cas entrée/sortie en cours de mois) — sans toucher aux loyers déjà reçus/virés.
  for (const e of etudiants) {
    await supabase.from('loyer_suivi')
      .update({ montant_attendu: montantTotalEtudiant(e, mois) })
      .eq('etudiant_id', e.id).eq('mois', mois).eq('statut', 'attendu')
    await supabase.from('virement_proprio_suivi')
      .update({ montant: montantVirementProprio(e, mois) })
      .eq('etudiant_id', e.id).eq('mois', mois).eq('statut', 'a_virer')
  }

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
    .select('*, etudiant (id, nom, prenom, loyer_nu, supplement_loyer, charges_eau, charges_copro, charges_internet, honoraires_dcb, taux_commission, date_entree, date_sortie_prevue, date_sortie_reelle, proprietaire (nom, prenom))')
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

// ── Historique / suivi par étudiant ───────────────────────────────────────

export async function listerLoyersEtudiant(etudiantId, agence = AGENCE) {
  const { data, error } = await supabase
    .from('loyer_suivi')
    .select('*')
    .eq('agence', agence)
    .eq('etudiant_id', etudiantId)
    .order('mois', { ascending: false })
  if (error) throw error
  return data || []
}

export async function listerVirementsEtudiant(etudiantId, agence = AGENCE) {
  const { data, error } = await supabase
    .from('virement_proprio_suivi')
    .select('*')
    .eq('agence', agence)
    .eq('etudiant_id', etudiantId)
    .order('mois', { ascending: false })
  if (error) throw error
  return data || []
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

// ── Journal d'activité ────────────────────────────────────────────────────

export async function listerLogsEtudiant(etudiantId, agence = AGENCE) {
  const { data, error } = await supabase
    .from('lld_log')
    .select('*')
    .eq('agence', agence)
    .eq('etudiant_id', etudiantId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function ajouterLog(payload) {
  const { error } = await supabase.from('lld_log').insert(payload)
  if (error) throw error
}
