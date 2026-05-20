// Page Règles de ventilation — Config menu
// Affichage visuel de toutes les règles par module

const S = {
  page:   { padding: '32px 28px', maxWidth: 960, margin: '0 auto' },
  title:  { fontSize: 22, fontWeight: 800, color: '#2C2416', marginBottom: 4 },
  sub:    { fontSize: 13, color: '#8C7B65', marginBottom: 32 },
  grid:   { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20, marginBottom: 32 },
  card:   { background: '#fff', border: '1px solid #D9CEB8', borderRadius: 12, overflow: 'hidden' },
  chead:  { padding: '12px 16px', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 },
  cbody:  { padding: '12px 16px', fontSize: 12.5, color: '#2C2416', lineHeight: 1.7 },
  code:   { background: '#F7F3EC', border: '1px solid #D9CEB8', borderRadius: 4, padding: '2px 6px', fontFamily: 'monospace', fontSize: 11.5, color: '#8C7B65' },
  h3:     { fontSize: 14, fontWeight: 700, color: '#2C2416', marginBottom: 12, marginTop: 0 },
  table:  { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th:     { background: '#F7F3EC', padding: '7px 10px', textAlign: 'left', fontWeight: 600, color: '#8C7B65', borderBottom: '1px solid #D9CEB8' },
  td:     { padding: '7px 10px', borderBottom: '1px solid #F0E8D8', verticalAlign: 'top', color: '#2C2416' },
  badge:  { display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700 },
  formula:{ background: '#F7F3EC', border: '1px solid #D9CEB8', borderRadius: 8, padding: '10px 14px', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.8, color: '#2C2416', overflowX: 'auto', whiteSpace: 'pre-wrap' },
  section:{ marginBottom: 36 },
}

const PLAT_COLORS = {
  airbnb:  { bg: '#FFF1F0', border: '#FECACA', text: '#B91C1C', dot: '#FF385C' },
  booking: { bg: '#EFF6FF', border: '#BFDBFE', text: '#1D4ED8', dot: '#0071C2' },
  direct:  { bg: '#F0FDF4', border: '#BBF7D0', text: '#166534', dot: '#16A34A' },
  commun:  { bg: '#FFF7ED', border: '#FED7AA', text: '#9A3412', dot: '#CC9933' },
  exclu:   { bg: '#FEF9EC', border: '#E9D9A8', text: '#78350F', dot: '#B45309' },
}

function Badge({ label, color }) {
  return (
    <span style={{ ...S.badge, background: color.bg, color: color.text, border: `1px solid ${color.border}` }}>
      {label}
    </span>
  )
}

function Section({ title, children }) {
  return (
    <div style={S.section}>
      <h2 style={{ fontSize: 16, fontWeight: 800, color: '#2C2416', borderBottom: '2px solid #CC9933', paddingBottom: 8, marginBottom: 20 }}>
        {title}
      </h2>
      {children}
    </div>
  )
}

function PlatCard({ color, title, icon, children }) {
  return (
    <div style={{ ...S.card, border: `1px solid ${color.border}` }}>
      <div style={{ ...S.chead, background: color.bg, color: color.text }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: color.dot, display: 'inline-block', flexShrink: 0 }} />
        {icon} {title}
      </div>
      <div style={S.cbody}>{children}</div>
    </div>
  )
}

function FormulaBlock({ children }) {
  return <div style={S.formula}>{children}</div>
}

function Mono({ children }) {
  return <code style={S.code}>{children}</code>
}

export default function PageReglesVentilation() {
  return (
    <div style={S.page}>
      <div style={S.title}>Règles de ventilation</div>
      <div style={S.sub}>
        Documentation des règles métier appliquées par <Mono>ventilation.js</Mono> — source de vérité : <Mono>docs/domain-rules.md</Mono>
      </div>

      {/* ── 1. Codes comptables ─────────────────────────────────────────── */}
      <Section title="1. Codes comptables produits">
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Code</th>
              <th style={S.th}>Libellé</th>
              <th style={S.th}>TVA</th>
              <th style={S.th}>Base de calcul</th>
              <th style={S.th}>Plateforme</th>
            </tr>
          </thead>
          <tbody>
            {[
              { code:'HON',  label:'Honoraires DCB',        tva:'20%', base:'commissionableBase × tauxCom', plat:'Toutes' },
              { code:'FMEN', label:'Forfait ménage DCB',    tva:'20%', base:'fmenBase − dueToOwner − AUTO', plat:'Toutes' },
              { code:'AUTO', label:'Débours AE',            tva:'0%',  base:'provision_ae_ref (ou montant_reel si saisi)', plat:'Toutes' },
              { code:'LOY',  label:'Reversement propriétaire', tva:'0%', base:'Airbnb: commissionableBase − HON + platformRemb\nBooking: fin_revenue_net − HON − FMEN − AUTO − taxes\nDirect: commissionableBase − HON + ownerFees', plat:'Toutes' },
              { code:'VIRProprio', label:'VIRProprio (virement calculé)', tva:'0%', base:'LOY + taxesTotal', plat:'Toutes' },
              { code:'TAXE', label:'Taxe de séjour',        tva:'0%',  base:'Σ fee_type=\'tax\' non remitted', plat:'Booking / Direct' },
              { code:'MEN',  label:'Ménage brut voyageur',  tva:'0%',  base:'Σ guest_fees hors management/host service/resort fee', plat:'Toutes' },
              { code:'COM',  label:'Commission DCB directe', tva:'20%', base:'managementFeeRaw (brut)', plat:'Direct uniquement' },
              { code:'RGLM', label:'Règlement voyageur',    tva:'0%',  base:'fin_revenue − Σ paiements reçus', plat:'Direct / Manual uniquement' },
            ].map(r => (
              <tr key={r.code}>
                <td style={S.td}><Mono>{r.code}</Mono></td>
                <td style={S.td}>{r.label}</td>
                <td style={{ ...S.td, color: r.tva === '20%' ? '#9A3412' : '#8C7B65' }}>{r.tva}</td>
                <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11, whiteSpace: 'pre-line' }}>{r.base}</td>
                <td style={S.td}>{r.plat}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 10, fontSize: 11.5, color: '#8C7B65' }}>
          RGLM n'apparaît pas dans les rapports propriétaires, factures ni exports SEPA — rapprochement bancaire uniquement.
        </div>
      </Section>

      {/* ── 2. Exclusions ───────────────────────────────────────────────── */}
      <Section title="2. Réservations exclues de la ventilation">
        <div style={S.grid}>
          {[
            { cond: 'bien.gestion_loyer = false', why: 'Le propriétaire gère son loyer lui-même' },
            { cond: 'reservation.owner_stay = true', why: 'Séjour propriétaire — ventilation manuelle via VentilationEdit (FMEN + AUTO)' },
            { cond: 'fin_revenue = 0', why: 'Court-circuit — early return, aucune écriture' },
            { cond: 'isDirect && isCancelled', why: 'Ventilation supprimée + ventilation_calculee=true' },
            { cond: 'final_status IN [cancelled, not_accepted, declined, expired]', why: 'Suppression + ventilation_calculee=true + fin_revenue=0' },
            { cond: 'ventilation_calculee = true', why: 'Non retraitée — ignorée par calculerVentilationMois' },
          ].map(e => (
            <div key={e.cond} style={{ ...S.card, borderLeft: '3px solid #B45309' }}>
              <div style={{ ...S.chead, background: '#FEF9EC', color: '#78350F', fontSize: 12 }}>
                ✗ <Mono>{e.cond}</Mono>
              </div>
              <div style={{ ...S.cbody, color: '#78350F', fontSize: 12 }}>{e.why}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── 3. Calculs par plateforme ───────────────────────────────────── */}
      <Section title="3. Formules par plateforme">
        <div style={S.grid}>

          {/* Airbnb */}
          <PlatCard color={PLAT_COLORS.airbnb} title="Airbnb" icon="🏠">
            <FormulaBlock>{`commissionableBase
  = accommodation + hostServiceFee
    + discounts + extraGuestFee

fmenBase = cleaningFee + communityFee
dueToOwner = Math.round(fmenBase × 0.1395)
fmenTTC = max(0, fmenBase − dueToOwner − AUTO)

honTTC = Math.round(commBase × tauxCom)  [round]
platformRemb = Math.ceil(fmenBase × 0.1621)

LOY = commBase − honTTC + platformRemb
VIRProprio = LOY  [taxesTotal = 0]`}</FormulaBlock>
            <div style={{ marginTop: 10, fontSize: 11.5, color: '#8C7B65' }}>
              Airbnb remit les taxes directement → taxesTotal = 0 toujours.
            </div>
          </PlatCard>

          {/* Booking */}
          <PlatCard color={PLAT_COLORS.booking} title="Booking" icon="📋">
            <FormulaBlock>{`commissionableBase
  = accommodation + hostServiceFee + discounts

fmenBase = cleaningFee + communityFee
totalFeesForOwnerRate = accommodation + Σ guestFees
dueToOwner = Math.round(
  |hostServiceFee| × fmenBase
  / totalFeesForOwnerRate × (1 − tauxCom))

fmenTTC = max(0, fmenBase − dueToOwner − AUTO)
taxesTotal = Σ taxes non-remitted
remittedTotal = Σ taxes remitted

honTTC = Math.round(commBase × tauxCom)  [round]

LOY = (fin_revenue − remittedTotal)
      − honTTC − fmenTTC − AUTO − taxesTotal
VIRProprio = LOY + taxesTotal`}</FormulaBlock>
            <div style={{ marginTop: 10, fontSize: 11.5, color: '#8C7B65' }}>
              LOY Booking = recalcul depuis fin_revenue net (pas depuis commBase).
            </div>
          </PlatCard>

          {/* Direct / Manual */}
          <PlatCard color={PLAT_COLORS.direct} title="Direct / Manual (Hospitable)" icon="🔗">
            <FormulaBlock>{`isDirect = platform='direct' || platform='manual'

commissionableBase
  = accommodation + hostServiceFee + discounts

honTTC = Math.floor(commBase × tauxCom)  [floor!]
comAmount = managementFeeRaw → code COM

fmenBase = cleaningFee + communityFee
  [dueToOwner = 0 — Hospitable ne retient pas]
fmenTTC = max(0, fmenBase − AUTO)

totalFeesForOwnerRate = accommodation + Σ guestFees
ownerFees = Σ Math.round(
  |hostServiceFee| × fee_i
  / totalFeesForOwnerRate × (1 − tauxCom))

LOY = commBase − honTTC + ownerFees
VIRProprio = LOY + taxesTotal`}</FormulaBlock>
            <div style={{ marginTop: 10, fontSize: 11.5, color: '#8C7B65' }}>
              Manual : hostServiceFee = 0 → ownerFees = 0 → LOY = commBase − honTTC.
              Math.floor pour honTTC (vs Math.round sur les autres).
            </div>
          </PlatCard>

        </div>
      </Section>

      {/* ── 4. Taux de commission ───────────────────────────────────────── */}
      <Section title="4. Résolution du taux de commission">
        <div style={{ ...S.card, maxWidth: 520 }}>
          <div style={{ ...S.chead, background: '#FFF7ED', color: '#9A3412', borderBottom: '1px solid #FED7AA' }}>
            Priorité résolue au moment de la ventilation (gelée ensuite)
          </div>
          <div style={S.cbody}>
            <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 2.2 }}>
              <li><Mono>bien.taux_commission_override</Mono> (ratio, ex : 0.20) — priorité absolue</li>
              <li><Mono>proprietaire.taux_commission / 100</Mono> (ex : 25 → 0.25)</li>
              <li><strong>0.25 (25%)</strong> — défaut hardcodé si les deux sont null</li>
            </ol>
            <div style={{ marginTop: 10, padding: '8px 12px', background: '#FEF9EC', borderRadius: 6, fontSize: 12, color: '#78350F' }}>
              ⚠ Modifier le taux d'un bien/proprio n'affecte pas les réservations déjà ventilées (<Mono>ventilation_calculee=true</Mono>).
            </div>
          </div>
        </div>
      </Section>

      {/* ── 5. Identification des fees ─────────────────────────────────── */}
      <Section title="5. Identification des fees par label">
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Fee recherché</th>
              <th style={S.th}>Filtre</th>
              <th style={S.th}>Usage</th>
            </tr>
          </thead>
          <tbody>
            {[
              { fee:'Cleaning fee', filtre:"label === 'cleaning fee' (égalité stricte)", usage:'cleaningFeeAirbnb — base ménage Airbnb' },
              { fee:'Community fee', filtre:"label === 'community fee' (égalité stricte)", usage:'communityFeeRaw — commission Airbnb/Hospitable sur ménage' },
              { fee:'Management fee', filtre:"label.includes('management')", usage:'managementFeeRaw → code COM (directes)' },
              { fee:'Host Service Fee', filtre:"fee_type === 'host_fee' (tous)", usage:'hostServiceFee (négatif) — commission plateforme' },
              { fee:'Taxes remitted', filtre:"label.includes('remitted')", usage:'Exclues LOY Airbnb, déduites fin_revenue Booking' },
              { fee:'MEN exclusions', filtre:"label = 'management fee' | 'host service fee' | 'resort fee'", usage:'Exclus du code MEN' },
            ].map(r => (
              <tr key={r.fee}>
                <td style={{ ...S.td, fontWeight: 600 }}>{r.fee}</td>
                <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11 }}>{r.filtre}</td>
                <td style={S.td}>{r.usage}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 12, padding: '10px 14px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, fontSize: 12, color: '#1D4ED8' }}>
          <strong>Normalisation labels localisés (Booking FR)</strong> : <Mono>"frais de ménage"</Mono> → <Mono>"cleaning fee"</Mono> &nbsp;|&nbsp; <Mono>"frais de service (5%)"</Mono> → <Mono>"community fee"</Mono>.
          S'applique uniquement au fallback <Mono>hospitable_raw</Mono>.
        </div>
      </Section>

      {/* ── 6. Règle AUTO ───────────────────────────────────────────────── */}
      <Section title="6. Règle AUTO (provision AE)">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, maxWidth: 700 }}>
          <div style={S.card}>
            <div style={{ ...S.chead, background: '#F7F3EC', color: '#8C7B65' }}>Provision (défaut)</div>
            <div style={S.cbody}>
              <FormulaBlock>{`aeAmount = isCancelled ? 0
          : (bien.provision_ae_ref || 0)`}</FormulaBlock>
              <div style={{ marginTop: 8, fontSize: 12 }}>
                Annulation → AUTO = 0. Si <Mono>provision_ae_ref = null</Mono> → AUTO = 0.
              </div>
            </div>
          </div>
          <div style={S.card}>
            <div style={{ ...S.chead, background: '#F0FDF4', color: '#166534' }}>Réel (remplace la provision)</div>
            <div style={S.cbody}>
              <FormulaBlock>{`ventilation.montant_reel
(saisi par l'AE via le portail)

FMEN.montant_reel =
  FMEN.montant_ttc
  + AUTO.provision − AUTO.réel`}</FormulaBlock>
              <div style={{ marginTop: 8, fontSize: 12 }}>
                Le réel remplace la provision dès qu'il est renseigné. FMEN ajusté en conséquence.
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* ── 7. Taxes / VIRProprio ───────────────────────────────────────── */}
      <Section title="7. Taxes et VIRProprio">
        <div style={S.grid}>
          <PlatCard color={PLAT_COLORS.airbnb} title="Airbnb" icon="🏠">
            <FormulaBlock>{`taxesTotal = 0
VIRProprio = LOY

[Airbnb remit les taxes directement
 au fisc — pas de pass-through DCB]`}</FormulaBlock>
          </PlatCard>
          <PlatCard color={PLAT_COLORS.booking} title="Booking" icon="📋">
            <FormulaBlock>{`taxesTotal = Σ taxes non-remitted
remittedTotal = Σ taxes remitted
  (déduites de fin_revenue avant LOY)
VIRProprio = LOY + taxesTotal`}</FormulaBlock>
          </PlatCard>
          <PlatCard color={PLAT_COLORS.direct} title="Direct" icon="🔗">
            <FormulaBlock>{`taxesTotal = Σ toutes les taxes
VIRProprio = LOY + taxesTotal`}</FormulaBlock>
          </PlatCard>
        </div>
      </Section>

      {/* ── 8. ownerFees détail ─────────────────────────────────────────── */}
      <Section title="8. ownerFees (Direct Hospitable uniquement)">
        <div style={{ ...S.card, maxWidth: 620 }}>
          <div style={{ ...S.chead, background: '#F0FDF4', color: '#166534', borderBottom: '1px solid #BBF7D0' }}>
            Portion de la platform fee Hospitable reversée au propriétaire
          </div>
          <div style={S.cbody}>
            <FormulaBlock>{`ownerFees = Σ_i Math.round(
  |hostServiceFee| × fee_i
  / (accommodation + Σ guestFees)
  × (1 − tauxCom)
)

[une itération par guest fee]`}</FormulaBlock>
            <div style={{ marginTop: 10, fontSize: 12 }}>
              Correspond exactement au champ <em>"Total owner fees"</em> du statement Hospitable.
              <br/>Hospitable prélève ~0,77% sur les fees du séjour — la part propriétaire (1 − tauxCom) est redistribuée pro-rata.
              <br/>Manual : <Mono>hostServiceFee = 0</Mono> → <Mono>ownerFees = 0</Mono>.
            </div>
          </div>
        </div>
      </Section>

      {/* ── 9. VIRNet rapport ───────────────────────────────────────────── */}
      <Section title="9. Reversement net propriétaire (virementNet)">
        <div style={{ ...S.card, maxWidth: 700 }}>
          <div style={{ ...S.chead, background: '#FFF7ED', color: '#9A3412', borderBottom: '1px solid #FED7AA' }}>
            Double branche — BRANCHE 1 (facture) prime sur BRANCHE 2 (estimation)
          </div>
          <div style={S.cbody}>
            <div style={{ marginBottom: 12 }}>
              <strong>BRANCHE 1</strong> — facture confirmée (<em>statut ≠ brouillon/calcul_en_cours</em>) :
              <FormulaBlock>{`virementNet = facture.montant_reversement
[montant gelé à la génération — vérité comptable]`}</FormulaBlock>
            </div>
            <div>
              <strong>BRANCHE 2</strong> — estimation temps réel :
              <FormulaBlock>{`virementNet = max(0,
  virTotal
  − fraisDeductionLoy
  + remboursements
  − deboursSeuls
  − haownerTotal
  − ownerStayMenageTotal
)`}</FormulaBlock>
            </div>
            <div style={{ marginTop: 10, padding: '8px 12px', background: '#FEF9EC', borderRadius: 6, fontSize: 12, color: '#78350F' }}>
              <Mono>virTotal</Mono> = Σ <Mono>ventilation.code='VIR'.montant_ht</Mono> (VIRProprio) des resas non proprio_encaisse.
              <br/><Mono>fraisDeductionLoy</Mono> = <Mono>frais_proprietaire.deduire_loyer</Mono> (positif) + <Mono>prestation_hors_forfait</Mono> (débours + haowner).
              <br/><Mono>remboursements</Mono> = <Mono>frais_proprietaire.remboursement</Mono> (réduit la déduction).
            </div>
          </div>
        </div>
      </Section>

      {/* ── 10. Résumé des règles implicites ───────────────────────────── */}
      <Section title="10. Règles implicites">
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Règle</th>
              <th style={S.th}>Comportement</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['loyAmount ≤ 0', 'Ligne LOY non créée'],
              ['fmenTTC ≤ 0', 'Ligne FMEN non créée'],
              ['Booking LOY', 'Recalculé depuis fin_revenue (pas commissionableBase)'],
              ['Airbnb taxesTotal', '= 0 toujours'],
              ['Discounts', 'Négatifs dans hospitable_raw — ajoutés à commissionableBase'],
              ['isDirect annulée', 'Ventilation supprimée + ventilation_calculee=true'],
            ].map(([r, b]) => (
              <tr key={r}>
                <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11 }}>{r}</td>
                <td style={S.td}>{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <div style={{ padding: '12px 16px', background: '#F7F3EC', border: '1px solid #D9CEB8', borderRadius: 8, fontSize: 12, color: '#8C7B65' }}>
        Source de vérité : <Mono>src/services/ventilation.js</Mono> V1 — toute modification doit être répercutée dans <Mono>supabase/functions/ventilation-auto/index.ts</Mono>.
        Documentation complète : <Mono>docs/domain-rules.md</Mono>.
      </div>
    </div>
  )
}
