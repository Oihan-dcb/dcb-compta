import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const url = 'https://omuncchvypbtxkpalwcr.supabase.co'
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tdW5jY2h2eXBidHhrcGFsd2NyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4OTE4NzIsImV4cCI6MjA4ODQ2Nzg3Mn0.jvPn6LkBfT1eeHmkGI-_vAD2pdM_Y0JWgtbJAG-DLjM'

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
