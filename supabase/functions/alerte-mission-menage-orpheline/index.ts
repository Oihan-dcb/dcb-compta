/**
 * alerte-mission-menage-orpheline — Edge Function Supabase (cron quotidien 8h21 UTC via pg_cron)
 *
 * Failsafe demandé par Oïhan le 10/09/2026, suite à l'incident TXORIA : une mission de ménage
 * réelle (mission_menage, 100,00 €, AE externe, statut 'valide') est restée avec
 * reservation_id = NULL pendant des semaines — l'événement iCal "Cleaning (MaisonTxoria0006)"
 * n'a jamais été rattaché à la réservation dont il était le ménage de départ (ménage réalisé
 * en 2 temps, 16 et 17 août, sur une résa de mois comptable juillet).
 *
 * Conséquence : ce coût AE n'était recouvré auprès d'AUCUN propriétaire. facturesEvoliz.js (le
 * vrai moteur de facturation) calcule autoBien depuis ventilation.AUTO, qui n'existe QUE par
 * réservation — une mission orpheline n'a donc aucune ligne AUTO et n'est jamais déduite du
 * reversement facturé (cf. buildComptaMensuelle.js ~ligne 249, qui exclut explicitement ces
 * missions du calcul et documente le trou). DCB paie l'AE (exportAutoDebours.js paie tout ce
 * qui n'est pas cancelled/refuse) et ne refacture rien : perte sèche, silencieuse.
 *
 * Cause racine côté sync : sync-ical-ae/index.ts:matchResa ne cherche une réservation que sur
 * bien_id + departure_date == date_mission OU date_mission + 1 jour. Un ménage fait le
 * lendemain-du-lendemain du départ (2e passage, rattrapage, ménage fond) ne matche jamais.
 * Ce garde-fou ne corrige pas matchResa — il rend le trou VISIBLE, avec la résa probable
 * (fenêtre ± 3 jours) pour que le rattachement se fasse en un coup d'œil.
 *
 * Même architecture que alerte-virement-orphelin / alerte-solde-manuel / alerte-solde-booking-
 * platform / alerte-encaissement-proprio-incoherent : un seul Edge Function partagé DCB/Lauian,
 * agence passée dans le body du cron, mail récap quotidien qui s'arrête de lui-même dès que la
 * mission est rattachée (elle sort alors du périmètre de la requête). LECTURE SEULE sur les
 * données métier — la seule écriture est la ligne d'audit journal_ops, comme les 4 autres.
 *
 * ── Périmètre et exclusions (chaque filtre est justifié par le code lu, pas supposé) ────────
 *
 * • type_mission IN ('checkout','cleaning') : les SEULS types que sync-ical-ae tente de
 *   rattacher (isCleaningCheckout = titre commençant par cleaning/check-out/checkout).
 *   'checkin' (visites d'accueil) et 'autre' — dont les "Maintenance (CODE)", que le Portail AE
 *   traite d'ailleurs comme hors séjour (missionHorsSejour) — ne sont JAMAIS matchés par
 *   conception : les signaler serait 100 % de faux positifs. 'cleaning' est gardé pour les
 *   lignes historiques (docs/data-model.md documente ce libellé, le code écrit 'checkout').
 *
 * • montant > 0 : exclut les visites d'accueil et toute mission non chiffrée (aucun débours AE
 *   → rien à recouvrer, rien à signaler).
 *
 * • statut NOT IN ('cancelled','refuse','annule') : exactement le périmètre de paiement de
 *   exportAutoDebours.js (.not('statut','in','(cancelled,refuse)')) — c'est-à-dire l'argent que
 *   DCB sort réellement. Volontairement PAS restreint à 'valide' : une mission 'en_attente' ou
 *   'planifie' avec un montant est déjà payée par l'export AE, donc déjà perdue si elle reste
 *   orpheline. Le statut est affiché dans le mail pour que le tri reste possible à l'œil.
 *
 * • ae.type = 'staff' exclu : ménage fait par un salarié DCB → pas un débours AE (même règle
 *   que buildComptaMensuelle.js:230). impute_salaire = true exclu pour la même raison (cas
 *   hybride Manon, CDI + AE : ménage couvert par le salaire, 0 débours).
 *
 * • regime = 'sap' exclu : facturé en parallèle au crédit d'impôt, AUCUNE imputation
 *   propriétaire par conception (migration 216, buildComptaMensuelle.js:322/331) — une mission
 *   SAP orpheline ne fait donc perdre aucune recette.
 *
 * • bien.skip_facturation exclu : biens internes / persos du gérant (LAGREOU, ASKIDA, MFC…) —
 *   facturesEvoliz.js:935 ne génère jamais de DEB_AE dessus (charge DCB absorbée par
 *   conception). Rien à recouvrer.
 *
 * • manual_mission_id non null exclu : pont vers une mission manuelle PowerHouse
 *   (migration 166 — même bien, même date), c'est-à-dire une intervention créée par le staff
 *   (ménage de fond, remise en état) qui n'a par nature aucune réservation attendue. Vérifié :
 *   AUCUN code de dcb-compta, dcb-portail-ae ou dcb-planning n'écrit cette colonne aujourd'hui
 *   (seule la migration 166 la mentionne) — le filtre est donc un no-op actuel, posé pour que
 *   le jour où PowerHouse alimentera ce pont l'alerte ne se mette pas à hurler à tort.
 *
 * • JOURS_DELAI = 8 : une mission n'est signalée que 8 jours après sa réalisation. sync-ical-cron
 *   repasse sync-ical-ae sur M-1 / M / M+1 CHAQUE nuit, et sync-ical-ae:160 réessaie le match à
 *   chaque passage (base.reservation_id = prev.reservation_id ?? resa_id) : 8 jours = au moins
 *   8 tentatives échouées, plus le temps que l'AE déclare ses heures et que le Portail valide
 *   (auto-validation des missions sans dépassement). En dessous, on signalerait des missions que
 *   le flux normal allait rattacher tout seul. Au-dessus, on laisserait filer des ménages sur un
 *   mois en cours de clôture. Seuil à valider par Oïhan — une constante, un seul endroit.
 *
 * • DATE_MIN = '2026-01-01' : même parti pris que alerte-encaissement-proprio-incoherent. Les
 *   missions 2025 vivent dans des mois clôturés et facturés depuis longtemps : non actionnables,
 *   et les resignaler chaque matin userait la confiance dans l'alerte.
 *
 * • Échappatoire pour un orphelin LÉGITIME (ménage réellement sans résa : réclamation, ménage
 *   offert, passage à la demande du propriétaire hors séjour) : mettre `#hors-resa` dans
 *   mission_menage.note → la mission est ignorée définitivement. C'est aujourd'hui une édition
 *   Supabase Dashboard (aucune UI n'écrit ce champ, seul PowerHouse le lit) ; sans cette soupape
 *   un cas légitime spammerait tous les matins jusqu'à ce qu'on falsifie son statut (donc la
 *   paie AE), ce qu'il ne faut jamais faire.
 *
 * ── Section 2 : missions sans bien identifié ────────────────────────────────────────────────
 * Une mission dont l'ical_code n'a pas été retrouvé garde bien_id = NULL (sync-ical-ae:146) :
 * elle est alors invisible de TOUS les écrans (tous filtrent en bien:bien_id!inner + agence),
 * et son coût n'est refacturé nulle part non plus — même classe de bug, agence indéterminable.
 * Ces lignes ne sont donc rapportées que dans le run 'dcb' (base Supabase partagée DCB/Lauian,
 * un seul destinataire possible), pour ne pas les envoyer deux fois.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const TYPES_MENAGE_DEPART = ['checkout', 'cleaning'] // seuls types que sync-ical-ae tente de matcher
const STATUTS_HORS_PAIE   = '(cancelled,refuse,annule)'
const JOURS_DELAI         = 8          // âge minimum d'une mission avant signalement
const FENETRE_RESA_JOURS  = 3          // ± N jours autour de date_mission pour proposer la résa probable
const DATE_MIN            = '2026-01-01'
const MARQUEUR_IGNORE     = '#hors-resa'

const STAFF_EMAIL: Record<string, string> = {
  dcb: 'oihan@destinationcotebasque.com',
  lauian: 'lauracoursan@hotmail.fr',
}

function fmtEur(cts: number) {
  return (cts / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' €'
}
function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}
function addDays(iso: string, n: number) {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

type Row = {
  date: string; anciennete: number; bien: string; titre: string; ae: string;
  statut: string; mois: string; clos: boolean; montant: string; suggestion: string | null;
}

function htmlRecap(rows: Row[], sansBien: Row[], total: string) {
  const ligne = (r: Row) => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #EDE6D8;font-size:13px;color:#2C2416">${r.date}<br><span style="color:#9C8E7D;font-size:11px">il y a ${r.anciennete} j · ${r.mois}${r.clos ? ' <span style="color:#C0392B;font-weight:bold">CLÔTURÉ</span>' : ''}</span></td>
      <td style="padding:10px 14px;border-bottom:1px solid #EDE6D8;font-size:13px;color:#2C2416"><strong>${r.bien}</strong><br><span style="color:#9C8E7D;font-size:11px">${r.titre}</span></td>
      <td style="padding:10px 14px;border-bottom:1px solid #EDE6D8;font-size:12px;color:#2C2416">${r.ae}<br><span style="color:#9C8E7D;font-size:11px;text-transform:uppercase">${r.statut}</span></td>
      <td style="padding:10px 14px;border-bottom:1px solid #EDE6D8;font-size:13px;color:#CC9933;font-weight:bold">${r.montant}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #EDE6D8;font-size:12px;color:#666">${r.suggestion || '<span style="color:#C0392B">aucune résa à ±' + FENETRE_RESA_JOURS + ' j</span>'}</td>
    </tr>`
  const entete = `
          <tr style="background:#FBF5E6"><th style="padding:8px 14px;font-size:10px;color:#9C8E7D;text-transform:uppercase;letter-spacing:.5px;text-align:left">Date ménage</th><th style="padding:8px 14px;font-size:10px;color:#9C8E7D;text-transform:uppercase;letter-spacing:.5px;text-align:left">Bien / mission</th><th style="padding:8px 14px;font-size:10px;color:#9C8E7D;text-transform:uppercase;letter-spacing:.5px;text-align:left">AE / statut</th><th style="padding:8px 14px;font-size:10px;color:#9C8E7D;text-transform:uppercase;letter-spacing:.5px;text-align:left">Coût AE</th><th style="padding:8px 14px;font-size:10px;color:#9C8E7D;text-transform:uppercase;letter-spacing:.5px;text-align:left">Résa probable</th></tr>`
  const section1 = rows.length ? `
      <tr><td style="padding:20px 24px 6px;font-size:13px;font-weight:bold;color:#2C2416">🧹 Ménages de départ jamais rattachés à une réservation (${rows.length})</td></tr>
      <tr><td style="padding:0 0 10px">
        <table width="100%" cellpadding="0" cellspacing="0">${entete}${rows.map(ligne).join('')}
        </table>
      </td></tr>` : ''
  const section2 = sansBien.length ? `
      <tr><td style="padding:20px 24px 6px;font-size:13px;font-weight:bold;color:#2C2416">❓ Missions sans bien identifié — ical_code introuvable (${sansBien.length})</td></tr>
      <tr><td style="padding:0 0 10px">
        <table width="100%" cellpadding="0" cellspacing="0">${entete}${sansBien.map(ligne).join('')}
        </table>
      </td></tr>
      <tr><td style="padding:0 40px 6px;font-size:12px;color:#666;line-height:1.5">
        Ces missions n'ont AUCUN bien : invisibles de tous les écrans (qui filtrent par bien + agence)
        et refacturées nulle part. Corriger l'<code>ical_code</code> du bien dans PageBiens, puis relancer
        la synchro iCal de l'AE concerné.
      </td></tr>` : ''
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:40px 20px"><tr><td align="center">
    <table width="700" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;max-width:700px;width:100%">
      <tr><td style="background:#CC9933;padding:26px 40px;text-align:center">
        <p style="margin:0;color:#fff;font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:0.85">Destination Côte Basque</p>
        <p style="margin:8px 0 0;color:#fff;font-size:19px;font-weight:bold">⚠ Ménage(s) AE payé(s) mais refacturé(s) à personne</p>
        <p style="margin:6px 0 0;color:rgba(255,255,255,0.75);font-size:13px">${rows.length + sansBien.length} mission${rows.length + sansBien.length > 1 ? 's' : ''} sans réservation · ${total} de coût AE non recouvré</p>
      </td></tr>
      <tr><td style="padding:10px 0 0">
        <table width="100%" cellpadding="0" cellspacing="0">
          ${section1}
          ${section2}
        </table>
      </td></tr>
      <tr><td style="padding:16px 40px;font-size:12px;color:#666;line-height:1.5">
        Une mission sans <code>reservation_id</code> n'a aucune ligne ventilation AUTO — elle n'est donc
        déduite d'aucun reversement propriétaire et refacturée sur aucune facture Evoliz, alors que l'AE
        est bien payé (export AUTO/Débours). À traiter en RATTACHANT la mission à sa réservation, pas en
        touchant au calcul : rattacher, puis relancer la ventilation du bien/mois pour recréer le lien AUTO.
        Un mois marqué <strong>CLÔTURÉ</strong> doit être réouvert avant refacturation.
        Ménage réellement hors séjour (offert, réclamation, demande propriétaire) : écrire
        <code>${MARQUEUR_IGNORE}</code> dans la note de la mission pour l'ignorer définitivement.
      </td></tr>
      <tr><td style="background:#f9f6f0;padding:16px 40px;text-align:center;font-size:11px;color:#9C8E7D">
        Généré automatiquement chaque matin tant qu'une mission de plus de ${JOURS_DELAI} jours reste sans réservation — s'arrête dès le rattachement.
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
  let body: { dry_run?: boolean; agence?: string } = {}
  try { body = await req.json() } catch { /* GET accepté */ }
  const dryRun = body.dry_run === true
  const AGENCE = body.agence || 'dcb'

  const today   = new Date().toISOString().slice(0, 10)
  const dateMax = addDays(today, -JOURS_DELAI) // mission réalisée il y a >= JOURS_DELAI jours

  const CHAMPS = 'id, date_mission, mois, montant, statut, type_mission, titre_ical, bien_id, note, regime, impute_salaire, manual_mission_id, ae:ae_id(prenom, nom, type)'

  // ── 1. Ménages de départ orphelins, bien connu (filtrable par agence) ────────
  const { data: missions, error } = await supabase
    .from('mission_menage')
    .select(`${CHAMPS}, bien:bien_id!inner(code, hospitable_name, agence, skip_facturation)`)
    .is('reservation_id', null)
    .in('type_mission', TYPES_MENAGE_DEPART)
    .not('statut', 'in', STATUTS_HORS_PAIE)
    .gt('montant', 0)
    .gte('date_mission', DATE_MIN)
    .lte('date_mission', dateMax)
    .eq('bien.agence', AGENCE)
    .order('date_mission')
  if (error) return json({ error: error.message }, 500)

  // ── 2. Missions sans bien identifié (ical_code introuvable) — run dcb seulement
  let missionsSansBien: any[] = []
  if (AGENCE === 'dcb') {
    const { data, error: errSB } = await supabase
      .from('mission_menage')
      .select(CHAMPS)
      .is('reservation_id', null)
      .is('bien_id', null)
      .not('statut', 'in', STATUTS_HORS_PAIE)
      .gt('montant', 0)
      .gte('date_mission', DATE_MIN)
      .lte('date_mission', dateMax)
      .order('date_mission')
    if (errSB) return json({ error: errSB.message }, 500)
    missionsSansBien = data || []
  }

  // Exclusions non exprimables proprement en filtre PostgREST (null-safe côté JS) ──────────
  const retenue = (m: any) => {
    if (m.impute_salaire === true) return false                                  // couvert par un salaire
    if (m.ae?.type === 'staff') return false                                     // salarié DCB, pas un débours AE
    if (m.regime === 'sap') return false                                         // SAP : aucune imputation proprio
    if (m.manual_mission_id) return false                                        // mission manuelle PowerHouse
    if (m.bien?.skip_facturation) return false                                   // bien interne, charge DCB assumée
    if ((m.note || '').toLowerCase().includes(MARQUEUR_IGNORE)) return false      // orphelin légitime, muté à la main
    return true
  }
  const orphelines  = (missions || []).filter(retenue)
  const sansBienRet = missionsSansBien.filter(retenue)

  if (!orphelines.length && !sansBienRet.length) {
    return json({ ok: true, agence: AGENCE, total: 0, sans_bien: 0 })
  }

  // ── Résa probable : même bien, départ à ± FENETRE_RESA_JOURS de la date du ménage ────────
  // Fenêtre explicite (liste de dates) plutôt qu'un between : borne le volume ramené, même
  // logique que sync-ical-ae:matchResa mais élargie — c'est précisément le décalage de +2 jours
  // (ménage en 2 temps) que matchResa ne sait pas voir.
  const bienIds = [...new Set(orphelines.map(m => m.bien_id).filter(Boolean))]
  const dates = new Set<string>()
  for (const m of orphelines) {
    for (let o = -FENETRE_RESA_JOURS; o <= FENETRE_RESA_JOURS; o++) dates.add(addDays(m.date_mission, o))
  }
  let resas: any[] = []
  if (bienIds.length && dates.size) {
    const { data } = await supabase
      .from('reservation')
      .select('id, code, guest_name, bien_id, departure_date, mois_comptable')
      .eq('final_status', 'accepted')
      .in('bien_id', bienIds)
      .in('departure_date', [...dates])
    resas = data || []
  }
  const suggestionPour = (m: any): string | null => {
    const cands = resas
      .filter(r => r.bien_id === m.bien_id)
      .map(r => ({ r, ecart: Math.round((new Date(r.departure_date + 'T00:00:00').getTime() - new Date(m.date_mission + 'T00:00:00').getTime()) / 86400_000) }))
      .filter(x => Math.abs(x.ecart) <= FENETRE_RESA_JOURS)
      .sort((a, b) => Math.abs(a.ecart) - Math.abs(b.ecart))
    if (!cands.length) return null
    return cands.slice(0, 2).map(({ r, ecart }) =>
      `<strong>${r.guest_name || r.code || '—'}</strong> — départ ${fmtDate(r.departure_date)} (${ecart === 0 ? 'même jour' : (ecart > 0 ? `J+${ecart}` : `J${ecart}`)})<br><span style="color:#9C8E7D;font-size:11px">mois compta ${r.mois_comptable || '—'}</span>`
    ).join('<br>')
  }

  // ── Clôture bien/mois : dit si une refacturation exige une réouverture ───────────────────
  const closSet = new Set<string>()
  if (bienIds.length) {
    const { data: clot } = await supabase
      .from('cloture_bien')
      .select('bien_id, mois')
      .eq('active', true)
      .in('bien_id', bienIds)
      .in('mois', [...new Set(orphelines.map(m => m.mois).filter(Boolean))])
    for (const c of clot || []) closSet.add(`${c.bien_id}|${c.mois}`)
  }

  const nbJours = (iso: string) =>
    Math.round((new Date(today + 'T00:00:00').getTime() - new Date(iso + 'T00:00:00').getTime()) / 86400_000)

  const toRow = (m: any, avecSuggestion: boolean): Row => ({
    date: fmtDate(m.date_mission),
    anciennete: nbJours(m.date_mission),
    bien: m.bien?.hospitable_name || m.bien?.code || '— bien inconnu —',
    titre: m.titre_ical || m.type_mission || '—',
    ae: [m.ae?.prenom, m.ae?.nom].filter(Boolean).join(' ') || '—',
    statut: m.statut || '—',
    mois: m.mois || '—',
    clos: closSet.has(`${m.bien_id}|${m.mois}`),
    montant: fmtEur(m.montant || 0),
    suggestion: avecSuggestion ? suggestionPour(m) : null,
  })

  const rows     = orphelines.map(m => toRow(m, true))
  const sansBien = sansBienRet.map(m => toRow(m, false))
  const totalCts = [...orphelines, ...sansBienRet].reduce((s, m) => s + (m.montant || 0), 0)
  const nb = rows.length + sansBien.length

  const to = STAFF_EMAIL[AGENCE] || STAFF_EMAIL.dcb
  if (!dryRun) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/smtp-send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({
        to: [to],
        subject: `⚠ ${nb} ménage${nb > 1 ? 's' : ''} AE sans réservation — ${fmtEur(totalCts)} non refacturé${nb > 1 ? 's' : ''}`,
        html: htmlRecap(rows, sansBien, fmtEur(totalCts)),
      }),
    })
    if (!res.ok) return json({ error: 'erreur_smtp', detail: await res.text() }, 500)
    await supabase.from('journal_ops').insert({
      categorie: 'facturation', action: 'alerte_mission_menage_orpheline', source: 'cron', statut: 'ok',
      message: `${rows.length} ménage(s) sans réservation + ${sansBien.length} mission(s) sans bien (agence ${AGENCE}), ${fmtEur(totalCts)} de coût AE non recouvré, alerte envoyée à ${to}`,
    })
  }

  return json({
    dry_run: dryRun, agence: AGENCE,
    seuil_jours: JOURS_DELAI, date_max: dateMax,
    total: rows.length, sans_bien: sansBien.length, montant_total: fmtEur(totalCts),
    rows: { orphelines: rows, sans_bien: sansBien },
  })
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json' } })
}
