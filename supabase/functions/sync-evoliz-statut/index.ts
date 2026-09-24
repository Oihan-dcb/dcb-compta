/**
 * sync-evoliz-statut — Edge Function Supabase (cron quotidien)
 *
 * facture_evoliz.statut ne se met jamais à jour tout seul après l'envoi
 * (bug constaté 2026-08-05 : 117 factures réellement payées sur 146 selon
 * Evoliz, seulement 2 marquées 'payee' en base). Cette synchro interroge
 * Evoliz (statut réel, source de vérité) et met à jour statut='payee' dès
 * qu'une facture 'envoye_evoliz' est effectivement réglée côté Evoliz.
 *
 * Prérequis à la relance automatique (relance-facture-impayee) : sans cette
 * synchro, une relance basée sur le statut local relancerait indéfiniment
 * des propriétaires ayant déjà payé.
 *
 * Relit aussi, pour chaque facture, le TTC et le reste à payer RÉELS d'Evoliz, son numéro
 * définitif (F-…) et la date de paiement (audit I-153, 24/09/2026).
 *
 * Body optionnel : { agence: 'dcb' | 'lauian', dry_run?: true } — sinon les deux agences.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const EVOLIZ_COMPANY_ID: Record<string, string> = { dcb: '114158', lauian: '115576' }

// Alerte "factures jamais parties chez le client" (24/09/2026) : récap le lundi uniquement
// (ou { alerte: true } dans le body), au-delà de JOURS_TOLERANCE après émission — laisse le
// temps au cycle normal de validation/envoi dans Evoliz.
const JOURS_TOLERANCE = 15
const ALERTE_EMAIL = 'oihan@destinationcotebasque.com'

type NonEnvoyee = {
  agence: string; mois: string; bien: string; proprio: string; numero: string;
  statut_evoliz: string; net_a_payer: number; proprio_paie: boolean;
}

function fmtEur(n: number) {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

function htmlAlerte(lignes: NonEnvoyee[]) {
  const td = 'padding:8px 12px;border-bottom:1px solid #EDE6D8;font-size:13px;color:#2C2416'
  const th = 'padding:8px 12px;font-size:10px;color:#9C8E7D;text-transform:uppercase;letter-spacing:.5px;text-align:left'
  const bloc = (titre: string, note: string, ls: NonEnvoyee[]) => !ls.length ? '' : `
    <tr><td style="padding:20px 28px 6px;font-size:14px;font-weight:bold;color:#2C2416">${titre} (${ls.length})</td></tr>
    <tr><td style="padding:0 28px 8px;font-size:12px;color:#666">${note}</td></tr>
    <tr><td style="padding:0 16px"><table width="100%" cellpadding="0" cellspacing="0">
      <tr style="background:#FBF5E6"><th style="${th}">Mois</th><th style="${th}">Bien / propriétaire</th><th style="${th}">Evoliz</th><th style="${th}">Net à payer</th></tr>
      ${ls.map(l => `<tr><td style="${td}">${l.mois}<br><span style="color:#9C8E7D;font-size:11px">${l.agence}</span></td>
        <td style="${td}"><strong>${l.bien}</strong><br><span style="color:#9C8E7D;font-size:11px">${l.proprio}</span></td>
        <td style="${td}">${l.numero}<br><span style="color:${l.statut_evoliz === 'filled' ? '#C0392B' : '#CC9933'};font-size:11px">${l.statut_evoliz === 'filled' ? 'brouillon' : l.statut_evoliz === 'debours_non_envoye' ? 'demande de débours jamais envoyée' : 'validée, non envoyée'}</span></td>
        <td style="${td};font-weight:bold">${fmtEur(l.net_a_payer)}</td></tr>`).join('')}
    </table></td></tr>`
  const proprio = lignes.filter(l => l.proprio_paie), autres = lignes.filter(l => !l.proprio_paie)
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#f5f0e8;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
  <table width="720" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;max-width:720px;width:100%">
    <tr><td style="background:#CC9933;padding:22px 28px;text-align:center;color:#fff">
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:.85">Destination Côte Basque</div>
      <div style="font-size:18px;font-weight:bold;margin-top:6px">⚠ Factures / débours jamais envoyés au propriétaire</div>
      <div style="font-size:13px;opacity:.8;margin-top:4px">${lignes.length} facture(s) émise(s) il y a plus de ${JOURS_TOLERANCE} jours, encore en brouillon ou non envoyées</div>
    </td></tr>
    ${bloc('Le propriétaire paie lui-même', 'Risque réel : il ne peut pas payer une facture qu\'il n\'a pas reçue. Valider puis envoyer depuis Evoliz. Tant qu\'une facture est en brouillon, un paiement reçu ne peut pas y être enregistré (« This invoice is not payable »).', proprio)}
    ${bloc('Honoraires prélevés sur le reversement', 'Pas de risque de paiement (déjà prélevés), mais la facture doit être validée dans Evoliz pour la comptabilité.', autres)}
    <tr><td style="padding:18px 28px;font-size:11px;color:#9C8E7D;text-align:center;background:#f9f6f0">Récap hebdomadaire (lundi) — généré par sync-evoliz-statut.</td></tr>
  </table></td></tr></table></body></html>`
}

async function evolizListInvoices(companyId: string, dateFrom: string, dateTo: string) {
  let page = 1
  const all: any[] = []
  while (true) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/evoliz-proxy`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'listInvoices', companyId,
        payload: { period: 'custom', dateFrom, dateTo, per_page: 100, page },
      }),
    })
    const json = await res.json()
    if (!res.ok || json?.error) throw new Error(`Evoliz listInvoices: ${JSON.stringify(json)}`)
    const items = json?.data?.data || []
    all.push(...items)
    const lastPage = json?.data?.meta?.last_page || 1
    if (page >= lastPage) break
    page++
  }
  return all
}

async function evolizCreatePayment(companyId: string, invoiceId: string, amount: number, paydate: string) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/evoliz-proxy`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'createPayment', companyId,
      payload: { invoiceId, paydate, amount, paytypeid: 6, label: 'Retenue sur le reversement (frais déduits du loyer)' },
    }),
  })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok && !json?.error && (json?.status === 200 || json?.status === 201), json }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  let body: { agence?: string; alerte?: boolean; dry_run?: boolean } = {}
  try { body = await req.json() } catch { /* cron sans body */ }
  const agences = body.agence ? [body.agence] : ['dcb', 'lauian']

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
  const results: Record<string, unknown> = {}
  const aSignaler: NonEnvoyee[] = []

  const now = new Date()
  const dateTo = now.toISOString().slice(0, 10)

  for (const agence of agences) {
    const companyId = EVOLIZ_COMPANY_ID[agence]
    if (!companyId) { results[agence] = { error: 'agence inconnue' }; continue }

    try {
      // Factures à relire : encore ouvertes, jamais relues, ou payées sans date de paiement
      // (audit I-153 : 135 factures payées sans date, numéros T- de brouillon jamais remplacés).
      const { data: factures, error } = await supabase
        .from('facture_evoliz')
        .select('id, id_evoliz, statut, mois, total_ttc, type_facture, date_emission, date_paiement, numero_facture, total_ttc_evoliz, reste_a_payer_evoliz, evoliz_synced_at, montant_retenu_loyer, retenue_evoliz_payee_at, bien:bien_id(code, mode_encaissement), proprietaire:proprietaire_id(nom, prenom)')
        .eq('agence', agence)
        .in('statut', ['envoye_evoliz', 'payee'])
        .not('id_evoliz', 'is', null)
        .neq('id_evoliz', 'N/A')
        .or('statut.eq.envoye_evoliz,evoliz_synced_at.is.null,date_paiement.is.null')
      if (error) throw error
      if (!factures?.length) { results[agence] = { checked: 0, updated: 0 }; continue }

      // Fenêtre = depuis la plus ancienne facture à relire (avant : 6 mois glissants — une
      // facture impayée de plus de 6 mois n'était plus jamais contrôlée, sans alerte).
      const plusAncienne = factures.map(f => f.date_emission).filter(Boolean).sort()[0]
      const dateFrom = plusAncienne && plusAncienne < '2026-01-01' ? plusAncienne : '2026-01-01'
      const invoices = await evolizListInvoices(companyId, dateFrom, dateTo)
      const statutById = new Map(invoices.map((inv: any) => [String(inv.invoiceid), inv]))

      let updated = 0, enrichies = 0, introuvables = 0
      const updatedIds: string[] = []
      const nonEnvoyees: NonEnvoyee[] = []
      const limite = new Date(now); limite.setDate(limite.getDate() - JOURS_TOLERANCE)
      for (const f of factures) {
        const inv = statutById.get(String(f.id_evoliz))
        if (!inv) { introuvables++; continue } // supprimée chez Evoliz, ou émise avant dateFrom
        const cts = (v: unknown) => v == null ? null : Math.round(Number(v) * 100)
        // Frais déjà retenus sur le reversement d'un bien mode proprio (migration 270) : posés
        // comme paiement partiel dès que la facture est validée (Evoliz refuse un paiement sur un
        // brouillon 'filled'). Une seule fois (retenue_evoliz_payee_at).
        if ((f as any).montant_retenu_loyer > 0 && !(f as any).retenue_evoliz_payee_at
            && inv.status !== 'filled' && inv.status !== 'paid' && (inv.total?.net_to_pay ?? 0) > 0 && !body.dry_run) {
          const retenu = Math.min((f as any).montant_retenu_loyer, cts(inv.total?.net_to_pay) || 0)
          const pay = await evolizCreatePayment(companyId, String(f.id_evoliz), retenu / 100, dateTo)
          if (pay.ok) {
            await supabase.from('facture_evoliz').update({ retenue_evoliz_payee_at: now.toISOString() }).eq('id', f.id)
            inv.total.net_to_pay = Math.max(0, Number(inv.total.net_to_pay) - retenu / 100)
            if (inv.total.net_to_pay <= 0) inv.status = 'paid'
          }
        }
        const payee = inv.status === 'paid' && (inv.total?.net_to_pay ?? 0) <= 0
        // Montant/numéro réels (Evoliz recalcule la TVA : écarts de centimes ; le numéro
        // définitif F- remplace le T- du brouillon à la validation)
        const maj: Record<string, unknown> = {
          total_ttc_evoliz: cts(inv.total?.vat_include),
          reste_a_payer_evoliz: cts(inv.total?.net_to_pay),
          evoliz_synced_at: now.toISOString(),
        }
        if (inv.document_number && inv.document_number !== f.numero_facture) maj.numero_facture = inv.document_number
        if (payee && !f.date_paiement) maj.date_paiement = (inv.status_dates?.paid || dateTo).slice(0, 10)
        const change = maj.numero_facture !== undefined || maj.date_paiement !== undefined ||
          maj.total_ttc_evoliz !== f.total_ttc_evoliz || maj.reste_a_payer_evoliz !== f.reste_a_payer_evoliz ||
          !f.evoliz_synced_at || (payee && f.statut === 'envoye_evoliz')
        if (change && !body.dry_run) {
          if (payee && f.statut === 'envoye_evoliz') maj.statut = 'payee'
          await supabase.from('facture_evoliz').update(maj).eq('id', f.id).eq('statut', f.statut)
          enrichies++
        }
        if (payee) {
          if (f.statut === 'envoye_evoliz') { updated++; updatedIds.push(f.id) }
          continue
        }
        if (f.statut !== 'envoye_evoliz') continue
        // Poussée chez Evoliz mais jamais partie chez le client : 'filled' = brouillon (T-),
        // 'create' = validée (F-) sans envoi. Cas 408P Belair (24/09/2026) : juillet validée
        // non envoyée, août brouillon — et createPayment échoue sur un brouillon ("not payable"),
        // donc le paiement reçu n'est jamais enregistré côté Evoliz.
        const emise = f.date_emission ? new Date(f.date_emission) : null
        if (f.type_facture === 'honoraires' && ['filled', 'create'].includes(inv.status) && (inv.total?.net_to_pay ?? 0) > 0 && emise && emise <= limite) {
          const b = (f as any).bien, p = (f as any).proprietaire
          nonEnvoyees.push({
            agence, mois: f.mois, bien: b?.code || '—', proprio: [p?.prenom, p?.nom].filter(Boolean).join(' ') || '—',
            numero: inv.document_number || '—', statut_evoliz: inv.status, net_a_payer: Number(inv.total?.net_to_pay ?? 0),
            proprio_paie: b?.mode_encaissement === 'proprio',
          })
        }
      }
      // Demandes de débours jamais envoyées au propriétaire : un bien sans collecte de loyer passe
      // 'envoye_evoliz' / id 'N/A' au push (canal officiel = mail « Info charges ») mais le mail
      // n'est parti que si quelqu'un clique « Envoyer au proprio ». Sans ce contrôle, la demande
      // n'est ni relancée (relance-debours lit 'envoye_proprio') ni rapprochée — cas B16, GASQ,
      // PATXI juillet 2026, jamais réclamés (audit I-154, 24/09/2026).
      const { data: deboursMuets } = await supabase.from('facture_evoliz')
        .select('id, mois, total_ttc, created_at, bien:bien_id(code, mode_encaissement), proprietaire:proprietaire_id(nom, prenom)')
        .eq('agence', agence).eq('type_facture', 'debours').in('statut', ['valide', 'envoye_evoliz'])
        .is('envoye_proprio_at', null).gt('total_ttc', 0)
      for (const d of deboursMuets || []) {
        if (new Date(d.created_at) > limite) continue
        const b = (d as any).bien, p = (d as any).proprietaire
        nonEnvoyees.push({
          agence, mois: d.mois, bien: b?.code || '—', proprio: [p?.prenom, p?.nom].filter(Boolean).join(' ') || '—',
          numero: 'débours', statut_evoliz: 'debours_non_envoye', net_a_payer: (d.total_ttc || 0) / 100, proprio_paie: true,
        })
      }

      // Factures rectificatives rattachées à une demande (ex. frais facturés à 20 % inclus dans une
      // demande de débours) : soldées chez Evoliz dès que la demande liée est réglée.
      let rectifSoldees = 0
      const { data: rectifs } = await supabase.from('facture_evoliz')
        .select('id, id_evoliz, reste_a_payer_evoliz, total_ttc_evoliz, liee:facture_liee_id(statut, date_paiement)')
        .eq('agence', agence).eq('type_facture', 'rectificative').eq('statut', 'envoye_evoliz')
        .not('facture_liee_id', 'is', null)
      for (const r of rectifs || []) {
        const liee = (r as any).liee
        if (!liee || !['remboursement_recu', 'payee'].includes(liee.statut)) continue
        const montant = r.reste_a_payer_evoliz ?? r.total_ttc_evoliz
        if (!montant || body.dry_run) continue
        const paydate = liee.date_paiement || dateTo
        const res = await fetch(`${SUPABASE_URL}/functions/v1/evoliz-proxy`, {
          method: 'POST',
          headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'createPayment', companyId, payload: {
            invoiceId: r.id_evoliz, paydate, paytypeid: 2, amount: montant / 100, label: 'Réglée avec la demande de débours liée' } }),
        })
        const j = await res.json().catch(() => ({}))
        if (!res.ok || j?.error || (j?.status && j.status >= 400)) {
          await supabase.from('journal_ops').insert({ categorie: 'facturation', action: 'rectificative_paiement_auto', source: 'cron', statut: 'error',
            message: `Rectificative ${r.id} : createPayment Evoliz échoué — ${JSON.stringify(j).slice(0, 300)}` })
          continue
        }
        await supabase.from('facture_evoliz').update({ statut: 'payee', date_paiement: paydate, reste_a_payer_evoliz: 0 }).eq('id', r.id).eq('statut', 'envoye_evoliz')
        rectifSoldees++
      }

      aSignaler.push(...nonEnvoyees)
      results[agence] = { checked: factures.length, updated, updatedIds, enrichies, introuvables, non_envoyees: nonEnvoyees.length, rectificatives_soldees: rectifSoldees }
    } catch (e: any) {
      results[agence] = { error: e.message }
    }
  }

  // Récap "jamais envoyées" : lundi, ou sur demande explicite
  let alerte: Record<string, unknown> = { envoyee: false }
  const lundi = now.getUTCDay() === 1
  if (aSignaler.length && (lundi || body.alerte)) {
    aSignaler.sort((a, b) => Number(b.proprio_paie) - Number(a.proprio_paie) || a.mois.localeCompare(b.mois) || a.bien.localeCompare(b.bien))
    if (!body.dry_run) {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/smtp-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({
          to: [ALERTE_EMAIL],
          subject: `⚠ ${aSignaler.length} facture(s) honoraires jamais envoyée(s) depuis Evoliz`,
          html: htmlAlerte(aSignaler),
        }),
      })
      alerte = { envoyee: res.ok, nb: aSignaler.length }
      await supabase.from('journal_ops').insert({
        categorie: 'facturation', action: 'alerte_factures_non_envoyees', source: 'cron', statut: res.ok ? 'ok' : 'error',
        message: `${aSignaler.length} facture(s) honoraires en brouillon/non envoyée(s) dans Evoliz depuis +${JOURS_TOLERANCE}j (${aSignaler.filter(l => l.proprio_paie).length} où le proprio paie lui-même)`,
      })
    } else {
      alerte = { dry_run: true, nb: aSignaler.length, lignes: aSignaler }
    }
  }

  return new Response(JSON.stringify({ ok: true, results, alerte }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  })
})
