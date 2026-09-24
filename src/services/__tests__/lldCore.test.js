import { describe, it, expect } from 'vitest'
import { classerMouvement, extraireMois, identifierEtudiant, choisirLoyer, loyerSolde, motsNom } from '../lldCore.js'

// Cas réels du relevé LLD DCB (septembre 2026)
const etudiants = [
  { id: 'maelia', nom: 'HAVARD KHAZIZIAN', prenom: 'Maëlia', loyer_nu: 81500, date_entree: '2026-09-01', date_sortie_prevue: '2027-06-15' },
  { id: 'noa', nom: 'RUIZ MATSUMOTO', prenom: 'Noa', loyer_nu: 64000, date_entree: '2026-09-01', date_sortie_prevue: '2027-06-15' },
  { id: 'thomas', nom: 'LE ROCHAIS', prenom: 'Thomas', loyer_nu: 81800, date_entree: '2026-09-10', date_sortie_prevue: '2027-06-10' },
  { id: 'louis', nom: 'CANIVET', prenom: 'Louis', loyer_nu: 80000, date_entree: '2026-09-13', date_sortie_prevue: '2027-06-13' },
  { id: 'antoine', nom: 'Antoine', prenom: 'MONBAILLY', loyer_nu: 85000, date_entree: '2026-09-01', date_sortie_prevue: '2027-06-30' },
  { id: 'ancien', nom: 'KHAZIZIAN', prenom: 'Paul', loyer_nu: 70000, date_entree: '2024-09-01', date_sortie_prevue: '2025-06-30' },
]
const mvt = (libelle, credit, date_operation = '2026-09-03') => ({ libelle, detail: '', credit, date_operation })

describe('classerMouvement', () => {
  it('reconnaît loyer, caution, frais', () => {
    expect(classerMouvement('VIR SEPA MME CHIKAKO MATSUMOTO - Reason: Loyer septembre')).toBe('loyer')
    expect(classerMouvement('VIR SEPA MME CHIKAKO MATSUMOTO - Reason: Caution')).toBe('caution')
    expect(classerMouvement('VIR INST MME SIMONE KHAZIZIAN - Reason: CAUTION APPART')).toBe('caution')
    expect(classerMouvement('VIR INST MME SIMONE KHAZIZIAN - Reason: FRAIS')).toBe('frais')
    expect(classerMouvement('VIR SEPA STRIPE STUDAPART T LE ROCHAIS')).toBe('loyer')
    expect(classerMouvement('VIR INST M DUPONT')).toBe('inconnu')
  })
})

describe('extraireMois', () => {
  it('lit le mois écrit dans le libellé', () => {
    expect(extraireMois('Reason: LOYER SEPT 26', '2026-09-02')).toBe('2026-09')
    expect(extraireMois('Loyer septembre', '2026-09-03')).toBe('2026-09')
    expect(extraireMois('Loyer juillet', '2026-07-06')).toBe('2026-07')
    expect(extraireMois('loyer 10/2026', '2026-09-28')).toBe('2026-10')
  })
  it('déduit l\'année au plus près du virement', () => {
    expect(extraireMois('Loyer decembre', '2027-01-04')).toBe('2026-12')   // payé en retard
    expect(extraireMois('Loyer janvier', '2026-12-29')).toBe('2027-01')    // payé d'avance
  })
  it('null sans mois dans le libellé', () => {
    expect(extraireMois('VIR INST MME SIMONE KHAZIZIAN', '2026-09-02')).toBe(null)
  })
})

describe('identifierEtudiant', () => {
  it('parent qui porte le nom de famille + montant = loyer → certain', () => {
    const r = identifierEtudiant(mvt('VIR INST MME SIMONE KHAZIZIAN - Reason: LOYER SEPT 26', 81500, '2026-09-02'), etudiants)
    expect(r.etudiant.id).toBe('maelia')     // pas l'ancien locataire KHAZIZIAN (parti en 2025)
    expect(r.confiance).toBe('certain')
    expect(r.type).toBe('loyer')
  })
  it('caution payée par un parent → certain, type caution', () => {
    const r = identifierEtudiant(mvt('VIR SEPA MME CHIKAKO MATSUMOTO - Reason: Caution', 96000), etudiants)
    expect(r.etudiant.id).toBe('noa')
    expect(r.type).toBe('caution')
    expect(r.confiance).toBe('certain')
  })
  it('plateforme Studapart (montant net) → certain', () => {
    const r = identifierEtudiant(mvt('VIR SEPA STRIPE (ref: STUDAPART-CJMM) - Reason: STUDAPART T LE ROCHAIS', 58984, '2026-09-14'), etudiants)
    expect(r.etudiant.id).toBe('thomas')
    expect(r.plateforme).toBe('studapart')
    expect(r.confiance).toBe('certain')
  })
  it('payeur mémorisé', () => {
    const r = identifierEtudiant(mvt('VIR INST EI - MR ROGER LOUIS Canive', 198000, '2026-09-08'), etudiants, [{ etudiant_id: 'louis', motif: 'roger louis' }])
    expect(r.etudiant.id).toBe('louis')
    expect(r.confiance).toBe('certain')
  })
  it('libellé tronqué sans payeur mémorisé → seulement une suggestion (probable), jamais appliquée seule', () => {
    const r = identifierEtudiant(mvt('VIR INST EI - MR ROGER LOUIS Canive', 198000, '2026-09-08'), etudiants)
    expect(r.etudiant.id).toBe('louis')
    expect(r.confiance).toBe('probable')
  })
  it('nom/prénom inversés sur la fiche → probable seulement', () => {
    const r = identifierEtudiant(mvt('VIR SEPA M ERIC MONBAILLY loyer', 85000), etudiants)
    expect(r.etudiant.id).toBe('antoine')
    expect(r.confiance).toBe('probable')
  })
  it('montant exact d\'un seul locataire, libellé muet → probable', () => {
    const r = identifierEtudiant(mvt('VIR SEPA 0012345', 64000), etudiants)
    expect(r.etudiant.id).toBe('noa')
    expect(r.confiance).toBe('probable')
  })
  it('particules ignorées dans les noms composés', () => {
    expect(motsNom('LE ROCHAIS')).toEqual(['rochais'])
  })
})

describe('choisirLoyer / loyerSolde', () => {
  const ouverts = [
    { id: 'l8', mois: '2026-08', montant_attendu: 81500 },
    { id: 'l9', mois: '2026-09', montant_attendu: 81500 },
    { id: 'l10', mois: '2026-10', montant_attendu: 81500 },
  ]
  it('mois du libellé prioritaire', () => {
    expect(choisirLoyer(mvt('LOYER SEPT 26', 81500, '2026-09-02'), ouverts).id).toBe('l9')
  })
  it('sinon le plus ancien loyer ouvert', () => {
    expect(choisirLoyer(mvt('VIR INST KHAZIZIAN', 81500, '2026-09-02'), ouverts).id).toBe('l8')
  })
  it('une vieille dette n\'absorbe pas un paiement récent', () => {
    expect(choisirLoyer(mvt('VIR KHAZIZIAN', 81500, '2026-09-02'), [{ id: 'avr', mois: '2026-04', montant_attendu: 1 }, ...ouverts]).id).toBe('l8')
    expect(choisirLoyer(mvt('VIR KHAZIZIAN', 81500, '2026-09-02'), [{ id: 'avr', mois: '2026-04', montant_attendu: 1 }])).toBe(null)
  })
  it('jamais au-delà du mois suivant le paiement', () => {
    expect(choisirLoyer(mvt('VIR', 81500, '2026-08-02'), [{ id: 'l10', mois: '2026-10', montant_attendu: 1 }])).toBe(null)
  })
  it('soldé à 1 € près, plateforme toujours soldée', () => {
    expect(loyerSolde({ montant_attendu: 81500 }, 81450, null)).toBe(true)
    expect(loyerSolde({ montant_attendu: 81500 }, 40000, null)).toBe(false)
    expect(loyerSolde({ montant_attendu: 81800 }, 58984, 'studapart')).toBe(true)
  })
})

import { extrairePayeur } from '../lldCore.js'
describe('extrairePayeur', () => {
  it('nom du donneur d\'ordre, civilités et préfixes retirés', () => {
    expect(extrairePayeur('VIR INST MME SIMONE KHAZIZIAN\n(ref: 0320262454)\n- Reason: LOYER SEPT 26')).toBe('simone khazizian')
    expect(extrairePayeur('VIR SEPA MME CHIKAKO MATSUMOTO\n(ref: ZZ1L44)')).toBe('chikako matsumoto')
    expect(extrairePayeur('VIR INST EI - MR ROGER LOUIS\n(ref: Virement de Ei - Mr Roger Louis Can)')).toBe('roger louis')
  })
  it('plateforme : texte qui suit la plateforme', () => {
    expect(extrairePayeur('VIR SEPA STRIPE\n(ref: STUDAPART-CJMMJYB3JNBTC9N2SO59A6KOO)\n- Reason: STUDAPART T LE ROCHAIS')).toBe('t le rochais')
  })
})
