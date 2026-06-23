import { supabase } from '../lib/supabase'
import { AGENCE } from '../lib/agence'

const TVA_RATE = 0.20

// ── Factures d'honoraires LLD (Phase 2) ─────────────────────────────────────
// Chemin DÉDIÉ (ne passe PAS par la table `ventilation` du saisonnier).
// 1 facture `facture_evoliz` (type_facture='lld') PAR BIEN et PAR MOIS, 1 ligne par loyer reçu.
// On ne facture QUE les honoraires de gestion (commission), pas le loyer ni les charges.
// Commission = taux × montant reçu (TTC, méthode Laura) → décomposée HT + TVA 20 %. Code HON_LLD.
// Idempotent : réutilise/maj la facture lld brouillon du bien/mois ; ne touche JAMAIS une facture
// déjà envoyée à Evoliz (id_evoliz non null).
export async function genererFacturesLLD(mois, agence = AGENCE) {
  const log = { creees: 0, mises_a_jour: 0, lignes: 0, skipped_envoye: 0, biens: [], erreurs: [] }

  // 1. Loyers REÇUS du mois (commission sur le réel encaissé).
  //    On facture sur le RÉEL ENCAISSÉ : un loyer reçu = honoraires dus, même si la fiche
  //    locataire est désormais archivée (locataire parti en cours de mois ayant payé son loyer).
  //    Le propriétaire = celui DU BIEN (autoritaire) et non celui de la fiche étudiant
  //    (qui peut être obsolète/erroné — ex. ERREGINA pointait Waldau au lieu de Nicolle).
  const { data: loyers, error } = await supabase
    .from('loyer_suivi')
    .select('id, montant_recu, montant_attendu, etudiant (id, nom, prenom, bien_id, taux_commission, bien:bien_id(proprietaire_id))')
    .eq('agence', agence)
    .eq('mois', mois)
    .eq('statut', 'recu')
  if (error) throw error

  // 2. Regrouper par bien (proprio = proprio du bien ; ignore les loyers sans bien/proprio)
  const parBien = new Map()
  for (const l of (loyers || [])) {
    const e = l.etudiant
    const proprietaireId = e?.bien?.proprietaire_id
    if (!e || !e.bien_id || !proprietaireId) continue
    if (!parBien.has(e.bien_id)) parBien.set(e.bien_id, { bien_id: e.bien_id, proprietaire_id: proprietaireId, loyers: [] })
    parBien.get(e.bien_id).loyers.push(l)
  }

  // 3. Une facture LLD par bien
  for (const grp of parBien.values()) {
    try {
      const lignesData = []
      let ordre = 1, totalHT = 0, totalTVA = 0, totalTTC = 0, reversement = 0
      for (const l of grp.loyers) {
        const e = l.etudiant
        const base = l.montant_recu ?? l.montant_attendu ?? 0
        const taux = e.taux_commission != null ? Number(e.taux_commission) : 0.10
        const honTTC = Math.round(base * taux)
        if (honTTC <= 0) continue
        const honHT = Math.round(honTTC / (1 + TVA_RATE))
        const honTVA = honTTC - honHT
        totalHT += honHT; totalTVA += honTVA; totalTTC += honTTC
        reversement += (base - honTTC)
        lignesData.push({
          code: 'HON_LLD',
          libelle: `Honoraires gestion LLD — ${[e.prenom, e.nom].filter(Boolean).join(' ')}`,
          description: `Loyer ${mois}`,
          montant_ht: honHT, taux_tva: 20, montant_tva: honTVA, montant_ttc: honTTC,
          ordre: ordre++,
        })
      }
      if (!lignesData.length) continue

      // Facture LLD existante pour ce bien/mois ?
      const { data: existing } = await supabase.from('facture_evoliz')
        .select('id, id_evoliz')
        .eq('agence', agence).eq('mois', mois).eq('bien_id', grp.bien_id).eq('type_facture', 'lld')
        .maybeSingle()
      if (existing?.id_evoliz) { log.skipped_envoye++; continue } // déjà envoyée → on ne réécrit pas

      const factureData = {
        mois, agence, proprietaire_id: grp.proprietaire_id, bien_id: grp.bien_id,
        type_facture: 'lld', total_ht: totalHT, total_tva: totalTVA, total_ttc: totalTTC,
        montant_reversement: reversement, statut: 'brouillon', solde_negatif: false,
      }

      let factureId
      if (existing) {
        await supabase.from('facture_evoliz').update(factureData).eq('id', existing.id)
        factureId = existing.id; log.mises_a_jour++
      } else {
        const { data: nf, error: insErr } = await supabase.from('facture_evoliz').insert(factureData).select('id').single()
        if (insErr) throw insErr
        factureId = nf.id; log.creees++
      }

      await supabase.from('facture_evoliz_ligne').delete().eq('facture_id', factureId)
      const { error: ligErr } = await supabase.from('facture_evoliz_ligne')
        .insert(lignesData.map(li => ({ ...li, facture_id: factureId })))
      if (ligErr) throw ligErr
      log.lignes += lignesData.length

      // Lien loyer → facture (traçabilité)
      await supabase.from('loyer_suivi').update({ facture_evoliz_id: factureId }).in('id', grp.loyers.map(l => l.id))
      log.biens.push(grp.bien_id)
    } catch (err) {
      log.erreurs.push({ bien_id: grp.bien_id, error: err.message })
    }
  }
  return log
}
