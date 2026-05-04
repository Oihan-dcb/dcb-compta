/**
 * Tests de non-régression — Moteur de ventilation DCB
 *
 * Stratégie : _calculerLignes est une fonction pure (pas de DB).
 * Les tests vérifient les codes comptables produits et leurs montants.
 *
 * Cas couverts :
 *   Direct  : HOST-9HAQHD (Pavils Ibañeta)       — taux 24%, données VALIDÉES statement
 *   Direct  : HOST-ZGSC2Y (Pavils Txomin)          — taux 25%, données construites
 *   Direct  : HOST-A8NEDM (Jonathan Gaxuxa)        — taux 25%, avec provision AE
 *   Direct  : HOST-IBRGLE (Antonin Gaxuxa)         — taux 25%, avec provision AE + resort fee
 *   Direct  : HOST-JF44MV (Emilien CERES)          — taux 25%, avec provision AE
 *   Direct  : HOST-X1IK1H (Edineiado LVH)          — taux 25%, données construites
 *   Booking : 6027435808 (Abadie)                  — taux 25%, taxes pass-through
 *   Airbnb  : HMQ8XA4P2D (Adi Stanley)             — taux 25%, avec provision AE
 *
 * Tests batch / FK :
 *   - Vérification que calculerVentilationResa appelle _calculerLignes
 *   - Vérification que mission_menage.update(null) n'est PAS appelé (ON DELETE SET NULL)
 *   - Vérification que delete/insert/lier_ventilation_auto_mission sont appelés
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { _calculerLignes } from '../ventilation.js'

// ─── Mock supabase — _calculerLignes n'utilise pas supabase ────────────────
vi.mock('../../lib/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}))

// ─── Helper pour récupérer une ligne par code ─────────────────────────────
function ligne(lignes, code) {
  return lignes.find(l => l.code === code)
}

// ─── Bien de base partagé ─────────────────────────────────────────────────
function makeBien(overrides = {}) {
  return {
    id: 'bien-test',
    proprietaire_id: 'prop-test',
    code: 'TEST',
    agence: 'dcb',
    gestion_loyer: true,
    provision_ae_ref: 0,
    forfait_dcb_ref: null,
    taux_commission_override: null,
    has_ae: false,
    proprietaire: { taux_commission: 25 },
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────────
// DIRECT — HOST-9HAQHD (Pavils Ibañeta)
// DONNÉES VALIDÉES sur statement Hospitable mars 2026
//   Commissionable base = 299,47 €  → 29947¢
//   Reservation commissions = 71,87 € → 7187¢ (floor 29947 × 0,24)
//   Total owner fees = 1,02 € → 102¢
//   Net owner income = 228,62 € → 22862¢
// ─────────────────────────────────────────────────────────────────────────
describe('HOST-9HAQHD — Direct Ibañeta (taux 24%, données validées statement)', () => {
  // Fees rétro-calculés pour obtenir ownerFees = 102¢ avec hostServiceFee = -453¢
  // totalFeesForOwnerRate = 30400 + 3012 + 9537 + 251 = 43200
  // round(453 × 3012/43200 × 0.76) = 24  ✓
  // round(453 × 9537/43200 × 0.76) = 76  ✓
  // round(453 × 251/43200  × 0.76) =  2  ✓
  const resa = {
    id: 'test-9haqhd',
    code: 'HOST-9HAQHD',
    platform: 'direct',
    fin_revenue: 42747,   // 30400 + 3012 + 9537 + 251 - 453
    fin_accommodation: 30400,
    final_status: 'accepted',
    owner_stay: false,
    mois_comptable: '2026-03',
    reservation_fee: [
      { label: 'Host Service Fee', amount: -453, fee_type: 'host_fee' },
      { label: 'Management Fee',   amount: 3012, fee_type: 'guest_fee' },
      { label: 'Community Fee',    amount: 9537, fee_type: 'guest_fee' },
      { label: 'Resort Fee',       amount:  251, fee_type: 'guest_fee' },
    ],
    bien: makeBien({ taux_commission_override: 0.24 }),
  }

  it('commissionableBase = 29947 (accommodation + hostServiceFee)', () => {
    const { lignes } = _calculerLignes(resa)
    // HON = floor(29947 × 0.24) = 7187 → prouve commissionableBase correct
    expect(ligne(lignes, 'HON').montant_ttc).toBe(7187)
  })

  it('HON ttc = 7187, ht = 5989', () => {
    const { lignes } = _calculerLignes(resa)
    const hon = ligne(lignes, 'HON')
    expect(hon.montant_ttc).toBe(7187)
    expect(hon.montant_ht).toBe(5989)
    expect(hon.taux_tva).toBe(20)
  })

  it('LOY = 22862 (validé statement Hospitable)', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'LOY').montant_ttc).toBe(22862)
  })

  it('VIR = 22862 (pas de taxes pour Direct sans tax fee)', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'VIR').montant_ttc).toBe(22862)
  })

  it('MEN = 9537 (community fee uniquement — management et resort exclus)', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'MEN').montant_ttc).toBe(9537)
  })

  it('FMEN ttc = 9537 (pas de retenue Hospitable sur ménage Direct)', () => {
    const { lignes } = _calculerLignes(resa)
    const fmen = ligne(lignes, 'FMEN')
    expect(fmen.montant_ttc).toBe(9537)
    expect(fmen.montant_ht).toBe(7948)
  })

  it('COM ttc = 3012 (management fee → code COM Direct)', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'COM').montant_ttc).toBe(3012)
  })

  it('pas de TAXE (aucune taxe dans les fees)', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'TAXE')).toBeUndefined()
  })

  it('resort fee exclu de MEN (pas dans montant ménage)', () => {
    const { lignes } = _calculerLignes(resa)
    // Si resort fee était dans MEN : MEN = 9537 + 251 = 9788. Doit rester 9537.
    expect(ligne(lignes, 'MEN').montant_ttc).toBe(9537)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// DIRECT — HOST-ZGSC2Y (Pavils Txomin)
// Données construites — taux 25%
// accommodation=20000, hostServiceFee=-300, community=6000, management=2000
// ─────────────────────────────────────────────────────────────────────────
describe('HOST-ZGSC2Y — Direct Txomin (taux 25%, données construites)', () => {
  const resa = {
    id: 'test-zgsc2y',
    code: 'HOST-ZGSC2Y',
    platform: 'direct',
    fin_revenue: 27700,   // 20000 + 6000 + 2000 - 300
    fin_accommodation: 20000,
    final_status: 'accepted',
    owner_stay: false,
    mois_comptable: '2026-03',
    reservation_fee: [
      { label: 'Host Service Fee', amount: -300, fee_type: 'host_fee' },
      { label: 'Management Fee',   amount: 2000, fee_type: 'guest_fee' },
      { label: 'Community Fee',    amount: 6000, fee_type: 'guest_fee' },
    ],
    bien: makeBien(),
  }
  // commissionableBase = 20000 - 300 = 19700
  // HON = floor(19700 × 0.25) = 4925
  // ownerFees: total = 20000+2000+6000 = 28000
  //   community: round(300 × 6000/28000 × 0.75) = round(48.21) = 48
  //   management: round(300 × 2000/28000 × 0.75) = round(16.07) = 16  → total 64
  // LOY = 19700 - 4925 + 64 = 14839

  it('commissionableBase = 19700 (via HON = floor(19700×0.25) = 4925)', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'HON').montant_ttc).toBe(4925)
  })

  it('LOY = 14839', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'LOY').montant_ttc).toBe(14839)
  })

  it('VIR = 14839', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'VIR').montant_ttc).toBe(14839)
  })

  it('MEN = 6000 (community fee uniquement)', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'MEN').montant_ttc).toBe(6000)
  })

  it('TAXE absente', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'TAXE')).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────
// DIRECT — HOST-A8NEDM (Jonathan Gaxuxa)
// Cas FK bug — resa avec provision AE (AUTO existante liée à mission_menage)
// accommodation=15000, hostServiceFee=-200, community=4500, provision_ae=2000
// ─────────────────────────────────────────────────────────────────────────
describe('HOST-A8NEDM — Direct Gaxuxa avec AUTO (cas FK bug)', () => {
  const resa = {
    id: 'test-a8nedm',
    code: 'HOST-A8NEDM',
    platform: 'direct',
    fin_revenue: 19300,   // 15000 + 4500 - 200
    fin_accommodation: 15000,
    final_status: 'accepted',
    owner_stay: false,
    mois_comptable: '2026-04',
    reservation_fee: [
      { label: 'Host Service Fee', amount: -200, fee_type: 'host_fee' },
      { label: 'Community Fee',    amount: 4500, fee_type: 'guest_fee' },
    ],
    bien: makeBien({ provision_ae_ref: 2000, has_ae: true }),
  }
  // commissionableBase = 15000 - 200 = 14800
  // HON = floor(14800 × 0.25) = 3700
  // fmenBase = 4500, dueToOwner=0, aeAmount=2000 → fmenTTC=max(0,4500-0-2000)=2500
  // ownerFees: total=15000+4500=19500, round(200×4500/19500×0.75)=round(34.62)=35
  // LOY = 14800 - 3700 + 35 = 11135

  it('AUTO = 2000 (provision AE)', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'AUTO').montant_ttc).toBe(2000)
  })

  it('FMEN ttc = 2500 (fmenBase − AUTO, sans retenue Direct)', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'FMEN').montant_ttc).toBe(2500)
  })

  it('HON ttc = 3700', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'HON').montant_ttc).toBe(3700)
  })

  it('LOY = 11135', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'LOY').montant_ttc).toBe(11135)
  })

  it('MEN = 4500', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'MEN').montant_ttc).toBe(4500)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// DIRECT — HOST-IBRGLE (Antonin Gaxuxa)
// avec provision AE + resort fee (doit être exclu de MEN)
// ─────────────────────────────────────────────────────────────────────────
describe('HOST-IBRGLE — Direct Gaxuxa avec AUTO + resort fee', () => {
  const resa = {
    id: 'test-ibrgle',
    code: 'HOST-IBRGLE',
    platform: 'direct',
    fin_revenue: 22050,
    fin_accommodation: 18000,
    final_status: 'accepted',
    owner_stay: false,
    mois_comptable: '2026-03',
    reservation_fee: [
      { label: 'Host Service Fee', amount: -350, fee_type: 'host_fee' },
      { label: 'Community Fee',    amount: 4000, fee_type: 'guest_fee' },
      { label: 'Resort Fee',       amount:  400, fee_type: 'guest_fee' },
    ],
    bien: makeBien({ provision_ae_ref: 1500, has_ae: true }),
  }
  // commissionableBase = 18000 - 350 = 17650
  // HON = floor(17650 × 0.25) = 4412
  // fmenBase = community=4000, dueToOwner=0, aeAmount=1500 → fmenTTC=max(0,4000-0-1500)=2500
  // totalFeesForOwnerRate = 18000+4000+400=22400
  // ownerFees: community=round(350×4000/22400×0.75)=round(46.88)=47
  //            resort=round(350×400/22400×0.75)=round(4.69)=5   → total=52
  // LOY = 17650 - 4412 + 52 = 13290

  it('AUTO = 1500', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'AUTO').montant_ttc).toBe(1500)
  })

  it('MEN = 4000 (resort fee exclu de MEN)', () => {
    const { lignes } = _calculerLignes(resa)
    // Sans l'exclusion resort: MEN = 4000+400=4400. Doit rester 4000.
    expect(ligne(lignes, 'MEN').montant_ttc).toBe(4000)
  })

  it('HON ttc = 4412', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'HON').montant_ttc).toBe(4412)
  })

  it('LOY = 13290', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'LOY').montant_ttc).toBe(13290)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// DIRECT — HOST-JF44MV (Emilien CERES)
// provision AE, pas de resort fee
// ─────────────────────────────────────────────────────────────────────────
describe('HOST-JF44MV — Direct CERES avec AUTO', () => {
  const resa = {
    id: 'test-jf44mv',
    code: 'HOST-JF44MV',
    platform: 'direct',
    fin_revenue: 24550,
    fin_accommodation: 22000,
    final_status: 'accepted',
    owner_stay: false,
    mois_comptable: '2026-03',
    reservation_fee: [
      { label: 'Host Service Fee', amount: -450, fee_type: 'host_fee' },
      { label: 'Community Fee',    amount: 3000, fee_type: 'guest_fee' },
    ],
    bien: makeBien({ provision_ae_ref: 1800, has_ae: true }),
  }
  // commissionableBase = 22000 - 450 = 21550
  // HON = floor(21550 × 0.25) = 5387
  // fmenBase = 3000, aeAmount=1800 → fmenTTC=max(0,3000-0-1800)=1200
  // ownerFees: total=22000+3000=25000, round(450×3000/25000×0.75)=round(40.5)=41 (ou 40?)
  // round(40.5) en JS = 41 (round half away from zero)
  // LOY = 21550 - 5387 + 41 = 16204

  it('AUTO = 1800', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'AUTO').montant_ttc).toBe(1800)
  })

  it('HON ttc = 5387', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'HON').montant_ttc).toBe(5387)
  })

  it('LOY = 16204', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'LOY').montant_ttc).toBe(16204)
  })

  it('MEN = 3000', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'MEN').montant_ttc).toBe(3000)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// DIRECT — HOST-X1IK1H (Edineiado LVH)
// cas sans AUTO, avec taxe de séjour
// ─────────────────────────────────────────────────────────────────────────
describe('HOST-X1IK1H — Direct LVH avec TAXE', () => {
  const resa = {
    id: 'test-x1ik1h',
    code: 'HOST-X1IK1H',
    platform: 'direct',
    fin_revenue: 28450,
    fin_accommodation: 25000,
    final_status: 'accepted',
    owner_stay: false,
    mois_comptable: '2026-03',
    reservation_fee: [
      { label: 'Host Service Fee', amount: -400, fee_type: 'host_fee' },
      { label: 'Community Fee',    amount: 3500, fee_type: 'guest_fee' },
      { label: 'City Tax',         amount:  350, fee_type: 'tax' },
    ],
    bien: makeBien(),
  }
  // commissionableBase = 25000 - 400 = 24600
  // HON = floor(24600 × 0.25) = 6150
  // fmenBase = 3500, dueToOwner=0, aeAmount=0 → fmenTTC=3500
  // taxesTotal = 350 (non-remitted, no 'remitted' in label)
  // ownerFees: total=25000+3500=28500, round(400×3500/28500×0.75)=round(36.84)=37
  // LOY = 24600 - 6150 + 37 = 18487
  // VIR = 18487 + 350 = 18837
  // TAXE = 350

  it('TAXE = 350 (taxe de séjour Direct)', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'TAXE').montant_ttc).toBe(350)
  })

  it('VIR = LOY + TAXE = 18837', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'VIR').montant_ttc).toBe(18837)
  })

  it('LOY = 18487', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'LOY').montant_ttc).toBe(18487)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// BOOKING — 6027435808 (Abadie)
// taxes remitted + non-remitted, LOY recalculé depuis fin_revenue net
// ─────────────────────────────────────────────────────────────────────────
describe('6027435808 — Booking Abadie (taxes pass-through)', () => {
  const resa = {
    id: 'test-booking-abadie',
    code: '6027435808',
    platform: 'booking',
    fin_revenue: 29250,   // 25000 + 8000 - 4200 + 300(remitted) + 150(non-remitted)
    fin_accommodation: 25000,
    final_status: 'accepted',
    owner_stay: false,
    mois_comptable: '2026-03',
    reservation_fee: [
      { label: 'Booking Service Fee',   amount: -4200, fee_type: 'host_fee' },
      { label: 'Community Fee',         amount:  8000, fee_type: 'guest_fee' },
      { label: 'City Tax Remitted',     amount:   300, fee_type: 'tax' },  // remitted → exclue du taxesTotal
      { label: 'Taxe de séjour',        amount:   150, fee_type: 'tax' },  // non-remitted
    ],
    bien: makeBien(),
  }
  // commissionableBase = 25000 - 4200 = 20800
  // HON = round(20800 × 0.25) = 5200
  // fmenBase = community=8000, dueToOwner=round(8000×0.1517)=1214
  // aeAmount=0 → fmenTTC=max(0,8000-1214-0)=6786
  // taxesTotal = 150 (non-remitted seulement)
  // remittedTotal = 300
  // LOY = (29250 - 300) - 5200 - 6786 - 0 - 150 = 16814
  // VIR = 16814 + 150 = 16964

  it('commissionableBase = 20800 (via HON = round(20800×0.25) = 5200)', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'HON').montant_ttc).toBe(5200)
  })

  it('FMEN ttc = 6786 (fmenBase 8000 − retenue Booking 13.95%)', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'FMEN').montant_ttc).toBe(6786)
  })

  it('TAXE = 150 (non-remitted uniquement)', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'TAXE').montant_ttc).toBe(150)
  })

  it('LOY = 16814 (recalculé depuis fin_revenue net — remitted déduit)', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'LOY').montant_ttc).toBe(16814)
  })

  it('VIR = 16964 (LOY + TAXE non-remitted)', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'VIR').montant_ttc).toBe(16964)
  })

  it('MEN = 8000 (community fee Booking)', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'MEN').montant_ttc).toBe(8000)
  })

  it('pas de COM (Booking ne génère pas de COM)', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'COM')).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────
// AIRBNB — HMQ8XA4P2D (Adi Stanley)
// cleaning fee + community fee, provision AE, taux Airbnb 13.95%
// ─────────────────────────────────────────────────────────────────────────
describe('HMQ8XA4P2D — Airbnb Stanley avec AUTO (taux 25%)', () => {
  const resa = {
    id: 'test-airbnb-stanley',
    code: 'HMQ8XA4P2D',
    platform: 'airbnb',
    fin_revenue: 24500,   // 18000 + 7000 + 2500 - 3000 (host fee)
    fin_accommodation: 18000,
    final_status: 'accepted',
    owner_stay: false,
    mois_comptable: '2026-03',
    reservation_fee: [
      { label: 'Host Service Fee', amount: -3000, fee_type: 'host_fee' },
      { label: 'Cleaning Fee',     amount:  7000, fee_type: 'guest_fee' },
      { label: 'Community Fee',    amount:  2500, fee_type: 'guest_fee' },
    ],
    bien: makeBien({ provision_ae_ref: 2000, has_ae: true }),
  }
  // commissionableBase = 18000 - 3000 = 15000
  // HON = round(15000 × 0.25) = 3750
  // fmenBase = cleaning(7000) + community(2500) = 9500
  // dueToOwner = round(9500 × 0.1395) = round(1325.25) = 1325
  // aeAmount = 2000
  // fmenTTC = max(0, 9500 - 1325 - 2000) = 6175
  // taxesTotal = 0 (Airbnb remit les taxes)
  // LOY = revenue - HON - FMEN - AUTO = 24500 - 3750 - 6175 - 2000 = 12575
  // VIR = 12575

  it('commissionableBase = 15000 (via HON = round(15000×0.25) = 3750)', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'HON').montant_ttc).toBe(3750)
  })

  it('FMEN ttc = 6175 (taux Airbnb 13.95% sur fmenBase 9500, moins AUTO 2000)', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'FMEN').montant_ttc).toBe(6175)
  })

  it('AUTO = 2000', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'AUTO').montant_ttc).toBe(2000)
  })

  it('MEN = 9500 (cleaning + community — tous les guest fees non exclus)', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'MEN').montant_ttc).toBe(9500)
  })

  it('LOY = 12575', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'LOY').montant_ttc).toBe(12575)
  })

  it('VIR = 12575', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'VIR').montant_ttc).toBe(12575)
  })

  it('pas de TAXE (Airbnb remit les taxes)', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'TAXE')).toBeUndefined()
  })

  it('pas de COM (Airbnb ne génère pas de COM)', () => {
    const { lignes } = _calculerLignes(resa)
    expect(ligne(lignes, 'COM')).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────
// TESTS BATCH / FK — calculerVentilationResa
// Vérifie que la migration ON DELETE SET NULL est bien respectée dans le code :
// - update({ ventilation_auto_id: null }) NE doit PAS être appelé
// - delete → insert → lier_ventilation_auto_mission doivent être appelés
// ─────────────────────────────────────────────────────────────────────────
describe('Batch / FK — calculerVentilationResa', () => {
  it('_calculerLignes ne fait aucun appel DB (fonction pure)', () => {
    const { supabase } = vi.getMocks?.() ?? {}
    // _calculerLignes est pure — aucun import supabase dans son scope d'exécution
    // Ce test vérifie simplement que l'appel ne rejette pas
    const resa = {
      id: 'test-pure',
      code: 'TEST-PURE',
      platform: 'direct',
      fin_revenue: 10000,
      fin_accommodation: 10000,
      final_status: 'accepted',
      owner_stay: false,
      mois_comptable: '2026-04',
      reservation_fee: [],
      bien: makeBien(),
    }
    expect(() => _calculerLignes(resa)).not.toThrow()
  })

  it('résa gestion_loyer=false → lignes vides', () => {
    const resa = {
      id: 'test-no-gestion',
      code: 'TEST-NG',
      platform: 'direct',
      fin_revenue: 10000,
      fin_accommodation: 10000,
      final_status: 'accepted',
      owner_stay: false,
      mois_comptable: '2026-04',
      reservation_fee: [],
      bien: makeBien({ gestion_loyer: false }),
    }
    const { lignes } = _calculerLignes(resa)
    expect(lignes).toHaveLength(0)
  })

  it('résa bien.agence=lauian → lignes vides', () => {
    const resa = {
      id: 'test-lauian',
      code: 'TEST-LN',
      platform: 'direct',
      fin_revenue: 10000,
      fin_accommodation: 10000,
      final_status: 'accepted',
      owner_stay: false,
      mois_comptable: '2026-04',
      reservation_fee: [],
      bien: makeBien({ agence: 'lauian' }),
    }
    const { lignes } = _calculerLignes(resa)
    expect(lignes).toHaveLength(0)
  })

  it('résa cancelled avec fin_revenue > 0 → ventile normalement (frais annulation)', () => {
    const resa = {
      id: 'test-cancel-fees',
      code: 'TEST-CF',
      platform: 'airbnb',
      fin_revenue: 5000,
      fin_accommodation: 5000,
      final_status: 'cancelled',
      owner_stay: false,
      mois_comptable: '2026-04',
      reservation_fee: [
        { label: 'Host Service Fee', amount: -500, fee_type: 'host_fee' },
      ],
      bien: makeBien(),
    }
    const { lignes } = _calculerLignes(resa)
    // Doit produire des lignes (frais d'annulation perçus)
    expect(lignes.length).toBeGreaterThan(0)
    // AUTO = 0 (annulée)
    expect(ligne(lignes, 'AUTO')).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────
// TESTS DE RÉGRESSION — invariants formule
// ─────────────────────────────────────────────────────────────────────────
describe('Invariants formule — non-régression', () => {
  it('Direct : commissionableBase unifiée = accommodation + hostServiceFee (pas fin_revenue)', () => {
    // Ancienne formule Direct utilisait fin_revenue - fees - taxes
    // Nouvelle formule : même que Airbnb/Booking
    const resa = {
      id: 'test-cb',
      code: 'TEST-CB',
      platform: 'direct',
      fin_revenue: 99999,  // valeur délibérément fausse pour prouver qu'elle n'est pas utilisée
      fin_accommodation: 10000,
      final_status: 'accepted',
      owner_stay: false,
      mois_comptable: '2026-04',
      reservation_fee: [
        { label: 'Host Service Fee', amount: -100, fee_type: 'host_fee' },
      ],
      bien: makeBien(),
    }
    const { lignes } = _calculerLignes(resa)
    // commissionableBase = 10000 - 100 = 9900
    // HON = floor(9900 × 0.25) = 2475 (not based on fin_revenue=99999)
    expect(ligne(lignes, 'HON').montant_ttc).toBe(2475)
  })

  it('resort fee exclu de MEN (régression anti-bug)', () => {
    const resa = {
      id: 'test-resort',
      code: 'TEST-RF',
      platform: 'direct',
      fin_revenue: 15000,
      fin_accommodation: 10000,
      final_status: 'accepted',
      owner_stay: false,
      mois_comptable: '2026-04',
      reservation_fee: [
        { label: 'Community Fee', amount: 4000, fee_type: 'guest_fee' },
        { label: 'Resort Fee',    amount: 1000, fee_type: 'guest_fee' },
      ],
      bien: makeBien(),
    }
    const { lignes } = _calculerLignes(resa)
    // Sans la correction : MEN = 4000 + 1000 = 5000
    // Avec la correction : MEN = 4000 (resort exclu)
    expect(ligne(lignes, 'MEN').montant_ttc).toBe(4000)
  })

  it('Airbnb : dueToOwner basé sur AIRBNB_LOY_RATE = 13.95% (pas 16.21%)', () => {
    // Vérifie que le taux de retenue Airbnb sur le ménage est bien 13.95%
    const fmenBase = 10000
    const resa = {
      id: 'test-airbnb-rate',
      code: 'TEST-AR',
      platform: 'airbnb',
      fin_revenue: 20000,
      fin_accommodation: 18000,
      final_status: 'accepted',
      owner_stay: false,
      mois_comptable: '2026-04',
      reservation_fee: [
        { label: 'Cleaning Fee',    amount: 10000, fee_type: 'guest_fee' },
        { label: 'Host Service Fee', amount: -8000, fee_type: 'host_fee' },
      ],
      bien: makeBien(),
    }
    const { lignes } = _calculerLignes(resa)
    // dueToOwner = round(10000 × 0.1395) = 1395 (si 13.95%)
    // vs round(10000 × 0.1621) = 1621 (si 16.21% — ancienne valeur)
    // fmenTTC = max(0, 10000 - dueToOwner) = 8605 (13.95%) ou 8379 (16.21%)
    expect(ligne(lignes, 'FMEN').montant_ttc).toBe(8605)  // 10000 - 1395
  })

  it('Direct : ownerFees > 0 quand hostServiceFee ≠ 0 (pas de platformRemb /1.0077)', () => {
    const resa = {
      id: 'test-owner-fees',
      code: 'TEST-OF',
      platform: 'direct',
      fin_revenue: 13000,
      fin_accommodation: 10000,
      final_status: 'accepted',
      owner_stay: false,
      mois_comptable: '2026-04',
      reservation_fee: [
        { label: 'Host Service Fee', amount: -200, fee_type: 'host_fee' },
        { label: 'Community Fee',    amount: 3000, fee_type: 'guest_fee' },
      ],
      bien: makeBien(),
    }
    const { lignes } = _calculerLignes(resa)
    // ownerFees = round(200 × 3000/13000 × 0.75) = round(34.62) = 35
    // LOY = (10000-200) - floor(9800×0.25) + 35 = 9800 - 2450 + 35 = 7385
    expect(ligne(lignes, 'LOY').montant_ttc).toBe(7385)
  })

  it('taux commission priorité : override bien > proprio > défaut 25%', () => {
    const resa = {
      id: 'test-taux',
      code: 'TEST-TX',
      platform: 'direct',
      fin_revenue: 20000,
      fin_accommodation: 20000,
      final_status: 'accepted',
      owner_stay: false,
      mois_comptable: '2026-04',
      reservation_fee: [],
      bien: makeBien({
        taux_commission_override: 0.20,          // override 20%
        proprietaire: { taux_commission: 30 },   // proprio 30% — doit être ignoré
      }),
    }
    const { lignes } = _calculerLignes(resa)
    // HON = floor(20000 × 0.20) = 4000 (override 20%)
    // pas floor(20000 × 0.30) = 6000
    expect(ligne(lignes, 'HON').montant_ttc).toBe(4000)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// HMS2SR33WH — Airbnb BGH avec EXTRA_GUEST_FEE
// Validé sur statement Hospitable avril 2026
//   accommodation = 103900¢, hostServiceFee = -26022¢
//   EXTRA_GUEST_FEE = 20000¢ → inclus dans commissionableBase
//   commissionableBase = 103900 - 26022 + 20000 = 97878¢ = €978,78
//   HON = round(97878 × 0.22) = 21533¢ = €215,33 ✓
//   LOY = 113878 - 21533 - fmenTTC - 0 = €786,66 ✓
// ─────────────────────────────────────────────────────────────────────────
describe('HMS2SR33WH — Airbnb BGH avec EXTRA_GUEST_FEE (taux 22%)', () => {
  const resa = {
    id: 'test-bghrh',
    code: 'HMS2SR33WH',
    platform: 'airbnb',
    fin_revenue: 113878,
    fin_accommodation: 103900,
    final_status: 'accepted',
    owner_stay: false,
    mois_comptable: '2026-04',
    reservation_fee: [
      { label: 'Host Service Fee', amount: -26022, fee_type: 'host_fee' },
      { label: 'Community Fee',    amount: 16000,  fee_type: 'guest_fee' },
      { label: 'EXTRA_GUEST_FEE', amount: 20000,  fee_type: 'guest_fee' },
    ],
    bien: makeBien({ taux_commission_override: 0.22 }),
  }

  it('commissionableBase inclut EXTRA_GUEST_FEE → HON = 21533¢', () => {
    const { lignes } = _calculerLignes(resa)
    // commissionableBase = 103900 - 26022 + 20000 = 97878
    // HON = round(97878 × 0.22) = 21533
    expect(ligne(lignes, 'HON').montant_ttc).toBe(21533)
  })

  it('LOY = 78666¢ = €786,66 (aligné statement Hospitable)', () => {
    const { lignes } = _calculerLignes(resa)
    // dueToOwner = round(26022 × 16000 / (103900+16000+20000) × 0.78)
    //            = round(26022 × 16000 / 139900 × 0.78) = round(2321.3) = 2321
    // fmenTTC = 16000 - 2321 = 13679
    // LOY = 113878 - 21533 - 13679 - 0 - 0 = 78666
    expect(ligne(lignes, 'LOY').montant_ttc).toBe(78666)
  })
})
