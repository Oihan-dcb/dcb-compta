import { supabase } from '../lib/supabase'
import { AGENCE } from '../lib/agence'

// ── Répartition mensuelle "Manon hybride" (CDI 15h + AE + SAP) ───────────────
// Voir plan : note projet project_manon_hybride.
//
// 2 axes INDÉPENDANTS :
//  • COÛT DCB : salarié (dans le pool 15h) vs AE (surplus). Déterminé par la cascade.
//  • FACTURATION PROPRIO : auto_dcb (normal) vs sap (résidence principale). Flag par ménage.
//
// Cascade de priorité (sature le pool salarié, missions ENTIÈRES, pas de cheval) :
//   1. Bureau (manual_missions, staff_id slug)         → toujours salarié
//   2. Ménages biens Oïhan (skip_facturation)
//   3. Ménages SAP (regime='sap')
//   4. Ménages DCB normaux (regime='auto_dcb')
//   → au-delà du pool : surplus facturé en AE (statut auto).

const POOL_HEBDO_H = 15

const slugify = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '')

// Nb de semaines réelles du mois (le "réel", non lissé) = jours / 7.
export function semainesDuMois(mois) {
  const [y, m] = String(mois).split('-').map(Number)
  const jours = new Date(y, m, 0).getDate()
  return jours / 7
}
export function poolMensuelH(mois) {
  return Math.round(POOL_HEBDO_H * semainesDuMois(mois) * 100) / 100
}

// Cascade pure : `missions` déjà triées par priorité. Remplit le pool avec des missions
// ENTIÈRES (une mission qui dépasse le reste du pool bascule entièrement en AE).
export function calculerCascade(poolH, missions) {
  let cumul = 0
  const salarie = [], ae = []
  for (const m of missions) {
    if (cumul + m.heures <= poolH) { salarie.push(m); cumul += m.heures }
    else ae.push(m)
  }
  return { salarie, ae }
}

// Charge les données du mois et calcule la répartition. LECTURE SEULE (ne persiste rien).
export async function chargerRepartitionManon(mois, agence = AGENCE) {
  // 1. Comptes de Manon : staff (type=staff) + AE, repérés par nom
  const { data: comptes } = await supabase
    .from('auto_entrepreneur')
    .select('id, prenom, nom, type, ae_user_id')
    .eq('agence', agence)
    .ilike('nom', 'castet')
    .ilike('prenom', 'manon')
  const staff = (comptes || []).find(c => c.type === 'staff')
  const ae    = (comptes || []).find(c => c.type === 'ae')
  if (!ae) return { error: 'Compte AE de Manon introuvable' }
  const slug = slugify(staff?.prenom || 'manon')

  // 2. Heures bureau du mois : manual_missions (planning) sur son slug staff
  const [y, m] = mois.split('-').map(Number)
  const debut = `${mois}-01`
  const fin   = `${mois}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
  const { data: manuels } = await supabase
    .from('manual_missions')
    .select('id, date, duration, description, bien_id')
    .eq('staff_id', slug)
    .gte('date', debut).lte('date', fin)
    .neq('deleted', true)

  // 3. Ménages du mois (compte AE), avec bien (skip_facturation) + régime
  const { data: menages } = await supabase
    .from('mission_menage')
    .select('id, date_mission, duree_heures, duree_prevue, regime, statut, bien:bien_id(code, hospitable_name, skip_facturation)')
    .eq('ae_id', ae.id)
    .eq('mois', mois)
    .neq('statut', 'cancelled')

  // 4. Construire les "blocs" avec priorité + heures
  const blocs = []
  for (const mm of (manuels || [])) {
    blocs.push({ id: mm.id, kind: 'bureau', priorite: 1, regime: 'bureau',
      heures: Number(mm.duration || 0), date: mm.date, label: mm.description || 'Bureau', bien: null })
  }
  for (const me of (menages || [])) {
    const h = Number(me.duree_heures ?? me.duree_prevue ?? 0)
    const estOihan = !!me.bien?.skip_facturation
    const regime = me.regime || 'auto_dcb'
    const priorite = estOihan ? 2 : (regime === 'sap' ? 3 : 4)
    blocs.push({ id: me.id, kind: estOihan ? 'oihan' : (regime === 'sap' ? 'sap' : 'dcb'),
      priorite, regime, heures: h, date: me.date_mission,
      label: me.bien?.code || me.bien?.hospitable_name || '—', bien: me.bien?.code || null })
  }

  // 5. Tri par priorité puis date, puis cascade
  blocs.sort((a, b) => a.priorite - b.priorite || String(a.date).localeCompare(String(b.date)))
  const poolH = poolMensuelH(mois)
  const { salarie, ae: surplus } = calculerCascade(poolH, blocs)

  // 6. Agrégats
  const sumH = arr => Math.round(arr.reduce((s, b) => s + b.heures, 0) * 100) / 100
  const parKind = kind => sumH(salarie.filter(b => b.kind === kind))
  const heuresSalarie = sumH(salarie)
  return {
    mois, poolH,
    salarie, surplus,
    heuresSalarie,
    heuresSurplusAe: sumH(surplus),
    pool_restant: Math.round((poolH - heuresSalarie) * 100) / 100,
    sature: heuresSalarie >= poolH,
    detail: {
      bureau:  parKind('bureau'),
      oihan:   parKind('oihan'),
      sap:     parKind('sap'),
      dcb:     parKind('dcb'),
    },
    // Axe facturation proprio (indépendant du coût) : tous les ménages SAP du mois
    sap_total_h: sumH([...salarie, ...surplus].filter(b => b.regime === 'sap')),
    comptes: { staff_id: staff?.id || null, ae_id: ae.id },
  }
}
