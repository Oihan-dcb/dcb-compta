import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { AGENCE } from '../lib/agence'
import { formatMontant } from '../lib/hospitable'
import { aFaireLLD, lancerLLDAuto, rattacherMouvementLLD } from '../services/lldAuto'
import { listerLoyersMois, listerEtudiants } from '../services/locationsLongues'

// « LLD — ce mois-ci » (I-159) : une seule page pour Laura. En haut, UNIQUEMENT ce qui demande
// une action ; en dessous, les loyers du mois. Le reste (rapprochement, loyers attendus,
// cautions, virements propriétaires, factures, quittances) se fait seul chaque nuit
// (api/lld-auto) — le bouton « Tout mettre à jour » lance la même chose tout de suite.

const moisCourant = () => new Date().toISOString().slice(0, 7)
const fmtDate = d => d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—'
const nom = e => [e?.prenom, e?.nom].filter(Boolean).join(' ') || '—'
const STATUT = {
  recu:      { label: '✓ Reçu',     color: '#059669', bg: '#ECFDF5' },
  attendu:   { label: 'Attendu',    color: '#B45309', bg: '#FFF7ED' },
  en_retard: { label: 'En retard',  color: '#B91C1C', bg: '#FEE2E2' },
}

function Bloc({ titre, n, couleur = '#B45309', note, children }) {
  if (!n) return null
  return (
    <div style={{ background: '#fff', border: '1px solid var(--border)', borderLeft: `4px solid ${couleur}`, borderRadius: 10, padding: '12px 16px', marginBottom: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: note ? 2 : 8 }}>{titre} <span style={{ color: couleur }}>({n})</span></div>
      {note && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{note}</div>}
      {children}
    </div>
  )
}

export default function LLDCeMois() {
  const [af, setAf] = useState(null)
  const [loyers, setLoyers] = useState([])
  const [etudiants, setEtudiants] = useState([])
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)
  const [choix, setChoix] = useState({}) // mouvement_id → etudiant_id choisi
  const mois = moisCourant()

  const charger = useCallback(async () => {
    setLoading(true)
    try {
      const [a, l, e] = await Promise.all([aFaireLLD(AGENCE), listerLoyersMois(mois, AGENCE), listerEtudiants(AGENCE, null, false)])
      setAf(a); setLoyers(l); setEtudiants(e)
    } catch (e) { setErr(e.message) }
    setLoading(false)
  }, [mois])
  useEffect(() => { charger() }, [charger])

  async function toutMettreAJour() {
    setRunning(true); setErr(null); setMsg(null)
    try {
      const r = await lancerLLDAuto(AGENCE)
      const rp = r.rapprochement
      setMsg(`Mis à jour : ${rp.loyers_recus} loyer(s) reçu(s), ${rp.cautions} caution(s), ${rp.frais} frais, ${rp.suggestions} à confirmer, ${rp.non_reconnus} non reconnu(s) · ${r.quittances?.envoyees || 0} quittance(s) envoyée(s)`)
      await charger()
    } catch (e) { setErr(e.message) }
    setRunning(false)
  }

  async function rattacher(mouvementId, etudiantId) {
    if (!etudiantId) return
    setErr(null)
    try {
      const r = await rattacherMouvementLLD(mouvementId, etudiantId, AGENCE)
      setMsg(`Rattaché${r.motif ? ` — « ${r.motif} » sera reconnu automatiquement les prochains mois` : ''}`)
      await charger()
    } catch (e) { setErr(e.message) }
  }

  async function ignorer(mouvementId) {
    setErr(null)
    const { error } = await supabase.from('lld_mouvement_bancaire').update({ statut: 'ignore', match_raison: 'ignoré à la main (hors loyer / caution)' }).eq('id', mouvementId)
    if (error) setErr(error.message); else await charger()
  }

  async function quittance(loyerId, envoyer) {
    setErr(null)
    const { data, error } = await supabase.functions.invoke('generer-quittance', { body: { loyer_suivi_id: loyerId, envoyer_email: envoyer } })
    if (error) { setErr(error.message); return }
    if (!envoyer && data?.pdf_url) window.open(data.pdf_url, '_blank')
    if (envoyer) setMsg(data?.email_envoye ? 'Quittance envoyée par e-mail' : "Quittance générée (pas d'e-mail locataire)")
    await charger()
  }

  async function relancer(loyerId) {
    setErr(null)
    const { data, error } = await supabase.functions.invoke('relance-loyer', { body: { loyer_suivi_id: loyerId } })
    if (error) { setErr('Relance : ' + error.message); return }
    const d = data?.detail?.[0]
    setMsg(d?.sms_ok || d?.email_ok ? `Relance envoyée — SMS ${d.sms_ok ? '✓' : '✗'} · e-mail ${d.email_ok ? '✓' : '✗'}` : 'Relance traitée — vérifier les coordonnées du locataire')
    await charger()
  }

  const selectEtudiant = (m, defaut) => (
    <select value={choix[m.id] ?? defaut ?? ''} onChange={e => setChoix(c => ({ ...c, [m.id]: e.target.value }))}
      style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12, maxWidth: 200 }}>
      <option value="">— Étudiant —</option>
      {etudiants.map(e => <option key={e.id} value={e.id}>{nom(e)}{e.bien?.code ? ` (${e.bien.code})` : ''}</option>)}
    </select>
  )
  const btn = (label, onClick, color = 'var(--brand)', plein = true) => (
    <button onClick={onClick} style={{ background: plein ? color : '#fff', color: plein ? '#fff' : color, border: `1px solid ${color}`, borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{label}</button>
  )
  const row = { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: '1px solid #F3EFE6', fontSize: 13, flexWrap: 'wrap' }

  const nbAFaire = af ? Object.values(af).reduce((s, v) => s + v.length, 0) : 0
  const totalAttendu = loyers.reduce((s, l) => s + (l.montant_attendu || 0), 0)
  const totalRecu = loyers.filter(l => l.statut === 'recu').reduce((s, l) => s + (l.montant_recu || l.montant_attendu || 0), 0)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{new Date(mois + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{formatMontant(totalRecu)} reçus sur {formatMontant(totalAttendu)} attendus · {loyers.filter(l => l.statut === 'recu').length}/{loyers.length} loyers</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Automatique chaque nuit</span>
          <button className="btn btn-primary" onClick={toutMettreAJour} disabled={running}>{running ? '⏳ Mise à jour…' : '⚡ Tout mettre à jour'}</button>
        </div>
      </div>
      {err && <div className="alert alert-error">{err}</div>}
      {msg && <div className="alert alert-success" onClick={() => setMsg(null)}>{msg}</div>}
      {loading && !af && <div className="loading-state"><span className="spinner" /> Chargement…</div>}

      {af && nbAFaire === 0 && (
        <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 10, padding: '14px 16px', marginBottom: 16, fontSize: 14, color: '#065F46', fontWeight: 600 }}>✓ Rien à traiter — tout est à jour.</div>
      )}

      {af && <>
        <Bloc titre="Paiements à confirmer" n={af.paiements_a_confirmer.length} couleur="#CC9933"
          note="Reconnus avec un doute. Confirmer = le payeur est mémorisé et reconnu seul les mois suivants.">
          {af.paiements_a_confirmer.map(m => (
            <div key={m.id} style={row}>
              <span style={{ minWidth: 80 }}>{fmtDate(m.date_operation)}</span>
              <strong style={{ minWidth: 90 }}>{formatMontant(m.credit)}</strong>
              <span style={{ flex: 1, minWidth: 200, color: 'var(--text-muted)', fontSize: 12 }}>{(m.libelle || '').replace(/\n/g, ' ').slice(0, 90)}</span>
              {btn(`✓ ${nom(m.suggestion)}`, () => rattacher(m.id, m.suggestion?.id), '#059669')}
              {selectEtudiant(m)}{choix[m.id] && btn('Rattacher', () => rattacher(m.id, choix[m.id]))}
              {btn('Ignorer', () => ignorer(m.id), '#9C8E7D', false)}
            </div>
          ))}
        </Bloc>

        <Bloc titre="Paiements non reconnus" n={af.paiements_non_reconnus.length} couleur="#B91C1C"
          note="À rattacher une seule fois : le payeur (parent, plateforme…) sera ensuite reconnu automatiquement.">
          {af.paiements_non_reconnus.map(m => (
            <div key={m.id} style={row}>
              <span style={{ minWidth: 80 }}>{fmtDate(m.date_operation)}</span>
              <strong style={{ minWidth: 90 }}>{formatMontant(m.credit)}</strong>
              <span style={{ flex: 1, minWidth: 200, color: 'var(--text-muted)', fontSize: 12 }}>{(m.libelle || '').replace(/\n/g, ' ').slice(0, 90)}</span>
              {selectEtudiant(m)}{choix[m.id] && btn('Rattacher', () => rattacher(m.id, choix[m.id]))}
              {btn('Ignorer', () => ignorer(m.id), '#9C8E7D', false)}
            </div>
          ))}
        </Bloc>

        <Bloc titre="Loyers en retard" n={af.loyers_en_retard.length} couleur="#B91C1C">
          {af.loyers_en_retard.map(l => (
            <div key={l.id} style={row}>
              <strong style={{ minWidth: 180 }}>{nom(l.etudiant)}</strong>
              <span style={{ minWidth: 70, color: 'var(--text-muted)' }}>{l.etudiant?.bien?.code}</span>
              <span style={{ minWidth: 70 }}>{l.mois}</span>
              <strong style={{ minWidth: 90 }}>{formatMontant((l.montant_attendu || 0) - (l.montant_recu || 0))}</strong>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1 }}>{l.nb_relances || 0} relance(s){l.etudiant?.telephone ? ` · ${l.etudiant.telephone}` : ''}</span>
              {(l.etudiant?.email || l.etudiant?.telephone) ? btn('📨 Relancer', () => relancer(l.id), '#B91C1C') : <span style={{ fontSize: 12, color: '#B91C1C' }}>ni e-mail ni téléphone</span>}
            </div>
          ))}
        </Bloc>

        <Bloc titre="Cautions à restituer" n={af.cautions_a_rendre.length} couleur="#B91C1C"
          note="Délai légal : 1 mois après la remise des clés si l'état des lieux est conforme, 2 mois sinon — au-delà, pénalité de 10 % du loyer par mois de retard.">
          {af.cautions_a_rendre.map(e => (
            <div key={e.id} style={row}><strong style={{ minWidth: 180 }}>{nom(e)}</strong><span style={{ minWidth: 70 }}>{e.bien?.code}</span><span>sortie {fmtDate(e.sortie)}</span><strong style={{ color: '#B91C1C' }}>avant le {fmtDate(e.limite_restitution)}</strong></div>
          ))}
        </Bloc>

        <Bloc titre="Cautions attendues non reçues" n={af.cautions_non_recues.length}>
          {af.cautions_non_recues.map(e => (
            <div key={e.id} style={row}><strong style={{ minWidth: 180 }}>{nom(e)}</strong><span style={{ minWidth: 70 }}>{e.bien?.code}</span><span>entrée {fmtDate(e.date_entree)}</span><strong>{formatMontant(e.caution)}</strong></div>
          ))}
        </Bloc>

        <Bloc titre="Virements propriétaires à faire (loyer encaissé)" n={af.virements_proprio_a_faire.length} note="Pointés automatiquement dès que le virement apparaît sur le relevé.">
          {af.virements_proprio_a_faire.map(v => (
            <div key={v.id} style={row}><strong style={{ minWidth: 180 }}>{nom(v.etudiant?.proprietaire)}</strong><span style={{ minWidth: 70 }}>{v.etudiant?.bien?.code}</span><span style={{ minWidth: 70 }}>{v.mois}</span><strong>{formatMontant(v.montant)}</strong><span style={{ color: 'var(--text-muted)', fontSize: 12 }}>loyer de {nom(v.etudiant)}</span></div>
          ))}
        </Bloc>

        <Bloc titre="Sorties dans les 45 jours" n={af.sorties_proches.length} couleur="#0891B2" note="Planifier l'état des lieux de sortie ; la caution se restitue ensuite dans le délai légal.">
          {af.sorties_proches.map(e => (
            <div key={e.id} style={row}><strong style={{ minWidth: 180 }}>{nom(e)}</strong><span style={{ minWidth: 70 }}>{e.bien?.code}</span><span>{fmtDate(e.date_sortie_reelle || e.date_sortie_prevue)}</span></div>
          ))}
        </Bloc>

        <Bloc titre="Locataires sans e-mail" n={af.etudiants_sans_email.length} couleur="#9C8E7D" note="Ni quittance ni relance automatique possibles — compléter la fiche.">
          {af.etudiants_sans_email.map(e => (
            <div key={e.id} style={row}><strong style={{ minWidth: 180 }}>{nom(e)}</strong><span>{e.bien?.code}</span></div>
          ))}
        </Bloc>
      </>}

      {/* Loyers du mois */}
      <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginTop: 6 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ background: 'var(--header-bg)' }}>
            {['Locataire', 'Bien', 'Attendu', 'Statut', 'Reçu le', 'Quittance', ''].map(h => <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {loyers.length === 0 && <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Loyers du mois pas encore préparés — « Tout mettre à jour » les crée.</td></tr>}
            {loyers.map(l => {
              const st = STATUT[l.statut] || STATUT.attendu
              return (
                <tr key={l.id} style={{ borderTop: '1px solid #F3EFE6' }}>
                  <td style={{ padding: '7px 10px', fontWeight: 600 }}>{nom(l.etudiant)}</td>
                  <td style={{ padding: '7px 10px', color: 'var(--text-muted)' }}>{l.etudiant?.bien?.code}</td>
                  <td style={{ padding: '7px 10px' }}>{formatMontant(l.montant_attendu)}</td>
                  <td style={{ padding: '7px 10px' }}><span style={{ background: st.bg, color: st.color, borderRadius: 5, padding: '2px 8px', fontSize: 12, fontWeight: 600 }}>{st.label}</span>
                    {l.statut !== 'recu' && l.montant_recu > 0 && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>partiel {formatMontant(l.montant_recu)}</span>}</td>
                  <td style={{ padding: '7px 10px' }}>{fmtDate(l.date_reception)}</td>
                  <td style={{ padding: '7px 10px', fontSize: 12 }}>{l.quittance_envoyee_at ? `✓ ${fmtDate(l.quittance_envoyee_at)}` : '—'}</td>
                  <td style={{ padding: '7px 10px', display: 'flex', gap: 6 }}>
                    {l.statut === 'recu' && btn('⬇ PDF', () => quittance(l.id, false), 'var(--brand)', false)}
                    {l.statut === 'recu' && !l.quittance_envoyee_at && l.etudiant?.email && btn('📧 Quittance', () => quittance(l.id, true))}
                    {l.statut !== 'recu' && (l.etudiant?.email || l.etudiant?.telephone) && btn('📨 Relancer', () => relancer(l.id), '#B91C1C', false)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
