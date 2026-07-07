/**
 * Supabase Edge Function — Proxy API Pennylane (v2)
 * Base URL : https://app.pennylane.com/api/external/v2
 * Auth : token statique (pas de login, contrairement à Evoliz) — Authorization: Bearer <token>
 * Multi-tenant : le token est scopé à une seule société Pennylane, donc pas de companyId
 * dans l'URL (contrairement à Evoliz) — on sélectionne l'agence via le paramètre `agency`.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const PENNYLANE_BASE = 'https://app.pennylane.com/api/external/v2'
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Mapping agency → suffixe secret Supabase
// DCB    : PENNYLANE_API_TOKEN
// Lauian : PENNYLANE_API_TOKEN_LAUIAN
const AGENCY_SUFFIX: Record<string, string> = {
  DCB: '',
  LAUIAN: '_LAUIAN',
}

function getToken(agency: string): string {
  const suffix = AGENCY_SUFFIX[agency] ?? ''
  const token = Deno.env.get(`PENNYLANE_API_TOKEN${suffix}`)
  if (!token) {
    throw new Error(`Token Pennylane manquant pour l'agence ${agency} (PENNYLANE_API_TOKEN${suffix})`)
  }
  return token
}

async function pennylaneReq(method: string, path: string, agency: string, body?: object) {
  const token = getToken(agency)
  const url = `${PENNYLANE_BASE}${path}`

  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { raw: text } }

  return { status: res.status, data }
}

// Upload multipart d'un PDF (base64 → Blob) vers /file_attachments
async function pennylaneUploadFile(agency: string, fileBase64: string, filename: string) {
  const token = getToken(agency)

  const binary = atob(fileBase64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const blob = new Blob([bytes], { type: 'application/pdf' })

  const form = new FormData()
  form.append('file', blob, filename)

  const res = await fetch(`${PENNYLANE_BASE}/file_attachments`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }, // pas de Content-Type : fetch le fixe (boundary multipart)
    body: form,
  })

  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { raw: text } }

  return { status: res.status, data }
}

// Construit le paramètre `filter` (JSON array d'objets {field, operator, value})
function buildFilter(conditions?: Array<{ field: string; operator: string; value: string }>): string {
  if (!conditions || conditions.length === 0) return ''
  return `filter=${encodeURIComponent(JSON.stringify(conditions))}`
}

function withQuery(path: string, params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') usp.set(k, v)
  }
  const qs = usp.toString()
  return qs ? `${path}?${qs}` : path
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    const { action, payload, agency } = await req.json()
    const ag = (agency || 'DCB').toUpperCase()
    if (!AGENCY_SUFFIX.hasOwnProperty(ag)) throw new Error(`Agence inconnue: ${ag}`)

    let result

    switch (action) {

      // ── TEST ──────────────────────────────────────────────
      case 'ping': {
        result = await pennylaneReq('GET', '/me', ag)
        break
      }

      // ── FOURNISSEURS ──────────────────────────────────────
      case 'listSuppliers': {
        const qs = buildFilter(payload?.filter)
        const path = withQuery('/suppliers', {
          cursor: payload?.cursor,
          limit: payload?.limit ? String(payload.limit) : undefined,
        })
        result = await pennylaneReq('GET', qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path, ag)
        break
      }

      case 'getSupplier': {
        result = await pennylaneReq('GET', `/suppliers/${payload.supplierId}`, ag)
        break
      }

      case 'createSupplier': {
        /**
         * payload: { name, siret (establishment_no), siren (reg_no), vatNumber,
         *   ledgerAccountId, emails: [], iban, externalReference }
         */
        result = await pennylaneReq('POST', '/suppliers', ag, {
          name: payload.name,
          establishment_no: payload.siret || undefined,
          reg_no: payload.siren || undefined,
          vat_number: payload.vatNumber || undefined,
          ledger_account: payload.ledgerAccountId ? { id: payload.ledgerAccountId } : undefined,
          emails: payload.emails || undefined,
          iban: payload.iban || undefined,
          external_reference: payload.externalReference || undefined,
        })
        break
      }

      case 'updateSupplier': {
        result = await pennylaneReq('PUT', `/suppliers/${payload.supplierId}`, ag, payload.data)
        break
      }

      // ── FICHIERS ──────────────────────────────────────────
      case 'uploadFile': {
        // payload: { fileBase64, filename }
        result = await pennylaneUploadFile(ag, payload.fileBase64, payload.filename || `document_${Date.now()}.pdf`)
        break
      }

      // ── FACTURES FOURNISSEURS ─────────────────────────────
      case 'importSupplierInvoice': {
        /**
         * payload: {
         *   fileAttachmentId: number,
         *   supplierId: number,
         *   date: "YYYY-MM-DD",
         *   deadline: "YYYY-MM-DD",
         *   amountBeforeTax: "100.00", tax: "20.00", amount: "120.00"  (strings — obligatoire côté Pennylane)
         *   lines: [{ ledgerAccountId, amount, tax, vatRate }]  (vatRate: FR_200|FR_100|FR_055|exempt|any)
         * }
         * Duplicate prevention : ré-importer le même fichier → 422
         */
        result = await pennylaneReq('POST', '/supplier_invoices/import', ag, {
          file_attachment_id: payload.fileAttachmentId,
          supplier_id: payload.supplierId,
          date: payload.date,
          deadline: payload.deadline || undefined,
          currency_amount_before_tax: String(payload.amountBeforeTax),
          currency_tax: String(payload.tax),
          currency_amount: String(payload.amount),
          invoice_lines: (payload.lines || []).map((l: any) => ({
            ledger_account_id: l.ledgerAccountId || undefined,
            currency_amount: String(l.amount),
            currency_tax: String(l.tax ?? '0'),
            vat_rate: l.vatRate || 'FR_200',
          })),
        })
        break
      }

      case 'getSupplierInvoice': {
        result = await pennylaneReq('GET', `/supplier_invoices/${payload.invoiceId}`, ag)
        break
      }

      // ── COMPTES BANCAIRES / TRANSACTIONS (rapprochement) ──
      case 'listBankAccounts': {
        result = await pennylaneReq('GET', '/bank_accounts', ag)
        break
      }

      case 'listTransactions': {
        const qs = buildFilter(payload?.filter)
        const path = withQuery('/transactions', {
          cursor: payload?.cursor,
          limit: payload?.limit ? String(payload.limit) : undefined,
        })
        result = await pennylaneReq('GET', qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path, ag)
        break
      }

      // ── COMPTES COMPTABLES / ÉCRITURES / JOURNAUX (lecture) ─
      case 'listLedgerAccounts': {
        const qs = buildFilter(payload?.filter)
        const path = withQuery('/ledger_accounts', {
          cursor: payload?.cursor,
          limit: payload?.limit ? String(payload.limit) : undefined,
        })
        result = await pennylaneReq('GET', qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path, ag)
        break
      }

      case 'listLedgerEntries': {
        const qs = buildFilter(payload?.filter)
        const path = withQuery('/ledger_entries', {
          cursor: payload?.cursor,
          limit: payload?.limit ? String(payload.limit) : undefined,
        })
        result = await pennylaneReq('GET', qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path, ag)
        break
      }

      case 'listJournals': {
        result = await pennylaneReq('GET', '/journals', ag)
        break
      }

      case 'listFiscalYears': {
        result = await pennylaneReq('GET', '/fiscal_years', ag)
        break
      }

      // ── CLIENTS / FACTURES CLIENT (lecture — Evoliz reste la source de vérité) ─
      case 'listCustomers': {
        const qs = buildFilter(payload?.filter)
        const path = withQuery('/customers', {
          cursor: payload?.cursor,
          limit: payload?.limit ? String(payload.limit) : undefined,
        })
        result = await pennylaneReq('GET', qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path, ag)
        break
      }

      case 'listCustomerInvoices': {
        const qs = buildFilter(payload?.filter)
        const path = withQuery('/customer_invoices', {
          cursor: payload?.cursor,
          limit: payload?.limit ? String(payload.limit) : undefined,
        })
        result = await pennylaneReq('GET', qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path, ag)
        break
      }

      case 'getCustomerInvoice': {
        result = await pennylaneReq('GET', `/customer_invoices/${payload.invoiceId}`, ag)
        break
      }

      // ── CATÉGORIES ANALYTIQUES (tag distributeur sur transactions) ─
      case 'listCategoryGroups': {
        result = await pennylaneReq('GET', '/category_groups', ag)
        break
      }

      case 'listCategories': {
        // payload: { categoryGroupId } — liste les catégories d'un groupe
        result = await pennylaneReq('GET', `/category_groups/${payload.categoryGroupId}/categories`, ag)
        break
      }

      case 'createCategory': {
        // payload: { categoryGroupId, label, direction? }
        result = await pennylaneReq('POST', '/categories', ag, {
          category_group_id: payload.categoryGroupId,
          label: payload.label,
          direction: payload.direction || undefined,
        })
        break
      }

      case 'putTransactionCategories': {
        // payload: { transactionId, categories: [{ id, weight }] }
        result = await pennylaneReq('PUT', `/transactions/${payload.transactionId}/categories`, ag, payload.categories)
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
