import { useState, useEffect, useCallback } from 'react'
import MoisSelector, { MOIS_FR } from '../components/MoisSelector'
import { supabase } from '../lib/supabase'
import {
  getBienNote, saveBienNote,
  genererRapportHTML, envoyerRapportEmail
} from '../services/rapportProprietaire'

const moisCourant = new Date().toISOString().substring(0, 7)

const STATUTS_NON_VENTILABLES = ['cancelled', 'not_accepted', 'not accepted', 'declined', 'expired']

const fmt = c => ((c || 0) / 100).toFixed(2).replace('.', ',') + ' €'

export default function PageRapports() {
  const [mois, setMois] = useState(moisCourant)
  const [moisDispos, setMoisDispos] = useState([moisCourant])
  const [proprietaires, setProprietaires] = useState([])
  const [selectedPropId, setSelectedPropId] = useState('')
  const [selectedBienId, setSelectedBienId] = useState('')
  const [data, setData] = useState(null)
  const [note, setNote] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [statut, setStatut] = useState('idle') // idle | sending | sent | error
  const [previewOpen, setPreviewOpen] = useState(false)

  // Chargement initial : proprietaires + mois disponibles
  useEffect(() => {
    supabase
      .from('proprietaire')
      .select('id, nom, email, bien(id, hospitable_name, actif, agence)')
      .eq('actif', true)
      .order('nom')
      .then(({ data: props }) => {
        setProprietaires(props || [])
        if (props?.length) setSelectedPropId(props[0].id)
      })

    supabase.from('reservation').select('mois_comptable').then(({ data: res }) => {
      if (res) {
        const uniq = [...new Set(res.map(d => d.mois_comptable).filter(Boolean))].sort((a, b) => b.localeCompare(a))
        if (uniq.length) setMoisDispos(uniq)
      }
    })
  }, [])

  // Auto-select bien quand proprio change
  useEffect(() => {
    if (!selectedPropId) return
    const proprio = proprietaires.find(p => p.id === selectedPropId)
    const biens = (proprio?.bien || []).filter(b => b.actif && b.agence === 'dcb')
    if (biens.length === 1) {
      setSelectedBienId(biens[0].id)
    } else {
      setSelectedBienId(biens[0]?.id || '')
    }
    setData(null)
    setNote('')
    setStatut('idle')
    setPreviewOpen(false)
  }, [selectedPropId, proprietaires])

  // Reset data quand mois change
  useEffect(() => {
    setData(null)
    setStatut('idle')
    setPreviewOpen(false)
  }, [mois])

  const charger = useCallback(async () => {
    if (!selectedBienId || !selectedPropId) return
    setLoading(true)
    setError(null)
    try {
      const proprio = proprietaires.find(p => p.id === selectedPropId)
      setEmail(proprio?.email || '')

      // Réservations du bien ce mois
      const { data: resas, error: resasErr } = await supabase
        .from('reservation')
        .select('id, code, fin_revenue, nights, arrival_date, departure_date, final_status, platform, guest_name, bien:bien_id(hospitable_name, code)')
        .eq('bien_id', selectedBienId)
        .eq('mois_comptable', mois)
        .order('arrival_date')
      if (resasErr) throw new Error(resasErr.message)

      const resasValides = (resas || []).filter(r => !STATUTS_NON_VENTILABLES.includes(r.final_status))
      const resaIds = resasValides.map(r => r.id)

      // Ventilation LOY pour ces réservations
      let loyTotal = 0
      if (resaIds.length) {
        const { data: vents } = await supabase
          .from('ventilation')
          .select('montant_ht, code, reservation_id')
          .in('reservation_id', resaIds)
          .eq('code', 'LOY')
        loyTotal = (vents || []).reduce((s, v) => s + (v.montant_ht || 0), 0)
      }

      // Avis liés à ces réservations
      let reviews = []
      if (resaIds.length) {
        const { data: revData } = await supabase
          .from('reservation_review')
          .select('id, reviewer_name, rating, comment, submitted_at, reservation:reservation_id(code, bien_id, arrival_date, bien:bien_id(hospitable_name))')
          .in('reservation_id', resaIds)
          .order('submitted_at', { ascending: false })
        reviews = revData || []
      }

      // Note de marché
      const noteVal = await getBienNote(selectedBienId, mois)
      setNote(noteVal)

      // Facture honoraires (badge)
      const { data: facture } = await supabase
        .from('facture_evoliz')
        .select('id, id_evoliz, statut')
        .eq('proprietaire_id', selectedPropId)
        .eq('mois', mois)
        .eq('type_facture', 'honoraires')
        .maybeSingle()

      // KPIs inline
      const nbResas = resasValides.length
      const caHeb = resasValides.reduce((s, r) => s + (r.fin_revenue || 0), 0)
      const durees = resasValides.map(r => r.nights || 0).filter(v => v > 0)
      const nuitsOccupees = durees.reduce((s, v) => s + v, 0)
      const dureeMoy = durees.length ? (durees.reduce((s, v) => s + v, 0) / durees.length).toFixed(1) : '0'
      const [y, m] = mois.split('-').map(Number)
      const nuitsDispos = new Date(y, m, 0).getDate()
      const tauxOcc = nuitsDispos > 0 ? Math.round((nuitsOccupees / nuitsDispos) * 100) : 0

      setData({
        proprio,
        bien: (proprio?.bien || []).find(b => b.id === selectedBienId),
        resas: resasValides,
        reviews,
        facture,
        kpis: { nbResas, caHeb, nuitsOccupees, nuitsDispos, tauxOcc, dureeMoy, loyTotal },
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [selectedBienId, selectedPropId, mois, proprietaires])

  useEffect(() => { charger() }, [charger])

  async function handleNoteBlur() {
    try { await saveBienNote(selectedBienId, mois, note) } catch (e) { console.error(e) }
  }

  async function handleEmailBlur() {
    const val = email.trim()
    try {
      await supabase.from('proprietaire').update({ email: val || null }).eq('id', selectedPropId)
    } catch (e) { console.error('saveEmail:', e) }
  }

  async function envoyer() {
    if (!data) return
    setStatut('sending')
    try {
      const html = genererRapportHTML(
        data.proprio,
        mois,
        {
          kpis: data.kpis,
          resas: data.resas,
          reviews: data.reviews,
          notes: [{ bienName: data.bien?.hospitable_name, note }],
        }
      )
      await envoyerRapportEmail({ ...data.proprio, email }, mois, html)
      setStatut('sent')
    } catch (e) {
      console.error(e)
      setStatut('error')
    }
  }

  const proprio = proprietaires.find(p => p.id === selectedPropId)
  const biensActifs = (proprio?.bien || []).filter(b => b.actif && b.agence === 'dcb')
  const [year, monthIdx] = mois.split('-')
  const moisLabel = MOIS_FR[parseInt(monthIdx) - 1] + ' ' + year

  const STATUT_STYLES = {
    idle:    { label: 'Non envoyé', color: '#9C8E7D', bg: '#F0EBE1' },
    sending: { label: 'Envoi…',     color: '#D97706', bg: '#FEF3C7' },
    sent:    { label: 'Envoyé ✓',   color: '#059669', bg: '#D1FAE5' },
    error:   { label: 'Erreur',     color: '#DC2626', bg: '#FEE2E2' },
  }
  const st = STATUT_STYLES[statut]

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1000 }}>
      {/* En-tête */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '1.4em', fontWeight: 700, color: 'var(--text)', flex: 1 }}>
          Rapports propriétaires
        </h1>
        <MoisSelector mois={mois} setMois={setMois} moisDispos={moisDispos} />
      </div>

      {/* Sélecteurs proprio + bien */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={selectedPropId}
          onChange={e => setSelectedPropId(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: '0.95em', background: '#fff', color: 'var(--text)', minWidth: 200 }}
        >
          {proprietaires.map(p => (
            <option key={p.id} value={p.id}>{p.nom}</option>
          ))}
        </select>

        {biensActifs.length > 1 && (
          <select
            value={selectedBienId}
            onChange={e => setSelectedBienId(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: '0.95em', background: '#fff', color: 'var(--text)', minWidth: 200 }}
          >
            {biensActifs.map(b => (
              <option key={b.id} value={b.id}>{b.hospitable_name}</option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <div style={{ background: '#FEE2E2', color: '#DC2626', padding: '10px 14px', borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}
      {loading && <div style={{ color: '#9C8E7D', marginBottom: 16 }}>Chargement…</div>}

      {data && (
        <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          {/* Titre bien */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', background: '#EAE3D4', borderBottom: '2px solid var(--brand)', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: '1.05em', flex: 1 }}>
              {data.bien?.hospitable_name || proprio?.nom} — {moisLabel}
            </span>
            {data.facture && (
              <span style={{
                padding: '3px 10px', borderRadius: 20, fontSize: '0.78em', fontWeight: 600,
                background: data.facture.id_evoliz ? '#D1FAE5' : '#FEF3C7',
                color: data.facture.id_evoliz ? '#059669' : '#D97706',
              }}>
                Facture {data.facture.id_evoliz ? '✓ Evoliz' : '⏳ en attente'}
              </span>
            )}
            <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: '0.8em', fontWeight: 600, background: st.bg, color: st.color }}>
              {st.label}
            </span>
          </div>

          <div style={{ padding: '20px' }}>
            {/* KPI cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 24 }}>
              {[
                { val: data.kpis.nbResas, lbl: 'Réservations' },
                { val: fmt(data.kpis.caHeb), lbl: 'CA Hébergement' },
                { val: fmt(data.kpis.loyTotal), lbl: 'Reversement' },
                { val: `${data.kpis.nuitsOccupees}/${data.kpis.nuitsDispos}`, lbl: 'Nuits occ./dispo.' },
                { val: `${data.kpis.tauxOcc} %`, lbl: "Taux d'occupation" },
                { val: `${data.kpis.dureeMoy} nuits`, lbl: 'Durée moyenne' },
              ].map(({ val, lbl }) => (
                <div key={lbl} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.2em', fontWeight: 700, color: 'var(--text)' }}>{val}</div>
                  <div style={{ fontSize: '0.72em', color: '#9C8E7D', marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.5 }}>{lbl}</div>
                </div>
              ))}
            </div>

            {/* Table réservations */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: '0.8em', fontWeight: 600, color: '#9C8E7D', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Réservations ({data.resas.length})
              </div>
              {data.resas.length > 0 ? (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88em' }}>
                  <thead>
                    <tr style={{ background: '#EAE3D4', color: 'var(--text)' }}>
                      <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '2px solid var(--brand)' }}>Code</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '2px solid var(--brand)' }}>Voyageur</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '2px solid var(--brand)' }}>Arrivée</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right', borderBottom: '2px solid var(--brand)' }}>Nuits</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right', borderBottom: '2px solid var(--brand)' }}>CA HEB</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.resas.map((r, i) => (
                      <tr key={r.id} style={{ background: i % 2 === 0 ? '#FDFAF4' : '#F7F3EC' }}>
                        <td style={{ padding: '7px 10px', color: '#9C8E7D', fontFamily: 'monospace' }}>{r.code}</td>
                        <td style={{ padding: '7px 10px', color: 'var(--text)' }}>{r.guest_name || '—'}</td>
                        <td style={{ padding: '7px 10px', color: '#4A3728' }}>{r.arrival_date || '—'}</td>
                        <td style={{ padding: '7px 10px', textAlign: 'right', color: '#4A3728' }}>{r.nights || '—'}</td>
                        <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 600, color: 'var(--text)' }}>{fmt(r.fin_revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p style={{ color: '#9C8E7D', fontStyle: 'italic', fontSize: '0.88em' }}>Aucune réservation ce mois.</p>
              )}
            </div>

            {/* Avis */}
            {data.reviews.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: '0.8em', fontWeight: 600, color: '#9C8E7D', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Avis reçus ({data.reviews.length})
                </div>
                {data.reviews.slice(0, 5).map(r => (
                  <div key={r.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', borderTop: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--brand)', fontSize: '1em', whiteSpace: 'nowrap' }}>{'★'.repeat(Math.round(r.rating || 0))}</span>
                    <span style={{ fontSize: '0.85em', color: '#4A3728', fontStyle: 'italic', flex: 1 }}>
                      "{r.comment?.substring(0, 120)}{r.comment?.length > 120 ? '…' : ''}"
                    </span>
                    <span style={{ fontSize: '0.78em', color: '#9C8E7D', whiteSpace: 'nowrap' }}>{r.reviewer_name || ''}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Note de marché */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: '0.82em', fontWeight: 600, color: 'var(--brand)', display: 'block', marginBottom: 6 }}>
                Note de marché
              </label>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                onBlur={handleNoteBlur}
                placeholder="Commentaire sur le marché, la saison, les tendances…"
                rows={3}
                style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', fontSize: '0.88em', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical', fontFamily: 'inherit' }}
              />
            </div>

            {/* Email + actions */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onBlur={handleEmailBlur}
                placeholder="Email propriétaire"
                style={{
                  flex: 1, minWidth: 220, fontSize: '0.88em', padding: '8px 10px',
                  border: `1px solid ${email ? '#059669' : '#D97706'}`,
                  borderRadius: 6,
                  background: email ? '#F0FDF4' : '#FFFBEB',
                  color: 'var(--text)', outline: 'none',
                }}
              />
              <button
                className="btn btn-secondary"
                style={{ fontSize: '0.85em', padding: '8px 14px' }}
                onClick={() => setPreviewOpen(true)}
              >
                Aperçu
              </button>
              <button
                className="btn btn-primary"
                style={{ fontSize: '0.85em', padding: '8px 14px', background: 'var(--brand)', color: '#fff', border: 'none', opacity: statut === 'sending' ? 0.6 : 1 }}
                onClick={envoyer}
                disabled={statut === 'sending' || !email}
              >
                {statut === 'sending' ? '…' : 'Envoyer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal aperçu */}
      {previewOpen && data && (() => {
        const html = genererRapportHTML(
          data.proprio,
          mois,
          {
            kpis: data.kpis,
            resas: data.resas,
            reviews: data.reviews,
            notes: [{ bienName: data.bien?.hospitable_name, note }],
          }
        )
        return (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(44,36,22,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
            onClick={() => setPreviewOpen(false)}
          >
            <div
              style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 740, height: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
              onClick={e => e.stopPropagation()}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', background: '#EAE3D4', borderBottom: '2px solid var(--brand)' }}>
                <span style={{ fontWeight: 700, color: 'var(--text)' }}>
                  Aperçu — {data.bien?.hospitable_name || data.proprio?.nom} — {moisLabel}
                </span>
                <button onClick={() => setPreviewOpen(false)} style={{ background: 'none', border: 'none', fontSize: '1.3em', cursor: 'pointer', color: 'var(--text)' }}>✕</button>
              </div>
              <iframe srcDoc={html} style={{ flex: 1, border: 'none', width: '100%' }} title="Aperçu rapport" />
            </div>
          </div>
        )
      })()}
    </div>
  )
}
