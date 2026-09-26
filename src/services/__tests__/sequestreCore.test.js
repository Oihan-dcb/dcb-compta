import { describe, it, expect } from 'vitest'
import { classerSortie, classerEntree } from '../sequestreCore.js'

// Libellés réels du séquestre location saisonnière DCB (juillet-septembre 2026)
const ctx = {
  aes: [
    { id: 'xane', nom: 'LARZABAL', prenom: 'Xane' }, { id: 'manon', nom: 'Castet', prenom: 'Manon' },
    { id: 'esteban', nom: 'GARRIDO DUPUY', prenom: 'Esteban' }, { id: 'lea', nom: 'ESCUDIER', prenom: 'Léa' },
    { id: 'severine', nom: 'POEYUSAN', prenom: 'Severine' }, { id: 'eve', nom: 'Vincent', prenom: 'Eve' },
  ],
  proprietaires: [
    { id: 'richou', nom: 'RICHOU', prenom: 'Gilles' }, { id: 'remond', nom: 'REMOND', prenom: 'Julien' },
    { id: 'grandvoinet', nom: 'GRANDVOINET', prenom: 'Philippe' }, { id: 'carossio', nom: 'CAROSSIO', prenom: 'Antoine' },
  ],
}
const s = (libelle, date_operation, extra = {}) => classerSortie({ libelle, date_operation, ...extra }, ctx)

describe('classerSortie', () => {
  it('remise SEPA des reversements = mois précédent', () => {
    expect(s('REM VIR SEPA DU 06/08/26', '2026-08-06')).toEqual({ type: 'reversement_groupe', mois: '2026-07' })
  })
  it('virements DCB (HON / FMEN / COM) avec le mois du libellé', () => {
    expect(s('HON - JUILLET', '2026-08-06')).toMatchObject({ type: 'transfert_dcb', sous: 'hon', mois: '2026-07' })
    expect(s('FMEN JUIN 26', '2026-07-06')).toMatchObject({ type: 'transfert_dcb', sous: 'fmen', mois: '2026-06' })
    expect(s('COM WEB - JUILLET', '2026-08-06')).toMatchObject({ type: 'transfert_dcb', sous: 'com', mois: '2026-07' })
    expect(s('COMMISIONS DIRECTES - JUILLET', '2026-08-06')).toMatchObject({ type: 'transfert_dcb', sous: 'com', mois: '2026-07' })
    expect(s('HON ITS AOUT', '2026-09-09')).toMatchObject({ type: 'transfert_dcb', sous: 'hon', mois: '2026-08' })
    expect(s('VIR SEPA DCB MENAGE', '2026-02-06')).toMatchObject({ type: 'transfert_dcb', sous: 'fmen', mois: '2026-01' })
    expect(s('COMM DISTRIBUTION DU MOIS DE J', '2026-02-06')).toMatchObject({ type: 'transfert_dcb', sous: 'com' })
    expect(s('VIREMENT FMEN AVRIL', '2026-04-21')).toMatchObject({ type: 'transfert_dcb', sous: 'fmen', mois: '2026-04' })
  })
  it('paiements AE (nom, ou mot « débours ») avec le mois du libellé', () => {
    expect(s('VIR SEPA MLE LARZABAL SHANE - Reason: DEBOURS JUILLET XANE', '2026-08-06')).toEqual({ type: 'paiement_ae', mois: '2026-07', tiers_id: 'xane' })
    expect(s('VIR SEPA EVE (ref: FACT DEBOURS EVE SEPTEMBRE)', '2026-09-10')).toEqual({ type: 'paiement_ae', mois: '2026-09', tiers_id: null })
    expect(s('FACTURE N137 DEBOURS MENAGE AL', '2026-04-20')).toMatchObject({ type: 'paiement_ae', mois: '2026-03' })
  })
  it('reversements individuels aux propriétaires', () => {
    expect(s('VIR SEPA GILLES MARIE RICHOU - Reason: loyers de juillet Ontzi', '2026-08-10')).toEqual({ type: 'reversement', mois: '2026-07', tiers_id: 'richou' })
    expect(s('VIR SEPA JULIEN REMOND ITS (ref: Loyer Aout ITS)', '2026-09-09')).toEqual({ type: 'reversement', mois: '2026-08', tiers_id: 'remond' })
    expect(s('VIR SEPA SOPHIE CAROSSIO (ref: TAXE de sejour Viky oubliee)', '2026-09-24')).toMatchObject({ type: 'reversement', tiers_id: 'carossio' })
  })
  it('frais bancaires, inter-agences', () => {
    expect(s('*FRAIS 1 VIR INST', '2026-09-02').type).toBe('frais_bancaires')
    expect(s('VIR INST LAUIAN IMMOBILIER - Reason: VIR INST EJM DE WINNE', '2026-07-30').type).toBe('inter_agence')
  })
})

describe('classerEntree', () => {
  it('remboursements de débours et paiements de facture des propriétaires', () => {
    expect(classerEntree({ libelle: 'VIR SEPA CHOMBART DE LAUWE PHIL - debours juillet 202' }).type).toBe('remboursement_debours')
    expect(classerEntree({ libelle: 'VIR SEPA CHOMBART DE LAUWE PHIL - facturation oihan' }).type).toBe('paiement_facture')
    expect(classerEntree({ libelle: 'VIR SEPA M DUPONT' }).type).toBe('non_affecte')
  })
})

describe('classerEntree — facture reconnue au code du bien', () => {
  it('débours DUL payé par un tiers', () => {
    const factures = [{ type_facture: 'debours', proprio_nom: 'CRESSEVEUR', bien_code: 'DUL', montants: [31875] }]
    expect(classerEntree({ libelle: 'VIR SEPA M OU MME CHAUCHET JEAN - Reason: Dul juin 2026', credit: 31875 }, factures).type).toBe('remboursement_debours')
  })
})

describe('classerEntree — retour d\'un virement DCB en trop', () => {
  it('« RETOUR COM AOUT » = retour DCB imputé sur août', () => {
    expect(classerEntree({ libelle: 'RETOUR COM AOUT', date_operation: '2026-09-26' })).toEqual({ type: 'retour_dcb', sous: 'com', mois: '2026-08' })
    expect(classerEntree({ libelle: 'VIR SEPA DESTINATION COTE BASQUE - Reason: RETOUR HON JUILLET', date_operation: '2026-09-26' })).toMatchObject({ type: 'retour_dcb', sous: 'hon', mois: '2026-07' })
  })
  it('un payout Booking.com n\'est pas un retour COM', () => {
    expect(classerEntree({ libelle: 'VIR SEPA Booking.com BV - Reason: NO.2cn75', date_operation: '2026-08-04' }).type).toBe('plateforme_non_rapprochee')
  })
})

describe('Entrée venant de l\'autre agence avec « STRIPE » dans le motif (26/09/2026)', () => {
  const ctx = { autreAgenceRe: /\b(destination cote basque|dcb)\b/ }
  it('reversement DCB → Lauïan des résas Stripe = inter_agence, pas plateforme', () => {
    expect(classerEntree({ libelle: 'VIR SEPA DESTINATION COTE BASQUE', detail: 'REVERSEMENT STRIPE RESAS LAUIAN 2026', credit: 915100, date_operation: '2026-09-26' }, [], ctx).type).toBe('inter_agence')
  })
  it('un vrai versement Stripe reste plateforme', () => {
    expect(classerEntree({ libelle: 'VIR SEPA STRIPE TECHNOLOGY EURO', detail: '', credit: 100, date_operation: '2026-09-26' }, [], ctx).type).toBe('plateforme_non_rapprochee')
  })
})

describe('Remboursement des frais Hospitable Direct par le courant (26/09/2026)', () => {
  it('« FRAIS HOSPITABLE JANVIER A AOUT 2026 » = frais remboursés, pas une plateforme', () => {
    expect(classerEntree({ libelle: 'FRAIS HOSPITABLE JANVIER A AOUT 2026', detail: '', credit: 105454, date_operation: '2026-09-26' }, [], {}).type).toBe('frais_stripe_rembourses')
  })
})

describe('Régularisation d\'écart du séquestre (26/09/2026)', () => {
  it('« REGULARISATION ECART SEQUESTRE 2026 » = regul_ecart (aucune poche)', () => {
    expect(classerEntree({ libelle: 'REGULARISATION ECART SEQUESTRE 2026', detail: '', credit: 79, date_operation: '2026-09-27' }, [], {}).type).toBe('regul_ecart')
  })
})
