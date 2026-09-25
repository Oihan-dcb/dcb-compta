import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { AGENCE } from '../lib/agence'
import { justifierSequestre } from '../services/sequestreJustificatif'
import SequestreAAffecter from '../components/SequestreAAffecter'

// Séquestre — justificatif (I-161) : le solde du séquestre location saisonnière décomposé en poches
// (à qui appartient chaque euro), pour l'agence de l'app (fiche sequestre_compte, migrations 278-280).
// Photo calculée chaque nuit (api/sequestre-justificatif, 05:20) ; « Recalculer » refait le calcul.
// Boîte « À affecter » : les mouvements que les règles n'ont pas su attribuer (grand livre).

const eur = c => ((c || 0) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const fmtD = d => d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—'
const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const moisLabel = m => { const [y, mm] = m.split('-'); return `${MOIS_FR[+mm - 1]} ${y}` }

// Détail affiché sous chaque poche (clé de detail)
const DETAIL_POCHE = {
  debours_rembourses: 'remboursements_debours',
  factures_payees_sequestre: 'factures_payees_sequestre',
  plateformes_non_rapprochees: 'plateformes_non_rapprochees',
  entrees_non_affectees: 'entrees_a_identifier',
  sorties_non_affectees: 'sorties_a_identifier',
}

export default function PageSequestre() {
  const [j, setJ] = useState(null)
  const [historique, setHistorique] = useState([])
  const [loading, setLoading] = useState(true)
  const [calcul, setCalcul] = useState(false)
  const [err, setErr] = useState(null)
  const [ouvert, setOuvert] = useState({})

  async function charger() {
    setLoading(true); setErr(null)
    const { data, error } = await supabase.from('sequestre_justificatif').select('*').eq('agence', AGENCE).order('date', { ascending: false }).limit(60)
    if (error) setErr(error.message)
    const dernier = data?.[0]
    if (dernier) setJ({ date: dernier.date, solde_banque: { montant: dernier.solde_banque, maj: dernier.solde_maj, banque: dernier.detail?.banque }, total_justifie: dernier.total_justifie,
      ecart: dernier.ecart, ecart_import: dernier.detail?.ecart_import, poches: dernier.poches, par_mois: dernier.par_mois, detail: dernier.detail, anomalies: dernier.detail?.anomalies || [], source: 'photo de la nuit' })
    setHistorique(data || [])
    setLoading(false)
  }
  useEffect(() => { charger() }, [])

  async function recalculer() {
    setCalcul(true); setErr(null)
    try { const r = await justifierSequestre(AGENCE); setJ({ ...r, source: 'calcul à l\'instant' }) }
    catch (e) { setErr(e.message) }
    setCalcul(false)
  }


  const th = { textAlign: 'left', padding: '8px 10px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', background: 'var(--header-bg)' }
  const td = { padding: '7px 10px', borderTop: '1px solid #F3EFE6', fontSize: 13 }
  const r = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
  const rouge = v => (v < -100 ? '#B91C1C' : undefined)

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Séquestre — justificatif</h1>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Location saisonnière · {j ? `${j.source} du ${fmtD(j.date)}` : ''}</span>
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={recalculer} disabled={calcul}>{calcul ? '⏳ Calcul…' : '↻ Recalculer maintenant'}</button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 18 }}>
        Chaque euro du séquestre appartient à quelqu'un : propriétaires, DCB, AE, voyageurs. Le justificatif décompose le solde bancaire réel en ces « poches » ; l'écart doit être nul.
      </div>
      {err && <div className="alert alert-error">{err}</div>}
      {loading && !j && <div className="loading-state"><span className="spinner" /> Chargement…</div>}
      {!loading && !j && <div className="empty-state">Pas encore de justificatif enregistré — « Recalculer maintenant » ou attendre le calcul de la nuit.</div>}

      {j && <>
        <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
          {[['Solde du relevé importé', j.solde_banque.montant, j.solde_banque.banque ? `banque : ${eur(j.solde_banque.banque.montant)}${Math.abs(j.ecart_import || 0) > 100 ? ` — ${eur(j.ecart_import)} pas encore importés` : ' ✓'}` : 'ouverture + mouvements'],
            ['Total justifié', j.total_justifie, 'somme des poches'],
            ['Écart', j.ecart, Math.abs(j.ecart) <= 100 ? '✓ séquestre justifié' : 'à expliquer']].map(([l, v, sub], i) => (
            <div key={l} style={{ flex: 1, minWidth: 200, background: '#fff', border: `${i === 2 ? 2 : 1}px solid ${i === 2 ? (Math.abs(v) <= 100 ? '#059669' : '#B91C1C') : 'var(--border)'}`, borderRadius: 10, padding: '12px 16px' }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{l}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: i === 2 && Math.abs(v) > 100 ? '#B91C1C' : undefined }}>{eur(v)}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub}</div>
            </div>
          ))}
        </div>

        {j.anomalies?.length > 0 && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 16px', marginBottom: 18 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#B91C1C', marginBottom: 6 }}>Anomalies ({j.anomalies.length})</div>
            {j.anomalies.map(a => <div key={a.cle} style={{ fontSize: 13, padding: '3px 0' }}>• {a.message}</div>)}
          </div>
        )}

        <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 20 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Poche</th><th style={{ ...th, textAlign: 'right' }}>Montant</th></tr></thead>
            <tbody>
              {j.poches.map(p => {
                const cleDetail = DETAIL_POCHE[p.cle]
                const lignes = cleDetail ? (j.detail?.[cleDetail] || []) : []
                return [
                  <tr key={p.cle} onClick={() => lignes.length && setOuvert(o => ({ ...o, [p.cle]: !o[p.cle] }))} style={{ cursor: lignes.length ? 'pointer' : 'default' }}>
                    <td style={td}>{lignes.length ? (ouvert[p.cle] ? '▾ ' : '▸ ') : ''}{p.label}{lignes.length ? <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> ({lignes.length})</span> : null}</td>
                    <td style={{ ...r, fontWeight: 600, color: rouge(p.montant) }}>{eur(p.montant)}</td>
                  </tr>,
                  ouvert[p.cle] && lignes.map((l, i) => (
                    <tr key={`${p.cle}-${i}`} style={{ background: '#FAF8F4' }}>
                      <td style={{ ...td, fontSize: 12, paddingLeft: 30, color: 'var(--text-muted)' }}>{fmtD(l.date)} · {l.libelle}{l.raison ? ` — ${l.raison}` : ''}</td>
                      <td style={{ ...r, fontSize: 12 }}>{eur(l.montant)}</td>
                    </tr>
                  )),
                ]
              })}
              <tr><td style={{ ...td, fontWeight: 700 }}>Total justifié</td><td style={{ ...r, fontWeight: 700 }}>{eur(j.total_justifie)}</td></tr>
            </tbody>
          </table>
        </div>

        <h2 style={{ fontSize: 16, margin: '0 0 4px' }}>À affecter</h2>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Mouvements que les règles automatiques n'ont pas su attribuer. Une affectation vaut pour ce mouvement ; « mémoriser pour ce libellé » l'applique aussi aux suivants.</div>
        <div style={{ marginBottom: 20 }}><SequestreAAffecter agence={AGENCE} /></div>

        <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Mois par mois</h2>
        <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, overflow: 'auto', marginBottom: 20 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead><tr>
              {['Mois', 'Encaissé', 'Propriétaires dû / payé', 'Reste', 'AE dû / payé', 'Reste', 'DCB viré', 'DCB détenu', 'DCB théorique', 'Anomalie'].map((h, i) => <th key={h + i} style={{ ...th, textAlign: i ? 'right' : 'left' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {j.par_mois.map(m => m.facture ? (
                <tr key={m.mois}>
                  <td style={td}>{moisLabel(m.mois)}</td>
                  <td style={r}>{eur(m.encaisse)}</td>
                  <td style={r}>{eur(m.proprietaires.du)} / {eur(m.proprietaires.paye)}</td>
                  <td style={{ ...r, color: rouge(m.proprietaires.reste) }}>{eur(m.proprietaires.reste)}</td>
                  <td style={r}>{eur(m.ae.du)} / {eur(m.ae.paye)}</td>
                  <td style={{ ...r, color: rouge(m.ae.reste) }}>{eur(m.ae.reste)}</td>
                  <td style={r}>{eur(m.dcb.paye)}</td>
                  <td style={{ ...r, color: rouge(m.dcb.reste) }}>{eur(m.dcb.reste)}</td>
                  <td style={r}>{eur(m.dcb.reste_theorique)}</td>
                  <td style={{ ...r, fontWeight: 600, color: Math.abs(m.dcb.anomalie) > 100 ? '#B91C1C' : '#059669' }}>{eur(m.dcb.anomalie)}</td>
                </tr>
              ) : (
                <tr key={m.mois} style={{ background: '#FAF8F4' }}>
                  <td style={td}>{moisLabel(m.mois)} <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>non facturé</span></td>
                  <td style={r}>{eur(m.encaisse)}</td>
                  <td colSpan={6} style={{ ...td, fontSize: 12, color: 'var(--text-muted)' }}>déjà sorti : {eur(m.sorti)} — le reste sera réparti à la facturation</td>
                  <td style={{ ...r, fontWeight: 600 }}>{eur(m.reste)}</td>
                  <td style={td} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg)', borderRadius: 8, padding: '10px 14px', marginBottom: 20, lineHeight: 1.6 }}>
          <strong>Lecture :</strong> « DCB détenu » = encaissé du mois − reversements dus − AE dus − déjà viré à DCB : ce que le séquestre détient réellement encore pour DCB.
          « DCB théorique » = ce qui reste à virer d'après la page Comptabilité (honoraires, ménage, commissions des résas encaissées + frais retenus).
          Une <strong>anomalie</strong> négative = il manque de l'argent au séquestre pour ce mois (virement DCB en trop, encaissement manquant, débours non remboursé) ;
          positive = de l'argent en plus (encaissement non réparti, reversement non facturé…). Mois suivis à partir de la date de départ de la fiche du compte séquestre.
        </div>

        {historique.length > 1 && <>
          <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Historique de l'écart</h2>
          <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', maxWidth: 520 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Date</th><th style={{ ...th, textAlign: 'right' }}>Solde</th><th style={{ ...th, textAlign: 'right' }}>Écart</th><th style={{ ...th, textAlign: 'right' }}>Variation</th></tr></thead>
              <tbody>{historique.slice(0, 30).map((h, i) => {
                const prev = historique[i + 1]
                const v = prev ? h.ecart - prev.ecart : null
                return <tr key={h.date}><td style={td}>{fmtD(h.date)}</td><td style={r}>{eur(h.solde_banque)}</td><td style={r}>{eur(h.ecart)}</td>
                  <td style={{ ...r, color: v != null && Math.abs(v) > 2000 ? '#B91C1C' : 'var(--text-muted)' }}>{v == null ? '—' : `${v > 0 ? '+' : ''}${eur(v)}`}</td></tr>
              })}</tbody>
            </table>
          </div>
        </>}
      </>}
    </div>
  )
}
