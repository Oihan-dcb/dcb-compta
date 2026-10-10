/**
 * point-du-matin — Edge Function Supabase (pg_cron 06:00 et 07:00 UTC → s'exécute à 08:00 Paris)
 *
 * Audit des mails automatiques du 09/10/2026, validé par Oïhan : UN seul mail par agence et par jour
 * (DCB → rôle 'point_du_matin' dcb, Lauïan → rôle 'point_du_matin' lauian), envoyé SEULEMENT s'il y a
 * quelque chose de nouveau ou un rappel dû. Remplace les mails quotidiens individuels des alertes compta
 * (booking-platform, ménages orphelins, virements orphelins, soldes manuels, séjours sans ménage,
 * doublons, encaissement incohérent, post-facture, fraîcheur banque, factures Evoliz non envoyées,
 * séquestre, paiements Evoliz non enregistrés).
 *
 * Source : alerte_etat (migration 371), alimentée chaque nuit par chaque contrôle (liste complète →
 * nouveau / toujours là / clos). Ici :
 *   🆕 Nouveau        : jamais présenté (nb_notifications = 0), avec montants, en tête.
 *   🔁 Rappel         : présenté une fois → rappel à J+3, puis J+7, puis chaque semaine tant qu'ouvert.
 *   📌 Toujours ouvert : le reste, UNE ligne par type d'alerte (nombre, total, ancienneté du plus ancien).
 *   ✅ Clos depuis le dernier point (compteur) ; ℹ️ pour info (relances parties hier, contrats auto) —
 *      ces deux sections n'entraînent jamais l'envoi à elles seules.
 * Week-end (samedi, dimanche, heure de Paris) : envoi seulement si une NOUVEAUTÉ atteint SEUIL_WEEKEND
 * (500 €) ou est marquée urgente (relevé bancaire muet, départ imminent sans ménage) ; le reste attend
 * lundi (non marqué comme présenté).
 *
 * Missions AE (« Mes missions », 09/10/2026) : la vue missions_acceptation_a_signaler (migration 374) est
 * publiée ici même dans alerte_etat (source 'mission_acceptation', liste complète par agence → mêmes
 * règles : nouveau, rappels, clôture auto quand la mission est acceptée / réattribuée / passée).
 * Urgent (passe le week-end) : mission de dernière minute non acceptée, ou refus à réattribuer dont
 * la mission commence dans moins de 48 h.
 *
 * Écarts planning ↔ Hospitable (Lot 3a du hub des tâches, 10/10/2026, migration 384) : la vue
 * mission_ecart_a_signaler (EN RETARD seulement : AE en congé / jour off avec une mission, refus encore
 * assigné dans Hospitable hors « Missions AE à réattribuer », ménage sans séjour) est publiée de la même
 * façon (source 'ecart_taches', urgent). Les départs sans ménage n'y sont pas : alerte-sejour-sans-menage
 * les signale déjà (pas de doublon).
 *
 * Body : { agence?: 'dcb'|'lauian', dry_run?: true (rendu HTML renvoyé, aucune écriture),
 *          force?: true (ignore l'heure et l'anti-doublon), to?: string[] (test : remplace les
 *          destinataires, n'écrit rien en base — l'alerte reste « nouvelle » pour le vrai envoi),
 *          simuler_missions?: lignes de la vue ajoutées au rendu (dry_run uniquement, pour tester) }
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { destinataires, fmtEur, signaler, type ItemAlerte } from '../_shared/alertes.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const HEURE_ENVOI = 8                // heure de Paris
const SEUIL_WEEKEND = 50000          // 500 € : en dessous, une nouveauté du week-end attend lundi
const ECARTS_RAPPEL = [3, 4]         // 1er rappel J+3, 2e J+7 (3+4), puis tous les 7 jours
const ECART_RAPPEL_ENSUITE = 7
const MARGE_MS = 2 * 3600 * 1000     // tolérance d'horaire du cron

const SOURCE_MISSIONS = 'mission_acceptation'
const SOURCE_ECARTS = 'ecart_taches'
const LIBELLES: Record<string, string> = {
  mission_acceptation: 'Missions AE à accepter ou à réattribuer',
  ecart_taches: 'Planning ↔ Hospitable : écarts en retard',
  paiement_honoraires: 'Paiements reçus non enregistrés dans Evoliz',
  fraicheur_banque: 'Relevés bancaires muets',
  sequestre: 'Séquestre',
  encaissement_proprio_incoherent: 'Argent reçu sur un bien « encaissement propriétaire »',
  virement_orphelin: 'Virements OTA sans réservation',
  solde_booking_platform: 'Soldes, contrats annulés et baux à vérifier',
  solde_manuel: 'Soldes manquants (résas manuelles)',
  menage_orphelin: 'Ménages AE sans réservation',
  sejour_sans_menage: 'Séjours sans mission de ménage',
  prestation_doublon: 'Prestations en double',
  changement_post_facture: 'Réservations modifiées après facture',
  ajustement_a_qualifier: 'Ajustements Hospitable à qualifier',
  facture_non_envoyee: 'Factures Evoliz non envoyées',
}
const ORDRE = Object.keys(LIBELLES)
const NOM_AGENCE: Record<string, string> = { dcb: 'DCB', lauian: 'Lauïan' }

function paris(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(d).map(x => [x.type, x.value]))
  return { jour: `${p.year}-${p.month}-${p.day}`, heure: Number(p.hour), weekend: ['sam.', 'dim.'].includes(p.weekday) }
}
const jours = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000))
const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function rappelDu(a: any) {
  if (!a.last_notified_at || a.nb_notifications < 1) return false
  const ecart = ECARTS_RAPPEL[a.nb_notifications - 1] ?? ECART_RAPPEL_ENSUITE
  return Date.now() - new Date(a.last_notified_at).getTime() >= ecart * 86400000 - MARGE_MS
}
const urgent = (a: any) => a.detail?.urgent === true || (a.montant_cts ?? 0) >= SEUIL_WEEKEND
const parSource = (l: any[]) => {
  const m = new Map<string, any[]>()
  for (const a of l) { if (!m.has(a.source)) m.set(a.source, []); m.get(a.source)!.push(a) }
  return [...m.entries()].sort((x, y) => (ORDRE.indexOf(x[0]) + 99) % 99 - (ORDRE.indexOf(y[0]) + 99) % 99)
}

// ── Missions AE à accepter (vue missions_acceptation_a_signaler, migration 374) ──────────────
const H48 = 48 * 3600 * 1000
const JOURS_FR = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']
const MOTIFS: Record<string, string> = { indisponible: 'indisponible', horaire: 'horaire impossible', trop_loin: 'trop loin', autre: 'autre', hospitable: 'refusée dans Hospitable' }
const fmtH = (h: string | null) => { if (!h) return ''; const [hh, mm] = h.split(':'); return `${Number(hh)}h${mm && mm !== '00' ? mm : ''}` }
// Heure de Paris (date + heure locale) → instant UTC
function parisVersUtc(date: string, heure: string | null) {
  const naif = new Date(`${date}T${(heure || '08:00').slice(0, 5)}:00Z`)
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(naif).map(x => [x.type, x.value]))
  const vuParis = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute)
  return new Date(naif.getTime() - (vuParis - naif.getTime()))
}
const quandMission = (date: string, heure: string | null) => {
  const d = new Date(date + 'T12:00:00Z')
  return `${JOURS_FR[d.getUTCDay()]} ${date.slice(8, 10)}/${date.slice(5, 7)}${heure ? ' à ' + fmtH(heure) : ''}`
}
const leFr = (iso: string | null) => iso ? new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(' ', ' à ').replace(':', 'h') : '?'

// deno-lint-ignore no-explicit-any
function itemsMissions(rows: any[]): Record<string, ItemAlerte[]> {
  const out: Record<string, ItemAlerte[]> = { dcb: [], lauian: [] }
  for (const r of rows) {
    const ag = r.agence === 'lauian' ? 'lauian' : 'dcb'
    const debut = parisVersUtc(r.date_mission, r.heure_mission)
    const moins48 = debut.getTime() - Date.now() <= H48
    const bien = r.bien_code || r.bien_nom || 'bien ?'
    const quand = quandMission(r.date_mission, r.heure_mission)
    const ae = r.ae_prenom || 'AE ?'
    let libelle: string, urgentM: boolean
    if (r.categorie === 'refus_a_reattribuer') {
      libelle = `✕ Refus à réattribuer — ${bien}, ${quand} — ${ae} (${MOTIFS[r.refus_motif] || 'sans motif'}${r.refus_precision ? ' : ' + r.refus_precision : ''})`
        + (r.refus_apres_acceptation ? ' · après l\'avoir acceptée' : '')
        + (r.hospitable_desassignee ? ' · retirée d\'Hospitable' : r.hospitable_erreur ? ' · ⚠️ toujours assignée dans Hospitable' : '')
      urgentM = moins48
    } else if (r.categorie === 'derniere_minute_en_retard') {
      libelle = `⏰ Dernière minute pas acceptée — ${bien}, ${quand} — ${ae} (attribuée le ${leFr(r.depuis)})`
      urgentM = true
    } else {
      libelle = `⏳ Pas encore acceptée, mission dans moins de 48 h — ${bien}, ${quand} — ${ae} (attribuée le ${leFr(r.depuis)})`
      urgentM = false
    }
    out[ag].push({ cle: `${r.categorie}:${r.mission_id}`, libelle, montant_cts: null,
      detail: { urgent: urgentM, categorie: r.categorie, mission_id: r.mission_id, debut: debut.toISOString(), bien, ae } })
  }
  return out
}
// ── Écarts planning ↔ Hospitable en retard (vue mission_ecart_a_signaler, migration 384) ─────
// deno-lint-ignore no-explicit-any
function itemsEcarts(rows: any[]): Record<string, ItemAlerte[]> {
  const out: Record<string, ItemAlerte[]> = { dcb: [], lauian: [] }
  for (const r of rows) {
    const ag = r.agence === 'lauian' ? 'lauian' : 'dcb'
    const bien = r.bien_code || r.bien_nom || 'bien ?'
    const quand = quandMission(r.date_ref, r.heure)
    out[ag].push({ cle: r.cle, libelle: `⚠️ ${bien}, ${quand} — ${r.pourquoi} (à régler avant le ${leFr(r.echeance)})`, montant_cts: null,
      detail: { urgent: true, genre: r.genre, mission_id: r.mission_id, debut: parisVersUtc(r.date_ref, r.heure).toISOString(), bien } })
  }
  return out
}
// Sans écriture (dry_run / test) : ce que alerte_signaler() produirait, appliqué en mémoire (une ou plusieurs sources)
// deno-lint-ignore no-explicit-any
function simulerSignalement(toutes: any[], parSourceItems: Record<string, Record<string, ItemAlerte[]>>, agences: string[]) {
  const sources = Object.keys(parSourceItems)
  const garde = toutes.filter(a => !sources.includes(a.source) || !agences.includes(a.agence))
  for (const source of sources) for (const ag of agences) {
    const existants = new Map(toutes.filter(a => a.source === source && a.agence === ag).map(a => [a.cle, a]))
    for (const it of parSourceItems[source][ag] || []) {
      const ex = existants.get(it.cle)
      garde.push(ex ? { ...ex, libelle: it.libelle, detail: it.detail }
        : { id: 'sim:' + source + ':' + ag + ':' + it.cle, source, agence: ag, cle: it.cle, libelle: it.libelle, montant_cts: null, detail: it.detail,
            first_seen: new Date().toISOString(), last_seen: new Date().toISOString(), resolved_at: null, last_notified_at: null, nb_notifications: 0 })
    }
  }
  return garde
}

function rendu(agence: string, jour: string, nouveaux: any[], rappels: any[], ouverts: any[], clos: number, infos: string[], autre: string | null) {
  const td = 'padding:7px 14px;border-bottom:1px solid #EDE6D8;font-size:13px;color:#2C2416;vertical-align:top'
  const titreSec = (t: string, c = '#2C2416') => `<tr><td style="padding:18px 24px 6px;font-size:15px;font-weight:bold;color:${c}">${t}</td></tr>`
  const ligne = (a: any, suffixe = '') => `<tr><td style="${td}">${esc(a.libelle)}${suffixe}</td><td style="${td};text-align:right;white-space:nowrap;font-weight:bold;color:#CC9933">${a.montant_cts ? fmtEur(a.montant_cts) : ''}</td></tr>`
  const bloc = (l: any[], suff: (a: any) => string = () => '') => parSource(l).map(([src, items]) =>
    `<tr><td style="padding:8px 24px 2px;font-size:12px;color:#9C8E7D;text-transform:uppercase;letter-spacing:.5px">${esc(LIBELLES[src] || src)}</td></tr>
     <tr><td style="padding:0 10px"><table width="100%" cellpadding="0" cellspacing="0">${items.sort((a, b) => (b.montant_cts || 0) - (a.montant_cts || 0) || String(a.detail?.debut || '').localeCompare(String(b.detail?.debut || ''))).map(a => ligne(a, suff(a))).join('')}</table></td></tr>`).join('')
  const sNouveau = nouveaux.length ? titreSec(`🆕 Nouveau (${nouveaux.length})`, '#B91C1C') + bloc(nouveaux) : ''
  const sRappel = rappels.length ? titreSec(`🔁 Rappel (${rappels.length})`) + bloc(rappels, a =>
    `<br><span style="font-size:11px;color:#9C8E7D">signalé il y a ${jours(a.first_seen)} j — rappel n° ${a.nb_notifications}</span>`) : ''
  const sOuvert = ouverts.length ? titreSec(`📌 Toujours ouvert`) + `<tr><td style="padding:0 10px"><table width="100%" cellpadding="0" cellspacing="0">${parSource(ouverts).map(([src, items]) => {
    const total = items.reduce((t, a) => t + (a.montant_cts || 0), 0)
    const plusAncien = Math.max(...items.map(a => jours(a.first_seen)))
    return `<tr><td style="${td}">${esc(LIBELLES[src] || src)} : <strong>${items.length}</strong>${total ? ` (${fmtEur(total)})` : ''} — le plus ancien depuis ${plusAncien} j</td></tr>`
  }).join('')}</table></td></tr>` : ''
  const sPied = [
    clos ? `✅ ${clos} alerte${clos > 1 ? 's' : ''} close${clos > 1 ? 's' : ''} d'elle${clos > 1 ? 's' : ''}-même depuis le dernier point (anomalie disparue).` : '',
    ...infos, autre || '',
  ].filter(Boolean).map(t => `<tr><td style="padding:3px 24px;font-size:12px;color:#666">${esc(t)}</td></tr>`).join('')
  const dateTxt = jour.split('-').reverse().join('/')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#f5f0e8;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 10px"><tr><td align="center">
<table width="680" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;max-width:680px;width:100%">
  <tr><td style="background:#EAE3D4;border-bottom:2px solid #CC9933;padding:18px 24px">
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#8C7B65">${esc(NOM_AGENCE[agence] || agence)}</div>
    <div style="font-size:19px;font-weight:bold;color:#2C2416;margin-top:4px">☀️ Point du matin — ${dateTxt}</div></td></tr>
  ${sNouveau}${sRappel}${sOuvert}
  ${sPied ? `<tr><td style="padding:12px 0 6px"><table width="100%" cellpadding="0" cellspacing="0">${sPied}</table></td></tr>` : ''}
  <tr><td style="background:#f9f6f0;padding:12px 24px;font-size:11px;color:#9C8E7D;text-align:center">
    Un seul mail par jour, seulement s'il y a du nouveau ou un rappel (J+3, J+7 puis chaque semaine). Week-end : seulement au-delà de 500 € ou urgent.
    Une alerte se clôt d'elle-même quand l'anomalie disparaît. Destinataires : table notification_destinataire.</td></tr>
</table></td></tr></table></body></html>`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
  // deno-lint-ignore no-explicit-any
  let body: { agence?: string; dry_run?: boolean; force?: boolean; to?: string[]; simuler_missions?: any[] } = {}
  try { body = await req.json() } catch { /* cron */ }
  const dryRun = body.dry_run === true
  const test = Array.isArray(body.to) && body.to.length > 0
  const now = paris()
  if (!dryRun && !body.force && !test && now.heure !== HEURE_ENVOI)
    return json({ ok: true, skipped: `heure de Paris ${now.heure} ≠ ${HEURE_ENVOI}` })

  const agences = body.agence ? [body.agence] : ['dcb', 'lauian']
  const resultats: unknown[] = []

  // Missions AE à accepter / réattribuer → alerte_etat (liste complète par agence). En dry_run / test :
  // rien n'est écrit, le résultat de alerte_signaler() est simulé en mémoire.
  const ecrire = !dryRun && !test
  const { data: rowsMissions, error: errMissions } = await supabase.from('missions_acceptation_a_signaler').select('*').order('date_mission')
  const lignesMissions = [...(rowsMissions || []), ...(dryRun && Array.isArray(body.simuler_missions) ? body.simuler_missions : [])]
  const itemsM = itemsMissions(lignesMissions)
  if (errMissions) {
    await supabase.from('journal_ops').insert({ categorie: 'alerte', action: 'point_du_matin', source: 'cron', statut: 'error', message: `missions_acceptation_a_signaler illisible : ${errMissions.message}` })
  } else if (ecrire) {
    for (const ag of agences) {
      try { await signaler(supabase, SOURCE_MISSIONS, ag, itemsM[ag] || []) }
      catch (e) { await supabase.from('journal_ops').insert({ categorie: 'alerte', action: 'point_du_matin', source: 'cron', statut: 'error', message: String((e as Error).message || e).slice(0, 300) }) }
    }
  }

  // Écarts planning ↔ Hospitable en retard → alerte_etat (source 'ecart_taches', même mécanique)
  const { data: rowsEcarts, error: errEcarts } = await supabase.from('mission_ecart_a_signaler').select('*').order('date_ref')
  const itemsE = itemsEcarts(rowsEcarts || [])
  if (errEcarts) {
    await supabase.from('journal_ops').insert({ categorie: 'alerte', action: 'point_du_matin', source: 'cron', statut: 'error', message: `mission_ecart_a_signaler illisible : ${errEcarts.message}` })
  } else if (ecrire) {
    for (const ag of agences) {
      try { await signaler(supabase, SOURCE_ECARTS, ag, itemsE[ag] || []) }
      catch (e) { await supabase.from('journal_ops').insert({ categorie: 'alerte', action: 'point_du_matin', source: 'cron', statut: 'error', message: String((e as Error).message || e).slice(0, 300) }) }
    }
  }

  // Ouvertes de toutes les agences (ligne de synthèse Lauïan dans le point DCB)
  const { data: lues, error } = await supabase.from('alerte_etat').select('*').is('resolved_at', null)
  if (error) return json({ error: error.message }, 500)
  const aSimuler: Record<string, Record<string, ItemAlerte[]>> = {}
  if (!errMissions) aSimuler[SOURCE_MISSIONS] = itemsM
  if (!errEcarts) aSimuler[SOURCE_ECARTS] = itemsE
  const toutes = !ecrire ? simulerSignalement(lues || [], aSimuler, agences) : (lues || [])

  for (const agence of agences) {
    if (!dryRun && !body.force && !test) {
      const { data: deja } = await supabase.from('point_du_matin_envoi').select('jour').eq('agence', agence).eq('jour', now.jour).maybeSingle()
      if (deja) { resultats.push({ agence, skipped: 'déjà envoyé aujourd\'hui' }); continue }
    }
    const ouvertes = (toutes || []).filter(a => a.agence === agence)
    let nouveaux = ouvertes.filter(a => a.nb_notifications === 0)
    let rappels = ouvertes.filter(rappelDu)
    if (now.weekend) { nouveaux = nouveaux.filter(urgent); rappels = [] }
    const presentes = new Set([...nouveaux, ...rappels].map(a => a.id))
    const reste = ouvertes.filter(a => !presentes.has(a.id))

    // Clos depuis le dernier envoi
    const { data: dernier } = await supabase.from('point_du_matin_envoi').select('envoye_at').eq('agence', agence).order('jour', { ascending: false }).limit(1).maybeSingle()
    const depuis = dernier?.envoye_at || new Date(Date.now() - 86400000).toISOString()
    const { count: clos } = await supabase.from('alerte_etat').select('id', { count: 'exact', head: true }).eq('agence', agence).gte('resolved_at', depuis)

    // Pour info (n'entraîne pas d'envoi)
    const infos: string[] = []
    if (errMissions) infos.push(`⚠️ Missions AE à accepter : lecture impossible ce matin (${errMissions.message}).`)
    const hier = new Date(Date.now() - 86400000).toISOString()
    const { data: envois } = await supabase.from('contract_events').select('contract_id, rental_contracts!inner(agence)')
      .eq('event_type', 'sent_email').eq('actor', 'auto_send').gte('created_at', hier).eq('rental_contracts.agence', agence)
    if (envois?.length) infos.push(`ℹ️ ${envois.length} contrat(s) envoyé(s) automatiquement au voyageur depuis hier (onglet Contrats).`)
    if (agence === 'dcb') {
      const { data: rel } = await supabase.from('journal_ops').select('action').in('action', ['relance_facture', 'relance_debours']).eq('statut', 'ok').gte('created_at', hier)
      if (rel?.length) infos.push(`ℹ️ ${rel.length} relance(s) propriétaire envoyée(s) depuis hier (${rel.filter(r => r.action === 'relance_facture').length} facture, ${rel.filter(r => r.action === 'relance_debours').length} débours) — plus de copie mail, trace dans journal_ops.`)
    }
    // Séquestre non calculé cette nuit : à dire, sinon un silence passerait pour « rien à signaler »
    const { data: seq } = await supabase.from('sequestre_compte').select('agence').eq('agence', agence).eq('actif', true).maybeSingle()
    if (seq) {
      const { data: j } = await supabase.from('sequestre_justificatif').select('date').eq('agence', agence).order('date', { ascending: false }).limit(1).maybeSingle()
      if (!j || j.date < now.jour) infos.push(`⚠️ Justificatif séquestre non recalculé cette nuit (dernier : ${j?.date ? j.date.split('-').reverse().join('/') : 'aucun'}).`)
    }
    // Synthèse de l'autre agence pour Oïhan (une ligne)
    let autre: string | null = null
    if (agence === 'dcb') {
      const l = (toutes || []).filter(a => a.agence === 'lauian')
      if (l.length) autre = `Lauïan (point envoyé à Laura) : ${l.filter(a => a.nb_notifications === 0).length} nouvelle(s), ${l.length} ouverte(s) au total.`
    }

    const aEnvoyer = nouveaux.length + rappels.length > 0
    const html = rendu(agence, now.jour, nouveaux, rappels, reste, clos || 0, infos, autre)
    const sujet = `☀️ Point du matin ${NOM_AGENCE[agence] || agence} — ${nouveaux.length ? `${nouveaux.length} nouveau${nouveaux.length > 1 ? 'x' : ''}` : ''}${nouveaux.length && rappels.length ? ', ' : ''}${rappels.length ? `${rappels.length} rappel${rappels.length > 1 ? 's' : ''}` : ''}${!aEnvoyer ? 'rien de nouveau' : ''}`
    const to = test ? body.to! : await destinataires(supabase, 'point_du_matin', agence)

    if (dryRun || (!aEnvoyer && !test)) {
      resultats.push({ agence, envoi: dryRun ? 'dry_run' : 'rien à envoyer', a_envoyer: aEnvoyer, weekend: now.weekend, to, sujet,
        nouveaux: nouveaux.length, rappels: rappels.length, ouverts: reste.length, clos: clos || 0, html: dryRun ? html : undefined })
      continue
    }

    const res = await fetch(`${SUPABASE_URL}/functions/v1/smtp-send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ to, subject: test ? `[TEST] ${sujet}` : sujet, html }),
    })
    const r = await res.json().catch(() => ({}))
    if (!res.ok || !r?.ok) {
      await supabase.from('journal_ops').insert({ categorie: 'alerte', action: 'point_du_matin', source: 'cron', statut: 'error', message: `${agence} : envoi échoué — ${JSON.stringify(r).slice(0, 300)}` })
      resultats.push({ agence, error: r }); continue
    }
    if (!test) {
      const ids = [...presentes]
      for (const a of ouvertes.filter(x => presentes.has(x.id)))
        await supabase.from('alerte_etat').update({ last_notified_at: new Date().toISOString(), nb_notifications: a.nb_notifications + 1 }).eq('id', a.id)
      await supabase.from('point_du_matin_envoi').upsert({ agence, jour: now.jour, envoye_at: new Date().toISOString(), destinataires: to,
        nb_nouveaux: nouveaux.length, nb_rappels: rappels.length, nb_ouverts: reste.length, resend_id: r.id || null }, { onConflict: 'agence,jour' })
      await supabase.from('journal_ops').insert({ categorie: 'alerte', action: 'point_du_matin', source: 'cron', statut: 'ok',
        message: `${agence} : ${nouveaux.length} nouveau(x), ${rappels.length} rappel(s), ${reste.length} toujours ouvert(s) — envoyé à ${to.join(', ')} (${ids.length} alerte(s) marquée(s) présentée(s))` })
    }
    resultats.push({ agence, envoye: true, test, to, sujet, nouveaux: nouveaux.length, rappels: rappels.length, ouverts: reste.length })
  }
  return json({ ok: true, jour: now.jour, weekend: now.weekend, resultats })
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json' } })
}
