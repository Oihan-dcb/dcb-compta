/**
 * alerte-solde-booking-platform — Edge Function Supabase (cron quotidien 8h09 UTC via pg_cron)
 *
 * Failsafe pour deux trous de surveillance découverts le 30/08/2026 en enquêtant sur la
 * clôture août dcb-compta (voir mémoire project_contrat_annule_ne_maj_pas_reservation) :
 *
 * 1. `mode_paiement='booking_platform'` (résas Direct/Manual où le contrat suppose que
 *    Hospitable encaisse — voir dcb-planning/api/cron-auto-contracts.js) ne planifie jamais
 *    de prélèvement, et [[alerte-solde-manuel]] ne surveille que les modes virement à venir.
 *    Aucun filet ne vérifie après coup que l'argent est réellement arrivé après `date_solde`.
 *    Cas trouvés : HOST-AX90XD (3447,09€, 24j de retard) et HOST-WSW44G (862€, 30j de retard).
 *
 * 2. Un contrat `rental_contracts.statut='cancelled'` ne propage jamais l'annulation vers
 *    `reservation.final_status` — la réservation reste active et ventilée indéfiniment.
 *    Cas trouvés : YGWYZL, HOST-5DNMNT, HOST-8PJIH7, HOST-0XN4AF.
 *    Volontairement PAS d'auto-annulation ici : un contrat peut être annulé APRÈS un séjour
 *    déjà eu lieu (cas HOST-TJNPFC — cliente restée sans jamais payer, contrat annulé a
 *    posteriori) — auto-annuler la réservation effacerait un vrai séjour. Alerte uniquement,
 *    décision humaine.
 *
 * Même architecture que alerte-solde-manuel : un seul Edge Function partagé DCB/Lauian,
 * agence passée dans le body du cron, mail récap quotidien qui s'arrête de lui-même dès que
 * la situation est résolue (rapprochee=true ou reservation réellement annulée).
 *
 * owner_stay exclu des deux sections (ajouté le 07/09/2026, même bug que alerte-solde-manuel
 * cf. project_alerte_solde_manuel) : un séjour propriétaire manuel peut avoir un contrat
 * auto-généré puis annulé (pas un vrai locataire), ou un guest_name = nom du propriétaire —
 * sans ce filtre, 3 des 19 lignes "Contrat annulé" de la section 2 étaient les propriétaires
 * eux-mêmes (Andrea/SCI du Tourmalet-MUNDUZ, Dominique belair/408P, Vincent Balhadere×2).
 *
 * Section 1 restreinte à platform='manual' (ajouté le 07/09/2026, demande Oïhan) : des
 * réservations mode_paiement='booking_platform' existent aussi pour platform='booking' et
 * 'direct' — encaissées via leur propre circuit (Booking.com/Airbnb rapprochés en banque,
 * 'direct' via Stripe Hospitable), jamais un vrai solde en souffrance côté DCB. 13 des 14
 * lignes affichées avant ce fix étaient platform='booking'. La section 2 (contrats annulés)
 * n'a pas cette restriction — la question posée là est différente (cohérence contrat/résa,
 * pas qui encaisse), et les cas restants après le fix owner_stay sont tous vérifiés réels.
 *
 * Audit des mails du 09/10/2026 (vérification au cas par cas des alertes en cours) :
 * • Section 1 excluait déjà Booking/Airbnb/direct ; restait le BAIL MOBILITÉ (type_contrat
 *   'mobilite', ex. 8B2SOT PATXI) : son contrat porte mode_paiement='booking_platform' par défaut
 *   mais le loyer suit un ÉCHÉANCIER (bail_data.conditions) versé sur le compte LOYERS — l'alerte
 *   annonçait « 1 350 € dû le 06/10 » alors que le bail prévoit 731,67 € le 01/10 et le 15/10.
 *   → section 1 hors bail ; section 3 dédiée : échéances échues (J+5) comparées aux virements
 *   reçus sur le compte loyers (lld_mouvement_bancaire) au nom du payeur ou du locataire.
 * • Section 2 signalait un contrat annulé JAMAIS ENVOYÉ (brouillon auto-généré mis en attente
 *   « durée longue » puis annulé par le staff, ex. 2XOHEF ENEKO) : ce n'est pas une annulation
 *   voyageur. → seuls les contrats réellement envoyés (sent_at/signed_at) comptent.
 * • Plus de mail : la liste complète est publiée dans alerte_etat (source 'solde_booking_platform')
 *   et remonte dans le Point du matin (nouveau en tête, rappels J+3/J+7, ouvert sur une ligne).
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { signaler, fmtEur, fmtDateFr, type ItemAlerte } from '../_shared/alertes.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SOURCE = 'solde_booking_platform'
const DELAI_BANCAIRE_JOURS = 5 // une échéance de bail n'est signalée que 5 jours après sa date (délai de virement)

const norm = (s: string) => (s || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9 ]/g, ' ')
function addDays(iso: string, n: number) {
  const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}

/** Échéances d'un bail mobilité : échéancier personnalisé, sinon loyer+charges+complément mensuels. */
function echeancesBail(bail: any): { date: string; montant_cts: number }[] {
  const c = bail?.conditions || {}
  if (Array.isArray(c.echeancier_perso) && c.echeancier_perso.length)
    return c.echeancier_perso.filter((e: any) => e?.date && e?.montant_cts > 0).map((e: any) => ({ date: e.date, montant_cts: e.montant_cts }))
  const mensuel = (c.loyer_cts || 0) + (c.charges_cts || 0) + (c.complement_cts || 0)
  if (!mensuel || !c.date_effet) return []
  const out: { date: string; montant_cts: number }[] = []
  const jour = Math.min(Math.max(Number(c.jour_paiement) || 1, 1), 28)
  let [y, m] = c.date_effet.split('-').map(Number)
  const fin = c.date_fin || c.date_effet
  for (let i = 0; i < 24; i++) {
    const d = `${y}-${String(m).padStart(2, '0')}-${String(jour).padStart(2, '0')}`
    if (d > fin) break
    out.push({ date: d < c.date_effet ? c.date_effet : d, montant_cts: mensuel })
    m++; if (m > 12) { m = 1; y++ }
  }
  return out
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
  let body: { dry_run?: boolean; agence?: string } = {}
  try { body = await req.json() } catch { /* GET accepté */ }
  const dryRun = body.dry_run === true
  const AGENCE = body.agence || 'dcb'
  const today = new Date().toISOString().slice(0, 10)

  // ── 1. Solde booking_platform jamais confirmé (hors bail mobilité : section 3) ──
  const { data: contratsSignesRaw, error: errSignes } = await supabase
    .from('rental_contracts')
    .select('reservation_id, date_solde, solde_montant_cts, type_contrat')
    .eq('mode_paiement', 'booking_platform')
    .eq('statut', 'signed')
    .lt('date_solde', today)
    .is('solde_confirme_at', null)
  if (errSignes) return json({ error: errSignes.message }, 500)
  const contratsSignes = (contratsSignesRaw || []).filter(c => c.type_contrat !== 'mobilite')

  // ── 2. Contrat annulé (après envoi au voyageur) mais réservation encore active ──
  // Une même réservation peut avoir plusieurs lignes rental_contracts annulées
  // (regénérations successives) — dédupliquer par reservation_id avant tout.
  // Un brouillon jamais envoyé puis annulé par le staff n'est pas une annulation voyageur
  // (2XOHEF ENEKO, 09/10/2026) : sent_at ou signed_at obligatoire.
  const { data: contratsAnnulesRaw, error: errAnnules } = await supabase
    .from('rental_contracts')
    .select('reservation_id, sent_at, signed_at')
    .eq('statut', 'cancelled')
  if (errAnnules) return json({ error: errAnnules.message }, 500)
  const contratsAnnules = Array.from(
    new Map((contratsAnnulesRaw || []).filter(c => c.sent_at || c.signed_at).map(c => [c.reservation_id, c])).values()
  )
  // Contrat regénéré : la même résa a aussi un contrat signé → l'annulé n'est qu'une ancienne
  // version (Phoebe Keen 6576088580 : signé + annulé le 08/06)
  const { data: signesTous } = await supabase
    .from('rental_contracts').select('reservation_id').eq('statut', 'signed')
    .in('reservation_id', contratsAnnules.map(c => c.reservation_id))
  const resaAvecSigne = new Set((signesTous || []).map(c => c.reservation_id))

  // ── 3. Bail mobilité : échéances échues sans virement sur le compte loyers ──
  const { data: baux, error: errBaux } = await supabase
    .from('rental_contracts')
    .select('reservation_id, bail_data')
    .eq('type_contrat', 'mobilite')
    .eq('statut', 'signed')
    .not('reservation_id', 'is', null)
  if (errBaux) return json({ error: errBaux.message }, 500)

  const codesAVerifier = [
    ...contratsSignes.map(c => c.reservation_id),
    ...contratsAnnules.map(c => c.reservation_id),
    ...(baux || []).map(c => c.reservation_id),
  ]

  const { data: resas } = codesAVerifier.length ? await supabase
    .from('reservation')
    .select('code, guest_name, arrival_date, departure_date, fin_revenue, rapprochee, final_status, owner_stay, platform, bien!inner(code, agence)')
    .in('code', codesAVerifier)
    .eq('bien.agence', AGENCE) : { data: [] as any[] }
  const resaByCode = Object.fromEntries((resas || []).map(r => [r.code, r]))
  const items: ItemAlerte[] = []

  for (const c of contratsSignes) {
    const r = resaByCode[c.reservation_id]
    if (!r) continue
    // Uniquement platform='manual' : booking.com/airbnb/direct encaissent via leur propre
    // circuit (Hospitable Stripe pour 'direct', virement OTA rapproché en banque pour les
    // autres). Demande d'Oïhan le 07/09/2026 : 13 des 14 lignes étaient platform='booking'.
    if (r.platform !== 'manual') continue
    if (r.owner_stay) continue // séjour propriétaire, pas un solde voyageur
    if (r.rapprochee) continue // encaissé entre-temps
    if (['cancelled', 'not accepted'].includes(r.final_status)) continue
    if (!(r.fin_revenue > 0)) continue
    const montant = c.solde_montant_cts || r.fin_revenue || 0
    items.push({
      cle: `solde:${r.code}`,
      libelle: `${r.guest_name || '—'} (${r.bien?.code || '—'}) — solde ${fmtEur(montant)} dû le ${fmtDateFr(c.date_solde)}, jamais confirmé`,
      montant_cts: montant,
      detail: { resa: r.code, date_solde: c.date_solde },
    })
  }

  for (const c of contratsAnnules) {
    const r = resaByCode[c.reservation_id]
    if (!r) continue
    if (r.owner_stay) continue // séjour propriétaire — contrat auto-généré/annulé sans rapport avec un vrai locataire
    if (['cancelled', 'not accepted'].includes(r.final_status)) continue // déjà annulée, résolu
    if (!(r.fin_revenue > 0)) continue
    if (resaAvecSigne.has(c.reservation_id)) continue // contrat regénéré : une version signée existe
    // Airbnb / Booking : l'annulation passe par la plateforme — le contrat DCB n'y est qu'une annexe.
    if (!['direct', 'manual'].includes(r.platform)) continue
    // Encaissée (rapprochée) : séjour réel (12 fausses alertes Lauïan + 3 DCB au 28/09/2026).
    if (r.rapprochee) continue
    items.push({
      cle: `annule:${r.code}`,
      libelle: `${r.guest_name || '—'} (${r.bien?.code || '—'}) — contrat annulé mais réservation active, arrivée le ${fmtDateFr(r.arrival_date)}, jamais payée`,
      montant_cts: r.fin_revenue || 0,
      detail: { resa: r.code, arrivee: r.arrival_date },
    })
  }

  // Bail mobilité : virements reçus au nom du payeur (société) ou d'un locataire sur le compte loyers
  const bauxAgence = (baux || []).filter(b => resaByCode[b.reservation_id])
  if (bauxAgence.length) {
    const debutMin = bauxAgence.map(b => b.bail_data?.conditions?.date_effet).filter(Boolean).sort()[0] || today
    const { data: credits } = await supabase.from('lld_mouvement_bancaire')
      .select('date_operation, credit, libelle, detail')
      .eq('agence', AGENCE).gt('credit', 0).gte('date_operation', addDays(debutMin, -20))
    for (const b of bauxAgence) {
      const r = resaByCode[b.reservation_id]
      if (['cancelled', 'not accepted'].includes(r.final_status)) continue
      const bail = b.bail_data || {}
      const dues = echeancesBail(bail).filter(e => addDays(e.date, DELAI_BANCAIRE_JOURS) <= today)
      if (!dues.length) continue
      const du = dues.reduce((s, e) => s + e.montant_cts, 0)
      const noms = [bail.payeur?.actif ? bail.payeur?.raison_sociale : null,
        ...(bail.locataires || []).map((l: any) => l?.nom)]
        .filter(Boolean).map((n: string) => norm(n).trim()).filter((n: string) => n.length >= 4)
      const debut = addDays(bail.conditions?.date_effet || dues[0].date, -20)
      const recu = (credits || []).filter(m => m.date_operation >= debut &&
        noms.some(n => norm(`${m.libelle || ''} ${m.detail || ''}`).includes(n))).reduce((s, m) => s + (m.credit || 0), 0)
      if (recu >= du - 100) continue
      const derniere = dues[dues.length - 1]
      items.push({
        cle: `bail:${r.code}`,
        libelle: `Bail mobilité ${r.guest_name || '—'} (${r.bien?.code || '—'}) — ${fmtEur(du)} attendus au ${fmtDateFr(derniere.date)} (${dues.length} échéance${dues.length > 1 ? 's' : ''}), ${fmtEur(recu)} reçus sur le compte loyers`,
        montant_cts: du - recu,
        detail: { resa: r.code, du, recu, payeur: bail.payeur?.raison_sociale || null },
      })
    }
  }

  if (!dryRun) {
    const res = await signaler(supabase, SOURCE, AGENCE, items)
    await supabase.from('journal_ops').insert({
      categorie: 'facturation', action: 'alerte_solde_booking_platform', source: 'cron', statut: 'ok',
      message: `${items.length} résa(s) à vérifier (agence ${AGENCE}) — ${res.nouveaux} nouvelle(s), ${res.resolus} résolue(s) — publiée(s) pour le Point du matin`,
    })
  }

  return json({ dry_run: dryRun, agence: AGENCE, total: items.length, items })
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json' } })
}
