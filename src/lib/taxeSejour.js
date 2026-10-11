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
//
// QUI COLLECTE (migration 404, 11/10/2026) — décision Oïhan : quand Booking retient la taxe (« CITY_TAX (Withheld Tax) »),
// c'est Booking qui la reverse à la commune → ces nuitées ne vont PAS dans notre déclaration (sinon déclarées deux fois).
// Règle par résa (le fait constaté sur la résa prime sur le réglage du bien) : collecteurResa() ci-dessous ; même règle
// en SQL : taxe_booking_collecteur().
// RÈGLE GÉNÉRALE (migration 405, 11/10/2026) : Booking = « plateforme » pour TOUTES les résas Booking (défaut) ; la
// détection automatique 404 est retirée ; une ligne taxe sans « Withheld » est seulement signalée (« À vérifier »).

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

// ── Qui collecte la taxe d'une résa (404) ─────────────────────────────────────────────────────────────────
// taxes = hospitable_raw.financials.guest.taxes (liste { label, amount }). Booking écrit « (Withheld Tax) » quand il
// retient la taxe lui-même ; une ligne taxe de séjour SANS « Withheld » (ex. « taxe de séjour (5.5%) », 2022-2025) =
// Booking la laissait dans le virement → c'est nous qui la collections.
const RE_RETENUE = /withheld/i
const RE_TAXE_SEJOUR = /(city.?tax|taxe de s[ée]jour|tourist.?tax)/i
export function taxeBookingCollecteur(taxes) {
  const l = (Array.isArray(taxes) ? taxes : []).map(t => String(t?.label || ''))
  if (l.some(x => RE_RETENUE.test(x))) return 'plateforme'
  if (l.some(x => RE_TAXE_SEJOUR.test(x))) return 'nous'
  return null
}
// 405 (11/10/2026, décision Oïhan : « Ce n'est pas à nous de déclarer la taxe pour Booking, Booking s'en charge ») :
// Booking = « plateforme » PAR DÉFAUT, « Withheld » ou pas. Forcer « nous » reste possible bien par bien (réglage
// explicite, journalisé) : seules les résas Booking SANS « Withheld » reviennent alors dans la déclaration.
export const COLLECTE_DEFAUT = { airbnb: 'plateforme', booking: 'plateforme', direct: 'nous' }
// Renvoie { collecteur: 'plateforme' | 'nous', source: 'resa' | 'reglage', montantRetenu (euros, Booking),
//           aVerifier: null | motif } — aVerifier = résa Booking portant une ligne taxe de séjour SANS « Withheld »
// (taxe qui serait facturée par nous) alors que le bien dit « plateforme » : SIGNALÉE seulement, jamais réintégrée.
export function collecteurResa(resa, bien) {
  const canal = resa.platform === 'airbnb' ? 'airbnb' : resa.platform === 'booking' ? 'booking' : 'direct'
  const reglage = { ...COLLECTE_DEFAUT, ...(bien?.taxe_collecte || {}) }[canal] || COLLECTE_DEFAUT[canal]
  if (canal === 'booking') {
    const fait = taxeBookingCollecteur(resa.taxes_voyageur)
    if (fait === 'plateforme') {
      // Booking a retenu la taxe : toujours hors déclaration (même si le bien est forcé « nous »).
      const montantRetenu = (resa.taxes_voyageur || []).filter(t => RE_RETENUE.test(t?.label || '')).reduce((s, t) => s + (Number(t.amount) || 0), 0) / 100
      return { collecteur: 'plateforme', source: 'resa', montantRetenu, aVerifier: null }
    }
    if (fait === 'nous' && reglage === 'plateforme') {
      const l = (resa.taxes_voyageur || []).find(t => RE_TAXE_SEJOUR.test(t?.label || ''))
      return { collecteur: 'plateforme', source: 'reglage', montantRetenu: 0,
        aVerifier: `ligne « ${l?.label || 'taxe'} » sans « Withheld »${l?.amount ? ` (${(Number(l.amount) / 100).toFixed(2).replace('.', ',')} €)` : ''} : taxe peut-être facturée par nous — vérifier l'extranet Booking ; si c'est nous qui la collectons, forcer Booking sur « nous » dans la fiche du bien` }
    }
  }
  return { collecteur: reglage, source: 'reglage', montantRetenu: 0, aVerifier: null }
}
