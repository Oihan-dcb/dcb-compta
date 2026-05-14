// Usage : SUPABASE_URL=https://... SUPABASE_KEY=<anon_or_service_key> node insert_sequestre.mjs
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const url = process.env.SUPABASE_URL || 'https://omuncchvypbtxkpalwcr.supabase.co'
const key = process.env.SUPABASE_KEY
if (!key) { console.error('SUPABASE_KEY manquante'); process.exit(1) }

const supabase = createClient(url, key)

const rows = JSON.parse(readFileSync('/tmp/sequestre_2025_rows.json', 'utf8'))

// First check if table exists and delete existing data
const { error: delErr } = await supabase
  .from('sequestre_rapport_item')
  .delete()
  .eq('agence', 'dcb')
  .eq('annee', 2025)

if (delErr) {
  console.error('Delete error:', delErr.message)
  // Table might not exist yet
}

// Insert in batches of 50
let inserted = 0
for (let i = 0; i < rows.length; i += 50) {
  const batch = rows.slice(i, i + 50)
  const { error } = await supabase.from('sequestre_rapport_item').insert(batch)
  if (error) {
    console.error(`Batch ${i}-${i+50} error:`, error.message)
    process.exit(1)
  }
  inserted += batch.length
  console.log(`Inserted ${inserted}/${rows.length}`)
}

console.log('Done! All rows inserted.')
