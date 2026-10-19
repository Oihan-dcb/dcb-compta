import { useState, useEffect, useRef } from 'react'
import { AGENCE } from '../lib/agence'
import { preparerImportBooking, validerImportBooking, getSuiviVirementsBooking } from '../services/importBooking'
import { eur } from '../services/bookingReleveCore'
import { frDate } from '../utils/dateFr'

// Identifiant extranet Booking par agence (lu dans le libellé des virements « …/ID.<n> ») :
// lien sans jeton de session (le navigateur réutilise la session ouverte)
const ID_EXTRANET = { dcb: '10415482', lauian: '10452973' }
const lienExtranet = id => `https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/payouts.html?hotel_id=${id}&lang=fr`

const ETATS_SUIVI = {
  detaille:      { label: 'Détail importé',         bg: '#DCFCE7', fg: '#166534' },
  detail_ecart:  { label: 'Détail ≠ virement',      bg: '#FEF3C7', fg: '#92400E' },
  sans_detail:   { label: 'Relevé à importer',      bg: '#FFEDD5', fg: '#9A3412' },
  non_rapproche: { label: 'Non rapproché',          bg: '#FEE2E2', fg: '#991B1B' },
}
const ETATS_VERSEMENT = {
  ok:            { label: 'Prêt : Σ lignes = virement', bg: '#DCFCE7', fg: '#166534' },
  ecart:         { label: 'Écart à vérifier',          bg: '#FEF3C7', fg: '#92400E' },
  sans_virement: { label: 'Virement pas encore en banque', bg: '#E0EEFF', fg: '#003580' },
  deja_importe:  { label: 'Déjà importé',              bg: '#F3F4F6', fg: '#4B5563' },
  cloture:       { label: 'Mois clôturé : à régulariser', bg: '#FEE2E2', fg: '#991B1B' },
}
const ACTIONS = {
  creer: 'à relier', corriger_montant: 'montant corrigé', aucune: 'déjà relié', deja_sur_autre_virement: 'sur un autre virement',
  a_regulariser: 'mois clôturé',
}

const Badge = ({ e }) => <span style={{ background: e.bg, color: e.fg, borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>{e.label}</span>
const th = { textAlign: 'left', padding: '6px 8px', fontSize: 12, color: '#8C7B65', fontWeight: 600, borderBottom: '1px solid #D9CEB8', whiteSpace: 'nowrap' }
const td = { padding: '6px 8px', fontSize: 13, borderBottom: '1px solid #EFE8DA', whiteSpace: 'nowrap' }
const num = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }

export default function RelevesBooking({ onChange }) {
  const [suivi, setSuivi] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [analyse, setAnalyse] = useState(null)
  const [choix, setChoix] = useState({})
  const [enCours, setEnCours] = useState(false)
  const [resultat, setResultat] = useState(null)
  const [survol, setSurvol] = useState(false)
  const inputRef = useRef()

  const depuis = (() => { const d = new Date(); d.setMonth(d.getMonth() - 12); return d.toISOString().slice(0, 10) })()
  async function chargerSuivi() {
    try { setSuivi(await getSuiviVirementsBooking(depuis)) } catch (e) { setErreur(e.message) }
  }
  useEffect(() => { chargerSuivi() }, [])

  async function deposer(fileList) {
    const files = [...(fileList || [])]
    if (!files.length) return
    setEnCours(true); setErreur(null); setResultat(null); setAnalyse(null)
    try {
      const a = await preparerImportBooking(files)
      setAnalyse(a)
      setChoix(Object.fromEntries(a.versements.filter(v => v.validable).map(v => [v.cle, v.etat !== 'ecart'])))
    } catch (e) { setErreur(e.message) }
    finally { setEnCours(false); if (inputRef.current) inputRef.current.value = '' }
  }

  async function valider() {
    const cles = Object.entries(choix).filter(([, v]) => v).map(([k]) => k)
    if (!cles.length) return
    setEnCours(true); setErreur(null)
    try {
      const log = await validerImportBooking(analyse, cles)
      setResultat(log)
      setAnalyse(null)
      await chargerSuivi()
      onChange?.()
    } catch (e) { setErreur(e.message) }
    finally { setEnCours(false) }
  }

  const idExtranet = suivi?.find(s => s.id_extranet)?.id_extranet || ID_EXTRANET[AGENCE]
  const aImporter = (suivi || []).filter(s => s.etat !== 'detaille')
  const nbChoisis = Object.values(choix).filter(Boolean).length

  return (
    <div style={{ background: '#fff', border: '1px solid #D9CEB8', borderRadius: 10, padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ maxWidth: 760 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#2C2416' }}>📋 Relevés Booking — {AGENCE === 'lauian' ? 'Lauïan' : AGENCE.toUpperCase()}</div>
          <div style={{ fontSize: 13, color: '#6B5D4A', marginTop: 4, lineHeight: 1.5 }}>
            Le virement Booking est rapproché <strong>automatiquement</strong> (séjours partis le mois précédent / séjour unique).
            Le relevé apporte le <strong>détail</strong> : commission, frais de paiement, taxe de séjour retenue, séjours absents d'Hospitable.
            <br />Chaque mois : <em>Extranet Booking › Finances › Versements</em> › ouvrir chaque versement › <em>Télécharger</em> (CSV ou Excel),
            puis déposer le(s) fichier(s) ci-dessous. <strong>Rien n'est écrit avant « Valider »</strong> ; réimporter un fichier ne double rien.
          </div>
        </div>
        {idExtranet && (
          <a href={lienExtranet(idExtranet)} target='_blank' rel='noopener noreferrer'
            style={{ textDecoration: 'none', background: '#fff', color: '#0071C2', border: '1.5px solid #0071C2', borderRadius: 8, padding: '7px 12px', fontWeight: 600, fontSize: 13 }}>
            🔗 Extranet Booking (versements)
          </a>
        )}
      </div>

      {/* Dépôt */}
      <div
        onDragOver={e => { e.preventDefault(); setSurvol(true) }} onDragLeave={() => setSurvol(false)}
        onDrop={e => { e.preventDefault(); setSurvol(false); deposer(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
        style={{ marginTop: 12, border: '2px dashed ' + (survol ? '#CC9933' : '#D9CEB8'), background: survol ? '#FBF6EC' : '#F7F3EC', borderRadius: 10, padding: '14px 16px', textAlign: 'center', cursor: 'pointer', fontSize: 14, color: '#6B5D4A' }}>
        {enCours ? '⏳ Lecture…' : <>Déposer ici les relevés Booking (.csv, .xlsx) — plusieurs fichiers possibles — ou <u>cliquer pour choisir</u></>}
        <input ref={inputRef} type='file' multiple accept='.csv,.xlsx,.xls' style={{ display: 'none' }} onChange={e => deposer(e.target.files)} />
      </div>

      {erreur && <div className='alert alert-error' style={{ marginTop: 10 }}>{erreur}</div>}

      {resultat && (
        <div style={{ marginTop: 10, background: resultat.erreurs.length ? '#FEF2F2' : '#F0FDF4', border: '1px solid ' + (resultat.erreurs.length ? '#FCA5A5' : '#86EFAC'), borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
          <strong>Relevé validé :</strong> {resultat.versements} versement(s), {resultat.lignes} ligne(s) enregistrée(s),
          {' '}{resultat.paiements_crees} résa(s) reliée(s), {resultat.paiements_corriges} montant(s) corrigé(s) au net Booking,
          {' '}{resultat.mouvements_rapproches} virement(s) rapproché(s).
          {resultat.a_regulariser.length > 0 && <div style={{ color: '#991B1B', marginTop: 4 }}>À régulariser à la main : {resultat.a_regulariser.join(' · ')}</div>}
          {resultat.erreurs.length > 0 && <div style={{ color: '#991B1B', marginTop: 4 }}>Erreurs : {resultat.erreurs.join(' · ')}</div>}
        </div>
      )}

      {/* Aperçu */}
      {analyse && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Aperçu — rien n'est encore écrit</div>
          {analyse.fichiers.filter(f => f.erreur).map(f => <div key={f.nom} className='alert alert-error'>{f.nom} : {f.erreur}</div>)}
          <div style={{ fontSize: 13, color: '#6B5D4A', marginBottom: 8 }}>
            {analyse.fichiers.length} fichier(s) · {analyse.resume.versements} versement(s) · {analyse.resume.lignes} ligne(s) ·
            {' '}{analyse.resume.ok} prêt(s) · {analyse.resume.ecart} avec écart · {analyse.resume.sans_virement} sans virement en banque ·
            {' '}{analyse.resume.deja_importe} déjà importé(s) · {analyse.resume.cloture} mois clôturé
          </div>
          {analyse.versements.map(v => (
            <div key={v.cle} style={{ border: '1px solid #D9CEB8', borderRadius: 8, padding: 12, marginBottom: 10, background: v.etat === 'deja_importe' ? '#FAFAF9' : '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {v.validable && <input type='checkbox' checked={!!choix[v.cle]} onChange={e => setChoix({ ...choix, [v.cle]: e.target.checked })} />}
                <strong>Versement du {frDate(v.payout_date)}</strong>
                {v.payout_id && <span style={{ fontSize: 12, color: '#8C7B65' }}>réf. {v.payout_id}</span>}
                <Badge e={ETATS_VERSEMENT[v.etat]} />
                <span style={{ fontSize: 13 }}>
                  {v.mouvement ? <>Virement reçu le {frDate(v.mouvement.date_operation)} : <strong>{eur(v.mouvement.credit)}</strong></> : 'Aucun virement trouvé'}
                  {' '}· Σ lignes <strong>{eur(v.somme_nets)}</strong>
                  {v.mouvement && v.ecart_virement !== 0 && <span style={{ color: '#B45309', fontWeight: 700 }}> · écart {eur(v.ecart_virement)}</span>}
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#6B5D4A', margin: '6px 0' }}>
                Payé par les voyageurs {eur(v.total_brut)} − commission {eur(v.total_commission)} − frais de paiement {eur(v.total_frais)} − taxe de séjour retenue {eur(v.total_taxe)} = net {eur(v.somme_nets)}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                  <thead><tr>
                    <th style={th}>Réservation</th><th style={th}>Bien</th><th style={th}>Séjour</th>
                    <th style={{ ...th, textAlign: 'right' }}>Payé voyageur</th><th style={{ ...th, textAlign: 'right' }}>Commission</th>
                    <th style={{ ...th, textAlign: 'right' }}>Frais paiement</th><th style={{ ...th, textAlign: 'right' }}>Taxe retenue</th>
                    <th style={{ ...th, textAlign: 'right' }}>Net versé</th><th style={{ ...th, textAlign: 'right' }}>Revenu Hospitable</th>
                    <th style={{ ...th, textAlign: 'right' }}>Écart</th><th style={th}>Paiement résa</th>
                  </tr></thead>
                  <tbody>
                    {v.lignes.map(l => (
                      <tr key={l.booking_ref} title={l.ecart.texte || ''}>
                        <td style={td}>{l.booking_ref}</td>
                        <td style={td}>{l.bien || <span style={{ color: '#B91C1C' }}>introuvable</span>}</td>
                        <td style={td}>{frDate(l.checkin)} → {frDate(l.checkout)}</td>
                        <td style={num}>{eur(l.gross_cents)}</td>
                        <td style={num}>{eur(-Math.abs(l.commission_cents || 0))}</td>
                        <td style={num}>{eur(-Math.abs(l.service_fee_cents || 0))}</td>
                        <td style={num}>{eur(-Math.abs(l.tourism_tax_cents || 0))}</td>
                        <td style={{ ...num, fontWeight: 700 }}>{eur(l.amount_cents)}</td>
                        <td style={num}>{l.fin_revenue != null ? eur(l.fin_revenue) : '—'}</td>
                        <td style={{ ...num, color: l.ecart_cents ? (Math.abs(l.ecart_cents) <= 100 ? '#8C7B65' : '#B45309') : '#166534' }}>{l.ecart_cents == null ? '—' : l.ecart_cents === 0 ? '✓' : eur(l.ecart_cents)}</td>
                        <td style={td}>{ACTIONS[l.action_paiement] || l.action_paiement}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {v.problemes.length > 0 && <ul style={{ margin: '8px 0 0 18px', padding: 0, fontSize: 12, color: '#92400E' }}>{v.problemes.map((p, i) => <li key={i}>{p}</li>)}</ul>}
              {v.a_regulariser.length > 0 && <ul style={{ margin: '6px 0 0 18px', padding: 0, fontSize: 12, color: '#991B1B' }}>{v.a_regulariser.map((p, i) => <li key={i}>{p}</li>)}</ul>}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className='btn btn-primary' disabled={!nbChoisis || enCours} onClick={valider}>✓ Valider {nbChoisis} versement(s)</button>
            <button className='btn' style={{ background: '#fff', border: '1px solid #D9CEB8' }} onClick={() => setAnalyse(null)}>Annuler</button>
          </div>
        </div>
      )}

      {/* Suivi des virements */}
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Virements Booking des 12 derniers mois</div>
        {suivi && aImporter.length > 0 && (
          <div style={{ fontSize: 13, color: '#9A3412', marginBottom: 6 }}>
            {aImporter.length} virement(s) sans détail complet : télécharger le versement de même référence dans l'extranet.
          </div>
        )}
        {!suivi ? <div style={{ fontSize: 13, color: '#8C7B65' }}>Chargement…</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr>
                <th style={th}>Virement reçu</th><th style={{ ...th, textAlign: 'right' }}>Montant</th>
                <th style={{ ...th, textAlign: 'right' }}>Résas reliées</th><th style={{ ...th, textAlign: 'right' }}>Détail relevé</th>
                <th style={th}>État</th><th style={th}>Réf. versement Booking</th>
              </tr></thead>
              <tbody>
                {suivi.map(s => (
                  <tr key={s.id}>
                    <td style={td}>{frDate(s.date_operation)}</td>
                    <td style={num}>{eur(s.credit)}</td>
                    <td style={num}>{s.nb_resas} · {eur(s.somme_resas)}</td>
                    <td style={num}>{s.nb_lignes ? <>{s.nb_lignes} · {eur(s.somme_lignes)}</> : '—'}</td>
                    <td style={td}><Badge e={ETATS_SUIVI[s.etat]} /></td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{s.ref_payout || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
