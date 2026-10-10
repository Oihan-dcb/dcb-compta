// Taxe de séjour — résolution PAR BIEN (migration 401, 11/10/2026).
// Même règle que la fonction SQL taxe_sejour_bien() utilisée par PowerHouse (fiche bien 💶 Tarifs & frais,
// résas manuelles) : à modifier ensemble.
//   • commune de la taxe = bien.taxe_commune, sinon bien.ville ;
//   • classement expiré (fin < jour, dates cohérentes) → barème « non classé » ;
//   • chambre d'hôtes → ligne « chambre_hotes » du barème, sinon 1★ (même ligne légale) ;
//   • « autre » catégorie → bien.taxe_tarif_saisi (€ / personne / nuit, taxes additionnelles comprises) ;
//   • régime au forfait → rien n'est dû par nuitée (le propriétaire paie un forfait à la commune) ;
//   • barème de la commune quelle que soit l'agence (donnée légale), la même agence d'abord, l'année la plus proche.
// La ventilation n'utilise PAS ce barème (ligne TAXE = taxe facturée par Hospitable, ventilationCore.js).

export const CLASSEMENTS = [
  { value: 'non_classe', label: 'Non classé' },
  { value: '1_etoile', label: '1 ★' },
  { value: '2_etoiles', label: '2 ★' },
  { value: '3_etoiles', label: '3 ★' },
  { value: '4_etoiles', label: '4 ★' },
  { value: '5_etoiles', label: '5 ★' },
  { value: 'palace', label: 'Palace' },
  { value: 'chambre_hotes', label: "Chambre d'hôtes" },
  { value: 'autre', label: 'Autre catégorie' },
]
export const CLASSEMENT_LABEL = Object.fromEntries(CLASSEMENTS.map(c => [c.value, c.label]))
const CLASSES_DATEES = ['1_etoile', '2_etoiles', '3_etoiles', '4_etoiles', '5_etoiles', 'palace']

export function communeTaxe(bien) {
  return ((bien?.taxe_commune || '').trim() || (bien?.ville || '').trim()) || null
}

export function classementEffectif(bien, jour) {
  const c = bien?.classification || 'non_classe'
  const d = bien?.classification_date, f = bien?.classification_fin
  const incoherent = d && f && f <= d
  if (CLASSES_DATEES.includes(c) && f && !incoherent && jour && f < jour) return 'non_classe'
  return c
}

// configs : lignes taxe_sejour_config (toutes agences). Renvoie la ligne retenue ou null.
export function choisirBareme(configs, bien, annee, jour) {
  const commune = (communeTaxe(bien) || '').toLowerCase()
  if (!commune) return null
  const eff = classementEffectif(bien, jour)
  const cherche = eff === 'chambre_hotes' ? ['chambre_hotes', '1_etoile'] : eff === 'autre' ? [] : [eff]
  const cands = (configs || []).filter(c => (c.commune || '').trim().toLowerCase() === commune && cherche.includes(c.classification))
  cands.sort((a, b) => (cherche.indexOf(a.classification) - cherche.indexOf(b.classification))
    || (Math.abs(a.annee - annee) - Math.abs(b.annee - annee))
    || ((b.agence === bien.agence) - (a.agence === bien.agence))
    || (b.annee - a.annee))
  return cands[0] || null
}

// Taxe due d'une résa (euros) ; null = barème manquant. resa.adultes (Hospitable guests.adult_count) prioritaire :
// les mineurs sont exonérés ; la division du prix (non classé) se fait par TOUS les occupants.
export function calculTaxeResa(resa, config, bien) {
  const nbNuits = resa.nights || 1
  const occupants = resa.guest_count || 1
  const adultes = resa.adultes != null && resa.adultes !== '' ? Number(resa.adultes) : occupants
  if (bien?.taxe_regime === 'forfait') return 0
  if (classementEffectif(bien, resa.arrival_date) === 'autre') {
    return bien?.taxe_tarif_saisi != null ? Number(bien.taxe_tarif_saisi) * adultes * nbNuits : null
  }
  if (!config) return null
  if (config.type_calcul === 'forfait') return Number(config.tarif_pers_nuit) * adultes * nbNuits
  // fin_accommodation stocké en centimes
  const prixNuitParPers = (resa.fin_accommodation || 0) / 100 / nbNuits / occupants
  const part = Math.min(prixNuitParPers * (Number(config.taux_pct) / 100), Number(config.plafond_ht))
  return part * (Number(config.coeff_additionnel) || 1) * adultes * nbNuits
}
