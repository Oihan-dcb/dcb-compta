import { useState, useEffect, useCallback } from 'react'
import MoisSelector, { MOIS_FR } from '../components/MoisSelector'
import { supabase } from '../lib/supabase'
import {
  genererRapportHTML, envoyerRapportEmail
} from '../services/rapportProprietaire'

const moisCourant = new Date().toISOString().substring(0, 7)
const STATUTS_NON_VENTILABLES = ['cancelled', 'not_accepted', 'not accepted', 'declined', 'expired']
const fmt = c => ((c || 0) / 100).toFixed(2).replace('.', ',') + ' €'

const PLATFORM_COLORS = {
  airbnb:  { bg: '#FFE8E3', color: '#D9452A', label: 'Airbnb' },
  booking: { bg: '#EAE3D4', color: '#4A3728', label: 'Booking' },
  stripe:  { bg: '#E8F0E8', color: '#2C6E2C', label: 'Stripe' },
  direct:  { bg: '#D1FAE5', color: '#059669', label: 'Direct' },
}

function PlatformBadge({ platform }) {
  const p = (platform || '').toLowerCase()
  const cfg = PLATFORM_COLORS[p] || { bg: '#F0EBE1', color: '#9C8E7D', label: platform || '—' }
  return (
    <span style={{ padding: '2px 7px', borderRadius: 10, fontSize: '0.75em', fontWeight: 600, background: cfg.bg, color: cfg.color }}>
      {cfg.label}
    </span>
  )
}

function prevYear(mois) {
  const [y, m] = mois.split('-')
  return `${parseInt(y) - 1}-${m}`
}

export default function PageRapports() {
  const [mois, setMois] = useState(moisCourant)
  const [moisDispos, setMoisDispos] = useState([moisCourant])
  const [proprietaires, setProprietaires] = useState([])
  const [selectedPropId, setSelectedPropId] = useState('')
  const [selectedBienId, setSelectedBienId] = useState('')
  const [data, setData] = useState(null)
  const [note, setNote] = useState('')
  const [noteReco, setNoteReco] = useState('')
  const [llmAnalyse, setLlmAnalyse] = useState('')
  const [vueSynthese, setVueSynthese] = useState(false)
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [statut, setStatut] = useState('idle')
  const [previewOpen, setPreviewOpen] = useState(false)

  useEffect(() => {
    supabase
      .from('proprietaire')
      .select('id, nom, email, bien(id, hospitable_name, listed, agence)')
      .eq('actif', true)
      .order('nom')
      .then(({ data: props }) => {
        setProprietaires(props || [])
        if (props?.length) setSelectedPropId(props[0].id)
      })

    supabase.from('reservation').select('mois_comptable').then(({ data: res }) => {
      const [cy, cm] = moisCourant.split('-').map(Number)
      const thisYearMonths = Array.from({ length: cm }, (_, i) =>
        `${cy}-${String(i + 1).padStart(2, '0')}`)
      const uniq = [...new Set([...thisYearMonths, ...(res || []).map(d => d.mois_comptable).filter(Boolean)])]
        .sort((a, b) => b.localeCompare(a))
      setMoisDispos(uniq)
    })
  }, [])

  useEffect(() => {
    if (!selectedPropId) return
    const proprio = proprietaires.find(p => p.id === selectedPropId)
    const biens = (proprio?.bien || []).filter(b => b.listed && b.agence === 'dcb')
    setSelectedBienId(biens[0]?.id || '')
    setData(null)
    setNote('')
    setNoteReco('')
    setLlmAnalyse('')
    setStatut('idle')
    setPreviewOpen(false)
  }, [selectedPropId, proprietaires])

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

      const moisN1 = prevYear(mois)
      const [y, m] = mois.split('-').map(Number)
      const nuitsDispos = new Date(y, m, 0).getDate()

      const [
        { data: resas, error: resasErr },
        { data: resasN1 },
        { data: fraisData },
        noteMarche,
        noteRecoVal,
        noteLlmVal,
        { data: facture },
      ] = await Promise.all([
        supabase
          .from('reservation')
          .select('id, code, fin_revenue, fin_accommodation, nights, arrival_date, departure_date, final_status, platform, guest_name, bien:bien_id(hospitable_name, code)')
          .eq('bien_id', selectedBienId)
          .eq('mois_comptable', mois)
          .order('arrival_date'),
        supabase
          .from('reservation')
          .select('id, fin_revenue, nights, final_status')
          .eq('bien_id', selectedBienId)
          .eq('mois_comptable', moisN1)
          .neq('final_status', 'cancelled'),
        supabase
          .from('frais_proprietaire')
          .select('id, libelle, montant_ttc, statut')
          .eq('bien_id', selectedBienId)
          .eq('mois_facturation', mois),
        supabase.from('bien_notes').select('note_marche')
          .eq('bien_id', selectedBienId).eq('mois', mois).maybeSingle()
          .then(r => r.data?.note_marche || ''),
        supabase.from('bien_notes').select('note_recommandations')
          .eq('bien_id', selectedBienId).eq('mois', mois).maybeSingle()
          .then(r => r.data?.note_recommandations || ''),
        supabase.from('bien_notes').select('note_analyse_llm')
          .eq('bien_id', selectedBienId).eq('mois', mois).maybeSingle()
          .then(r => r.data?.note_analyse_llm || ''),
        supabase.from('facture_evoliz').select('id, id_evoliz, statut')
          .eq('proprietaire_id', selectedPropId).eq('mois', mois).eq('type_facture', 'honoraires').maybeSingle(),
      ])

      if (resasErr) throw new Error(resasErr.message)

      setNote(noteMarche)
      setNoteReco(noteRecoVal)
      setLlmAnalyse(noteLlmVal)

      const resasValides = (resas || []).filter(r => !STATUTS_NON_VENTILABLES.includes(r.final_status))
      const resaIds = resasValides.map(r => r.id)

      let loyTotal = 0
      let ventByResa = {}
      if (resaIds.length) {
        const { data: vents } = await supabase
          .from('ventilation')
          .select('reservation_id, code, montant_ht, montant_ttc')
          .in('reservation_id', resaIds)
          .in('code', ['HON', 'LOY', 'VIR', 'FMEN'])
        for (const v of vents || []) {
          if (!ventByResa[v.reservation_id]) ventByResa[v.reservation_id] = {}
          ventByResa[v.reservation_id][v.code] = v
        }
        loyTotal = (vents || []).filter(v => v.code === 'LOY').reduce((s, v) => s + (v.montant_ht || 0), 0)
      }

      let reviews = []
      if (resaIds.length) {
        const { data: revData } = await supabase
          .from('reservation_review')
          .select('id, reviewer_name, rating, comment, submitted_at')
          .in('reservation_id', resaIds)
          .order('submitted_at', { ascending: false })
        reviews = revData || []
      }

      const nbResas = resasValides.length
      const caHeb = resasValides.reduce((s, r) => s + (r.fin_revenue || 0), 0)
      const durees = resasValides.map(r => r.nights || 0).filter(v => v > 0)
      const nuitsOccupees = durees.reduce((s, v) => s + v, 0)
      const dureeMoy = durees.length ? (durees.reduce((s, v) => s + v, 0) / durees.length).toFixed(1) : '0'
      const tauxOcc = nuitsDispos > 0 ? Math.round((nuitsOccupees / nuitsDispos) * 100) : 0

      const resaN1Valid = resasN1 || []
      const caHebN1 = resaN1Valid.reduce((s, r) => s + (r.fin_revenue || 0), 0)
      const nuitesN1 = resaN1Valid.map(r => r.nights || 0).filter(v => v > 0)
      const nuitsOccN1 = nuitesN1.reduce((s, v) => s + v, 0)
      const tauxOccN1 = nuitsDispos > 0 ? Math.round((nuitsOccN1 / nuitsDispos) * 100) : 0
      const kpisN1 = { nbResas: resaN1Valid.length, caHeb: caHebN1, nuitsOccupees: nuitsOccN1, tauxOcc: tauxOccN1 }

      const alertes = []
      if (tauxOcc < 50 && nbResas > 0) alertes.push({ type: 'warn', msg: `Taux d'occupation faible (${tauxOcc} %)` })
      if (reviews.length === 0 && nbResas > 0) alertes.push({ type: 'info', msg: 'Aucun avis reçu ce mois' })
      if (!proprio?.email) alertes.push({ type: 'warn', msg: 'Email propriétaire manquant' })
      if (caHebN1 > 0 && caHeb < caHebN1 * 0.8) alertes.push({ type: 'warn', msg: `CA en baisse vs N-1 (${fmt(caHeb)} vs ${fmt(caHebN1)})` })

      setData({
        proprio,
        bien: (proprio?.bien || []).find(b => b.id === selectedBienId),
        resas: resasValides.map(r => ({ ...r, vent: ventByResa[r.id] || {} })),
        reviews,
        facture,
        frais: fraisData || [],
        kpis: { nbResas, caHeb, nuitsOccupees, nuitsDispos, tauxOcc, dureeMoy, loyTotal },
        kpisN1,
        alertes,
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [selectedBienId, selectedPropId, mois, proprietaires])

  useEffect(() => { charger() }, [charger])

  async function handleNoteBlur() {
    try {
      await supabase.from('bien_notes').upsert(
        { bien_id: selectedBienId, mois, note_marche: note, updated_at: new Date().toISOString() },
        { onConflict: 'bien_id,mois' }
      )
    } catch (e) { console.error(e) }
  }

  async function handleNoteRecoBlur() {
    try {
      await supabase.from('bien_notes').upsert(
        { bien_id: selectedBienId, mois, note_recommandations: noteReco, updated_at: new Date().toISOString() },
        { onConflict: 'bien_id,mois' }
      )
    } catch (e) { console.error(e) }
  }

  async function handleLlmBlur() {
    try {
      await supabase.from('bien_notes').upsert(
        { bien_id: selectedBienId, mois, note_analyse_llm: llmAnalyse, updated_at: new Date().toISOString() },
        { onConflict: 'bien_id,mois' }
      )
    } catch (e) { console.error(e) }
  }

  async function handleEmailBlur() {
    const val = email.trim()
    try {
      await supabase.from('proprietaire').update({ email: val || null }).eq('id', selectedPropId)
    } catch (e) { console.error('saveEmail:', e) }
  }

  async function lancerAnalyseLLM() {
    if (!data) return
    const [yr, mo] = mois.split('-')
    const moisLabel = MOIS_FR[parseInt(mo) - 1] + ' ' + yr
    const noteMoy = data.reviews.length
      ? (data.reviews.reduce((s, r) => s + (r.rating || 0), 0) / data.reviews.length).toFixed(1)
      : 'N/A'
    const prompt = `Tu es consultant en location saisonnière haut de gamme. Analyse ces données pour "${data.bien?.hospitable_name}" (${moisLabel}) :
- Réservations : ${data.kpis.nbResas} (N-1 : ${data.kpisN1?.nbResas ?? '?'})
- CA hébergement : ${fmt(data.kpis.caHeb)} (N-1 : ${fmt(data.kpisN1?.caHeb ?? 0)})
- Taux occupation : ${data.kpis.tauxOcc}% (N-1 : ${data.kpisN1?.tauxOcc ?? '?'}%)
- Avis : ${data.reviews.length} ce mois, note moyenne ${noteMoy}/5
Fournis une analyse concise (5-8 lignes) : performance du mois, comparatif N-1, points forts/faibles, 2-3 recommandations actionnables.`
    try {
      const { data: llmData, error: llmErr } = await Promise.race([
        supabase.functions.invoke('llm-analyse', { body: { prompt } }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000)),
      ])
      if (llmErr) throw llmErr
      const txt = llmData?.text || ''
      if (txt) {
        setLlmAnalyse(txt)
        await supabase.from('bien_notes').upsert(
          { bien_id: selectedBienId, mois, note_analyse_llm: txt, updated_at: new Date().toISOString() },
          { onConflict: 'bien_id,mois' }
        )
      }
    } catch (e) { console.warn('LLM analyse failed:', e.message) }
  }

  async function envoyer() {
    if (!data) return
    setStatut('sending')
    try {
      const html = genererRapportHTML(data.proprio, mois, {
        kpis: data.kpis, resas: data.resas, reviews: data.reviews,
        notes: [{ bienName: data.bien?.hospitable_name, note }],
      })
      await envoyerRapportEmail({ ...data.proprio, email }, mois, html)
      setStatut('sent')
    } catch (e) { console.error(e); setStatut('error') }
  }

  const proprio = proprietaires.find(p => p.id === selectedPropId)
  const biensActifs = (proprio?.bien || []).filter(b => b.listed && b.agence === 'dcb')
  const [year, monthIdx] = mois.split('-')
  const moisLabel = MOIS_FR[parseInt(monthIdx) - 1] + ' ' + year

  const STATUT_STYLES = {
    idle:    { label: 'Non envoyé', color: '#9C8E7D', bg: '#F0EBE1' },
    sending: { label: 'Envoi…',     color: '#D97706', bg: '#FEF3C7' },
    sent:    { label: 'Envoyé ✓',   color: '#059669', bg: '#D1FAE5' },
    error:   { label: 'Erreur',     color: '#DC2626', bg: '#FEE2E2' },
  }
  const st = STATUT_STYLES[statut]

  function DeltaBadge({ rawN, rawN1 }) {
    if (rawN1 === undefined || rawN1 === null) return null
    const delta = Math.round(((rawN - rawN1) / (rawN1 || 1)) * 100)
    const pos = delta >= 0
    return (
      <span style={{ fontSize: '0.68em', marginLeft: 4, color: pos ? '#059669' : '#DC2626', fontWeight: 600 }}>
        {pos ? '▲' : '▼'}{Math.abs(delta)}%
      </span>
    )
  }

  const kpiCards = !data ? [] : [
    { val: data.kpis.nbResas,             lbl: 'Réservations',      rawN: data.kpis.nbResas,       rawN1: data.kpisN1.nbResas,      dispN1: data.kpisN1.nbResas },
    { val: fmt(data.kpis.caHeb),          lbl: 'CA Hébergement',    rawN: data.kpis.caHeb,         rawN1: data.kpisN1.caHeb,        dispN1: fmt(data.kpisN1.caHeb) },
    { val: fmt(data.kpis.loyTotal),       lbl: 'Reversement',       rawN: null,                    rawN1: null,                     dispN1: null },
    { val: `${data.kpis.nuitsOccupees}/${data.kpis.nuitsDispos}`, lbl: 'Nuits occ./dispo.', rawN: data.kpis.nuitsOccupees, rawN1: data.kpisN1.nuitsOccupees, dispN1: data.kpisN1.nuitsOccupees },
    { val: `${data.kpis.tauxOcc} %`,      lbl: "Taux d'occupation", rawN: data.kpis.tauxOcc,       rawN1: data.kpisN1.tauxOcc,      dispN1: `${data.kpisN1.tauxOcc} %` },
    { val: `${data.kpis.dureeMoy} nuits`, lbl: 'Durée moyenne',     rawN: null,                    rawN1: null,                     dispN1: null },
  ]

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1000 }}>
      {/* En-tête */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '1.4em', fontWeight: 700, color: 'var(--text)', flex: 1 }}>
          Rapports propriétaires
        </h1>
        {data && (
          <button onClick={() => setVueSynthese(v => !v)} style={{
            padding: '6px 14px', border: '1px solid var(--border)', borderRadius: 20,
            background: vueSynthese ? 'var(--brand)' : '#fff',
            color: vueSynthese ? '#fff' : 'var(--text)', fontSize: '0.82em', cursor: 'pointer', fontWeight: 600,
          }}>
            {vueSynthese ? 'Vue détaillée' : 'Vue synthèse'}
          </button>
        )}
        <MoisSelector mois={mois} setMois={setMois} moisDispos={moisDispos} />
      </div>

      {/* Sélecteurs */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={selectedPropId} onChange={e => setSelectedPropId(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: '0.95em', background: '#fff', color: 'var(--text)', minWidth: 200 }}>
          {proprietaires.map(p => <option key={p.id} value={p.id}>{p.nom}</option>)}
        </select>
        {biensActifs.length > 1 && (
          <select value={selectedBienId} onChange={e => setSelectedBienId(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: '0.95em', background: '#fff', color: 'var(--text)', minWidth: 200 }}>
            {biensActifs.map(b => <option key={b.id} value={b.id}>{b.hospitable_name}</option>)}
          </select>
        )}
      </div>

      {error && <div style={{ background: '#FEE2E2', color: '#DC2626', padding: '10px 14px', borderRadius: 8, marginBottom: 16 }}>{error}</div>}
      {loading && <div style={{ color: '#9C8E7D', marginBottom: 16 }}>Chargement…</div>}

      {data && (
        <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          {/* Header card */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', background: '#EAE3D4', borderBottom: '2px solid var(--brand)', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: '1.05em', flex: 1 }}>
              {data.bien?.hospitable_name || proprio?.nom} — {moisLabel}
            </span>
            {data.facture && (
              <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: '0.78em', fontWeight: 600,
                background: data.facture.id_evoliz ? '#D1FAE5' : '#FEF3C7',
                color: data.facture.id_evoliz ? '#059669' : '#D97706' }}>
                Facture {data.facture.id_evoliz ? '✓ Evoliz' : '⏳ en attente'}
              </span>
            )}
            <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: '0.8em', fontWeight: 600, background: st.bg, color: st.color }}>
              {st.label}
            </span>
          </div>

          <div style={{ padding: '20px' }}>
            {/* BLOC 1 — Alertes auto */}
            {data.alertes.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                {data.alertes.map((a, i) => (
                  <span key={i} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    margin: '0 6px 6px 0', padding: '4px 10px', borderRadius: 20, fontSize: '0.8em', fontWeight: 600,
                    background: a.type === 'warn' ? '#FEF3C7' : '#F0EBE1',
                    color: a.type === 'warn' ? '#D97706' : '#4A3728',
                  }}>
                    {a.type === 'warn' ? '⚠' : 'ℹ'} {a.msg}
                  </span>
                ))}
              </div>
            )}

            {/* BLOC 2 — KPIs + delta N-1 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 24 }}>
              {kpiCards.map(({ val, lbl, rawN, rawN1, dispN1 }) => (
                <div key={lbl} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.2em', fontWeight: 700, color: 'var(--text)' }}>
                    {val}{rawN !== null && <DeltaBadge rawN={rawN} rawN1={rawN1} />}
                  </div>
                  <div style={{ fontSize: '0.72em', color: '#9C8E7D', marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.5 }}>{lbl}</div>
                  {!vueSynthese && dispN1 !== null && dispN1 !== undefined && (
                    <div style={{ fontSize: '0.7em', color: '#9C8E7D', marginTop: 2 }}>N-1 : {dispN1}</div>
                  )}
                </div>
              ))}
            </div>

            {/* BLOC 3 — Table réservations avec platform badges */}
            {!vueSynthese && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: '0.8em', fontWeight: 600, color: '#9C8E7D', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Réservations ({data.resas.length})
                </div>
                {data.resas.length > 0 ? (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82em' }}>
                    <thead>
                      <tr style={{ background: '#EAE3D4', color: 'var(--text)' }}>
                        {[
                          { h: 'Code',       right: false },
                          { h: 'Voyageur',   right: false },
                          { h: 'Arrivée',    right: false },
                          { h: 'Plateforme', right: false },
                          { h: 'Nuits',      right: true  },
                          { h: 'Base comm.', right: true  },
                          { h: 'HON',        right: true  },
                          { h: 'LOY',        right: true  },
                          { h: 'VIR',        right: true  },
                          { h: 'EXTRA',      right: true  },
                        ].map(({ h, right }) => (
                          <th key={h} style={{ padding: '7px 8px', textAlign: right ? 'right' : 'left', borderBottom: '2px solid var(--brand)', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.resas.map((r, i) => {
                        const v = r.vent
                        return (
                          <tr key={r.id} style={{ background: i % 2 === 0 ? '#FDFAF4' : '#F7F3EC' }}>
                            <td style={{ padding: '6px 8px', color: '#9C8E7D', fontFamily: 'monospace' }}>{r.code}</td>
                            <td style={{ padding: '6px 8px', color: 'var(--text)' }}>{r.guest_name || '—'}</td>
                            <td style={{ padding: '6px 8px', color: '#4A3728', whiteSpace: 'nowrap' }}>{r.arrival_date || '—'}</td>
                            <td style={{ padding: '6px 8px' }}><PlatformBadge platform={r.platform} /></td>
                            <td style={{ padding: '6px 8px', textAlign: 'right', color: '#4A3728' }}>{r.nights || '—'}</td>
                            <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text)' }}>{fmt(r.fin_revenue)}</td>
                            <td style={{ padding: '6px 8px', textAlign: 'right', color: '#D97706' }}>{v.HON  ? fmt(v.HON.montant_ttc)  : '—'}</td>
                            <td style={{ padding: '6px 8px', textAlign: 'right', color: '#059669', fontWeight: 600 }}>{v.LOY  ? fmt(v.LOY.montant_ht)   : '—'}</td>
                            <td style={{ padding: '6px 8px', textAlign: 'right', color: '#4A3728' }}>{v.VIR  ? fmt(v.VIR.montant_ht)   : '—'}</td>
                            <td style={{ padding: '6px 8px', textAlign: 'right', color: '#9C8E7D' }}>{v.FMEN ? fmt(v.FMEN.montant_ttc) : '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                ) : (
                  <p style={{ color: '#9C8E7D', fontStyle: 'italic', fontSize: '0.88em' }}>Aucune réservation ce mois.</p>
                )}
              </div>
            )}

            {/* BLOC 4 — Avis voyageurs */}
            {!vueSynthese && data.reviews.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: '0.8em', fontWeight: 600, color: '#9C8E7D', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Avis reçus ({data.reviews.length}) — Moyenne {(data.reviews.reduce((s, r) => s + (r.rating || 0), 0) / data.reviews.length).toFixed(1)}/5
                </div>
                {data.reviews.slice(0, 5).map(r => (
                  <div key={r.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', borderTop: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--brand)', whiteSpace: 'nowrap' }}>{'★'.repeat(Math.round(r.rating || 0))}</span>
                    <span style={{ fontSize: '0.85em', color: '#4A3728', fontStyle: 'italic', flex: 1 }}>
                      "{r.comment?.substring(0, 120)}{r.comment?.length > 120 ? '…' : ''}"
                    </span>
                    <span style={{ fontSize: '0.78em', color: '#9C8E7D', whiteSpace: 'nowrap' }}>{r.reviewer_name || ''}</span>
                  </div>
                ))}
              </div>
            )}

            {/* BLOC 5 — Frais & ajustements */}
            {!vueSynthese && data.frais.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: '0.8em', fontWeight: 600, color: '#9C8E7D', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Frais & ajustements ({data.frais.length})
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88em' }}>
                  <thead>
                    <tr style={{ background: '#EAE3D4', color: 'var(--text)' }}>
                      <th style={{ padding: '7px 10px', textAlign: 'left', borderBottom: '2px solid var(--brand)' }}>Libellé</th>
                      <th style={{ padding: '7px 10px', textAlign: 'right', borderBottom: '2px solid var(--brand)' }}>Montant TTC</th>
                      <th style={{ padding: '7px 10px', textAlign: 'left', borderBottom: '2px solid var(--brand)' }}>Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.frais.map((f, i) => (
                      <tr key={f.id} style={{ background: i % 2 === 0 ? '#FDFAF4' : '#F7F3EC' }}>
                        <td style={{ padding: '6px 10px', color: 'var(--text)' }}>{f.libelle}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, color: '#DC2626' }}>{fmt(f.montant_ttc)}</td>
                        <td style={{ padding: '6px 10px' }}>
                          <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: '0.78em', fontWeight: 600,
                            background: f.statut === 'facturé' ? '#D1FAE5' : '#FEF3C7',
                            color: f.statut === 'facturé' ? '#059669' : '#D97706' }}>
                            {f.statut || 'en attente'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* BLOC 6 — Analyse LLM */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <label style={{ fontSize: '0.82em', fontWeight: 600, color: 'var(--brand)' }}>Analyse intelligente</label>
                <button onClick={lancerAnalyseLLM} style={{
                  padding: '3px 10px', border: '1px solid var(--brand)', borderRadius: 10,
                  background: 'none', color: 'var(--brand)', fontSize: '0.78em', cursor: 'pointer', fontWeight: 600,
                }}>Générer</button>
              </div>
              <textarea value={llmAnalyse} onChange={e => setLlmAnalyse(e.target.value)} onBlur={handleLlmBlur}
                placeholder="Cliquer sur Générer pour lancer l'analyse…" rows={4}
                style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', fontSize: '0.85em', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical', fontFamily: 'inherit' }}
              />
            </div>

            {/* BLOC 7 — Notes duales */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
              <div>
                <label style={{ fontSize: '0.82em', fontWeight: 600, color: 'var(--brand)', display: 'block', marginBottom: 6 }}>Note de marché</label>
                <textarea value={note} onChange={e => setNote(e.target.value)} onBlur={handleNoteBlur}
                  placeholder="Commentaire sur le marché, la saison, les tendances…" rows={3}
                  style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', fontSize: '0.88em', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical', fontFamily: 'inherit' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.82em', fontWeight: 600, color: 'var(--brand)', display: 'block', marginBottom: 6 }}>Recommandations DCB</label>
                <textarea value={noteReco} onChange={e => setNoteReco(e.target.value)} onBlur={handleNoteRecoBlur}
                  placeholder="Actions recommandées pour le propriétaire…" rows={3}
                  style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', fontSize: '0.88em', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical', fontFamily: 'inherit' }}
                />
              </div>
            </div>

            {/* Email + actions */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} onBlur={handleEmailBlur}
                placeholder="Email propriétaire"
                style={{ flex: 1, minWidth: 220, fontSize: '0.88em', padding: '8px 10px',
                  border: `1px solid ${email ? '#059669' : '#D97706'}`, borderRadius: 6,
                  background: email ? '#F0FDF4' : '#FFFBEB', color: 'var(--text)', outline: 'none' }}
              />
              <button className="btn btn-secondary" style={{ fontSize: '0.85em', padding: '8px 14px' }}
                onClick={() => setPreviewOpen(true)}>Aperçu</button>
              <button className="btn btn-primary"
                style={{ fontSize: '0.85em', padding: '8px 14px', background: 'var(--brand)', color: '#fff', border: 'none', opacity: statut === 'sending' ? 0.6 : 1 }}
                onClick={envoyer} disabled={statut === 'sending' || !email}>
                {statut === 'sending' ? '…' : 'Envoyer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal aperçu */}
      {previewOpen && data && (() => {
        const html = genererRapportHTML(data.proprio, mois, {
          kpis: data.kpis, resas: data.resas, reviews: data.reviews,
          notes: [{ bienName: data.bien?.hospitable_name, note }],
        })
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(44,36,22,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
            onClick={() => setPreviewOpen(false)}>
            <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 740, height: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
              onClick={e => e.stopPropagation()}>
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
