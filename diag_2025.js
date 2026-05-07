// Diagnostic : que contient la DB pour 2025 ?
const { createClient } = require('@supabase/supabase-js')
const SUPA_URL = 'https://omuncchvypbtxkpalwcr.supabase.co'
const SUPA_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.DCB_COMPTA_SUPABASE_SERVICE_ROLE_KEY
if (!SUPA_KEY) { console.error('Clé Supabase manquante'); process.exit(1) }
const sb = createClient(SUPA_URL, SUPA_KEY)

async function main() {
  // 1. Resas 2025
  const { data: resas2025, error: e1 } = await sb.from('reservation')
    .select('id, mois_comptable, rapprochee, ventilation_calculee, fin_revenue, final_status')
    .gte('mois_comptable', '2025-01').lte('mois_comptable', '2025-12')
  console.log('\n=== RÉSERVATIONS 2025 ===')
  console.log('Total resas:', resas2025?.length || 0, e1?.message || '')
  if (resas2025?.length) {
    const rappr = resas2025.filter(r => r.rapprochee).length
    const vent  = resas2025.filter(r => r.ventilation_calculee).length
    const revenue = resas2025.filter(r => (r.fin_revenue||0) > 0).length
    const byMois = {}
    resas2025.forEach(r => { byMois[r.mois_comptable] = (byMois[r.mois_comptable]||0)+1 })
    console.log('  Rapprochées:', rappr, '| Ventilées:', vent, '| Avec fin_revenue:', revenue)
    console.log('  Par mois:', JSON.stringify(byMois))
  }

  // 2. Ventilation 2025
  const { data: ventil2025, error: e2 } = await sb.from('ventilation')
    .select('code, montant_ht, montant_ttc, mois_comptable')
    .gte('mois_comptable', '2025-01').lte('mois_comptable', '2025-12')
    .in('code', ['HON','COM','FMEN','AUTO','LOY','VIR','TAXE'])
  console.log('\n=== VENTILATION 2025 ===')
  console.log('Total lignes:', ventil2025?.length || 0, e2?.message || '')
  if (ventil2025?.length) {
    const byCode = {}
    ventil2025.forEach(v => {
      if (!byCode[v.code]) byCode[v.code] = { ht: 0, ttc: 0, nb: 0 }
      byCode[v.code].ht  += v.montant_ht || 0
      byCode[v.code].ttc += v.montant_ttc || 0
      byCode[v.code].nb++
    })
    Object.entries(byCode).sort(([a],[b])=>a.localeCompare(b)).forEach(([code, v]) => {
      console.log(`  ${code}: HT=${(v.ht/100).toFixed(2)}€  TTC=${(v.ttc/100).toFixed(2)}€  (${v.nb} lignes)`)
    })
  }

  // 3. Factures Evoliz 2025
  const { data: fev2025, error: e3 } = await sb.from('facture_evoliz')
    .select('mois, statut, type_facture, total_ttc, montant_reversement')
    .gte('mois', '2025-01').lte('mois', '2025-12')
  console.log('\n=== FACTURES EVOLIZ 2025 ===')
  console.log('Total factures:', fev2025?.length || 0, e3?.message || '')
  if (fev2025?.length) {
    const byType = {}
    fev2025.forEach(f => {
      const k = `${f.type_facture}/${f.statut}`
      if (!byType[k]) byType[k] = { nb: 0, ttc: 0, rev: 0 }
      byType[k].nb++; byType[k].ttc += f.total_ttc||0; byType[k].rev += f.montant_reversement||0
    })
    Object.entries(byType).forEach(([k,v]) => {
      console.log(`  ${k}: ${v.nb} fact. TTC=${(v.ttc/100).toFixed(2)}€ Rev=${(v.rev/100).toFixed(2)}€`)
    })
  }

  // 4. Mouvements bancaires 2025
  const { data: mvt2025, error: e4 } = await sb.from('mouvement_bancaire')
    .select('date_operation, credit, debit, canal')
    .gte('date_operation', '2025-01-01').lte('date_operation', '2025-12-31')
  console.log('\n=== MOUVEMENTS BANCAIRES 2025 ===')
  console.log('Total mouvements:', mvt2025?.length || 0, e4?.message || '')
  if (mvt2025?.length) {
    const totalCredit = mvt2025.reduce((s,m) => s+(m.credit||0), 0)
    const totalDebit  = mvt2025.reduce((s,m) => s+(m.debit||0), 0)
    console.log(`  Entrées: ${(totalCredit/100).toFixed(2)}€ | Sorties: ${(totalDebit/100).toFixed(2)}€`)
  }
}
main().catch(console.error)
