// scripts/import-releves-hospitable.mjs — enregistre le « Total due to owner » des relevés Hospitable
// (PDF « <Bien>-statement-MM-AA.pdf ») dans sequestre_releve_proprio, pour les mois sans facture
// d'honoraires dans l'app (janvier-avril 2026 : factures faites à la main dans Evoliz).
// Le justificatif séquestre utilise ce montant en priorité sur le recalcul live.
//
// Usage : node --env-file=.env.local scripts/import-releves-hospitable.mjs [--dry] dossier1 [dossier2 …]
// Requiert pdftotext (poppler). Les fichiers « preview » sont ignorés ; un relevé présent dans deux
// dossiers n'est compté qu'une fois (clé bien + mois du nom de fichier).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const dossiers = args.filter(a => !a.startsWith('--'))
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const AGENCE = process.env.VITE_AGENCE || 'dcb'

// Préfixe du nom de fichier Hospitable → code bien (noms Hospitable ≠ codes app)
const PREFIXES = [
  [/^416--Harea/i, '416'], [/^602--Horizonte/i, '602'], [/^Ala-a---Ilbarritz/i, 'ALAIA'],
  [/^BDX---LVH/i, 'BDX'], [/^CERES/i, 'CERES'], [/^Chambre-Gaxuxa/i, 'GAXUXA'], [/^Chambre-Iba-eta/i, 'IBANETA'],
  [/^Chambre-Pantxika/i, 'PANTXIKA'], [/^Chambre-Txomin/i, 'TXOMIN'], [/^Chambre-Bixintxo/i, 'BIXINTXO'],
  [/^EKIA/i, 'EKIA'], [/^Maison-MA-T/i, 'M-MAITE'], [/^Munduz/i, 'MUNDUZ'], [/^BGH/i, 'BGH'],
  [/^Erdigunea/i, 'ERDIGUNEA'], [/^ZURBIAC/i, 'ZURBIAC'],
]
const cts = s => { const neg = /^[-−]/.test(s); const v = Math.round(parseFloat(s.replace(/[^0-9.]/g, '')) * 100); return neg ? -v : v }

const { data: biens } = await supabase.from('bien').select('id, code').eq('agence', AGENCE)
const releves = new Map()
for (const d of dossiers) for (const f of fs.readdirSync(d).filter(f => /statement-\d{2}-\d{2}.*\.pdf$/i.test(f) && !/preview/i.test(f))) {
  const m = f.match(/statement-(\d{2})-(\d{2})/i)
  const mois = `20${m[2]}-${m[1]}`
  const code = PREFIXES.find(([re]) => re.test(f))?.[1]
  const bien = biens.find(b => b.code === code)
  if (!bien) { console.log(`?? ${f} : bien inconnu`); continue }
  const txt = execFileSync('pdftotext', ['-layout', path.join(d, f), '-'], { encoding: 'utf8' })
  const ligne = txt.split('\n').find(l => /Total due to owner/.test(l))
  const montant = ligne?.match(/[-−]?€[\d,.]+/)?.[0]
  if (!montant) { console.log(`?? ${f} : « Total due to owner » introuvable`); continue }
  releves.set(`${mois}_${bien.id}`, { agence: AGENCE, mois, bien_id: bien.id, montant: cts(montant.replace('€', '')), source: f, code })
}
for (const r of [...releves.values()].sort((a, b) => (a.mois + a.code).localeCompare(b.mois + b.code))) console.log(r.mois, r.code.padEnd(10), (r.montant / 100).toFixed(2))
if (!dry && releves.size) {
  const { error } = await supabase.from('sequestre_releve_proprio').upsert([...releves.values()].map(({ code, ...r }) => r), { onConflict: 'agence,mois,bien_id' })
  if (error) throw error
  console.log(`${releves.size} relevé(s) enregistré(s)`)
}
