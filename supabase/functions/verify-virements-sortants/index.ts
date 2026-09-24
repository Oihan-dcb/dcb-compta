/**
 * Edge Function — verify-virements-sortants
 *
 * Contrôle symétrique du badge "Tréso" (allocate-encaissements, sens entrant) : vérifie que
 * l'argent RÉELLEMENT viré au propriétaire (débit bancaire réel, remonté nuit après nuit par
 * pennylane-mouvement-sync.js) correspond bien au montant facturé (facture_evoliz.montant_reversement
 * pour les honoraires, total_ttc pour la facture COM).
 *
 * Avant cette fonction, ce rapprochement n'existait qu'en localStorage côté client
 * (PageFactures.jsx, bloc "Contrôle virements propriétaires") — sans trace serveur ni alerte.
 * Voir audit 06-07/09/2026 (mémoire "exportSCT.js virement brut + audit reversements 2026") :
 * 10 écarts (358,05€ de sur-virements + 1497,77€ de sous-virements) découverts seulement après
 * une plainte cliente, faute d'un contrôle automatique.
 *
 * Stratégie de matching, par ordre :
 *   1. Un lien déjà posé manuellement par Oïhan (lien_manuel=true) n'est JAMAIS retouché.
 *   2. Matching strict (port de autoMatchVirement côté client) : score par inclusion du code du
 *      bien (ou des codes du groupe de facturation) dans le libellé/détail du mouvement. Un seul
 *      candidat restant avec score >= 1 → match_source='auto', confiance='certain'.
 *   3. Sinon (0 ou >=2 candidats, ou facture COM qui n'a pas de code bien à matcher) → Opus
 *      (edge function llm-analyse, model claude-opus-4-6) tranche sur le reste non résolu en un
 *      seul appel groupé pour le mois. Réponse strictement JSON, parsing défensif — si le modèle
 *      ne répond pas un JSON exploitable, ces lignes restent simplement non résolues ce cycle.
 *
 * Body attendu : { mois: "YYYY-MM", agence: "dcb" }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { logError } from '../_shared/logError.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResp(data: object, status = 200) {
  return new Response(JSON.stringify(data), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
    status,
  })
}

function norm(s: string | null | undefined): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function moisSuivant(mois: string): string {
  const [y, m] = mois.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

interface Mouvement {
  id: string
  libelle: string | null
  detail: string | null
  debit: number
  date_operation: string
  canal: string | null
}

interface Candidat {
  cle: string
  label: string           // pour affichage/prompt (nom propriétaire + bien(s) ou libellé COM)
  attendu_cts: number
  tokens: string[]        // tokens de matching strict (codes bien) — vide pour COM
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { mois, agence = 'dcb' } = await req.json()
    if (!mois || !/^\d{4}-\d{2}$/.test(mois)) {
      throw new Error('mois invalide — format YYYY-MM attendu')
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

    const moisNext = moisSuivant(mois)

    // ── 1. Candidats à vérifier : factures honoraires + COM du mois ──────────
    const [{ data: factures, error: errFact }, { data: aes, error: errAes }, { data: mouvements, error: errMvt }, { data: existantes, error: errExist }] = await Promise.all([
      supabase.from('facture_evoliz')
        .select(`
          id, type_facture, montant_reversement, total_ttc,
          bien:bien_id(code),
          proprietaire:proprietaire_id(nom, prenom, bien!proprietaire_id(code, groupe_facturation))
        `)
        .eq('mois', mois).eq('agence', agence).in('type_facture', ['honoraires', 'com']),
      supabase.from('auto_entrepreneur').select('nom, prenom').eq('actif', true),
      supabase.from('mouvement_bancaire')
        .select('id, libelle, detail, debit, date_operation, canal')
        .in('mois_releve', [moisNext, moisSuivant(moisNext)]).eq('agence', agence).gt('debit', 0)
        // Fenêtre M+1..M+2 : un reversement du mois M part toujours APRÈS la fin du mois. Avec [M, M+1],
        // le virement de juillet payé le 10/08 tombait dans la fenêtre d'août (RICHOU, faux lien, I-152).
        // Séquestre uniquement : le compte courant (paie, fournisseurs, HON/FMEN internes) ne porte
        // jamais un reversement propriétaire — sans ce filtre, Opus recevait ses débits (I-152).
        .neq('source', 'Powens_courant')
        .order('date_operation', { ascending: true }),
      supabase.from('virement_sortant_controle').select('*').eq('agence', agence).eq('mois', mois),
    ])
    // Débits déjà rattachés de façon sûre (manuel ou certain) à la facture d'un AUTRE mois : jamais
    // réutilisables ici — sinon le même virement justifie deux mois différents.
    const { data: liensAutresMois } = await supabase.from('virement_sortant_controle')
      .select('mouvement_bancaire_id').eq('agence', agence).neq('mois', mois)
      .not('mouvement_bancaire_id', 'is', null).or('lien_manuel.eq.true,match_confiance.eq.certain')
    const mvtsAutresMois = new Set((liensAutresMois || []).map((l: any) => l.mouvement_bancaire_id))
    if (errFact) throw new Error(`Erreur facture_evoliz: ${errFact.message}`)
    if (errAes) throw new Error(`Erreur auto_entrepreneur: ${errAes.message}`)
    if (errMvt) throw new Error(`Erreur mouvement_bancaire: ${errMvt.message}`)
    if (errExist) throw new Error(`Erreur virement_sortant_controle: ${errExist.message}`)

    // ── 2. Construire les candidats (cle, montant attendu, tokens de matching) ──
    const candidats: Candidat[] = []
    for (const f of (factures || []) as any[]) {
      const estCom = f.type_facture === 'com'
      const attendu = estCom ? f.total_ttc : f.montant_reversement
      if (!attendu || attendu <= 0) continue
      const cle = estCom ? `com-${f.id}` : f.id
      const bienCode = f.bien?.code
      const tokens = estCom
        ? [] // pas de code bien pour COM → résolu uniquement par Opus
        : bienCode
          ? [norm(bienCode)].filter((t: string) => t.length >= 2)
          : (f.proprietaire?.bien || []).map((b: any) => norm(b.code)).filter((t: string) => t.length >= 2)
      const label = estCom
        ? 'Commissions Web Directes'
        : `${f.proprietaire?.nom || ''} ${f.proprietaire?.prenom || ''} (${bienCode || (f.proprietaire?.bien || []).map((b: any) => b.code).join(', ')})`
      candidats.push({ cle, label: label.trim(), attendu_cts: attendu, tokens })
    }

    // ── 3. Exclure les virements AE (canal ou libellé) — même règle que le client ──
    const tokensAE = (aes || []).flatMap((ae: any) =>
      [ae.nom, ae.prenom].filter(Boolean).map((s: string) => norm(s)).filter((t: string) => t.length >= 3)
    )
    const estVirementAE = (v: Mouvement) => {
      if (v.canal === 'sortant_ae') return true
      const lib = norm(`${v.detail || ''} ${v.libelle || ''}`)
      return tokensAE.some((t: string) => lib.includes(t))
    }
    // Exclure aussi les frais bancaires (jamais un virement propriétaire) — la même règle
    // côté client (chargerVirements) ne filtre pas ce canal, mais ici on écrit en base : mieux
    // vaut ne jamais proposer un rapprochement contre une cotisation/frais de tenue de compte.
    const virsTableau: Mouvement[] = (mouvements || []).filter((v: any) => v.canal !== 'frais_bancaires' && !estVirementAE(v))

    // ── 4. Séparer verrouillé (lien_manuel) vs à recalculer ─────────────────
    const existantesByCle = new Map<string, any>((existantes || []).map((e: any) => [e.cle, e]))
    const clesVerrouillees = new Set(
      (existantes || []).filter((e: any) => e.lien_manuel).map((e: any) => e.cle)
    )
    const mvtsDejaVerrouilles = new Set(
      (existantes || []).filter((e: any) => e.lien_manuel && e.mouvement_bancaire_id).map((e: any) => e.mouvement_bancaire_id)
    )
    const disponiblesBruts = virsTableau.filter(v => !mvtsDejaVerrouilles.has(v.id) && !mvtsAutresMois.has(v.id))
    const aResoudreBruts = candidats.filter(c => !clesVerrouillees.has(c.cle))

    // ── 4b. Remises groupées (fichier SCT, I-152) ───────────────────────────
    // Un fichier SCT transmis à la banque est débité en UNE ligne « REM VIR SEPA DU jj/mm/aa ».
    // PageExports mémorise la composition de chaque fichier (sct_export) : on rattache la remise au
    // fichier de même total → chaque facture du fichier est liée à ce débit. Total identique au
    // centime = certain ; écart < 3 % (virement ajouté/retiré à la main dans la banque) = incertain.
    const resolusRemise = new Map<string, { mouvement: Mouvement; ecart: number; confiance: string; raison: string }>()
    const remisesUtilisees = new Set<string>()
    const remises = disponiblesBruts.filter(v => /^REM\s+VIR\s+SEPA/i.test((v.libelle || '').trim()))
    if (remises.length) {
      const { data: exportsSct } = await supabase.from('sct_export')
        .select('id, msg_id, total_cts, lignes, created_at').eq('agence', agence).eq('mois', mois)
        .order('created_at', { ascending: false })
      const clesAResoudre = new Map(aResoudreBruts.map(c => [c.cle, c]))
      const exportsUtilises = new Set<string>()
      for (const r of remises) {
        const libres = (exportsSct || []).filter((e: any) => !exportsUtilises.has(e.id))
        let choix: any = libres.find((e: any) => e.total_cts === r.debit)
        let confiance = 'certain'
        if (!choix) {
          const proches = libres.filter((e: any) => Math.abs(e.total_cts - r.debit) <= r.debit * 0.03)
            .sort((a: any, b: any) => Math.abs(a.total_cts - r.debit) - Math.abs(b.total_cts - r.debit))
          choix = proches[0]
          confiance = 'incertain'
        }
        if (!choix) continue
        exportsUtilises.add(choix.id)
        remisesUtilisees.add(r.id)
        const ecartRemise = r.debit - choix.total_cts
        const raison = `Remise groupée du ${r.date_operation} (${(r.debit / 100).toFixed(2)} €) = fichier SCT ${choix.msg_id || choix.id}`
          + (ecartRemise ? ` — ATTENTION écart remise/fichier ${(ecartRemise / 100).toFixed(2)} € (virement ajouté ou retiré à la main dans la banque ?)` : '')
        for (const l of (choix.lignes || [])) {
          const c = clesAResoudre.get(l.cle)
          if (!c || resolusRemise.has(c.cle)) continue
          resolusRemise.set(c.cle, { mouvement: r, ecart: c.attendu_cts - l.montant_cts, confiance, raison })
        }
      }
    }
    const disponibles = disponiblesBruts.filter(v => !remisesUtilisees.has(v.id))
    const aResoudre = aResoudreBruts.filter(c => !resolusRemise.has(c.cle))

    // Garde-fou montant : un token bien (parfois court/numérique, ex. "602") peut apparaître
    // par coïncidence dans le libellé d'une transaction totalement étrangère (constaté sur
    // données réelles : "REMBOURSEMENT AIRCOVER 602 GAL", 155,03€, matché à tort sur la
    // facture du bien 602 attendue à 3820,03€). On n'accepte un match strict que si le débit
    // reste dans un ordre de grandeur plausible de l'attendu — les écarts réels observés lors
    // de l'audit (12,50€ à 1497,77€) restent toujours une fraction du montant attendu, jamais
    // un rapport de x25. Les cas hors de cette plage restent non résolus → tentés par Opus.
    const plausible = (attendu: number, debit: number) => debit >= attendu * 0.5 && debit <= attendu * 2
    // « certain » seulement si le montant colle (≤ 1 % ou ≤ 1 €) ; sinon le lien reste proposé mais
    // « incertain » (auparavant RICHOU août affichait « certain » avec 7 900,73 € d'écart).
    const confianceStricte = (attendu: number, ecart: number) => Math.abs(ecart) <= Math.max(100, attendu * 0.01) ? 'certain' : 'incertain'

    // ── 5. Matching strict (port de autoMatchVirement) ──────────────────────
    const resolusAuto = new Map<string, { mouvement: Mouvement; ecart: number }>()
    const restants: Candidat[] = []
    for (const c of aResoudre) {
      if (!c.tokens.length) { restants.push(c); continue } // COM, ou facture sans code bien exploitable
      let best: Mouvement | null = null
      let bestScore = 0
      let nbAtBest = 0
      for (const v of disponibles) {
        if ([...resolusAuto.values()].some(r => r.mouvement.id === v.id)) continue
        if (!plausible(c.attendu_cts, v.debit)) continue
        const lib = norm(`${v.detail || ''} ${v.libelle || ''}`)
        const score = c.tokens.reduce((s: number, t: string) => s + (lib.includes(t) ? 1 : 0), 0)
        if (score > bestScore) { bestScore = score; best = v; nbAtBest = 1 }
        else if (score === bestScore && score > 0) { nbAtBest++ }
      }
      if (best && bestScore >= 1 && nbAtBest === 1) {
        resolusAuto.set(c.cle, { mouvement: best, ecart: c.attendu_cts - best.debit })
      } else {
        restants.push(c)
      }
    }

    // ── 6. Fallback Opus sur ce qui reste ambigu (1 seul appel groupé) ──────
    const resolusOpus = new Map<string, { mouvement: Mouvement; ecart: number; confiance: string; raison: string }>()
    if (restants.length > 0) {
      // Fenêtre de plausibilité montant (voir plus haut) appliquée aussi au pool envoyé à Opus :
      // sur ce compte, la majorité des débits (frais divers, remboursements AirCover, transferts
      // internes...) n'ont rien à voir avec un virement propriétaire — inutile de les proposer.
      const attendus = restants.map(c => c.attendu_cts)
      const mouvementsRestants = disponibles.filter(v =>
        ![...resolusAuto.values()].some(r => r.mouvement.id === v.id) &&
        attendus.some(a => plausible(a, v.debit))
      )
      if (mouvementsRestants.length > 0) {
        try {
          const prompt = [
            `Tu dois apparier des virements bancaires sortants réels à des factures propriétaires DCB (conciergerie), sur la base du libellé bancaire, du montant et de la date. N'apparie QUE si c'est plausible (nom du propriétaire ou du bien reconnaissable malgré une orthographe/format différent, montant cohérent). Laisse non résolu plutôt que de deviner.`,
            ``,
            `Factures à résoudre (cle, propriétaire/bien, montant attendu en euros) :`,
            JSON.stringify(restants.map(c => ({ cle: c.cle, label: c.label, attendu_eur: (c.attendu_cts / 100).toFixed(2) }))),
            ``,
            `Virements bancaires disponibles (id, libellé, détail, montant en euros, date) :`,
            JSON.stringify(mouvementsRestants.map(v => ({ id: v.id, libelle: v.libelle, detail: v.detail, montant_eur: (v.debit / 100).toFixed(2), date: v.date_operation }))),
            ``,
            `Réponds UNIQUEMENT avec un tableau JSON valide (aucun texte autour, aucun bloc markdown), de la forme :`,
            `[{"cle": "...", "mouvement_bancaire_id": "...", "confiance": "certain"|"incertain", "raison": "..."}]`,
            `N'inclus que les paires que tu proposes réellement — omets les factures/virements sans correspondance plausible.`,
          ].join('\n')

          const res = await fetch(`${SUPABASE_URL}/functions/v1/llm-analyse`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY },
            body: JSON.stringify({ prompt, model: 'claude-opus-4-6' }),
          })
          const { text } = await res.json()
          const cleaned = (text || '').replace(/^```(json)?/i, '').replace(/```$/, '').trim()
          const parsed = JSON.parse(cleaned)
          if (Array.isArray(parsed)) {
            const cleValides = new Set(restants.map(c => c.cle))
            const mvtValides = new Map(mouvementsRestants.map(v => [v.id, v]))
            const mvtUtilises = new Set<string>()
            for (const p of parsed) {
              if (!cleValides.has(p.cle) || resolusOpus.has(p.cle)) continue
              const mvt = mvtValides.get(p.mouvement_bancaire_id)
              if (!mvt || mvtUtilises.has(mvt.id)) continue
              if (!['certain', 'incertain'].includes(p.confiance)) continue
              const c = restants.find(r => r.cle === p.cle)!
              resolusOpus.set(p.cle, { mouvement: mvt, ecart: c.attendu_cts - mvt.debit, confiance: p.confiance, raison: String(p.raison || '').slice(0, 500) })
              mvtUtilises.add(mvt.id)
            }
          }
        } catch (e) {
          // Parsing/appel Opus défensif — ne bloque jamais le reste du rapprochement.
          console.error('verify-virements-sortants: fallback Opus échoué:', (e as Error).message)
        }
      }
    }

    // ── 7. Upsert des lignes non verrouillées ───────────────────────────────
    const now = new Date().toISOString()
    const rows = aResoudreBruts.map(c => {
      const remise = resolusRemise.get(c.cle)
      const auto = resolusAuto.get(c.cle)
      const opus = resolusOpus.get(c.cle)
      const m = remise || auto || opus
      return {
        agence, mois, cle: c.cle,
        mouvement_bancaire_id: m?.mouvement.id ?? null,
        lien_manuel: false,
        explicitement_non_lie: false,
        ecart_cts: m ? m.ecart : null,
        match_source: remise || auto ? 'auto' : opus ? 'opus' : null,
        match_confiance: remise ? remise.confiance : auto ? confianceStricte(c.attendu_cts, auto.ecart) : opus ? opus.confiance : null,
        match_raison: remise ? remise.raison : opus ? opus.raison : auto && confianceStricte(c.attendu_cts, auto.ecart) === 'incertain' ? `Code bien reconnu mais montant différent (écart ${(auto.ecart / 100).toFixed(2)} €)` : null,
        updated_at: now,
      }
    })
    if (rows.length > 0) {
      const { error: upErr } = await supabase.from('virement_sortant_controle').upsert(rows, { onConflict: 'agence,mois,cle' })
      if (upErr) throw new Error(`Erreur upsert virement_sortant_controle: ${upErr.message}`)
    }

    // ── 8. Réponse : map complète (verrouillées + fraîchement calculées) ───
    const resultat: Record<string, any> = {}
    for (const e of (existantes || [])) {
      if (e.lien_manuel) resultat[e.cle] = e
    }
    for (const c of candidats) {
      if (resultat[c.cle]) continue
      const remise = resolusRemise.get(c.cle)
      const auto = resolusAuto.get(c.cle)
      const opus = resolusOpus.get(c.cle)
      const m = remise || auto || opus
      resultat[c.cle] = {
        cle: c.cle,
        mouvement_bancaire_id: m?.mouvement.id ?? null,
        lien_manuel: false,
        explicitement_non_lie: false,
        ecart_cts: m ? m.ecart : null,
        match_source: remise || auto ? 'auto' : opus ? 'opus' : null,
        match_confiance: remise ? remise.confiance : auto ? confianceStricte(c.attendu_cts, auto.ecart) : opus ? opus.confiance : null,
        match_raison: remise ? remise.raison : opus ? opus.raison : auto && confianceStricte(c.attendu_cts, auto.ecart) === 'incertain' ? `Code bien reconnu mais montant différent (écart ${(auto.ecart / 100).toFixed(2)} €)` : null,
        commentaire: existantesByCle.get(c.cle)?.commentaire ?? null,
      }
    }

    return jsonResp({
      candidats: candidats.length,
      resolus_remise: resolusRemise.size,
      resolus_auto: resolusAuto.size,
      resolus_opus: resolusOpus.size,
      non_resolus: candidats.length - clesVerrouillees.size - resolusRemise.size - resolusAuto.size - resolusOpus.size,
      controle: resultat,
    })

  } catch (err: any) {
    console.error('verify-virements-sortants fatal:', err.message)
    await logError({ source: 'edge_verify-virements-sortants', message: err.message, stack: err.stack })
    return jsonResp({ error: err.message }, 200)
  }
})
