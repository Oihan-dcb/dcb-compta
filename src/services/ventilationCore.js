/**
 * Noyau pur du calcul de ventilation — extrait le 21/08/2026 (Étape 4, audit fusion des
 * moteurs) depuis api/ventiler.js, qui servait de référence (les 3 copies historiques
 * étaient arithmétiquement identiques, validé par diff mécanique + comparaison dry-run
 * réelle sur juin 2026, mois clôturé).
 *
 * AUCUN import de code avec effet de bord — ni supabase, ni AGENCE, ni journal_ops. Fonction
 * pure : mêmes entrées, mêmes sorties, aucun effet de bord, aucun accès réseau/DB. C'est ce
 * qui permet de la partager entre 3 runtimes différents (Vercel/Node pour api/ventiler.js,
 * Deno pour supabase/functions/ventilation-auto, navigateur/Vite pour
 * src/services/ventilation.js) sans rien dupliquer ni rien casser côté environnement
 * d'exécution. Exception (06/09/2026) : import de ../lib/constants.js ci-dessous — fichier de
 * pure donnée, zéro dépendance, même mécanisme d'import relatif déjà éprouvé dans les 3
 * runtimes, donc compatible avec cette contrainte de portabilité.
 *
 * Toute modification ici s'applique aux 3 moteurs à la fois — c'est le but : la classe de
 * bug I-123 (CITY_TAX corrigé dans un seul des deux fichiers) et I-124 (skip_facturation
 * oublié dans une des 3 copies) devient structurellement impossible.
 */

// Source unique de STATUTS_NON_VENTILABLES : src/lib/constants.js — importée puis
// ré-exportée ici pour ne rien casser côté 3 moteurs qui l'importent depuis ce fichier.
// Avant le 06/09/2026, cette constante était redéfinie ici en dur et avait divergé (liste
// périmée, sans 'checkpoint'/'request', pendant que 4 autres fichiers du repo avaient chacun
// leur propre copie, certaines encore plus périmées) — même classe de bug que I-123/I-124
// que le noyau partagé devait justement rendre impossible. Ne JAMAIS la redéfinir localement
// ailleurs : importer depuis lib/constants.js.
import { STATUTS_NON_VENTILABLES } from '../lib/constants.js'
export { STATUTS_NON_VENTILABLES }

export const TVA_RATE = 0.20

export function ligneTVA(code, libelle, montantHT, bien, resa, tauxCalcule, montantTTC) {
  const ttc = montantTTC || Math.round(montantHT * (1 + TVA_RATE))
  const tva = ttc - montantHT
  return {
    reservation_id: resa.id,
    bien_id: bien.id,
    proprietaire_id: bien.proprietaire_id,
    code, libelle,
    montant_ht: montantHT, taux_tva: 20, montant_tva: tva, montant_ttc: ttc,
    mois_comptable: resa.mois_comptable, calcul_source: 'auto',
    taux_calcule: code === 'HON' ? tauxCalcule : null,
  }
}

export function ligneHorsTVA(code, libelle, montant, bien, resa) {
  return {
    reservation_id: resa.id,
    bien_id: bien.id,
    proprietaire_id: bien.proprietaire_id,
    code, libelle,
    montant_ht: montant, taux_tva: 0, montant_tva: 0, montant_ttc: montant,
    mois_comptable: resa.mois_comptable, calcul_source: 'auto',
    taux_calcule: null,
  }
}

export function _calculerLignes(resa, agence) {
  const bien = resa.bien
  if (!bien) throw new Error(`Bien manquant pour résa ${resa.code}`)
  if ((bien.agence || agence) !== agence) return { lignes: [], isProlongation: false, fallbackAirbnb: null }

  const revenue = resa.fin_revenue || 0

  let fees = resa.reservation_fee || []

  if (fees.length === 0 && resa.hospitable_raw?.financials?.host) {
    const fin = resa.hospitable_raw.financials.host
    const rawHostFees  = fin.host_fees  || []
    const rawGuestFees = fin.guest_fees || []
    const rawTaxes     = fin.taxes      || []
    const LABEL_ALIASES = {
      'frais de ménage':       'cleaning fee',
      'frais de service (5%)': 'community fee',
    }
    const normalizeLabel = l => LABEL_ALIASES[l?.toLowerCase()] ?? l
    fees = [
      ...rawHostFees.map(f  => ({ label: normalizeLabel(f.label),  amount: f.amount, fee_type: 'host_fee' })),
      ...rawGuestFees.map(f => ({ label: normalizeLabel(f.label),  amount: f.amount, fee_type: 'guest_fee' })),
      ...rawTaxes.map(f     => ({ label: normalizeLabel(f.label),  amount: f.amount, fee_type: 'tax' })),
    ]
  }

  const hostFees       = fees.filter(f => f.fee_type === 'host_fee')
  const hostServiceFee = hostFees.reduce((s, f) => s + (f.amount || 0), 0)
  const guestFeesAll   = fees.filter(f => f.fee_type === 'guest_fee')
  const taxes          = fees.filter(f => f.fee_type === 'tax')

  // Ajustements Hospitable (Resolution Center Airbnb, ex. remboursement partiel) : montant
  // signé, non qualifiable automatiquement (hébergement ou ménage/extra ?) → voir migration
  // 222. Tant que non qualifié (statut≠'traite'), contribution nulle au calcul (comportement
  // identique à avant leur prise en compte) ; la détection/alerte est gérée par _writeResa.
  // Ménage/extra : montant_fmen saisi manuellement (migration 224) augmente le FMEN de DCB.
  // montant_auto n'entre dans AUCUN calcul (stocké pour information seulement) : la vraie
  // rémunération AE passe par une prestation_hors_forfait réelle saisie séparément (liée à
  // mission_menage), jamais par cette ligne — sinon double paiement AE. Le reliquat de
  // l'ajustement non absorbé par montant_fmen (= revenue déjà augmenté du montant brut, non
  // compensé par fmenTTC) remonte naturellement au propriétaire via le résidu LOY, où il
  // s'annule avec la déduction de la prestation réelle (ex. Shelly : +75 ajustement, +56,25
  // FMEN → +18,75 résiduel au LOY, qui compense exactement les -18,75 de la prestation
  // "Recouche" déduite par ailleurs — net propriétaire = 0).
  const ajustementsQualifies = (resa.reservation_ajustement || []).filter(a => a.statut === 'traite')
  const ajustementHebergement = ajustementsQualifies
    .filter(a => a.type === 'hebergement').reduce((s, a) => s + (a.montant || 0), 0)
  const ajustementFmenExtra = ajustementsQualifies
    .filter(a => a.type === 'menage').reduce((s, a) => s + (a.montant_fmen || 0), 0)

  const discountsRaw    = resa.hospitable_raw?.financials?.host?.discounts || []
  const discountsFromApi = discountsRaw.reduce((s, d) => s + (d.amount || 0), 0)
  const discountsTotal   = discountsFromApi !== 0 ? discountsFromApi : -(resa.fin_discount || 0)

  const accommodation = resa.fin_accommodation || 0
  const tauxCom = bien.taux_commission_override
    || (bien.proprietaire?.taux_commission ? bien.proprietaire.taux_commission / 100 : null)
    || 0.25

  const isDirect     = resa.platform === 'direct' || resa.platform === 'manual'
  const isCancelled  = STATUTS_NON_VENTILABLES.includes(resa.final_status)
  const isProlongation = resa.isProlongation === true ||
    (resa.guest_name || '').toLowerCase().includes('prolongation')

  const managementFeeRaw  = guestFeesAll.find(f => f.label?.toLowerCase().includes('management'))?.amount || 0
  const cleaningFeeAirbnb = guestFeesAll.find(f => f.label?.toLowerCase() === 'cleaning fee')?.amount || 0
  const communityFeeRaw   = guestFeesAll.find(f => f.label?.toLowerCase() === 'community fee')?.amount || 0
  const menageBrut        = resa.platform === 'airbnb' ? cleaningFeeAirbnb : communityFeeRaw
  // Ce label existe en base sous 3 formes : "Extra guest fee" (import CSV maison, cf.
  // importCSV.js:242), "EXTRA_GUEST_FEE" (écrit par un sync Hospitable plus ancien),
  // "Additional guest fee" (libellé alternatif Hospitable). Bug trouvé le 06/09/2026 : le
  // match strict sur 'extra_guest_fee' ne captait que la forme underscore et ratait
  // silencieusement les 2 autres (161 lignes reservation_fee concernées, 84 résas). Même bug
  // dupliqué (non couvert par ce fix) dans buildRapportData.js:base_comm — voir ce fichier.
  const EXTRA_GUEST_FEE_LABELS = ['extra guest fee', 'additional guest fee']
  const extraGuestFee     = guestFeesAll
    .filter(f => EXTRA_GUEST_FEE_LABELS.includes(f.label?.toLowerCase().replace(/_/g, ' ')))
    .reduce((s, f) => s + (f.amount || 0), 0)

  const aeAmount = (isCancelled || isProlongation || (isDirect && menageBrut === 0))
    ? 0 : (bien.provision_ae_ref || 0)

  const isRemitted = t => t.label?.toLowerCase().includes('remitted')
  const taxesTotal = resa.platform === 'airbnb'
    ? 0
    : taxes.filter(t => !isRemitted(t)).reduce((s, t) => s + (t.amount || 0), 0)

  const totalFeesForOwnerRate = accommodation + guestFeesAll.reduce((s, f) => s + (f.amount || 0), 0)

  const totalFeesAirbnb    = cleaningFeeAirbnb + communityFeeRaw
  const airbnbFallbackActif = resa.platform === 'airbnb' && totalFeesAirbnb === 0 && (bien.forfait_dcb_ref || 0) > 0
  // Fallback Airbnb : Airbnb n'a pas transmis la ligne ménage → le ménage voyageur est FONDU
  // dans `accommodation`. Prix ménage facturé au voyageur = forfait_dcb_ref + provision_ae_ref
  // (vérifié : 97,00 = 72,00 + 25,00 sur le 416).
  const fmenBase = airbnbFallbackActif
    ? (bien.forfait_dcb_ref || 0) + (bien.provision_ae_ref || 0)
    : totalFeesAirbnb
  // Part du host service fee Airbnb imputée au ménage (Airbnb commissionne aussi le ménage).
  const dueToOwner = ((resa.platform === 'airbnb' || resa.platform === 'booking') && totalFeesForOwnerRate > 0)
    ? Math.round(Math.abs(hostServiceFee) * fmenBase / totalFeesForOwnerRate * (1 - tauxCom))
    : 0
  let fmenTTC = Math.max(0, fmenBase - dueToOwner - aeAmount) + ajustementFmenExtra
  // fmenHT peut être négatif si ajustementFmenExtra dépasse la marge FMEN normale (DCB
  // absorbe la perte) — pas de floor à 0 ici, pour que HON+FMEN+AUTO+LOY se recoupe exactement.
  let fmenHT  = fmenTTC !== 0 ? Math.round(fmenTTC / (1 + TVA_RATE)) : 0

  // En fallback, le ménage voyageur NET de la commission Airbnb (= fmenBase − dueToOwner) est
  // fondu dans `accommodation` → on le retranche de la base de commission, sinon HON serait
  // calculé sur le ménage. (Cas normal : le ménage est déjà hors accommodation.)
  const menageFonduAccommodation = airbnbFallbackActif ? (fmenBase - dueToOwner) : 0

  const commissionableBase = accommodation + hostServiceFee + discountsTotal + extraGuestFee - menageFonduAccommodation + ajustementHebergement
  let honTTC = isDirect
    ? Math.floor(commissionableBase * tauxCom)
    : Math.round(commissionableBase * tauxCom)
  let honHT = Math.round(honTTC / (1 + TVA_RATE))

  // skip_facturation : bien perso du gérant (ex. LAGREOU/ASKIDA) — aucun honoraire ni
  // forfait ménage ne doit être prélevé, pas juste "non facturé" (cf. facturesLLD.js).
  // Le revenu correspondant remonte intégralement au propriétaire via LOY/VIR ci-dessous.
  if (bien.skip_facturation) {
    honHT = 0; honTTC = 0; fmenHT = 0; fmenTTC = 0
  }

  const menLabelsToExclude = ['management fee', 'host service fee', 'resort fee']
  const menFees   = guestFeesAll.filter(f => !menLabelsToExclude.includes(f.label?.toLowerCase()))
  const menAmount = menFees.reduce((s, f) => s + (f.amount || 0), 0)

  const resortFeeRaw = guestFeesAll.find(f => f.label?.toLowerCase() === 'resort fee')?.amount || 0
  const comAmount    = isDirect ? (managementFeeRaw + resortFeeRaw) : 0
  const comHT        = comAmount > 0 ? Math.round(comAmount / (1 + TVA_RATE)) : 0

  const ownerFees = (isDirect && totalFeesForOwnerRate > 0)
    ? guestFeesAll.reduce((s, f) => s + Math.round(Math.abs(hostServiceFee) * (f.amount || 0) / totalFeesForOwnerRate * (1 - tauxCom)), 0)
    : 0

  let loyAmount
  if (isDirect) {
    loyAmount = commissionableBase - honTTC + ownerFees
  } else {
    loyAmount = revenue - honTTC - fmenTTC - aeAmount - taxesTotal
  }

  if (resa.platform === 'booking') {
    const remittedTotal = taxes.filter(t => isRemitted(t)).reduce((s, t) => s + (t.amount || 0), 0)
    // CITY_TAX (Withheld Tax) est déjà exclu de host.revenue.amount — ne pas déduire une 2e fois
    loyAmount = (revenue - remittedTotal) - honTTC - fmenTTC - aeAmount - taxesTotal
  }

  // skip_facturation : 100% de l'encaissement reversé (hors frais plateforme déjà exclus de
  // `revenue`), ménage AE réel payé à part via la ligne AUTO — pas de déduction commission/
  // ménage/AE sur le LOY. commissionableBase n'est pas fiable ici (formule pensée pour
  // Airbnb/Booking, pas pour une résa Direct sans breakdown standard Hospitable).
  if (bien.skip_facturation) {
    loyAmount = revenue - taxesTotal
  }

  const horsSequestre = bien.gestion_loyer === false
    && (resa.platform === 'airbnb' || resa.platform === 'booking')

  const lignes = []

  if (menAmount > 0)
    lignes.push(ligneHorsTVA('MEN',  'Ménage brut voyageur',       menAmount, bien, resa))
  if (comHT > 0)
    lignes.push(ligneTVA(    'COM',  'Commission DCB',              comHT,     bien, resa, null,        comAmount))
  if (honHT > 0)
    lignes.push(ligneTVA(    'HON',  'Honoraires de gestion',       honHT,     bien, resa, tauxCom,     honTTC))
  if (fmenHT !== 0)
    lignes.push(ligneTVA(    'FMEN', 'Forfait ménage',              fmenHT,    bien, resa, null,        fmenTTC))
  // Ligne AUTO créée même à 0 quand il y a un ménage : provision_ae_ref absent ≠ coût nul,
  // la ligne sert d'ancrage aux missions réelles (lier_ventilation_auto_mission +
  // update-ventilation-auto qui pose montant_reel et le FMEN réel dérivé).
  if (aeAmount > 0 || menAmount > 0)
    lignes.push(ligneHorsTVA('AUTO', 'Débours auto-entrepreneur',   aeAmount,  bien, resa))
  if (loyAmount > 0 && !horsSequestre)
    lignes.push(ligneHorsTVA('LOY',  'Reversement propriétaire',   loyAmount,  bien, resa))

  const virAmount = loyAmount + taxesTotal
  if (virAmount > 0 && !horsSequestre)
    lignes.push(ligneHorsTVA('VIR',  'Virement propriétaire',       virAmount, bien, resa))

  if (resa.platform !== 'airbnb') {
    const seen = new Set()
    for (const tax of taxes) {
      if (tax.amount > 0 && !isRemitted(tax)) {
        const label = tax.label || 'Taxe séjour'
        const key   = `${label}|${tax.amount}`
        if (!seen.has(key)) {
          seen.add(key)
          lignes.push(ligneHorsTVA('TAXE', label, tax.amount, bien, resa))
        }
      }
    }
  }

  return {
    lignes, isProlongation,
    fallbackAirbnb: airbnbFallbackActif ? {
      motif: 'airbnb_fees_missing',
      forfait_dcb_ref: bien.forfait_dcb_ref,
      provision_ae_ref: bien.provision_ae_ref || 0,
      fmenBase,
    } : null,
  }
}
