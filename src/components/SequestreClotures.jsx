import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { cloturerMois, rouvrirMois, cloturerExercice, exerciceEnCours, listerClotures } from '../services/sequestreCloture'
import { compteSequestre } from '../services/sequestreJustificatif'

// Clôtures et journal du séquestre (migration 283). Un mois clôturé = photo figée du justificatif au
// dernier jour du mois + verrou des affectations ; la nuit, le cron vérifie qu'aucune donnée d'un mois
// clôturé n'a bougé (dérive → journal + alerte). L'exercice se clôture quand tous ses mois le sont.

const eur = c => ((c || 0) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const fmtD = d => d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—'
const fmtDT = d => d ? new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const moisLabel = m => { const [y, mm] = m.split('-'); return `${MOIS_FR[+mm - 1]} ${y}` }
const moisPlus = (mois, n) => { const [y, m] = mois.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` }

const TYPES = {
  calcul: ['Calcul', '#6B7280'], variation_ecart: ['Écart', '#B45309'], anomalie_nouvelle: ['Anomalie', '#B91C1C'],
  anomalie_resolue: ['Résolue', '#15803D'], affectation: ['Affectation', '#1D4ED8'], alias: ['Libellé', '#1D4ED8'],
  cloture_mois: ['Clôture', '#15803D'], reouverture_mois: ['Réouverture', '#B45309'], cloture_exercice: ['Exercice', '#15803D'],
  derive_mois_cloture: ['Dérive', '#B91C1C'], note: ['Note', '#6B7280'],
}

export default function SequestreClotures({ agence, onChange }) {
  const [compte, setCompte] = useState(null)
  const [clotures, setClotures] = useState([])
  const [exercice, setExercice] = useState(null)
  const [journal, setJournal] = useState([])
  const [filtre, setFiltre] = useState('sans_calcul')
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)

  async function charger() {
    const [c, cl, ex, { data: jr }] = await Promise.all([
      compteSequestre(agence), listerClotures(agence), exerciceEnCours(agence),
      supabase.from('sequestre_journal').select('*').eq('agence', agence).order('cree_le', { ascending: false }).limit(200),
    ])
    setCompte(c); setClotures(cl); setExercice(ex); setJournal(jr || [])
  }
  useEffect(() => { charger().catch(e => setMsg({ err: e.message })) }, [agence])

  const auteur = async () => (await supabase.auth.getUser()).data?.user?.email || null
  async function action(cle, fn, ok) {
    setBusy(cle); setMsg(null)
    try { const r = await fn(); setMsg({ ok: ok(r) }); await charger(); onChange?.() }
    catch (e) { setMsg({ err: e.message }) }
    setBusy(null)
  }

  if (!compte) return null
  const moisCourant = new Date().toISOString().slice(0, 7)
  const mois = []
  for (let m = compte.mois_debut; m < moisCourant; m = moisPlus(m, 1)) mois.push(m)
  const prochain = mois.find(m => !clotures.some(c => c.mois === m && c.verrouille))
  const dernierClos = [...clotures].filter(c => c.verrouille).sort((a, b) => b.mois.localeCompare(a.mois))[0]

  const th = { textAlign: 'left', padding: '7px 10px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', background: 'var(--header-bg)' }
  const td = { padding: '6px 10px', borderTop: '1px solid #F3EFE6', fontSize: 13 }
  const r = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
  const lignesJournal = journal.filter(l => filtre === 'tout' || (filtre === 'sans_calcul' ? l.type !== 'calcul' : l.type === filtre))

  return (
    <div style={{ marginBottom: 22 }}>
      {msg?.err && <div className="alert alert-error" style={{ marginBottom: 8 }}>{msg.err}</div>}
      {msg?.ok && <div className="alert alert-success" style={{ marginBottom: 8 }}>{msg.ok}</div>}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 420px', background: '#fff', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 14 }}>Clôtures</strong>
            {exercice && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Exercice {fmtD(exercice.debut)} → {fmtD(exercice.fin)} · ouverture {eur(exercice.solde_ouverture)}</span>}
            {exercice && exercice.fin < new Date().toISOString().slice(0, 10) && (
              <button className="btn btn-primary" style={{ marginLeft: 'auto', fontSize: 12 }} disabled={!!busy}
                onClick={() => { const note = window.prompt('Note de clôture d\'exercice (facultatif) :') ?? null
                  action('exercice', async () => cloturerExercice(agence, { auteur: await auteur(), note }), x => `Exercice clôturé (écart ${eur(x.ecart)}) ; exercice suivant ouvert le ${fmtD(x.suivant.debut)}`) }}>
                Clôturer l'exercice
              </button>)}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Mois</th><th style={th}>Statut</th><th style={{ ...th, textAlign: 'right' }}>Écart figé</th><th style={th} /></tr></thead>
            <tbody>
              {mois.map(m => {
                const c = clotures.find(x => x.mois === m)
                const clos = c?.verrouille
                return (
                  <tr key={m}>
                    <td style={td}>{moisLabel(m)}</td>
                    <td style={{ ...td, fontSize: 12 }}>{clos
                      ? <span style={{ color: '#15803D' }}>✓ clôturé le {fmtD(c.verrouille_le)}{c.verrouille_par ? ` · ${c.verrouille_par.split('@')[0]}` : ''}</span>
                      : <span style={{ color: 'var(--text-muted)' }}>{c ? 'rouvert' : 'ouvert'}</span>}</td>
                    <td style={{ ...r, color: clos && Math.abs(c.ecart) > 100 ? '#B91C1C' : undefined }}>{clos ? eur(c.ecart) : ''}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {!clos && m === prochain && <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={!!busy}
                        onClick={() => action(m, async () => {
                          try { return await cloturerMois(agence, m, { auteur: await auteur() }) }
                          catch (e) {
                            if (!/forcer/.test(e.message)) throw e
                            const note = window.prompt(`${e.message}\n\nMotif pour clôturer quand même :`)
                            if (!note) throw e
                            return await cloturerMois(agence, m, { auteur: await auteur(), forcer: true, note })
                          }
                        }, x => `${moisLabel(m)} clôturé — écart figé ${eur(x.ecart)}`)}>
                        {busy === m ? '⏳ Calcul…' : 'Clôturer'}</button>}
                      {clos && c.mois === dernierClos?.mois && <button className="btn" style={{ fontSize: 12 }} disabled={!!busy}
                        onClick={() => { const motif = window.prompt(`Rouvrir ${moisLabel(m)} — motif :`); if (motif) action(`r${m}`, async () => rouvrirMois(agence, m, { auteur: await auteur(), motif }), () => `${moisLabel(m)} rouvert`) }}>
                        Rouvrir</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 14px', lineHeight: 1.5 }}>
            Clôturer fige le justificatif au dernier jour du mois et verrouille les affectations de ce mois. Chaque nuit, les 3 derniers mois clôturés sont recalculés à leur date d'arrêté : toute donnée modifiée après coup apparaît en « dérive » dans le journal et dans l'alerte mail.
          </div>
        </div>

        <div style={{ flex: '2 1 520px', background: '#fff', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <strong style={{ fontSize: 14 }}>Journal</strong>
            <select className="input" value={filtre} onChange={e => setFiltre(e.target.value)} style={{ marginLeft: 'auto', fontSize: 12, width: 200 }}>
              <option value="sans_calcul">Événements (sans calculs)</option>
              <option value="tout">Tout</option>
              {Object.entries(TYPES).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div style={{ maxHeight: 460, overflow: 'auto' }}>
            {!lignesJournal.length && <div style={{ padding: 14, fontSize: 13, color: 'var(--text-muted)' }}>Rien pour l'instant — le journal se remplit à chaque calcul de nuit, affectation et clôture.</div>}
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>{lignesJournal.map(l => {
                const [lib, col] = TYPES[l.type] || [l.type, '#6B7280']
                return <tr key={l.id}>
                  <td style={{ ...td, whiteSpace: 'nowrap', fontSize: 11, color: 'var(--text-muted)', width: 96 }}>{fmtDT(l.cree_le)}</td>
                  <td style={{ ...td, width: 92 }}><span style={{ fontSize: 11, fontWeight: 600, color: col, border: `1px solid ${col}`, borderRadius: 99, padding: '1px 7px', whiteSpace: 'nowrap' }}>{lib}</span></td>
                  <td style={{ ...td, fontSize: 12 }}>{l.message}{l.auteur && l.auteur !== 'cron' && l.auteur !== 'trigger' ? <span style={{ color: 'var(--text-muted)' }}> · {l.auteur.split('@')[0]}</span> : null}</td>
                </tr>
              })}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
