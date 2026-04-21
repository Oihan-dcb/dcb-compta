/**
 * inbound-invoice — Edge Function Supabase
 *
 * Reçoit le webhook Resend Inbound quand un email arrive sur
 * factures@destinationcotebasque.com.
 *
 * Pour chaque pièce jointe PDF/image :
 *   1. Appel parse-invoice (LLM Claude)
 *   2. Upload PDF → Storage etudiant-documents/factures/{agence}/{mois}/
 *   3. INSERT facture_achat (statut: a_valider)
 * Puis notification email à Oihan.
 *
 * Webhook URL à configurer dans Resend Inbound :
 *   https://omuncchvypbtxkpalwcr.supabase.co/functions/v1/inbound-invoice
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const NOTIFY_EMAIL     = 'oihan@destinationcotebasque.com'

// Content-types acceptés
const ACCEPTED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' },
    })
  }

  try {
    const body = await req.json()

    const from: string       = body.from || ''
    const subject: string    = body.subject || '(sans objet)'
    const attachments: any[] = body.attachments || []

    // Filtrer pièces jointes exploitables
    const pieces = attachments.filter(a =>
      ACCEPTED_TYPES.includes((a.mimeType || '').toLowerCase()) && a.content
    )

    if (pieces.length === 0) {
      // Aucune pièce jointe exploitable — on ignore silencieusement
      return new Response(JSON.stringify({ ok: true, skipped: 'no_attachment' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
    const now      = new Date()
    const moisDefault = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const agence   = detectAgence(body.to)

    const results: any[] = []

    for (const piece of pieces) {
      const mediaType: string = piece.mimeType.toLowerCase()
      const fileBase64: string = piece.content
      const filename: string = piece.filename || `facture_${Date.now()}.pdf`

      // ── 1. Parse via LLM ────────────────────────────────────────────────
      let parsed: any = {}
      try {
        const parseRes = await fetch(`${SUPABASE_URL}/functions/v1/parse-invoice`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SERVICE_KEY}`,
          },
          body: JSON.stringify({ file_base64: fileBase64, media_type: mediaType }),
        })
        if (parseRes.ok) {
          const parseData = await parseRes.json()
          if (parseData.ok) parsed = parseData
        }
      } catch (_) {
        // Parse échoué — on continue avec des valeurs null
      }

      // ── 2. Dériver le mois depuis date_facture ou aujourd'hui ───────────
      let mois = moisDefault
      if (parsed.date_facture) {
        const parts = parsed.date_facture.split('-')
        if (parts.length >= 2) mois = `${parts[0]}-${parts[1]}`
      }

      // ── 3. Upload PDF vers Storage ───────────────────────────────────────
      let pdfUrl: string | null = null
      try {
        const pdfBytes = base64ToUint8(fileBase64)
        const storagePath = `factures/${agence}/${mois}/${crypto.randomUUID()}_${filename}`
        const { error: uploadErr } = await supabase.storage
          .from('etudiant-documents')
          .upload(storagePath, pdfBytes, { contentType: mediaType, upsert: false })
        if (!uploadErr) {
          const { data: { publicUrl } } = supabase.storage
            .from('etudiant-documents')
            .getPublicUrl(storagePath)
          pdfUrl = publicUrl
        }
      } catch (_) {
        // Upload échoué — la facture sera créée sans PDF
      }

      // ── 4. INSERT facture_achat ──────────────────────────────────────────
      const { data: facture, error: insertErr } = await supabase
        .from('facture_achat')
        .insert({
          agence,
          mois,
          fournisseur:      parsed.fournisseur || devineFournisseur(from, subject),
          montant_ttc:      parsed.montant_ttc || 0,
          montant_ht:       parsed.montant_ht  || null,
          type_paiement:    parsed.type_paiement || 'virement',
          date_facture:     parsed.date_facture  || null,
          numero_facture:   parsed.numero_facture || null,
          statut:           'a_valider',
          pdf_url:          pdfUrl,
          notes:            `Reçu par email de ${from} — objet : ${subject}`,
        })
        .select('id')
        .single()

      if (insertErr) {
        results.push({ filename, error: insertErr.message })
        continue
      }

      results.push({
        filename,
        facture_id:  facture.id,
        fournisseur: parsed.fournisseur || null,
        montant_ttc: parsed.montant_ttc || null,
        mois,
      })
    }

    // ── 5. Notification à Oihan ─────────────────────────────────────────────
    const nbOk = results.filter(r => r.facture_id).length
    if (nbOk > 0) {
      const lignes = results.filter(r => r.facture_id).map(r =>
        `<li><strong>${r.fournisseur || '?'}</strong> — ${r.montant_ttc ? r.montant_ttc + ' €' : 'montant à vérifier'} (${r.mois}) — <em>${r.filename}</em></li>`
      ).join('')

      await fetch(`${SUPABASE_URL}/functions/v1/smtp-send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify({
          to: NOTIFY_EMAIL,
          subject: `📎 ${nbOk} facture${nbOk > 1 ? 's' : ''} reçue${nbOk > 1 ? 's' : ''} — à valider`,
          html: `
<p>Un email de <strong>${from}</strong> (objet : <em>${subject}</em>) a déclenché l'import automatique de ${nbOk} facture${nbOk > 1 ? 's' : ''} :</p>
<ul>${lignes}</ul>
<p>Toutes en statut <strong>à valider</strong> dans <a href="https://dcb-compta.vercel.app/achats">PageAchats</a>.</p>
`,
        }),
      })
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { 'Content-Type': 'application/json' },
    })

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

// ── Helpers ─────────────────────────────────────────────────────────────────

function detectAgence(to: string | string[]): string {
  const toStr = Array.isArray(to) ? to.join(' ') : (to || '')
  if (toStr.includes('lauian')) return 'lauian'
  if (toStr.includes('bordeaux')) return 'bordeaux'
  return 'dcb'
}

function devineFournisseur(from: string, subject: string): string {
  // Extraire domaine de l'expéditeur (ex: factures@sfr.fr → SFR)
  const match = from.match(/@([\w-]+)\.\w+/)
  if (match) return match[1].toUpperCase()
  return subject.slice(0, 60) || 'Inconnu'
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
