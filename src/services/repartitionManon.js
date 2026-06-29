import { supabase } from '../lib/supabase'
import { AGENCE } from '../lib/agence'

// ── Répartition mensuelle "Manon hybride" (CDI 15h + AE + SAP) — v2 ──────────
// Voir plan : note projet project_manon_hybride.
//
// PRINCIPE (révisé) : le temps SALARIÉ se mesure sur les AMPLITUDES POINTÉES
// (staff_heures_jour : « Je commence / Je termine », pause 20min auto dès 6h),
// PAS sur la somme des durées de missions.
//
// Couverture (coût DCB) :
//   • Un ménage est COUVERT par le salaire (impute_salaire=true → 0 débours AE) s'il est
//     fait sur un BIEN DCB un JOUR où Manon a pointé une journée salariée.
//   • Tout le reste = AE : biens Lauian (toujours), et ménages DCB hors jour pointé.
// Axe FACTURATION proprio (indépendant) : regime 'auto_dcb' / 'sap' (par ménage).

const POOL_HEBDO_H = 15
const PAUSE_LEGALE_MIN = 20
const SEUIL_PAUSE_MIN = 6 * 60

const toMin = hm => { if (!hm) return null; const [h, m] = String(hm).slice(0, 5).split(':').map(Number); return h * 60 + m }
const round2 = n => Math.round(n * 100) / 100

// Heures payées d'une journée pointée = amplitude − pause (20 min mini si > 6h).
export function heuresPayeesJour(row) {
  const d = toMin(row.heure_debut), f = toMin(row.heure_fin)
  if (d == null || f == null) return 0
  let amp = f - d; if (amp < 0) amp += 24 * 60
  const pause = amp > SEUIL_PAUSE_MIN ? Math.max(row.pause_min || 0, PAUSE_LEGALE_MIN) : (row.pause_min || 0)
  return Math.max(0, amp - pause) / 60
}

export function semainesDuMois(mois) {
  const [y, m] = String(mois).split('-').map(Number)
  return new Date(y, m, 0).getDate() / 7
}
export function poolMensuelH(mois) { return round2(POOL_HEBDO_H * semainesDuMois(mois)) }

async function comptesManon(agence) {
  const { data } = await supabase.from('auto_entrepreneur')
    .select('id, type').eq('agence', agence).ilike('nom', 'castet').ilike('prenom', 'manon')
  return { staff: (data || []).find(c => c.type === 'staff'), ae: (data || []).find(c => c.type === 'ae') }
}

// Calcule la répartition du mois (LECTURE SEULE). Retourne aussi la liste des ménages
// avec leur couverture (pour l'affichage + l'application).
export async function chargerRepartitionManon(mois, agence = AGENCE) {
  const { staff, ae } = await comptesManon(agence)
  if (!ae) return { error: 'Compte AE de Manon introuvable' }

  // Jours salariés pointés (terminés)
  const { data: jours } = staff
    ? await supabase.from('staff_heures_jour')
        .select('date, heure_debut, heure_fin, pause_min')
        .eq('ae_id', staff.id).eq('mois', mois).not('heure_fin', 'is', null)
    : { data: [] }
  const joursSalaries = new Set((jours || []).map(j => j.date))
  const heuresSalarie = round2((jours || []).reduce((s, j) => s + heuresPayeesJour(j), 0))

  // Ménages du mois
  const { data: menages } = await supabase.from('mission_menage')
    .select('id, date_mission, duree_heures, duree_prevue, regime, statut, impute_salaire, bien:bien_id(code, hospitable_name, agence, skip_facturation)')
    .eq('ae_id', ae.id).eq('mois', mois).neq('statut', 'cancelled')

  const lignes = (menages || []).map(m => {
    const h = Number(m.duree_heures ?? m.duree_prevue ?? 0)
    const lauian = m.bien?.agence === 'lauian'
    const couvert = !lauian && joursSalaries.has(m.date_mission)
    const bucket = couvert
      ? (m.bien?.skip_facturation ? 'oihan' : (m.regime === 'sap' ? 'sap' : 'dcb'))
      : (lauian ? 'ae_lauian' : 'ae_hors_pointage')
    return { id: m.id, date: m.date_mission, heures: h, regime: m.regime || 'auto_dcb',
      bien: m.bien?.code || m.bien?.hospitable_name || '—', lauian, couvert, bucket, impute_salaire: m.impute_salaire }
  })

  const sumH = pred => round2(lignes.filter(pred).reduce((s, l) => s + l.heures, 0))
  const nb = pred => lignes.filter(pred).length
  const poolH = poolMensuelH(mois)

  // Détail jour par jour : pointage (début/fin/pause/heures) + ménages du jour
  const jourMap = new Map()
  for (const j of (jours || [])) {
    jourMap.set(j.date, { date: j.date, debut: j.heure_debut, fin: j.heure_fin, pause: j.pause_min || 0, heures: round2(heuresPayeesJour(j)), menages: [] })
  }
  for (const l of lignes) {
    if (!jourMap.has(l.date)) jourMap.set(l.date, { date: l.date, debut: null, fin: null, pause: 0, heures: 0, menages: [] })
    jourMap.get(l.date).menages.push({ bien: l.bien, heures: l.heures, couvert: l.couvert, bucket: l.bucket, regime: l.regime })
  }
  const joursDetail = [...jourMap.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)))

  return {
    mois, poolH,
    joursDetail,
    jours_pointes: (jours || []).length,
    heures_salarie: heuresSalarie,
    ecart_pool: round2(heuresSalarie - poolH),
    couvert: {
      oihan: { h: sumH(l => l.bucket === 'oihan'), nb: nb(l => l.bucket === 'oihan') },
      sap:   { h: sumH(l => l.bucket === 'sap'),   nb: nb(l => l.bucket === 'sap') },
      dcb:   { h: sumH(l => l.bucket === 'dcb'),   nb: nb(l => l.bucket === 'dcb') },
      total_nb: nb(l => l.couvert),
    },
    ae: {
      lauian:        { h: sumH(l => l.bucket === 'ae_lauian'),        nb: nb(l => l.bucket === 'ae_lauian') },
      hors_pointage: { h: sumH(l => l.bucket === 'ae_hors_pointage'), nb: nb(l => l.bucket === 'ae_hors_pointage') },
      total_h: sumH(l => !l.couvert), total_nb: nb(l => !l.couvert),
    },
    sap_total_h: sumH(l => l.regime === 'sap'),
    lignes,
    comptes: { staff_id: staff?.id || null, ae_id: ae.id },
  }
}

// Persiste impute_salaire sur les ménages (couvert=true) pour que la compta exclue le débours AUTO.
export async function appliquerImputationManon(mois, agence = AGENCE) {
  const r = await chargerRepartitionManon(mois, agence)
  if (r.error) throw new Error(r.error)
  const couverts = r.lignes.filter(l => l.couvert && !l.impute_salaire).map(l => l.id)
  const aRetirer = r.lignes.filter(l => !l.couvert && l.impute_salaire).map(l => l.id)
  if (couverts.length) await supabase.from('mission_menage').update({ impute_salaire: true }).in('id', couverts)
  if (aRetirer.length) await supabase.from('mission_menage').update({ impute_salaire: false }).in('id', aRetirer)
  return { couverts: couverts.length, retires: aRetirer.length }
}
