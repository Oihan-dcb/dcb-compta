// scripts/releve-booking.mjs — même code que le panneau « 📋 Relevés Booking » de la page Banque
// (src/services/importBooking.js), en ligne de commande, pour un rattrapage par lot.
// Par défaut : APERÇU seulement (rien d'écrit). --valider : écrit les versements validables
// (idempotent : réimporter ne double rien ; mois clôturé : rien d'écrit, listé « à régulariser »).
//
// Usage : VITE_AGENCE=lauian node --env-file=.env.local --experimental-loader ./scripts/_esm-loader.mjs \
//           scripts/releve-booking.mjs [--valider] fichier1.csv [fichier2.xlsx …]
import fs from 'node:fs'
import path from 'node:path'
import { preparerImportBooking, validerImportBooking } from '../src/services/importBooking.js'

const args = process.argv.slice(2)
const valider = args.includes('--valider')
const chemins = args.filter(a => !a.startsWith('--'))
const files = chemins.map(p => ({ name: path.basename(p), buffer: fs.readFileSync(p) }))
const e = c => c == null ? '—' : (c / 100).toFixed(2)

const a = await preparerImportBooking(files)
console.log(`Agence ${a.agence} — ${a.fichiers.length} fichier(s), ${a.resume.versements} versement(s), ${a.resume.lignes} ligne(s)`)
for (const f of a.fichiers.filter(f => f.erreur)) console.log('  ERREUR', f.nom, f.erreur)
for (const v of a.versements) {
  console.log(`\n[${v.etat}] versement ${v.payout_date} ${v.payout_id || ''} | virement ${v.mouvement ? v.mouvement.date_operation + ' ' + e(v.mouvement.credit) : 'ABSENT'} | Σ ${e(v.somme_nets)} | écart ${e(v.ecart_virement)}`
    + ` | brut ${e(v.total_brut)} comm ${e(v.total_commission)} frais ${e(v.total_frais)} taxe ${e(v.total_taxe)}`)
  for (const l of v.lignes) console.log(`   ${l.booking_ref} ${l.bien || '?'} net ${e(l.amount_cents)} revenu ${e(l.fin_revenue)} écart ${e(l.ecart_cents)} [${l.ecart.code}] paiement ${l.action_paiement}`)
  for (const p of v.problemes) console.log('   ! ' + p)
  for (const p of v.a_regulariser) console.log('   ⚠ ' + p)
}
if (valider) {
  const log = await validerImportBooking(a)
  console.log('\nVALIDÉ :', JSON.stringify(log, null, 1))
} else console.log('\n(aperçu seulement — ajouter --valider pour écrire)')
