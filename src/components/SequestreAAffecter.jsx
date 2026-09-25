import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// Boîte « À affecter » du séquestre (migrations 278-280) : les mouvements que les règles
// automatiques n'ont pas su attribuer (grand livre sequestre_ecriture, ayant_droit = a_affecter).
// Affecter = sequestre_affectation (ce mouvement) + optionnellement sequestre_alias (ce libellé,
// réappliqué automatiquement aux prochains mouvements). Pris en compte au prochain calcul.

const eur = c => ((c || 0) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const fmtD = d => d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—'
const norm = t => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// Ce qu'un mouvement peut être : type de classement (sequestreCore) + tiers attendu
const CHOIX_SORTIE = [
  { v: 'reversement', l: 'Reversement à un propriétaire', tiers: 'proprietaire' },
  { v: 'paiement_ae', l: 'Paiement d\'un AE (ménages / extras)', tiers: 'ae' },
  { v: 'transfert_dcb:hon', l: 'Virement à l\'agence — honoraires' },
  { v: 'transfert_dcb:fmen', l: 'Virement à l\'agence — forfait ménage' },
  { v: 'transfert_dcb:com', l: 'Virement à l\'agence — commission' },
  { v: 'inter_agence', l: 'Vers l\'autre agence (argent encaissé pour elle)' },
  { v: 'remboursement_voyageur', l: 'Remboursement voyageur' },
  { v: 'frais_bancaires', l: 'Frais bancaires' },
]
const CHOIX_ENTREE = [
  { v: 'remboursement_debours', l: 'Remboursement de débours par un propriétaire', tiers: 'proprietaire' },
  { v: 'paiement_facture', l: 'Paiement d\'une facture d\'honoraires (dû à l\'agence)', tiers: 'proprietaire' },
  { v: 'retour_dcb:com', l: 'Retour d\'un virement agence en trop' },
  { v: 'inter_agence', l: 'Depuis l\'autre agence' },
  { v: 'reprise_ancien_sequestre', l: 'Reprise d\'un ancien compte séquestre' },
  { v: 'remise_frais_bancaires', l: 'Remise de frais bancaires' },
]

export default function SequestreAAffecter({ agence, onChange }) {
  const [lignes, setLignes] = useState([])
  const [tiers, setTiers] = useState({ proprietaire: [], ae: [] })
  const [saisie, setSaisie] = useState({})
  const [msg, setMsg] = useState(null)
  const [loading, setLoading] = useState(true)

  async function charger() {
    setLoading(true)
    const { data: ec } = await supabase.from('sequestre_ecriture')
      .select('mouvement_id, ligne, date_operation, montant, nature, mois, detail, mouvement:mouvement_id(libelle, detail)')
      .eq('agence', agence).eq('ayant_droit', 'a_affecter').order('date_operation', { ascending: false })
    const [{ data: pr }, { data: ae }] = await Promise.all([
      supabase.from('proprietaire').select('id, nom, prenom').eq('agence', agence).order('nom'),
      supabase.from('auto_entrepreneur').select('id, nom, prenom, actif').eq('type', 'ae').order('prenom'),
    ])
    setLignes(ec || [])
    setTiers({ proprietaire: pr || [], ae: (ae || []).filter(a => a.actif !== false) })
    setLoading(false)
  }
  useEffect(() => { charger() }, [agence])

  async function affecter(l) {
    const s = saisie[`${l.mouvement_id}-${l.ligne}`] || {}
    if (!s.choix) return setMsg('Choisis ce que représente ce mouvement.')
    const [type, sous] = s.choix.split(':')
    const liste = l.montant < 0 ? CHOIX_SORTIE : CHOIX_ENTREE
    const def = liste.find(c => c.v === s.choix)
    if (def?.tiers && !s.tiers_id) return setMsg(`Choisis le ${def.tiers === 'ae' ? 'AE' : 'propriétaire'}.`)
    const { data: { user } } = await supabase.auth.getUser()
    const note = s.note || `Affecté depuis la page Séquestre (${def?.l})`
    const { error } = await supabase.from('sequestre_affectation').upsert({
      mouvement_id: l.mouvement_id, type, sous: sous || null, mois: s.mois || l.mois || null, note,
      tiers_type: def?.tiers || null, tiers_id: s.tiers_id || null, created_by: user?.email || null,
    }, { onConflict: 'mouvement_id' })
    if (error) return setMsg(error.message)
    if (s.alias && s.motif) {
      const { error: eA } = await supabase.from('sequestre_alias').upsert({
        agence, sens: l.montant < 0 ? 'sortie' : 'entree', motif: norm(s.motif), type, sous: sous || null,
        tiers_type: def?.tiers || null, tiers_id: s.tiers_id || null, note, cree_par: user?.email || null,
      }, { onConflict: 'agence,sens,motif' })
      if (eA) return setMsg(eA.message)
    }
    setLignes(ls => ls.filter(x => !(x.mouvement_id === l.mouvement_id && x.ligne === l.ligne)))
    setMsg('Affecté — pris en compte au prochain calcul (« Recalculer maintenant » ou cette nuit).')
    onChange?.()
  }

  const set = (l, k, v) => setSaisie(s => ({ ...s, [`${l.mouvement_id}-${l.ligne}`]: { ...(s[`${l.mouvement_id}-${l.ligne}`] || {}), [k]: v } }))
  const td = { padding: '6px 8px', borderTop: '1px solid #F3EFE6', fontSize: 12, verticalAlign: 'top' }

  if (loading) return <div className="loading-state"><span className="spinner" /> Chargement…</div>
  if (!lignes.length) return <div style={{ fontSize: 13, color: '#059669', padding: '8px 0' }}>✓ Aucun mouvement à affecter.</div>

  return (
    <div>
      {msg && <div className="alert alert-info" style={{ marginBottom: 8 }}>{msg}</div>}
      <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
          <tbody>
            {lignes.map(l => {
              const k = `${l.mouvement_id}-${l.ligne}`, s = saisie[k] || {}
              const libelle = `${l.mouvement?.libelle || ''} ${l.mouvement?.detail || ''}`.replace(/\s+/g, ' ').trim()
              const liste = l.montant < 0 ? CHOIX_SORTIE : CHOIX_ENTREE
              const def = liste.find(c => c.v === s.choix)
              const partie = l.detail?.raison
              return (
                <tr key={k}>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtD(l.date_operation)}</td>
                  <td style={{ ...td, maxWidth: 360 }}>{libelle}{partie ? <div style={{ color: 'var(--text-muted)' }}>{partie}</div> : null}
                    {l.nature === 'remise_groupee_sans_detail' && <div style={{ color: '#B45309' }}>Remise groupée sans détail : importer le PDF « Détail Remise » de la banque.</div>}
                    {l.nature === 'plateforme_non_rapprochee' && <div style={{ color: 'var(--text-muted)' }}>Encaissement plateforme : à rapprocher d'une réservation (page Rapprochement).</div>}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap', color: l.montant < 0 ? '#B91C1C' : '#059669' }}>{eur(l.montant)}</td>
                  <td style={td}>
                    <select className="input" value={s.choix || ''} onChange={e => set(l, 'choix', e.target.value)} style={{ fontSize: 12, width: 250 }}>
                      <option value="">— c'est quoi ? —</option>
                      {liste.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}
                    </select>
                    {def?.tiers && <select className="input" value={s.tiers_id || ''} onChange={e => set(l, 'tiers_id', e.target.value)} style={{ fontSize: 12, width: 250, marginTop: 4 }}>
                      <option value="">— {def.tiers === 'ae' ? 'AE' : 'propriétaire'} —</option>
                      {tiers[def.tiers].map(t => <option key={t.id} value={t.id}>{t.nom} {t.prenom || ''}</option>)}
                    </select>}
                  </td>
                  <td style={td}>
                    <input className="input" placeholder="mois AAAA-MM" value={s.mois ?? (l.mois || '')} onChange={e => set(l, 'mois', e.target.value)} style={{ fontSize: 12, width: 110 }} />
                    <label style={{ display: 'block', marginTop: 4, fontSize: 11 }}>
                      <input type="checkbox" checked={!!s.alias} onChange={e => { set(l, 'alias', e.target.checked); if (e.target.checked && !s.motif) set(l, 'motif', norm(l.mouvement?.libelle).split(' ').filter(w => !['vir', 'sepa', 'inst', 'reason', 'ref'].includes(w)).slice(0, 4).join(' ')) }} /> mémoriser pour ce libellé
                    </label>
                    {s.alias && <input className="input" value={s.motif || ''} onChange={e => set(l, 'motif', e.target.value)} title="texte contenu dans le libellé bancaire" style={{ fontSize: 11, width: 180, marginTop: 2 }} />}
                  </td>
                  <td style={td}><button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => affecter(l)}>Affecter</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
