// Formatage des dates AFFICHÉES à l'utilisateur (format français, heure de Paris).
// Purement visuel : ne jamais utiliser pour des valeurs envoyées à la DB, à Evoliz,
// Pennylane, aux exports (CSV/SCT/FEC) ni pour des comparaisons/tris/clés.

const _frParse=v=>{if(!v)return null;const s=String(v);if(/^\d{4}-\d{2}-\d{2}$/.test(s))return{d:s,heure:null};const t=new Date(s);if(isNaN(t))return null;const p=Object.fromEntries(new Intl.DateTimeFormat("fr-FR",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(t).map(x=>[x.type,x.value]));return{d:`${p.year}-${p.month}-${p.day}`,heure:`${p.hour==="24"?"00":p.hour}:${p.minute}`};};

// "2026-10-07" ou timestamp → "07/10/2026"
export function frDate(v) {
  if (v === null || v === undefined || v === '') return ''
  const r = _frParse(v)
  if (!r) return String(v)
  const [y, m, d] = r.d.split('-')
  return `${d}/${m}/${y}`
}

// timestamp → "07/10/2026 16:00" (heure de Paris) ; date seule → "07/10/2026"
export function frDateHeure(v) {
  if (v === null || v === undefined || v === '') return ''
  const r = _frParse(v)
  if (!r) return String(v)
  const [y, m, d] = r.d.split('-')
  return r.heure ? `${d}/${m}/${y} ${r.heure}` : `${d}/${m}/${y}`
}

// "2026-10-07" ou timestamp → "07/10"
export function frDateCourte(v) {
  if (v === null || v === undefined || v === '') return ''
  const r = _frParse(v)
  if (!r) return String(v)
  const [, m, d] = r.d.split('-')
  return `${d}/${m}`
}

const _MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

// "2026-10" (ou "2026-10-01") → "octobre 2026"
export function frMois(v) {
  if (v === null || v === undefined || v === '') return ''
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(String(v))
  if (!m) return String(v)
  const idx = Number(m[2]) - 1
  if (idx < 0 || idx > 11) return String(v)
  return `${_MOIS[idx]} ${m[1]}`
}
