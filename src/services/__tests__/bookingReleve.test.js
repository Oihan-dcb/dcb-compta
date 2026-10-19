import { describe, it, expect, vi } from 'vitest'

// importBooking importe le client supabase (variables d'env absentes en test) : on le neutralise,
// seuls les parseurs purs sont testés ici
vi.mock('../../lib/supabase', () => ({ supabase: {} }))

import { parseBookingCSV, lireFichierBooking } from '../importBooking'
import {
  regrouperParVersement, apparierVirement, expliquerEcartLigne, analyserReleveBooking,
  proposerRapprochementBookingSansReleve, suiviVirementsBooking, refPayoutDuLibelle, detailMouvementBooking,
} from '../bookingReleveCore'

// Format « détail d'un versement » FR, tel que téléchargé pour Lauïan (noms fictifs)
const CSV_FR = `Type,"Numéro de réservation",Arrivée,Checkout,"Nom du client","Prestataire de paiement","Statut de la réservation",Devise,"Taxe de séjour","Statut du paiement",Montant,Commission,"Frais de service de paiement",Net,"Date du paiement","Identifiant du paiement"
Réservation,6968892887,"17 sept. 2026","20 sept. 2026","Client Test","Booking.com B.V.",OK,EUR,-12.96,by_booking,674.23,-112.42,-9.26,539.59,"24 sept. 2026",Ps5G1EDz4PjF11nh`

// Format DCB mensuel : plusieurs résas dans un même versement
const CSV_DCB = `Type,Booking number,Check-in,Checkout,Guest name,Reservation status,Currency,Payment status,Tourism tax,Amount,Commission,Payments Service Fee,Net,Payout date,Payout ID
Reservation,1111111111,1 Sep 2026,5 Sep 2026,A,ok,EUR,by_booking,-10.00,1000.00,-170.00,-13.50,806.50,1 Oct 2026,ABCdef123
Reservation,2222222222,10 Sep 2026,12 Sep 2026,B,ok,EUR,by_booking,-5.00,500.00,-85.00,-6.75,403.25,1 Oct 2026,ABCdef123`

// Ancien format « Payout_from… » avec ligne résumé (Payout)
const CSV_ANCIEN = `Type/Type de transaction,Numéro de référence,Numéro de réservation,Date d'arrivée,Date de départ,Nom de l'établissement,Identifiant de l'établissement,Montant brut,Commission,Montant payable,Statut de la réservation,Date du versement
(Payout),PAY-1,-,-,-,-,-,-,-,-,-,02/06/2026
Réservation,-,3333333333,01/05/2026,04/05/2026,Chambre X,123,700.00,119.00,571.28,ok,02/06/2026`

const mouv = (id, date, credit, libelle = 'VIR SEPA Booking.com B.V.', extra = {}) => ({ id, date_operation: date, credit, libelle, detail: '', statut_matching: 'en_attente', mois_releve: date.slice(0, 7), ...extra })
const resa = (id, ref, fin_revenue, extra = {}) => ({ id, platform_id: ref, code: ref, fin_revenue, final_status: 'accepted', mois_comptable: '2026-09', rapprochee: false, bien: { agence: 'dcb', code: 'BIEN' + id, gestion_loyer: true }, ...extra })

describe('parseBookingCSV', () => {
  it('lit le format FR détail de versement (montants, taxe, frais, payout id, date FR)', () => {
    const rows = parseBookingCSV(CSV_FR)
    const l = rows['2026-09-24'][0]
    expect(l).toMatchObject({ booking_ref: '6968892887', payout_id: 'Ps5G1EDz4PjF11nh', amount_cents: 53959, gross_cents: 67423,
      commission_cents: 11242, tourism_tax_cents: 1296, service_fee_cents: 926, checkin: '2026-09-17', checkout: '2026-09-20', est_resume: false })
    // Montant − taxe − commission − frais = net
    expect(l.gross_cents - l.tourism_tax_cents - l.commission_cents - l.service_fee_cents).toBe(l.amount_cents)
  })
  it('marque la ligne (Payout) de l’ancien format comme résumé', () => {
    const rows = parseBookingCSV(CSV_ANCIEN)['2026-06-02']
    expect(rows.find(r => r.est_resume)).toBeTruthy()
    expect(rows.find(r => !r.est_resume)).toMatchObject({ booking_ref: '3333333333', amount_cents: 57128 })
  })
  it('accepte un en-tête précédé d’un titre et un BOM', () => {
    const rows = parseBookingCSV('﻿Relevé Booking\n\n' + CSV_DCB)
    expect(rows['2026-10-01']).toHaveLength(2)
  })
  it('lit un fichier XLSX', async () => {
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.aoa_to_sheet(CSV_DCB.split('\n').map(l => l.split(',')))
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Versement')
    const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    const txt = await lireFichierBooking({ name: 'releve.xlsx', buffer })
    expect(parseBookingCSV(txt)['2026-10-01'].map(r => r.amount_cents)).toEqual([80650, 40325])
  })
})

describe('regroupement et appariement', () => {
  it('groupe par payout id et fusionne réservation + ajustement d’une même résa', () => {
    const rows = parseBookingCSV(CSV_DCB)
    rows['2026-10-01'].push({ ...rows['2026-10-01'][0], amount_cents: -1000, gross_cents: -1000, commission_cents: 0, type_ligne: 'adjustment' })
    const g = regrouperParVersement(rows)
    expect(g).toHaveLength(1)
    expect(g[0].lignes).toHaveLength(2)
    expect(g[0].lignes[0]).toMatchObject({ amount_cents: 79650, fusionnee: true })
  })
  it('apparie par référence NO.<payout id> du libellé, sinon montant + date', () => {
    const g = regrouperParVersement(parseBookingCSV(CSV_DCB))[0]
    const ref = apparierVirement(g, [mouv('x', '2026-10-02', 1), mouv('m', '2026-10-05', 120975, 'VIR SEPA Booking.com B.V. NO.ABCdef123/ID.10415482')])
    expect(ref).toMatchObject({ par: 'reference', mouvement: { id: 'm' } })
    const mt = apparierVirement(g, [mouv('m2', '2026-10-02', 120975)])
    expect(mt).toMatchObject({ par: 'montant_date', mouvement: { id: 'm2' } })
    // autre référence dans le libellé = autre versement
    expect(apparierVirement(g, [mouv('m3', '2026-10-02', 120975, 'Booking.com NO.ZZZ999')]).mouvement).toBeNull()
    expect(refPayoutDuLibelle({ libelle: 'VIR SEPA Booking.com\n- Reason: NO.TcOwPFVcrLAmj/ID.10415482' })).toBe('TcOwPFVcrLAmj')
  })
})

describe('expliquerEcartLigne', () => {
  const l = { amount_cents: 76110, tourism_tax_cents: 2016, service_fee_cents: 1306 }
  it('identique, arrondi, taxe dans le revenu Hospitable, inconnu', () => {
    expect(expliquerEcartLigne(l, { fin_revenue: 76110 }).code).toBe('ok')
    expect(expliquerEcartLigne(l, { fin_revenue: 76054 }).code).toBe('arrondi')
    expect(expliquerEcartLigne(l, { fin_revenue: 78098, final_status: 'accepted' }).code).toBe('taxe_dans_revenu')
    expect(expliquerEcartLigne(l, { fin_revenue: 77416, final_status: 'accepted' }).code).toBe('frais_dans_revenu')
    expect(expliquerEcartLigne(l, null).code).toBe('resa_inconnue')
    expect(expliquerEcartLigne(l, { fin_revenue: 50000, final_status: 'cancelled' }).code).toBe('annulee')
    expect(expliquerEcartLigne(l, { fin_revenue: 50000, final_status: 'accepted' }).code).toBe('inexplique')
  })
})

describe('analyserReleveBooking', () => {
  const groupes = () => regrouperParVersement(parseBookingCSV(CSV_DCB))
  const base = { agence: 'dcb', mouvements: [mouv('m', '2026-10-02', 120975, 'Booking.com NO.ABCdef123')], reservations: [resa('r1', '1111111111', 80650), resa('r2', '2222222222', 40300)] }

  it('virement = Σ lignes → ok ; paiements à créer ; écart de centimes toléré par ligne', () => {
    const a = analyserReleveBooking(groupes(), base)
    const v = a.versements[0]
    expect(v.etat).toBe('ok')
    expect(v.ecart_virement).toBe(0)
    expect(v.lignes.map(l => l.action_paiement)).toEqual(['creer', 'creer'])
    expect(v.lignes[1].ecart.code).toBe('arrondi')
    expect(v.total_commission).toBe(25500)
    expect(v.validable).toBe(true)
    expect(detailMouvementBooking(v)).toContain('commission: 255.00€')
    // le détail bancaire d'origine (référence de virement) est conservé, un ancien résumé remplacé
    const banque = '2015698914-NO.ABCdef123/ID.10452973'
    const d1 = detailMouvementBooking({ ...v, mouvement: { ...v.mouvement, detail: banque } })
    expect(d1.endsWith(' || banque: ' + banque)).toBe(true)
    expect(detailMouvementBooking({ ...v, mouvement: { ...v.mouvement, detail: d1 } })).toBe(d1)
    expect(detailMouvementBooking({ ...v, mouvement: { ...v.mouvement, detail: 'Booking | 3 resa(s) | commission: 1€' } })).not.toContain('banque')
    expect(refPayoutDuLibelle({ libelle: 'VIR', detail: d1 })).toBe('ABCdef123')
  })
  it('déjà rapproché à la main au revenu Hospitable → corrige le montant au net Booking', () => {
    const a = analyserReleveBooking(groupes(), { ...base, paiements: [{ reservation_id: 'r2', mouvement_id: 'm', montant: 40300 }, { reservation_id: 'r1', mouvement_id: 'm', montant: 80650 }] })
    expect(a.versements[0].lignes.map(l => l.action_paiement)).toEqual(['aucune', 'corriger_montant'])
  })
  it('réimport : tout déjà importé → rien à valider (idempotent)', () => {
    const lignesExistantes = [
      { booking_ref: '1111111111', payout_date: '2026-10-01', amount_cents: 80650, commission_cents: 17000, service_fee_cents: 1350, tourism_tax_cents: 1000, mouvement_id: 'm' },
      { booking_ref: '2222222222', payout_date: '2026-10-01', amount_cents: 40325, commission_cents: 8500, service_fee_cents: 675, tourism_tax_cents: 500, mouvement_id: 'm' },
    ]
    const paiements = [{ reservation_id: 'r1', mouvement_id: 'm', montant: 80650 }, { reservation_id: 'r2', mouvement_id: 'm', montant: 40325 }]
    const v = analyserReleveBooking(groupes(), { ...base, lignesExistantes, paiements }).versements[0]
    expect(v.etat).toBe('deja_importe')
    expect(v.validable).toBe(false)
  })
  it('Σ lignes ≠ virement → écart listé, pas de statut rapproché', () => {
    const v = analyserReleveBooking(groupes(), { ...base, mouvements: [mouv('m', '2026-10-02', 130975, 'Booking.com NO.ABCdef123')] }).versements[0]
    expect(v.etat).toBe('ecart')
    expect(v.ecart_virement).toBe(10000)
    expect(v.problemes.join(' ')).toMatch(/≠ virement reçu/)
  })
  it('mois clôturé : rien d’écrit, tout listé « à régulariser »', () => {
    const v = analyserReleveBooking(groupes(), { ...base, moisClotures: new Set(['2026-10']) }).versements[0]
    expect(v.etat).toBe('cloture')
    expect(v.validable).toBe(false)
    expect(v.a_regulariser.length).toBeGreaterThan(0)
  })
  it('résa d’un mois clôturé (virement ouvert) : ligne stockée mais paiement à régulariser', () => {
    const v = analyserReleveBooking(groupes(), { ...base, moisClotures: new Set(['2026-09']) }).versements[0]
    expect(v.validable).toBe(true)
    expect(v.lignes.every(l => l.action_paiement === 'a_regulariser')).toBe(true)
  })
  it('résa d’une autre agence → versement bloqué (mauvais compte Booking)', () => {
    const v = analyserReleveBooking(groupes(), { ...base, reservations: [resa('r1', '1111111111', 80650, { bien: { agence: 'lauian', code: 'X' } }), resa('r2', '2222222222', 40325)] }).versements[0]
    expect(v.validable).toBe(false)
    expect(v.etat).toBe('ecart')
  })
  it('résa déjà payée par un autre virement → non modifiée, signalée', () => {
    const v = analyserReleveBooking(groupes(), { ...base, paiements: [{ reservation_id: 'r1', mouvement_id: 'autre', montant: 80650 }] }).versements[0]
    expect(v.lignes[0].action_paiement).toBe('deja_sur_autre_virement')
    expect(v.problemes.join(' ')).toMatch(/autre virement/)
  })
  it('virement pas encore reçu → lignes gardées en attente', () => {
    const v = analyserReleveBooking(groupes(), { ...base, mouvements: [] }).versements[0]
    expect(v.etat).toBe('sans_virement')
    expect(v.validable).toBe(true)
  })
})

describe('proposerRapprochementBookingSansReleve', () => {
  // Cas réel DCB 02/10/2026 (14 séjours de septembre, Σ = 11 375,01 €) + un séjour d'octobre non payé
  const sept = [328652, 53366, 46250, 50167, 34860, 40457, 155611, 123362, 36002, 107402, 45026, 59192, 31433, 25721]
  const cands = [...sept.map((v, i) => ({ id: 's' + i, platform_id: 'P' + i, departure_date: '2026-09-' + String(5 + i).padStart(2, '0'), fin_revenue: v })),
    { id: 'oct', platform_id: 'PO', departure_date: '2026-10-01', fin_revenue: 38940 }]
  it('cohorte du mois : tous les séjours partis avant le 1er du mois du virement', () => {
    const p = proposerRapprochementBookingSansReleve({ date_operation: '2026-10-02', credit: 1137501 }, cands)
    expect(p.regle).toBe('cohorte')
    expect(p.resas).toHaveLength(14)
    expect(p.ecart).toBe(0)
  })
  it('écart d’arrondi toléré (0,30 €/résa), au-delà → relevé nécessaire', () => {
    expect(proposerRapprochementBookingSansReleve({ date_operation: '2026-10-02', credit: 1137501 + 300 }, cands)?.regle).toBe('cohorte')
    expect(proposerRapprochementBookingSansReleve({ date_operation: '2026-10-02', credit: 1137501 + 5000 }, cands)).toBeNull()
  })
  it('Lauïan : séjour unique à ±2 €', () => {
    const c = [{ id: 'a', platform_id: 'A', departure_date: '2026-09-20', fin_revenue: 53959 }, { id: 'b', platform_id: 'B', departure_date: '2026-09-03', fin_revenue: 97063 }]
    const p = proposerRapprochementBookingSansReleve({ date_operation: '2026-09-25', credit: 53959 }, c)
    expect(p).toMatchObject({ regle: 'sejour_unique', ecart: 0 })
    expect(p.resas[0].id).toBe('a')
  })
  it('deux séjours au même montant → pas de choix au hasard', () => {
    const c = [{ id: 'a', departure_date: '2026-09-20', fin_revenue: 50000 }, { id: 'b', departure_date: '2026-09-21', fin_revenue: 50000 }]
    expect(proposerRapprochementBookingSansReleve({ date_operation: '2026-09-25', credit: 50000 }, c)).toBeNull()
  })
})

describe('suiviVirementsBooking', () => {
  it('détaillé / sans détail / non rapproché', () => {
    const ms = [mouv('a', '2026-10-02', 1000, 'Booking.com NO.AAA/ID.10415482'), mouv('b', '2026-09-02', 500), mouv('c', '2026-08-04', 700)]
    const s = suiviVirementsBooking(ms, [{ mouvement_id: 'a', montant: 1000 }, { mouvement_id: 'b', montant: 500 }], [{ mouvement_id: 'a', amount_cents: 1000 }])
    expect(s.map(x => x.etat)).toEqual(['detaille', 'sans_detail', 'non_rapproche'])
    expect(s[0]).toMatchObject({ ref_payout: 'AAA', id_extranet: '10415482' })
  })
})
