import { supabase } from '../lib/supabase'
import { AGENCE } from '../lib/agence'

// ── Helpers ────────────────────────────────────────────────────────────────────

function pad2(n) { return String(n).padStart(2, '0') }

function nowISO() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
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

// ── Génération XML pain.001.001.03 ────────────────────────────────────────────

function buildSCT({ msgId, pmtInfId, debtorNom, debtorIban, debtorBic, transactions }) {
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

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${esc(msgId)}</MsgId>
      <CreDtTm>${nowISO()}</CreDtTm>
      <NbOfTxs>${nbTx}</NbOfTxs>
      <CtrlSum>${eur(total)}</CtrlSum>
      <InitgPty>
        <Nm>${esc(debtorNom)}</Nm>
      </InitgPty>
    </GrpHdr>
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
      </Dbtr>
      <DbtrAcct>
        <Id>
          <IBAN>${iban(debtorIban)}</IBAN>
        </Id>
      </DbtrAcct>${debtorBicBlock(debtorBic)}${txsXml}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>`
}

// ── Virements propriétaires ────────────────────────────────────────────────────
// Debtor  : compte loyers LLD (CE)
// Creditors : un CdtTrfTxInf par propriétaire ayant statut a_virer

export async function genererSCTVirementsProprios(mois, agence = AGENCE) {
  const { data: config, error: errCfg } = await supabase
    .from('agency_config')
    .select('lld_iban_loyers, lld_bic_loyers, lld_nom_titulaire')
    .eq('agence', agence)
    .single()
  if (errCfg) throw errCfg
  if (!config?.lld_iban_loyers) throw new Error('IBAN compte loyers LLD non configuré (voir Config → Locations longues)')

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

  return buildSCT({
    msgId:       `DCB-PROP-${mois}-${Date.now()}`,
    pmtInfId:    `PMT-PROP-${mois}`,
    debtorNom:   config.lld_nom_titulaire || 'DESTINATION COTE BASQUE',
    debtorIban:  config.lld_iban_loyers,
    debtorBic:   config.lld_bic_loyers || '',
    transactions,
  })
}

// ── Virement honoraires DCB ────────────────────────────────────────────────────
// Debtor  : compte loyers LLD (CE)
// Creditor : compte principal DCB
// Montant : somme des honoraires_dcb des loyers reçus du mois

export async function genererSCTHonorairesDCB(mois, agence = AGENCE) {
  const { data: config, error: errCfg } = await supabase
    .from('agency_config')
    .select('lld_iban_loyers, lld_bic_loyers, lld_iban_principal, lld_bic_principal, lld_nom_titulaire')
    .eq('agence', agence)
    .single()
  if (errCfg) throw errCfg
  if (!config?.lld_iban_loyers)    throw new Error('IBAN compte loyers LLD non configuré (voir Config → Locations longues)')
  if (!config?.lld_iban_principal) throw new Error('IBAN compte principal non configuré (voir Config → Locations longues)')

  const { data: loyers, error: errLoy } = await supabase
    .from('loyer_suivi')
    .select('etudiant(honoraires_dcb)')
    .eq('agence', agence)
    .eq('mois', mois)
    .eq('statut', 'recu')
  if (errLoy) throw errLoy

  const totalHon = (loyers || []).reduce((s, l) => s + (l.etudiant?.honoraires_dcb || 0), 0)
  if (!totalHon) throw new Error(`Aucun honoraire DCB à virer pour ${mois} (aucun loyer reçu avec honoraires)`)

  const debtorNom = config.lld_nom_titulaire || 'DESTINATION COTE BASQUE'

  return buildSCT({
    msgId:       `DCB-HON-${mois}-${Date.now()}`,
    pmtInfId:    `PMT-HON-${mois}`,
    debtorNom,
    debtorIban:  config.lld_iban_loyers,
    debtorBic:   config.lld_bic_loyers || '',
    transactions: [{
      endToEndId:   `HON-${mois}`,
      montant:       totalHon,
      creditorIban:  config.lld_iban_principal,
      creditorBic:   config.lld_bic_principal || '',
      creditorNom:   debtorNom,
      remittance:    `HONORAIRES LLD ${mois}`,
    }],
  })
}
