/**
 * relance-loyer — Edge Function Supabase
 *
 * Vérifie quotidiennement les loyers en attente et envoie des relances
 * automatiques (email + SMS) sans intervention d'Oihan.
 *
 * Déclenchement : pg_cron tous les jours à 9h (migration 026)
 * Peut aussi être appelée manuellement : POST avec { dry_run: true } pour simulation
 *
 * Logique de relance :
 *   - Loyer attendu après jour_paiement_attendu de l'étudiant
 *   - Relance 1 : jour >= jour_paiement, nb_relances = 0
 *   - Relance 2 : ≥ 3 jours après relance 1, nb_relances = 1
 *   - Relance 3 : ≥ 3 jours après relance 2, nb_relances = 2
 *   - Après 3 relances : statut → 'en_retard', escalade Oihan (badge rouge UI)
 *
 * Variables d'env requises :
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto Supabase)
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
 *   APP_URL  (pour appel smtp-send)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── SMS ────────────────────────────────────────────────────────────────────

async function envoyerSMS(sid: string, token: string, from: string, to: string, body: string) {
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${sid}:${token}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ From: from, To: to, Body: body }).toString(),
    })
    const data = await res.json()
    if (res.ok) return { ok: true, sid: data.sid }
    return { ok: false, error: data.message || JSON.stringify(data) }
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) }
  }
}

// ── Textes de relance ──────────────────────────────────────────────────────

function nomMois(mois: string): string {
  const [, m] = mois.split('-')
  const noms = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre']
  return noms[parseInt(m) - 1]
}

function formatEuros(centimes: number): string {
  return (centimes / 100).toFixed(2).replace('.', ',') + ' €'
}

function texteSMS(prenom: string, mois: string, montant: number, nbRelances: number): string {
  const label = nomMois(mois)
  const mt = formatEuros(montant)
  if (nbRelances === 0) {
    return `Bonjour ${prenom}, votre loyer de ${mt} pour ${label} n'a pas encore été réceptionné. Merci de procéder au virement dès que possible. — DCB`
  }
  if (nbRelances === 1) {
    return `Bonjour ${prenom}, rappel : votre loyer de ${mt} pour ${label} reste en attente. Merci de régulariser rapidement ou de nous contacter. — DCB`
  }
  return `Bonjour ${prenom}, dernier rappel automatique : loyer de ${mt} pour ${label} toujours impayé. Un conseiller DCB va prendre contact avec vous. — DCB`
}

function texteEmail(prenom: string, nom: string, mois: string, montant: number, nbRelances: number, agenceLabel: string): { subject: string, html: string } {
  const label = nomMois(mois)
  const mt = formatEuros(montant)
  const relanceLabel = ['Première', 'Deuxième', 'Troisième'][nbRelances] || 'Rappel'

  const subject = `${relanceLabel} relance — loyer ${label}`

  const html = `
<p>Bonjour ${prenom},</p>
<p>Nous n'avons pas encore reçu votre loyer de <strong>${mt}</strong> pour le mois de <strong>${label}</strong>.</p>
${nbRelances < 2
  ? `<p>Merci de procéder au virement dès que possible sur le compte habituel.</p>`
  : `<p><strong>Attention :</strong> ceci est notre dernier rappel automatique. Un conseiller ${agenceLabel} va prendre contact avec vous prochainement.</p>`
}
<p>Si vous avez déjà effectué le virement, merci d'ignorer ce message.</p>
<p>Cordialement,<br>${agenceLabel}</p>
`
  return { subject, html }
}

// ── Main ───────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    let dry_run = false
    let loyer_suivi_id: string | null = null
    try {
      const body = await req.json()
      dry_run = !!body.dry_run
      loyer_suivi_id = body.loyer_suivi_id || null
    } catch { /* cron n'envoie pas de body */ }

    const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
    const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const TWILIO_SID    = Deno.env.get('TWILIO_ACCOUNT_SID')
    const TWILIO_TOKEN  = Deno.env.get('TWILIO_AUTH_TOKEN')
    const TWILIO_FROM   = Deno.env.get('TWILIO_FROM_NUMBER')

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

    // Mois courant + jour du mois
    const now     = new Date()
    const mois    = now.toISOString().slice(0, 7)
    const jourDuMois = now.getDate()
    const maintenant = now.toISOString()

    // ── 1. Trouver les loyers à relancer ────────────────────────────────
    const troisiersJoursAvant = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString()
    // Si loyer_suivi_id fourni : relance forcée sur un seul loyer (bypass délais)
    const forceManuel = !!loyer_suivi_id

    let loyersQuery = supabase
      .from('loyer_suivi')
      .select(`
        id, mois, statut, nb_relances, date_derniere_relance,
        etudiant (
          id, agence, nom, prenom, email, telephone,
          loyer_nu, supplement_loyer, charges_eau, charges_copro, charges_internet,
          honoraires_dcb, jour_paiement_attendu, statut
        )
      `)

    if (forceManuel) {
      // Relance manuelle — un seul loyer, pas de filtre statut/mois
      loyersQuery = loyersQuery.eq('id', loyer_suivi_id!)
    } else {
      // Batch cron — loyers attendu du mois courant, < 3 relances
      loyersQuery = loyersQuery
        .eq('mois', mois)
        .eq('statut', 'attendu')
        .lt('nb_relances', 3)
    }

    const { data: loyers, error: errLoyers } = await loyersQuery
    if (errLoyers) throw errLoyers

    const resultats: any[] = []

    for (const loyer of (loyers || [])) {
      const e = loyer.etudiant
      if (!e || e.statut !== 'actif') continue

      if (!forceManuel) {
        // Vérifier si le loyer est en retard (jour actuel >= jour_paiement)
        if (jourDuMois < e.jour_paiement_attendu) {
          resultats.push({ etudiant: `${e.nom} ${e.prenom || ''}`.trim(), action: 'skip', raison: 'pas encore dû' })
          continue
        }
        // Vérifier délai minimum entre relances (3 jours)
        if (loyer.date_derniere_relance && loyer.date_derniere_relance > troisiersJoursAvant) {
          resultats.push({ etudiant: `${e.nom} ${e.prenom || ''}`.trim(), action: 'skip', raison: 'relance trop récente' })
          continue
        }
      }

      const montantTotal = (e.loyer_nu || 0) + (e.supplement_loyer || 0) +
                           (e.charges_eau || 0) + (e.charges_copro || 0) + (e.charges_internet || 0)
      const prenom = e.prenom || e.nom

      const nbRelances = loyer.nb_relances
      const isLastRelance = nbRelances === 2

      // ── Récupérer label agence ────────────────────────────────────────
      const { data: agenceData } = await supabase
        .from('agency_config')
        .select('label, resend_from_email')
        .eq('agence', e.agence)
        .single()
      const agenceLabel = agenceData?.label || 'Destination Côte Basque'

      let emailOk = false
      let smsOk = false

      if (!dry_run) {
        // ── Email ───────────────────────────────────────────────────────
        if (e.email) {
          const { subject, html } = texteEmail(prenom, e.nom, mois, montantTotal, nbRelances, agenceLabel)
          await fetch(`${SUPABASE_URL}/functions/v1/smtp-send`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${SERVICE_KEY}`,
            },
            body: JSON.stringify({ to: e.email, subject, html }),
          }).then(r => { emailOk = r.ok }).catch(() => {})
        }

        // ── SMS ─────────────────────────────────────────────────────────
        if (e.telephone && TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM) {
          const corps = texteSMS(prenom, mois, montantTotal, nbRelances)
          const result = await envoyerSMS(TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM, e.telephone, corps)
          smsOk = result.ok
        }

        // ── Mettre à jour loyer_suivi ───────────────────────────────────
        const updates: any = {
          nb_relances: nbRelances + 1,
          date_derniere_relance: maintenant,
        }
        if (isLastRelance) updates.statut = 'en_retard'
        await supabase.from('loyer_suivi').update(updates).eq('id', loyer.id)

        // ── Écrire dans lld_log ─────────────────────────────────────────
        const logEntries: any[] = []
        if (emailOk && e.email) {
          logEntries.push({
            agence: e.agence, etudiant_id: e.id, loyer_suivi_id: loyer.id,
            type: forceManuel ? 'relance_manuelle' : 'email_relance',
            canal: 'email', destinataire: e.email, statut: 'ok', mois: loyer.mois,
            details: { nb_relance: nbRelances + 1, montant: montantTotal },
          })
        } else if (e.email) {
          logEntries.push({
            agence: e.agence, etudiant_id: e.id, loyer_suivi_id: loyer.id,
            type: forceManuel ? 'relance_manuelle' : 'email_relance',
            canal: 'email', destinataire: e.email, statut: 'erreur', mois: loyer.mois,
            details: { nb_relance: nbRelances + 1, montant: montantTotal },
          })
        }
        if (smsOk && e.telephone) {
          logEntries.push({
            agence: e.agence, etudiant_id: e.id, loyer_suivi_id: loyer.id,
            type: forceManuel ? 'relance_manuelle' : 'sms_relance',
            canal: 'sms', destinataire: e.telephone, statut: 'ok', mois: loyer.mois,
            details: { nb_relance: nbRelances + 1, montant: montantTotal },
          })
        } else if (e.telephone && TWILIO_SID) {
          logEntries.push({
            agence: e.agence, etudiant_id: e.id, loyer_suivi_id: loyer.id,
            type: forceManuel ? 'relance_manuelle' : 'sms_relance',
            canal: 'sms', destinataire: e.telephone, statut: 'erreur', mois: loyer.mois,
            details: { nb_relance: nbRelances + 1, montant: montantTotal },
          })
        }
        if (isLastRelance) {
          logEntries.push({
            agence: e.agence, etudiant_id: e.id, loyer_suivi_id: loyer.id,
            type: 'relance_escalade', canal: 'ui', statut: 'ok', mois: loyer.mois,
            details: { message: 'Loyer passé en retard — escalade Oihan' },
          })
        }
        if (logEntries.length) await supabase.from('lld_log').insert(logEntries)
      }

      resultats.push({
        etudiant:    `${e.nom} ${e.prenom || ''}`.trim(),
        mois,
        nb_relances: nbRelances + (dry_run ? 0 : 1),
        email_ok:    emailOk,
        sms_ok:      smsOk,
        escalade:    isLastRelance,
        dry_run,
      })
    }

    const nbRelancees = resultats.filter(r => r.action !== 'skip').length
    const nbEscalade  = resultats.filter(r => r.escalade).length

    return new Response(
      JSON.stringify({
        ok: true,
        mois,
        jour: jourDuMois,
        dry_run,
        relancees:  nbRelancees,
        escalades:  nbEscalade,
        detail:     resultats,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
