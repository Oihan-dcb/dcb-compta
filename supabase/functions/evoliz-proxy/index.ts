/**
 * Supabase Edge Function — Proxy API Evoliz
 * Base URL : https://www.evoliz.io/
 * Auth : POST /api/login → access_token (valide 20 min)
 * Company ID : entier numérique (pas le slug)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const EVOLIZ_BASE = 'https://www.evoliz.io'
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Cache des tokens par companyId (valide 20 min, marge de 60s)
const _tokenCache: Record<string, { token: string; expiry: number }> = {}

// Mapping companyId → suffixe secret Supabase
// DCB     : EVOLIZ_PUBLIC_KEY     / EVOLIZ_SECRET_KEY
// Lauian  : EVOLIZ_PUBLIC_KEY_LAUIAN / EVOLIZ_SECRET_KEY_LAUIAN
const COMPANY_SUFFIX: Record<string, string> = {
  '114158': '',
  '115576': '_LAUIAN',
}

async function getToken(companyId: string): Promise<string> {
  const cached = _tokenCache[companyId]
  if (cached && Date.now() < cached.expiry) return cached.token

  const suffix = COMPANY_SUFFIX[companyId] ?? ''
  const publicKey = Deno.env.get(`EVOLIZ_PUBLIC_KEY${suffix}`)
  const secretKey = Deno.env.get(`EVOLIZ_SECRET_KEY${suffix}`)

  if (!publicKey || !secretKey) {
    throw new Error(`Clés Evoliz manquantes pour companyId ${companyId} (EVOLIZ_PUBLIC_KEY${suffix}, EVOLIZ_SECRET_KEY${suffix})`)
  }

  const res = await fetch(`${EVOLIZ_BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ public_key: publicKey, secret_key: secretKey }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Auth Evoliz échouée: ${res.status} — ${err.substring(0, 200)}`)
  }

  const data = await res.json()
  const expiry = data.expires_at
    ? new Date(data.expires_at).getTime() - 60_000
    : Date.now() + 19 * 60 * 1000

  _tokenCache[companyId] = { token: data.access_token, expiry }
  return data.access_token
}

async function evolizReq(method: string, path: string, companyId: string, body?: object) {
  const token = await getToken(companyId)
  const url = `${EVOLIZ_BASE}/api/v1/companies/${companyId}${path}`

  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  // Essayer de parser le JSON même si erreur
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { raw: text } }

  return { status: res.status, data }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    const { action, payload, companyId } = await req.json()
    const company = companyId || Deno.env.get('EVOLIZ_COMPANY_ID')
    if (!company) throw new Error('company_id manquant')

    let result

    switch (action) {

      // ── TEST ──────────────────────────────────────────────
      case 'ping': {
        // Récupère les infos de la société pour tester la connexion
        result = await evolizReq('GET', '', company)
        break
      }

      // ── CLIENTS ───────────────────────────────────────────
      case 'listClients': {
        const params = new URLSearchParams()
        if (payload?.search) params.set('search', payload.search)
        if (payload?.page) params.set('page', String(payload.page))
        if (payload?.per_page) params.set('per_page', String(payload.per_page))
        const qs = params.toString() ? `?${params.toString()}` : ''
        result = await evolizReq('GET', `/clients${qs}`, company)
        break
      }

      case 'getClient': {
        result = await evolizReq('GET', `/clients/${payload.clientId}`, company)
        break
      }

      case 'getClientContacts': {
        // Récupère les contacts d'un client (emails, téléphones détaillés)
        result = await evolizReq('GET', `/clients/${payload.clientId}/contacts`, company)
        break
      }

      case 'createClient': {
        // Champs requis : name, type, address (postcode, town, iso2)
        result = await evolizReq('POST', '/clients', company, {
          name: payload.name,
          type: payload.type || 'Particulier', // Particulier | Professionnel | Administration publique
          address: {
            addr: payload.address || '',
            postcode: payload.postcode || '',
            town: payload.town || '',
            iso2: payload.country || 'FR',
          },
          phone: payload.phone || undefined,
          // email via contact client (séparé dans l'API Evoliz)
        })
        break
      }

      case 'updateClient': {
        result = await evolizReq('PATCH', `/clients/${payload.clientId}`, company, payload.data)
        break
      }

      // ── FACTURES ──────────────────────────────────────────
      case 'listInvoices': {
        const params = new URLSearchParams()
        if (payload?.clientId) params.set('clientid', payload.clientId)
        if (payload?.period) params.set('period', payload.period)
        if (payload?.dateFrom) { params.set('period', 'custom'); params.set('date_min', payload.dateFrom) }
        if (payload?.dateTo) params.set('date_max', payload.dateTo)
        const qs = params.toString() ? `?${params}` : ''
        result = await evolizReq('GET', `/invoices${qs}`, company)
        break
      }

      case 'getInvoice': {
        result = await evolizReq('GET', `/invoices/${payload.invoiceId}`, company)
        break
      }

      case 'createInvoice': {
        /**
         * payload: {
         *   clientId: number,
         *   documentdate: "YYYY-MM-DD",
         *   paytermid: number (défaut 1 = comptant),
         *   comment: string (note bas de facture),
         *   items: [{ designation, quantity, unitPrice (€), vatRate }]
         * }
         * Crée une facture en statut "filled" (brouillon)
         * Appeler createInvoice puis saveInvoice pour la finaliser
         */
        result = await evolizReq('POST', '/invoices', company, {
          documentdate: payload.documentdate,
          clientid: payload.clientId,
          comment: payload.comment || '',
          term: {
            paytermid: payload.paytermid || 1, // 1 = comptant
            paytypeid: payload.paytypeid || undefined,
            recovery_indemnity: false, // indemnité forfaitaire recouvrement — requis pour clients pro (SCI, etc.)
          },
          items: (payload.items || []).map((l: any) => ({
            type: 'article',
            designation: l.designation,
            reference: l.reference || undefined,
            quantity: l.quantity || 1,
            unit_price: l.unitPrice,     // En euros (pas en centimes)
            vat_rate: l.vatRate ?? 20,
          })),
        })
        break
      }

      case 'saveInvoice': {
        // Passe la facture de "filled" → "create" avec numéro définitif
        result = await evolizReq('POST', `/invoices/${payload.invoiceId}/create`, company)
        break
      }

      case 'sendInvoice': {
        result = await evolizReq('POST', `/invoices/${payload.invoiceId}/send`, company, {
          to: payload.to ? [payload.to] : undefined,
          subject: payload.subject,
          body: payload.body,
          attachment: true,
        })
        break
      }

      case 'deleteInvoice': {
        // Uniquement si statut "filled" (brouillon)
        result = await evolizReq('DELETE', `/invoices/${payload.invoiceId}`, company)
        break
      }

      // ── PAIEMENTS ─────────────────────────────────────────
      case 'createPayment': {
        result = await evolizReq('POST', `/invoices/${payload.invoiceId}/payments`, company, {
          paydate: payload.paydate,
          label: payload.label || 'Règlement',
          paytypeid: payload.paytypeid || 4, // 4 = virement
          amount: payload.amount,
        })
        break
      }

      // ── PDF ──────────────────────────────────────────────
      case 'getInvoicePDF': {
        // Télécharge le PDF d'une facture et retourne son contenu en base64
        const token = await getToken(company)
        const url = `${EVOLIZ_BASE}/api/v1/companies/${company}/invoices/${payload.invoiceId}/pdf`
        const pdfRes = await fetch(url, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/pdf' },
        })
        if (!pdfRes.ok) {
          result = { status: pdfRes.status, data: { error: `PDF ${pdfRes.status}` } }
          break
        }
        const ab = await pdfRes.arrayBuffer()
        const u8 = new Uint8Array(ab)
        let b64 = ''
        for (let i = 0; i < u8.length; i += 3072) b64 += btoa(String.fromCharCode(...u8.slice(i, i + 3072)))
        result = { status: 200, data: { pdf_base64: b64 } }
        break
      }

      // ── UTILITAIRES ───────────────────────────────────────
      case 'getPayterms': {
        result = await evolizReq('GET', '/payterms', company)
        break
      }

      case 'getPaytypes': {
        result = await evolizReq('GET', '/paytypes', company)
        break
      }

      default:
        throw new Error(`Action inconnue: ${action}`)
    }

    return new Response(JSON.stringify(result), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
