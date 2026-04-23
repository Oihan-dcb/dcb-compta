import { supabase } from '../lib/supabase'
import { AGENCE } from '../lib/agence'

// ── Helpers ────────────────────────────────────────────────────────────────────

function pad2(n) { return String(n).padStart(2, '0') }

function nowISOWithTz() {
  const d = new Date()
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const hh = pad2(Math.floor(Math.abs(off) / 60))
  const mm = pad2(Math.abs(off) % 60)
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${ms}${sign}${hh}:${mm}`
}

function msgIdTimestamp(nom) {
  const d = new Date()
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  const rand = String(Math.floor(Math.random() * 1000)).padStart(3, '0')
  const ts = `${pad2(d.getDate())}${pad2(d.getMonth()+1)}${d.getFullYear()}${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}${ms}${rand}`
  return `${ts} ${nom}`
}

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`
}

function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function eur(centimes) {
  return (centimes / 100).toFixed(2)
}

function iban(s) {
  return (s || '').replace(/\s/g, '').toUpperCase()
}

function bic(s) {
  return (s || '').replace(/\s/g, '').toUpperCase()
}

function bicBlock(b) {
  if (!b) return ''
  return `
        <CdtrAgt>
          <FinInstnId>
            <BIC>${bic(b)}</BIC>
          </FinInstnId>
        </CdtrAgt>`
}

function debtorBicBlock(b) {
  if (!b) return ''
  return `
      <DbtrAgt>
        <FinInstnId>
          <BIC>${bic(b)}</BIC>
        </FinInstnId>
      </DbtrAgt>`
}

// ── Bloc PmtInf unique ─────────────────────────────────────────────────────────

function buildPmtInf({ pmtInfId, debtorNom, debtorIban, debtorBic, transactions }) {
  const nbTx = transactions.length
  const total = transactions.reduce((s, t) => s + t.montant, 0)

  const txsXml = transactions.map((t, i) => `
      <CdtTrfTxInf>
        <PmtId>
          <EndToEndId>${esc(t.endToEndId || `TX-${i+1}`)}</EndToEndId>
        </PmtId>
        <Amt>
          <InstdAmt Ccy="EUR">${eur(t.montant)}</InstdAmt>
        </Amt>${bicBlock(t.creditorBic)}
        <Cdtr>
          <Nm>${esc(t.creditorNom)}</Nm>
        </Cdtr>
        <CdtrAcct>
          <Id>
            <IBAN>${iban(t.creditorIban)}</IBAN>
          </Id>
        </CdtrAcct>
        <RmtInf>
          <Ustrd>${esc((t.remittance || '').slice(0, 140))}</Ustrd>
        </RmtInf>
      </CdtTrfTxInf>`).join('')

  return {
    nbTx,
    total,
    xml: `
    <PmtInf>
      <PmtInfId>${esc(pmtInfId)}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <NbOfTxs>${nbTx}</NbOfTxs>
      <CtrlSum>${eur(total)}</CtrlSum>
      <PmtTpInf>
        <SvcLvl>
          <Cd>SEPA</Cd>
        </SvcLvl>
      </PmtTpInf>
      <ReqdExctnDt>${todayISO()}</ReqdExctnDt>
      <Dbtr>
        <Nm>${esc(debtorNom)}</Nm>
        <PstlAdr>
          <Ctry>FR</Ctry>
        </PstlAdr>
      </Dbtr>
      <DbtrAcct>
        <Id>
          <IBAN>${iban(debtorIban)}</IBAN>
        </Id>
      </DbtrAcct>${debtorBicBlock(debtorBic)}
      <ChrgBr>SLEV</ChrgBr>${txsXml}
    </PmtInf>`,
  }
}

// ── Génération XML pain.001.001.03 (1 PmtInf) ─────────────────────────────────

function buildSCT({ msgId, pmtInfId, debtorNom, debtorIban, debtorBic, transactions }) {
  const pmtInf = buildPmtInf({ pmtInfId, debtorNom, debtorIban, debtorBic, transactions })
  const resolvedMsgId = msgId || msgIdTimestamp(debtorNom)

  return `<?xml version="1.0"?>
<Document xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${esc(resolvedMsgId)}</MsgId>
      <CreDtTm>${nowISOWithTz()}</CreDtTm>
      <NbOfTxs>${pmtInf.nbTx}</NbOfTxs>
      <CtrlSum>${eur(pmtInf.total)}</CtrlSum>
      <InitgPty>
        <Nm>${esc(debtorNom)}</Nm>
      </InitgPty>
    </GrpHdr>${pmtInf.xml}
  </CstmrCdtTrfInitn>
</Document>`
}

// ── Génération XML pain.001.001.03 (N PmtInf) ─────────────────────────────────

function buildSCTMulti({ msgId, initiatorNom, pmtGroups }) {
  const pmtInfs = pmtGroups.map(g => buildPmtInf(g))
  const totalNbTx = pmtInfs.reduce((s, p) => s + p.nbTx, 0)
  const totalCtrl = pmtInfs.reduce((s, p) => s + p.total, 0)
  const resolvedMsgId = msgId || msgIdTimestamp(initiatorNom)

  return `<?xml version="1.0"?>
<Document xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${esc(resolvedMsgId)}</MsgId>
      <CreDtTm>${nowISOWithTz()}</CreDtTm>
      <NbOfTxs>${totalNbTx}</NbOfTxs>
      <CtrlSum>${eur(totalCtrl)}</CtrlSum>
      <InitgPty>
        <Nm>${esc(initiatorNom)}</Nm>
      </InitgPty>
    </GrpHdr>${pmtInfs.map(p => p.xml).join('')}
  </CstmrCdtTrfInitn>
</Document>`
}

// ── Virements propriétaires LLD ────────────────────────────────────────────────
// Debtor  : compte loyers LLD (CE)
// Creditors : un CdtTrfTxInf par propriétaire ayant statut a_virer

export async function genererSCTVirementsProprios(mois, agence = AGENCE) {
  const { data: config, error: errCfg } = await supabase
    .from('agency_config')
    .select('seq_lld_loyers_iban, seq_lld_loyers_bic, agence_titulaire')
    .eq('agence', agence)
    .single()
  if (errCfg) throw errCfg
  if (!config?.seq_lld_loyers_iban) throw new Error('IBAN séquestre LLD loyers non configuré (voir Agence → Comptes bancaires)')

  const { data: virements, error: errVir } = await supabase
    .from('virement_proprio_suivi')
    .select('id, montant, etudiant(nom, prenom, proprietaire(nom, prenom, iban, bic))')
    .eq('agence', agence)
    .eq('mois', mois)
    .eq('statut', 'a_virer')
  if (errVir) throw errVir

  const valid = (virements || []).filter(v => v.etudiant?.proprietaire?.iban && v.montant > 0)
  if (!valid.length) throw new Error(`Aucun virement propriétaire à effectuer pour ${mois} (avec IBAN configuré)`)

  const transactions = valid.map((v, i) => {
    const prop = v.etudiant.proprietaire
    const etud = v.etudiant
    return {
      endToEndId:   `PROP-${String(v.id).slice(0, 8).toUpperCase()}-${i+1}`,
      montant:       v.montant,
      creditorIban:  prop.iban,
      creditorBic:   prop.bic || '',
      creditorNom:   `${prop.nom} ${prop.prenom}`.trim(),
      remittance:    `LOYER LLD ${mois} ${etud.nom} ${etud.prenom}`,
    }
  })

  const debtorNom = config.agence_titulaire || 'DESTINATION COTE BASQUE'

  return buildSCT({
    msgId:       msgIdTimestamp(debtorNom),
    pmtInfId:    `PMT-PROP-LLD-${mois}`,
    debtorNom,
    debtorIban:  config.seq_lld_loyers_iban,
    debtorBic:   config.seq_lld_loyers_bic || '',
    transactions,
  })
}

// ── Virement honoraires DCB (LLD) ──────────────────────────────────────────────
// Debtor  : compte loyers LLD (CE)
// Creditor : compte principal DCB
// Montant : somme des honoraires_dcb des loyers reçus du mois

export async function genererSCTHonorairesDCB(mois, agence = AGENCE) {
  const { data: config, error: errCfg } = await supabase
    .from('agency_config')
    .select('seq_lld_loyers_iban, seq_lld_loyers_bic, agence_iban, agence_bic, agence_titulaire')
    .eq('agence', agence)
    .single()
  if (errCfg) throw errCfg
  if (!config?.seq_lld_loyers_iban) throw new Error('IBAN séquestre LLD loyers non configuré (voir Agence → Comptes bancaires)')
  if (!config?.agence_iban)         throw new Error('IBAN compte agence non configuré (voir Agence → Comptes bancaires)')

  const { data: loyers, error: errLoy } = await supabase
    .from('loyer_suivi')
    .select('etudiant(honoraires_dcb)')
    .eq('agence', agence)
    .eq('mois', mois)
    .eq('statut', 'recu')
  if (errLoy) throw errLoy

  const totalHon = (loyers || []).reduce((s, l) => s + (l.etudiant?.honoraires_dcb || 0), 0)
  if (!totalHon) throw new Error(`Aucun honoraire DCB à virer pour ${mois} (aucun loyer reçu avec honoraires)`)

  const debtorNom = config.agence_titulaire || 'DESTINATION COTE BASQUE'

  return buildSCT({
    msgId:       msgIdTimestamp(debtorNom),
    pmtInfId:    `PMT-HON-LLD-${mois}`,
    debtorNom,
    debtorIban:  config.seq_lld_loyers_iban,
    debtorBic:   config.seq_lld_loyers_bic || '',
    transactions: [{
      endToEndId:   `HON-LLD-${mois}`,
      montant:       totalHon,
      creditorIban:  config.agence_iban,
      creditorBic:   config.agence_bic || '',
      creditorNom:   debtorNom,
      remittance:    `HONORAIRES LLD ${mois}`,
    }],
  })
}

// ── Virements propriétaires LC ─────────────────────────────────────────────────
// Debtor  : compte séquestre locations courtes
// Creditors : 1 ligne par bien (VIR = LOY + TAXE)
// Exception Maïté : toutes les chambres (groupe_facturation='MAITE') → 1 seul virement

export async function genererSCTVirementsPropriosLC(mois, agence = AGENCE) {
  const { data: config, error: errCfg } = await supabase
    .from('agency_config')
    .select('seq_lc_iban, seq_lc_bic, agence_titulaire')
    .eq('agence', agence)
    .single()
  if (errCfg) throw errCfg
  if (!config?.seq_lc_iban) throw new Error('IBAN séquestre LC non configuré (voir Agence → Comptes bancaires)')

  const { data: lignes, error: errVir } = await supabase
    .from('ventilation')
    .select(`
      id, montant_ttc, bien_id,
      bien(id, code, groupe_facturation, agence),
      proprietaire:proprietaire_id(id, nom, prenom, iban, bic)
    `)
    .eq('mois_comptable', mois)
    .eq('code', 'VIR')
    .gt('montant_ttc', 0)
  if (errVir) throw errVir

  const valid = (lignes || []).filter(l =>
    (l.bien?.agence || agence) === agence && l.proprietaire?.iban
  )
  if (!valid.length) throw new Error(`Aucun virement LC à effectuer pour ${mois} (avec IBAN configuré)`)

  // Grouper : groupe_facturation non-null → agréger, sinon 1 ligne par bien
  const groups = new Map()
  for (const l of valid) {
    const key = l.bien?.groupe_facturation || l.bien_id
    if (!groups.has(key)) {
      groups.set(key, { montant: 0, prop: l.proprietaire, label: l.bien?.groupe_facturation || l.bien?.code || key, isGroupe: !!l.bien?.groupe_facturation })
    }
    groups.get(key).montant += l.montant_ttc
  }

  const transactions = Array.from(groups.entries()).map(([key, g], i) => ({
    endToEndId:   `VIR-LC-${String(key).slice(0, 8).toUpperCase()}-${i+1}`,
    montant:       g.montant,
    creditorIban:  g.prop.iban,
    creditorBic:   g.prop.bic || '',
    creditorNom:   `${g.prop.nom} ${g.prop.prenom}`.trim(),
    remittance:    `LOYER LC ${mois} ${g.label}`,
  }))

  const debtorNom = config.agence_titulaire || 'DESTINATION COTE BASQUE'

  return buildSCT({
    msgId:       msgIdTimestamp(debtorNom),
    pmtInfId:    `PMT-VIR-LC-${mois}`,
    debtorNom,
    debtorIban:  config.seq_lc_iban,
    debtorBic:   config.seq_lc_bic || '',
    transactions,
  })
}

// ── Virements internes LC (HON + COM + FMEN + Frais Stripe) ────────────────────
// PmtInf 1 : seq_lc_iban → agence_iban  (HON TTC + COM TTC + FMEN TTC, 3 transactions)
// PmtInf 2 : agence_iban → seq_lc_iban  (remboursement frais Stripe)

export async function genererSCTInternesLC(mois, agence = AGENCE) {
  const { data: config, error: errCfg } = await supabase
    .from('agency_config')
    .select('seq_lc_iban, seq_lc_bic, agence_iban, agence_bic, agence_titulaire')
    .eq('agence', agence)
    .single()
  if (errCfg) throw errCfg
  if (!config?.seq_lc_iban)   throw new Error('IBAN séquestre LC non configuré (voir Agence → Comptes bancaires)')
  if (!config?.agence_iban)   throw new Error('IBAN compte agence non configuré (voir Agence → Comptes bancaires)')

  // Totaux HON / COM / FMEN depuis ventilation
  const { data: ventLines, error: errVent } = await supabase
    .from('ventilation')
    .select('code, montant_ttc, bien(agence)')
    .eq('mois_comptable', mois)
    .in('code', ['HON', 'COM', 'FMEN'])
  if (errVent) throw errVent

  const filtered = (ventLines || []).filter(l => (l.bien?.agence || agence) === agence && l.montant_ttc > 0)
  const sum = (code) => filtered.filter(l => l.code === code).reduce((s, l) => s + l.montant_ttc, 0)
  const totHON  = sum('HON')
  const totCOM  = sum('COM')
  const totFMEN = sum('FMEN')

  // Frais Stripe du mois (brut - net)
  const { data: mvtsStripe, error: errMvt } = await supabase
    .from('mouvement_bancaire')
    .select('id')
    .eq('canal', 'stripe')
    .eq('mois_releve', mois)
  if (errMvt) throw errMvt

  let fraisStripe = 0
  if (mvtsStripe?.length) {
    const mvtIds = mvtsStripe.map(m => m.id)
    const { data: stripeLines, error: errSL } = await supabase
      .from('stripe_payout_line')
      .select('montant_brut, montant_net')
      .in('mouvement_id', mvtIds)
    if (errSL) throw errSL
    fraisStripe = (stripeLines || []).reduce((s, l) => s + ((l.montant_brut || 0) - (l.montant_net || 0)), 0)
  }

  const debtorNom = config.agence_titulaire || 'DESTINATION COTE BASQUE'
  const pmtGroups = []

  // PmtInf 1 : séquestre LC → compte agence (commissions)
  const txComm = []
  if (totHON  > 0) txComm.push({ endToEndId: `HON-LC-${mois}`,  montant: totHON,  creditorIban: config.agence_iban, creditorBic: config.agence_bic || '', creditorNom: debtorNom, remittance: `HONORAIRES LC ${mois}` })
  if (totCOM  > 0) txComm.push({ endToEndId: `COM-LC-${mois}`,  montant: totCOM,  creditorIban: config.agence_iban, creditorBic: config.agence_bic || '', creditorNom: debtorNom, remittance: `COMMISSIONS LC ${mois}` })
  if (totFMEN > 0) txComm.push({ endToEndId: `FMEN-LC-${mois}`, montant: totFMEN, creditorIban: config.agence_iban, creditorBic: config.agence_bic || '', creditorNom: debtorNom, remittance: `FORFAIT MENAGE LC ${mois}` })

  if (!txComm.length && !fraisStripe) throw new Error(`Aucun mouvement interne LC à générer pour ${mois}`)

  if (txComm.length) {
    pmtGroups.push({
      pmtInfId:    `PMT-COMM-LC-${mois}`,
      debtorNom,
      debtorIban:  config.seq_lc_iban,
      debtorBic:   config.seq_lc_bic || '',
      transactions: txComm,
    })
  }

  // PmtInf 2 : compte agence → séquestre LC (remboursement frais Stripe)
  if (fraisStripe > 0) {
    pmtGroups.push({
      pmtInfId:    `PMT-STRIPE-LC-${mois}`,
      debtorNom,
      debtorIban:  config.agence_iban,
      debtorBic:   config.agence_bic || '',
      transactions: [{
        endToEndId:   `FRAIS-STRIPE-LC-${mois}`,
        montant:       fraisStripe,
        creditorIban:  config.seq_lc_iban,
        creditorBic:   config.seq_lc_bic || '',
        creditorNom:   debtorNom,
        remittance:    `FRAIS STRIPE LC ${mois}`,
      }],
    })
  }

  return buildSCTMulti({
    msgId:        msgIdTimestamp(debtorNom),
    initiatorNom: debtorNom,
    pmtGroups,
  })
}
