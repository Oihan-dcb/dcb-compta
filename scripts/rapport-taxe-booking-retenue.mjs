// scripts/rapport-taxe-booking-retenue.mjs — LECTURE SEULE (migration 404, 11/10/2026).
// Mois potentiellement SURDÉCLARÉS : résas Booking dont Booking a retenu la taxe de séjour (« Withheld ») et que la
// déclaration PageTaxeSejour comptait quand même (Booking inclus depuis le 24/09/2026, commit 9cb9c80 / I-158 ; avant :
// Direct seulement). Pour chaque mois d'arrivée et chaque agence : nombre de résas, nuitées, taxe RETENUE par Booking,
// et taxe « due » que la page aurait déclarée (même calcul que la page : src/lib/taxeSejour.js).
// Ne modifie rien. Usage : node scripts/rapport-taxe-booking-retenue.mjs [AAAA-MM-JJ début] [AAAA-MM-JJ fin]
import fs from 'fs'
import { choisirBareme, calculTaxeResa, collecteurResa } from '../src/lib/taxeSejour.js'

const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const KEY = (env.match(/^SUPABASE_SERVICE_ROLE_KEY="?([^"\n]+)"?/m) || [])[1]
const BASE = 'https://omuncchvypbtxkpalwcr.supabase.co/rest/v1/'
const debut = process.argv[2] || '2025-01-01', fin = process.argv[3] || '2026-12-31'
async function get(path) {
  const out = []
  for (let off = 0; ; off += 1000) {
    const r = await fetch(BASE + path, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Range: `${off}-${off + 999}` } })
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
    const rows = await r.json(); out.push(...rows)
    if (rows.length < 1000) return out
  }
}
const biens = await get('bien?select=id,code,agence,ville,classification,classification_date,classification_fin,taxe_commune,taxe_regime,taxe_collecte,taxe_tarif_saisi')
const configs = await get('taxe_sejour_config?select=*')
const resas = await get(`reservation?platform=eq.booking&final_status=eq.accepted&owner_stay=not.is.true&arrival_date=gte.${debut}&arrival_date=lte.${fin}`
  + '&select=id,code,bien_id,platform,arrival_date,nights,guest_count,fin_accommodation,adultes:hospitable_raw->guests->>adult_count,taxes_voyageur:hospitable_raw->financials->guest->taxes&order=arrival_date')
const bienParId = Object.fromEntries(biens.map(b => [b.id, b]))
const parMois = {}
for (const r of resas) {
  const b = bienParId[r.bien_id]; if (!b) continue
  const c = collecteurResa(r, { ...b, taxe_collecte: { booking: 'nous' } }) // ancien réglage : « nous » partout
  if (c.source !== 'resa' || c.collecteur !== 'plateforme') continue
  const cfg = choisirBareme(configs, b, Number(r.arrival_date.slice(0, 4)), r.arrival_date)
  const due = calculTaxeResa(r, cfg, b)
  const k = `${r.arrival_date.slice(0, 7)}|${b.agence}`
  const m = parMois[k] ||= { mois: r.arrival_date.slice(0, 7), agence: b.agence, resas: 0, nuitees: 0, retenue: 0, due: 0, sansBareme: 0, biens: new Set() }
  m.resas++; m.nuitees += r.nights || 0; m.retenue += c.montantRetenu; m.due += due || 0; if (due == null) m.sansBareme++; m.biens.add(b.code)
}
const lignes = Object.values(parMois).sort((a, b) => (a.mois + a.agence).localeCompare(b.mois + b.agence))
const e = x => x.toFixed(2).replace('.', ',')
console.log('mois;agence;resas;nuitees;taxe_retenue_par_booking_eur;taxe_que_la_page_aurait_declaree_eur;resas_sans_bareme;biens')
for (const m of lignes) console.log([m.mois, m.agence, m.resas, m.nuitees, e(m.retenue), e(m.due), m.sansBareme, [...m.biens].join(' ')].join(';'))
const T = lignes.reduce((t, m) => ({ resas: t.resas + m.resas, retenue: t.retenue + m.retenue, due: t.due + m.due }), { resas: 0, retenue: 0, due: 0 })
console.log(`TOTAL;;${T.resas};;${e(T.retenue)};${e(T.due)};;`)
