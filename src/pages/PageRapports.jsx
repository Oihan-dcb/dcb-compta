import { useState, useEffect, useCallback } from 'react'
import MoisSelector, { MOIS_FR } from '../components/MoisSelector'
import { supabase } from '../lib/supabase'
import {
  genererRapportHTML, envoyerRapportEmail
} from '../services/rapportProprietaire'
import { genererStatementHTML, genererMailStatementHTML } from '../services/rapportStatement'

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

function getCanal(platform, ownerStay) {
  if (ownerStay) return <span style={{ fontSize: '0.75em', color: '#9C8E7D', fontStyle: 'italic' }}>Propriétaire</span>
  const p = (platform || '').toLowerCase()
  const cfg = PLATFORM_COLORS[p] || { bg: '#F0EBE1', color: '#9C8E7D', label: platform || '—' }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: cfg.color }} />
      <span style={{ fontSize: '0.78em', color: cfg.color, fontWeight: 600 }}>{cfg.label}</span>
    </span>
  )
}

function prevYear(mois) {
  const [y, m] = mois.split('-')
  return `${parseInt(y) - 1}-${m}`
}

function nextMoisStr(mois) {
  const [y, m] = mois.split('-').map(Number)
  return m === 12 ? `${y+1}-01` : `${y}-${String(m+1).padStart(2,'0')}`
}

function renderMarkdown(text) {
  if (!text) return ''
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^#{1,3}\s+(.+)$/gm, '<strong style="font-size:1.05em;color:var(--brand)">$1</strong>')
    .replace(/^\*\s+(.+)$/gm, '• $1')
    .replace(/^(\d+)\.\s+(.+)$/gm, '$1. $2')
    .replace(/\n/g, '<br/>')
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
  const [llmContexte, setLlmContexte] = useState('')
  const [llmTendances, setLlmTendances] = useState('')
  const [editingBloc, setEditingBloc] = useState({ analyse: false, contexte: false, tendances: false })
  const [generatingBloc, setGeneratingBloc] = useState(null)
  const [vueSynthese, setVueSynthese] = useState(false)
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [statut, setStatut] = useState('idle')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [bienIdsActifs, setBienIdsActifs] = useState(null)
  const [biensEnvoyes, setBiensEnvoyes] = useState(new Set())
  const [generatingPDF, setGeneratingPDF] = useState(false)
  const [notePerso, setNotePerso] = useState('')
  const [modeMaite, setModeMaite] = useState('chambre')
  const [joindrePDF, setJoindrePDF] = useState(false)
  const [showMailPreview, setShowMailPreview] = useState(false)
  const [erreurDetail, setErreurDetail] = useState('')
  const [colsConfig, setColsConfig] = useState({})
  const [useStatement, setUseStatement] = useState(false)

  useEffect(() => {
    supabase
      .from('proprietaire')
      .select('id, nom, email, bien(id, hospitable_name, listed, agence, groupe_facturation, rapport_config)')
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
    setLlmContexte('')
    setLlmTendances('')
    setEditingBloc({ analyse: false, contexte: false, tendances: false })
    setStatut('idle')
    setPreviewOpen(false)
  }, [selectedPropId, proprietaires])

  useEffect(() => {
    setData(null)
    setStatut('idle')
    setPreviewOpen(false)
    Promise.all([
      supabase.from('reservation').select('bien_id').eq('mois_comptable', mois)
        .or('fin_revenue.gt.0,final_status.not.in.("cancelled","not_accepted","declined","expired")'),
      supabase.from('frais_proprietaire').select('bien_id').eq('mois_facturation', mois),
      supabase.from('bien_notes').select('bien_id').eq('mois', mois).not('rapport_envoye_at', 'is', null),
    ]).then(([{ data: resasBiens }, { data: fraisBiens }, { data: rapports }]) => {
      setBienIdsActifs(new Set([
        ...(resasBiens || []).map(r => r.bien_id),
        ...(fraisBiens || []).map(f => f.bien_id),
      ]))
      setBiensEnvoyes(new Set((rapports || []).map(r => r.bien_id)))
    })
  }, [mois])

  const charger = useCallback(async () => {
    if (!selectedBienId || !selectedPropId) return
    setLoading(true)
    setError(null)
    try {
      const proprio = proprietaires.find(p => p.id === selectedPropId)
      setEmail(proprio?.email || '')
      const maiteIdsLocal = (proprio?.bien || []).filter(b => b.groupe_facturation === 'MAITE').map(b => b.id)
      const isGlobal = modeMaite === 'global' && maiteIdsLocal.length > 0

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
        noteContexteVal,
        noteTendancesVal,
        notePersoVal,
        { data: facture },
        tauxCommission,
      ] = await Promise.all([
        (() => {
          let q = supabase.from('reservation').select('id, code, fin_revenue, fin_accommodation, fin_host_service_fee, nights, arrival_date, departure_date, final_status, platform, owner_stay, guest_name, bien:bien_id(hospitable_name, code)').eq('mois_comptable', mois).order('arrival_date')
          return isGlobal ? q.in('bien_id', maiteIdsLocal) : q.eq('bien_id', selectedBienId)
        })(),
        (() => {
          let q = supabase.from('reservation').select('id, fin_revenue, nights, final_status').eq('mois_comptable', moisN1).neq('final_status', 'cancelled')
          return isGlobal ? q.in('bien_id', maiteIdsLocal) : q.eq('bien_id', selectedBienId)
        })(),
        (() => {
          let q = supabase.from('frais_proprietaire').select('id, libelle, montant_ttc, statut').eq('mois_facturation', mois)
          return isGlobal ? q.in('bien_id', maiteIdsLocal) : q.eq('bien_id', selectedBienId)
        })(),
        supabase.from('bien_notes').select('note_marche')
          .eq('bien_id', selectedBienId).eq('mois', mois).maybeSingle()
          .then(r => r.data?.note_marche || ''),
        supabase.from('bien_notes').select('note_recommandations')
          .eq('bien_id', selectedBienId).eq('mois', mois).maybeSingle()
          .then(r => r.data?.note_recommandations || ''),
        supabase.from('bien_notes').select('note_analyse_llm')
          .eq('bien_id', selectedBienId).eq('mois', mois).maybeSingle()
          .then(r => r.data?.note_analyse_llm || ''),
        supabase.from('bien_notes').select('note_contexte')
          .eq('bien_id', selectedBienId).eq('mois', mois).maybeSingle()
          .then(r => r.data?.note_contexte || ''),
        supabase.from('bien_notes').select('note_tendances')
          .eq('bien_id', selectedBienId).eq('mois', mois).maybeSingle()
          .then(r => r.data?.note_tendances || ''),
        supabase.from('bien_notes').select('note_personnalisation')
          .eq('bien_id', selectedBienId).eq('mois', mois).maybeSingle()
          .then(r => r.data?.note_personnalisation || ''),
        supabase.from('facture_evoliz').select('id, id_evoliz, statut, total_ttc')
          .eq('proprietaire_id', selectedPropId).eq('mois', mois).eq('type_facture', 'honoraires').maybeSingle(),
        supabase.from('bien').select('taux_commission_override, proprietaire:proprietaire_id(taux_commission)')
          .eq('id', selectedBienId).maybeSingle()
          .then(r => r.data?.taux_commission_override || r.data?.proprietaire?.taux_commission || 25),
      ])

      if (resasErr) throw new Error(resasErr.message)

      setNote(noteMarche)
      setNoteReco(noteRecoVal)
      setLlmAnalyse(noteLlmVal)
      setLlmContexte(noteContexteVal)
      setLlmTendances(noteTendancesVal)
      setNotePerso(notePersoVal)

      const resasValides = (resas || []).filter(r =>
        !STATUTS_NON_VENTILABLES.includes(r.final_status) || (r.fin_revenue || 0) > 0
      )
      const resaIds = resasValides.map(r => r.id)

      let loyTotal = 0
      let honTotal = 0
      let virTotal = 0
      let ventByResa = {}
      let vents = []
      if (resaIds.length) {
        const { data: ventsData } = await supabase
          .from('ventilation')
          .select('reservation_id, code, montant_ht, montant_ttc')
          .in('reservation_id', resaIds)
          .in('code', ['HON', 'LOY', 'VIR', 'FMEN', 'AUTO', 'MEN'])
        vents = ventsData || []
        for (const v of vents) {
          if (!ventByResa[v.reservation_id]) ventByResa[v.reservation_id] = {}
          ventByResa[v.reservation_id][v.code] = v
        }
        loyTotal = vents.filter(v => v.code === 'LOY').reduce((s, v) => s + (v.montant_ht || 0), 0)
        honTotal = vents.filter(v => v.code === 'HON').reduce((s, v) => s + (v.montant_ttc || 0), 0)
        virTotal = vents.filter(v => v.code === 'VIR').reduce((s, v) => s + (v.montant_ht || 0), 0)
      }

      let prestations = []
      try {
        let qPhf = supabase
          .from('prestation_hors_forfait')
          .select('id, bien_id, reservation_id, date_prestation, description, montant, type_imputation, prestation_type:prestation_type_id(nom)')
          .eq('mois', mois)
          .eq('statut', 'valide')
          .in('type_imputation', ['deduction_loy', 'debours_proprio', 'haowner'])
        if (isGlobal) {
          if (!maiteIdsLocal || maiteIdsLocal.length === 0) {
            prestations = []
          } else {
            qPhf = qPhf.in('bien_id', maiteIdsLocal)
            const { data: phfData } = await qPhf
            prestations = phfData || []
          }
        } else {
          qPhf = qPhf.eq('bien_id', selectedBienId)
          const { data: phfData } = await qPhf
          prestations = phfData || []
        }
      } catch (_) { /* silencieux — ne bloque pas le chargement */ }

      const extraByResa = {}
      ;(prestations || [])
        .filter(p => ['deduction_loy', 'debours_proprio'].includes(p.type_imputation) && p.reservation_id)
        .forEach(p => {
          extraByResa[p.reservation_id] = (extraByResa[p.reservation_id] || 0) + (p.montant || 0)
        })

      const extrasGlobaux = (prestations || [])
        .filter(p => ['deduction_loy', 'debours_proprio'].includes(p.type_imputation) && !p.reservation_id)
        .sort((a, b) => (a.date_prestation || '').localeCompare(b.date_prestation || ''))
        .map(p => ({ ...p, libelle: p.description || p.prestation_type?.nom || '—' }))

      const haownerList = (prestations || [])
        .filter(p => p.type_imputation === 'haowner')
        .sort((a, b) => (a.date_prestation || '').localeCompare(b.date_prestation || ''))
        .map(p => ({ ...p, montant_ttc: Math.round((p.montant || 0) * 1.20), libelle: p.description || p.prestation_type?.nom || '—' }))

      const totalDebours = (prestations || [])
        .filter(p => ['deduction_loy', 'debours_proprio'].includes(p.type_imputation))
        .reduce((s, p) => s + (p.montant || 0), 0)
      const totalHaowner = haownerList.reduce((s, p) => s + (p.montant_ttc || 0), 0)
      const virementNet = Math.max(0, virTotal - totalDebours - totalHaowner)

      let reviews = []
      {
        const [yr, mo] = mois.split('-').map(Number)
        const nextMois = mo === 12 ? `${yr+1}-01` : `${yr}-${String(mo+1).padStart(2,'0')}`
        const { data: revData } = await supabase
          .from('reservation_review')
          .select('id, reviewer_name, rating, comment, submitted_at')
          .eq('bien_id', selectedBienId)
          .gte('submitted_at', `${mois}-01`)
          .lt('submitted_at', `${nextMois}-01`)
          .order('submitted_at', { ascending: false })
        reviews = revData || []
      }

      const { data: allReviewsData } = await supabase
        .from('reservation_review').select('rating')
        .eq('bien_id', selectedBienId).not('rating', 'is', null)

      const noteMoisMoy = reviews.length > 0
        ? (reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length).toFixed(1) : null
      const noteGlobaleMoy = allReviewsData?.length > 0
        ? (allReviewsData.reduce((s, r) => s + (r.rating || 0), 0) / allReviewsData.length).toFixed(1) : null

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
        tauxCommission,
        resas: resasValides.map(r => {
          const v = ventByResa[r.id] || {}
          const virHt = v.VIR?.montant_ht || 0
          const loyHt = v.LOY?.montant_ht || 0
          return {
            ...r,
            vent: v,
            extra: extraByResa[r.id] || 0,
            hon:  v.HON?.montant_ttc || 0,
            loy:  loyHt,
            vir:  virHt,
            fmen: v.FMEN?.montant_ttc || 0,
            taxe: Math.max(0, virHt - loyHt),
            menage_voyageur: v.MEN?.montant_ht || 0,
            base_comm: tauxCommission > 0
              ? Math.round((v.HON?.montant_ht || 0) / (tauxCommission / 100))
              : 0,
          }
        }),
        reviews,
        facture,
        frais: fraisData || [],
        kpis: { nbResas, caHeb, nuitsOccupees, nuitsDispos, tauxOcc, dureeMoy, loyTotal, honTotal: facture?.montant_ttc || honTotal, virementNet },
        kpisN1,
        alertes,
        noteMoisMoy,
        noteGlobaleMoy,
        nbReviewsGlobal: allReviewsData?.length || 0,
        extrasGlobaux,
        haownerList,
        ventByResa,
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [selectedBienId, selectedPropId, mois, proprietaires, modeMaite])

  useEffect(() => { charger() }, [charger])

  useEffect(() => {
    if (data?.bien?.rapport_config?.colonnes) setColsConfig(data.bien.rapport_config.colonnes)
  }, [data?.bien?.id])

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

  async function handleContexteBlur() {
    try {
      await supabase.from('bien_notes').upsert(
        { bien_id: selectedBienId, mois, note_contexte: llmContexte, updated_at: new Date().toISOString() },
        { onConflict: 'bien_id,mois' }
      )
    } catch (e) { console.error(e) }
  }

  async function handleTendancesBlur() {
    try {
      await supabase.from('bien_notes').upsert(
        { bien_id: selectedBienId, mois, note_tendances: llmTendances, updated_at: new Date().toISOString() },
        { onConflict: 'bien_id,mois' }
      )
    } catch (e) { console.error(e) }
  }

  async function handleNotePersoBlur() {
    try {
      await supabase.from('bien_notes').upsert(
        { bien_id: selectedBienId, mois, note_personnalisation: notePerso, updated_at: new Date().toISOString() },
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

  async function genererBloc(which) {
    if (!data) return
    setGeneratingBloc(which)

    const [yr, mo] = mois.split('-').map(Number)
    const moisLabel = MOIS_FR[mo - 1] + ' ' + yr
    const m1 = nextMoisStr(mois)
    const m2 = nextMoisStr(m1)
    const prixMoyenNuit = data.kpis.nuitsOccupees > 0
      ? Math.round((data.kpis.caHeb / data.kpis.nuitsOccupees) / 100) : 0

    let meteoResume = 'Données météo non disponibles.'
    let meteoFutur = ''
    try {
      const meteoRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=43.48&longitude=-1.56&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,sunshine_duration&timezone=Europe%2FParis&past_days=31&forecast_days=14`
      )
      const meteo = await meteoRes.json()
      const days = (meteo.daily?.time || [])
      const moisPad = String(mo).padStart(2, '0')
      const avg = arr => arr.length ? (arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(1) : '?'
      const sum = arr => arr.reduce((s, v) => s + v, 0).toFixed(0)
      const idx = days.reduce((acc, d, i) => d.startsWith(`${yr}-${moisPad}`) ? [...acc, i] : acc, [])
      if (idx.length > 0) {
        const tMax = idx.map(i => meteo.daily.temperature_2m_max[i]).filter(v => v != null)
        const tMin = idx.map(i => meteo.daily.temperature_2m_min[i]).filter(v => v != null)
        const pluie = idx.map(i => meteo.daily.precipitation_sum[i] || 0)
        const soleil = idx.map(i => (meteo.daily.sunshine_duration[i] || 0) / 3600)
        meteoResume = `Tmax moy. ${avg(tMax)}°C, Tmin moy. ${avg(tMin)}°C, précipitations ${sum(pluie)}mm, ensoleillement moy. ${avg(soleil)}h/j`
      }
      const idxFut = days.reduce((acc, d, i) => d.startsWith(m1) ? [...acc, i] : acc, [])
      if (idxFut.length > 0) {
        const tMaxF = idxFut.map(i => meteo.daily.temperature_2m_max[i]).filter(v => v != null)
        meteoFutur = `Tmax moy. prévue ${avg(tMaxF)}°C sur les prochaines semaines`
      }
    } catch (e) { console.warn('Météo non disponible:', e.message) }

    const { data: resasFutures } = await supabase
      .from('reservation')
      .select('code, arrival_date, departure_date, nights, fin_revenue, final_status, platform')
      .eq('bien_id', selectedBienId)
      .in('mois_comptable', [m1, m2])
      .not('final_status', 'in', '("cancelled","not_accepted","declined","expired")')
      .order('arrival_date')

    const bienNom = data.bien?.hospitable_name || ''
    const tauxCommission = data.tauxCommission

    const [m1yr, m1mo] = m1.split('-').map(Number)
    const [m2yr, m2mo] = m2.split('-').map(Number)
    const nextMoisLabel = MOIS_FR[m1mo - 1] + ' ' + m1yr
    const nextNextMoisLabel = MOIS_FR[m2mo - 1] + ' ' + m2yr
    const totalNuitsFutures = (resasFutures || []).reduce((s, r) => s + (r.nights || 0), 0)
    const meteoPrevisions = meteoFutur || 'Données météo non disponibles pour les prochaines semaines.'

    const SYSTEM_PROMPT = `Tu es Oïhan, gérant de Destination Côte Basque.
Tu rédiges des analyses mensuelles internes sur les biens gérés, destinées à être partagées avec les propriétaires.
Ton rôle n'est pas de décrire des chiffres mais d'en donner une lecture claire, professionnelle et maîtrisée.

---

RÈGLES GLOBALES :

POSITIONNEMENT :
- Tu analyses la performance comme un gestionnaire d'actif
- Tu montres que le bien est piloté activement
- Tu restes factuel, fluide et professionnel

TON :
- Naturel, humain, maîtrisé
- Neutre mais incarné (pas robotique)
- Jamais commercial, jamais administratif

FORME :
- Aucun début type "Bonjour", aucune signature
- Pas d'adresse directe au propriétaire (pas de "vous")
- Écriture à la 3ème personne uniquement
- Paragraphes courts et denses
- Pas de bullet points, pas de titres

CONTENU :
- Aucun jargon comptable
- Chaque chiffre doit être interprété
- Aucune répétition entre les blocs
- Une information = un seul bloc

NOTE OÏHAN :
- Les éléments fournis dans "NOTE OÏHAN" doivent être intégrés naturellement
- Ils doivent apparaître dans UN SEUL bloc (Analyse du mois)
- Ils doivent être reformulés comme une observation, jamais comme une note externe

PERFORMANCE FAIBLE :
- Toujours abordée si présente
- Ton factuel et constructif
- Donner des éléments d'explication
- Montrer implicitement que la situation est pilotée`

    async function _genererAnalyse() {
      const prompt = `Bien : ${bienNom} — ${moisLabel}

Données disponibles :
- Base commissionnable : ${fmt(data.kpis.caHeb)}
- Taux de commission : ${tauxCommission}%
- Reversement net : ${fmt(data.kpis.loyTotal)}
- Réservations : ${data.kpis.nbResas} (N-1 : ${data.kpisN1?.nbResas > 0 ? data.kpisN1.nbResas : 'N/A'})
- Taux occupation : ${data.kpis.tauxOcc}% (N-1 : ${data.kpisN1?.tauxOcc > 0 ? data.kpisN1.tauxOcc + '%' : 'N/A'})
- Prix moyen/nuit : ${prixMoyenNuit}€
- Note voyageurs : ${data.noteMoisMoy ? data.noteMoisMoy + '/5 (' + data.reviews.length + ' avis)' : 'aucun avis ce mois'}

Avis voyageurs :
${data.reviews.map(r => '- ' + r.rating + '/5 : "' + (r.comment || '') + '"').join('\n') || 'Aucun avis ce mois'}

${notePerso ? 'NOTE OÏHAN :\n' + notePerso : ''}

OBJECTIF :
Donner une lecture claire de la performance du mois.

CONTENU ATTENDU :
- Positionner le mois (bon / correct / en retrait)
- Expliquer les variations vs N-1
- Interpréter le niveau de revenu et d'occupation
- Intégrer intelligemment les retours voyageurs
- Ajouter la NOTE OÏHAN de manière fluide si présente

FORMAT :
- Démarrer directement sans introduction
- 3 à 4 paragraphes maximum
- Pas de transition vers les mois suivants`
      const { data: llmData, error: llmErr } = await Promise.race([
        supabase.functions.invoke('llm-analyse', { body: { prompt, system: SYSTEM_PROMPT } }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 30000)),
      ])
      if (llmErr) throw llmErr
      const txt = llmData?.text || ''
      if (txt) {
        setLlmAnalyse(cleanLlmText(txt))
        await supabase.from('bien_notes').upsert(
          { bien_id: selectedBienId, mois, note_analyse_llm: txt, updated_at: new Date().toISOString() },
          { onConflict: 'bien_id,mois' }
        )
      }
    }

    async function _genererContexte() {
      const prompt = `Bien : ${bienNom} — ${moisLabel}

Données disponibles :
- Météo : ${meteoResume}
- Taux d'occupation : ${data.kpis.tauxOcc}% (N-1 : ${data.kpisN1?.tauxOcc > 0 ? data.kpisN1.tauxOcc + '%' : 'N/A'})
- Réservations : ${data.kpis.nbResas} (N-1 : ${data.kpisN1?.nbResas > 0 ? data.kpisN1.nbResas : 'N/A'})

OBJECTIF :
Apporter un éclairage extérieur sur la performance.

CONTENU ATTENDU :
- Impact de la météo ou de la saisonnalité sur la demande
- Lecture du niveau de demande locative à Biarritz ce mois
- Mise en perspective du marché local (événements, vacances, dynamique côtière)

CONTRAINTES :
- Ne pas répéter les données du bloc Analyse
- Ne pas reprendre la NOTE OÏHAN
- Ne pas mentionner le reversement ou les honoraires

FORMAT :
- Démarrer directement par le contexte météo ou marché
- 2 à 3 paragraphes maximum`
      const { data: llmData, error: llmErr } = await Promise.race([
        supabase.functions.invoke('llm-analyse', { body: { prompt, system: SYSTEM_PROMPT } }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 30000)),
      ])
      if (llmErr) throw llmErr
      const txt = llmData?.text || ''
      if (txt) {
        setLlmContexte(cleanLlmText(txt))
        await supabase.from('bien_notes').upsert(
          { bien_id: selectedBienId, mois, note_contexte: txt, updated_at: new Date().toISOString() },
          { onConflict: 'bien_id,mois' }
        )
      }
    }

    async function _genererTendances() {
      const prompt = `Bien : ${bienNom} — Perspectives ${nextMoisLabel} / ${nextNextMoisLabel}

Données disponibles :
Réservations en portefeuille (M+1/M+2) :
${resasFutures?.length > 0
  ? resasFutures.map(r => '- ' + r.arrival_date + ' → ' + r.departure_date + ' (' + r.nights + 'n, ' + r.platform + ')').join('\n')
  : 'Aucune réservation enregistrée pour les 2 prochains mois'}
Total : ${resasFutures?.length || 0} réservation(s), ${totalNuitsFutures} nuits couvertes

Prévisions météo :
${meteoPrevisions}

CE QUI A DÉJÀ ÉTÉ DIT dans les blocs précédents (ne pas répéter) :
- Analyse : "${llmAnalyse?.substring(0, 250) || 'non généré'}"
- Contexte : "${llmContexte?.substring(0, 250) || 'non généré'}"

OBJECTIF :
Donner de la visibilité sur les prochains mois et rassurer.

CONTENU ATTENDU :
- Lecture du niveau de remplissage futur (avance / normal / retard par rapport à la saison)
- Interprétation de la dynamique du carnet de réservations
- Mise en perspective avec les prévisions météo si pertinent
- Ton rassurant et maîtrisé

CONTRAINTES :
- Ne pas utiliser "vous", "votre"
- Parler du bien à la 3ème personne
- "les réservations sont en portefeuille", "le carnet compte X réservations"
- Ne pas répéter les données de performance du mois écoulé

FORMAT :
- 2 à 3 paragraphes maximum
- Pas de conclusion formelle ni de signature`
      const { data: llmData, error: llmErr } = await Promise.race([
        supabase.functions.invoke('llm-analyse', { body: { prompt, system: SYSTEM_PROMPT } }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 30000)),
      ])
      if (llmErr) throw llmErr
      const txt = llmData?.text || ''
      if (txt) {
        setLlmTendances(cleanLlmText(txt))
        await supabase.from('bien_notes').upsert(
          { bien_id: selectedBienId, mois, note_tendances: txt, updated_at: new Date().toISOString() },
          { onConflict: 'bien_id,mois' }
        )
      }
    }
    const cleanLlmText = (text) => text
      .replace(/^#+\s+.+$/gm, '')
      .replace(/^---+$/gm, '')
      .replace(/^\*\*[^*]+\*\*\s*$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    try {
      if (which === 'all') {
        await _genererAnalyse()
        await _genererContexte()
        await _genererTendances()
      }
      else if (which === 'analyse') await _genererAnalyse()
      else if (which === 'contexte') await _genererContexte()
      else if (which === 'tendances') await _genererTendances()
    } catch (e) { console.warn('LLM génération failed:', e.message) }
    finally { setGeneratingBloc(null) }
  }

  function buildRapportData() {
    const vByResa = data.ventByResa || {}
    const taux = data.tauxCommission || 0
    const resas = (data.resas || []).map(r => {
      const v = vByResa[r.id] || {}
      const virHt = v.VIR?.montant_ht || 0
      const loyHt = v.LOY?.montant_ht || 0
      // gross_revenue = fin_revenue - fin_host_service_fee
      // fin_host_service_fee est NÉGATIF (ex: -6455) → soustraction = addition
      // Fallback sur fin_revenue si fin_host_service_fee est null (resas CSV)
      const gross_revenue = r.fin_host_service_fee != null
        ? (r.fin_revenue || 0) - (r.fin_host_service_fee || 0)
        : (r.fin_revenue || 0)
      return {
        ...r,
        gross_revenue,
        hon:  v.HON?.montant_ttc || 0,
        loy:  loyHt,
        vir:  virHt,
        fmen: v.FMEN?.montant_ttc || 0,
        taxe: Math.max(0, virHt - loyHt),
        menage_voyageur: v.MEN?.montant_ht || 0,
        base_comm: (r.fin_accommodation || 0) + (r.fin_host_service_fee || 0),
      }
    })
    return {
      kpis: data.kpis, resas, reviews: data.reviews,
      bien: data.bien, llmAnalyse, llmContexte, llmTendances, kpisN1: data.kpisN1,
      noteMoisMoy: data.noteMoisMoy, noteGlobaleMoy: data.noteGlobaleMoy,
      nbReviewsGlobal: data.nbReviewsGlobal,
      notes: [{ bienName: data.bien?.hospitable_name, note }],
      noteContexte: note,
      noteReco,
      tauxCommission: taux,
      extrasGlobaux: data?.extrasGlobaux || [],
      haownerList: data?.haownerList || [],
      colonnes: colsConfig,
    }
  }

  function getHTML() {
    const rapportData = buildRapportData()
    return useStatement
      ? genererStatementHTML(data.proprio, mois, rapportData)
      : genererRapportHTML(data.proprio, mois, rapportData, rapportData.colonnes)
  }

  function getMailHTML() {
    const rapportData = buildRapportData()
    return useStatement
      ? genererMailStatementHTML(data.proprio, mois, rapportData)
      : genererRapportHTML(data.proprio, mois, rapportData, rapportData.colonnes)
  }

  async function telechargerPDF() {
    if (!data) return
    setGeneratingPDF(true)
    try {
      const html = getHTML()
      const response = await fetch('/api/generate-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html, orientation: useStatement ? 'landscape' : 'portrait' }),
      })
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Erreur génération PDF')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const bienNom = data.bien?.hospitable_name || data.proprio?.nom || 'rapport'
      a.href = url
      a.download = `Rapport_${bienNom.replace(/[^a-zA-Z0-9]/g, '_')}_${mois}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Erreur PDF:', error)
      alert('Erreur lors de la génération du PDF : ' + error.message)
    } finally {
      setGeneratingPDF(false)
    }
  }

  async function envoyer() {
    if (!data) return
    const emails = email.split(',').map(e => e.trim()).filter(e => e.includes('@'))
    if (emails.length === 0) { alert('Email invalide'); return }
    setStatut('sending')
    try {
      let htmlBody, prependAttachments = []

      if (useStatement) {
        console.log('[envoyer] étape 1 — genererMailStatementHTML')
        const rapportData = buildRapportData()
        htmlBody = genererMailStatementHTML(data.proprio, mois, rapportData)
        console.log('[envoyer] mail body length:', htmlBody.length)

        // Générer le statement PDF en pièce jointe
        try {
          console.log('[envoyer] étape 2 — genererStatementHTML')
          const statementHtml = genererStatementHTML(data.proprio, mois, rapportData)
          console.log('[envoyer] étape 3 — fetch /api/generate-pdf')
          const pdfRes = await fetch('/api/generate-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ html: statementHtml, orientation: 'landscape' }),
          })
          console.log('[envoyer] generate-pdf status:', pdfRes.status)
          if (pdfRes.ok) {
            const ab = await pdfRes.arrayBuffer()
            const u8 = new Uint8Array(ab)
            let base64 = ''
            for (let i = 0; i < u8.length; i += 3072) base64 += btoa(String.fromCharCode(...u8.slice(i, i + 3072)))
            console.log('[envoyer] PDF base64 length:', base64.length)
            const bienNom = data.bien?.hospitable_name?.replace(/[^a-zA-Z0-9]/g, '_') || 'bien'
            prependAttachments = [{
              filename: `Statement_${bienNom}_${mois}.pdf`,
              content_base64: base64,
            }]
          } else {
            const errText = await pdfRes.text()
            console.warn('[envoyer] generate-pdf erreur:', pdfRes.status, errText)
          }
        } catch (e) {
          console.warn('[envoyer] Statement PDF non joint:', e.message, e)
        }
        console.log('[envoyer] prependAttachments count:', prependAttachments.length)
      } else {
        htmlBody = getHTML()
      }

      const bienName = data.bien?.hospitable_name || data.proprio?.nom
      const smtpPayloadSize = JSON.stringify({ htmlBody, prependAttachments }).length
      console.log('[envoyer] étape 4 — smtp-send, payload ~', Math.round(smtpPayloadSize / 1024), 'KB, joindrePDF:', joindrePDF)
      await Promise.all(emails.map(addr =>
        envoyerRapportEmail({ ...data.proprio, email: addr, bienName }, mois, htmlBody, joindrePDF, prependAttachments)
      ))
      console.log('[envoyer] étape 5 — bien_notes upsert')
      await supabase.from('bien_notes').upsert(
        { bien_id: selectedBienId, mois, rapport_envoye_at: new Date().toISOString() },
        { onConflict: 'bien_id,mois' }
      )
      setBiensEnvoyes(prev => new Set([...prev, selectedBienId]))
      setStatut(emails.length > 1 ? `sent_${emails.length}` : 'sent')
    } catch (e) { console.error('ERREUR ENVOI STATEMENT:', e); setStatut('error'); setErreurDetail(e?.message || String(e)) }
  }

  const proprio = proprietaires.find(p => p.id === selectedPropId)
  const biensActifs = (proprio?.bien || []).filter(b => b.listed && b.agence === 'dcb')
  const isMaite = (proprio?.bien || []).some(b => b.groupe_facturation === 'MAITE')
  const maiteIds = (proprio?.bien || []).filter(b => b.groupe_facturation === 'MAITE').map(b => b.id)
  const biensActifsMaite = biensActifs.filter(b => b.groupe_facturation === 'MAITE')
  const propsFiltres = bienIdsActifs === null
    ? proprietaires
    : proprietaires.filter(p => (p.bien || []).some(b => bienIdsActifs.has(b.id)))
  const [year, monthIdx] = mois.split('-')
  const moisLabel = MOIS_FR[parseInt(monthIdx) - 1] + ' ' + year

  const STATUT_STYLES = {
    idle:    { label: 'Non envoyé', color: '#9C8E7D', bg: '#F0EBE1' },
    sending: { label: 'Envoi…',     color: '#D97706', bg: '#FEF3C7' },
    sent:    { label: 'Envoyé ✓',   color: '#059669', bg: '#D1FAE5' },
    error:   { label: 'Erreur',     color: '#DC2626', bg: '#FEE2E2' },
  }
  const st = STATUT_STYLES[statut] || { label: `Envoyé ✓ (${statut.replace('sent_', '')} destinataires)`, color: '#059669', bg: '#D1FAE5' }

  function DeltaBadge({ rawN, rawN1 }) {
    if (rawN1 === undefined || rawN1 === null || rawN1 === 0)
      return <span style={{ fontSize: '0.68em', marginLeft: 4, color: '#9C8E7D' }}>N/A</span>
    const delta = Math.round(((rawN - rawN1) / rawN1) * 100)
    const pos = delta >= 0
    return (
      <span style={{ fontSize: '0.68em', marginLeft: 4, color: pos ? '#059669' : '#DC2626', fontWeight: 600 }}>
        {pos ? '▲' : '▼'}{Math.abs(delta)}%
      </span>
    )
  }

  const kpiCards = !data ? [] : [
    { val: data.kpis.nbResas,             lbl: 'Réservations',      rawN: data.kpis.nbResas,       rawN1: data.kpisN1.nbResas || 0, dispN1: data.kpisN1.nbResas > 0 ? data.kpisN1.nbResas : null },
    { val: fmt(data.kpis.caHeb),          lbl: 'CA Hébergement',    rawN: data.kpis.caHeb,         rawN1: data.kpisN1.caHeb || 0,   dispN1: data.kpisN1.caHeb > 0 ? fmt(data.kpisN1.caHeb) : null },
    { val: fmt(data.kpis.honTotal),       lbl: 'Total HON',          rawN: null,                    rawN1: null,                     dispN1: null },
    { val: fmt(data.kpis.virementNet),    lbl: 'Virement proprio',   rawN: null,                    rawN1: null,                     dispN1: null },
    { val: `${data.kpis.nuitsOccupees}/${data.kpis.nuitsDispos}`, lbl: 'Nuits occ./dispo.', rawN: data.kpis.nuitsOccupees, rawN1: data.kpisN1.nuitsOccupees || 0, dispN1: data.kpisN1.nuitsOccupees > 0 ? data.kpisN1.nuitsOccupees : null },
    { val: `${data.kpis.tauxOcc} %`,      lbl: "Taux d'occupation", rawN: data.kpis.tauxOcc,       rawN1: data.kpisN1.tauxOcc || 0, dispN1: data.kpisN1.tauxOcc > 0 ? `${data.kpisN1.tauxOcc} %` : null },
    { val: `${data.kpis.dureeMoy} nuits`, lbl: 'Durée moyenne',     rawN: null,                    rawN1: null,                     dispN1: null },
    { val: data.noteMoisMoy ? `★ ${data.noteMoisMoy}` : '—', lbl: 'Avis du mois',  rawN: null, rawN1: null, dispN1: `${data.reviews?.length || 0} avis` },
    { val: data.noteGlobaleMoy ? `★ ${data.noteGlobaleMoy}` : '—', lbl: 'Note globale', rawN: null, rawN1: null, dispN1: `${data.nbReviewsGlobal || 0} avis` },
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
          {propsFiltres.map(p => {
            const bienEnvoye = (p.bien || []).some(b => biensEnvoyes.has(b.id))
            return (
              <option key={p.id} value={p.id} style={{ color: bienEnvoye ? '#9C8E7D' : 'inherit' }}>
                {bienEnvoye ? '✓ ' : ''}{p.nom}
              </option>
            )
          })}
        </select>
        {isMaite && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {[['chambre', 'Par chambre'], ['maison', 'Maison entière'], ['global', 'Global']].map(([val, lbl]) => (
              <label key={val} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: '0.85em', fontWeight: modeMaite === val ? 700 : 400, color: modeMaite === val ? 'var(--brand)' : 'var(--text)' }}>
                <input type="radio" name="modeMaite" value={val} checked={modeMaite === val} onChange={() => setModeMaite(val)} style={{ accentColor: 'var(--brand)' }} />
                {lbl}
              </label>
            ))}
          </div>
        )}
        {modeMaite !== 'global' && biensActifs.length > 1 && (
          <select value={selectedBienId} onChange={e => setSelectedBienId(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: '0.95em', background: '#fff', color: 'var(--text)', minWidth: 200 }}>
            {(isMaite && modeMaite !== 'global' ? biensActifsMaite : biensActifs).map(b => <option key={b.id} value={b.id}>{b.hospitable_name}</option>)}
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
                <div style={{ marginBottom: 10, padding: '8px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: '0.8em', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                  <span style={{ fontWeight: 600, marginRight: 6, color: 'var(--text)' }}>Colonnes rapport :</span>
                  {[
                    { key: 'brut',      label: 'Brut voyageur', def: false },
                    { key: 'base_comm', label: 'Base comm.',    def: true  },
                    { key: 'hon',       label: 'HON',           def: true  },
                    { key: 'loy',       label: 'LOY',           def: true  },
                    { key: 'vir',       label: 'VIR',           def: true  },
                    { key: 'debours',   label: 'Débours',         def: false },
                    { key: 'menage',    label: 'Ménage voyageur', def: false },
                  ].map(({ key, label, def }) => (
                    <label key={key} style={{ marginRight: 8, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <input type="checkbox"
                        checked={colsConfig[key] ?? def}
                        onChange={async (e) => {
                          const newCols = { ...colsConfig, [key]: e.target.checked }
                          setColsConfig(newCols)
                          if (data?.bien?.id) {
                            await supabase.from('bien').update({ rapport_config: { colonnes: newCols } }).eq('id', data.bien.id)
                          }
                        }} />
                      {label}
                    </label>
                  ))}
                </div>
                {data.resas.length > 0 ? (
                  <div style={{ overflowX: 'auto', width: '100%' }}>
                  <table style={{ width: '100%', minWidth: 700, borderCollapse: 'collapse', fontSize: '0.78em' }}>
                    <thead>
                      <tr style={{ background: '#EAE3D4', color: 'var(--text)' }}>
                        {(() => {
                          const thF = (label, right = false, color) => <th key={label} style={{ padding: '7px 8px', textAlign: right ? 'right' : 'left', borderBottom: '2px solid var(--brand)', whiteSpace: 'nowrap', ...(color ? { color } : {}) }}>{label}</th>
                          return <>
                            {thF('Code')}
                            {thF('Voyageur')}
                            {thF('Arrivée')}
                            {thF('Plateforme')}
                            {thF('Nuits', true)}
                            {(colsConfig.brut      ?? false) && thF('Brut voyageur', true)}
                            {(colsConfig.base_comm  ?? true)  && thF('Base comm.', true)}
                            {(colsConfig.hon        ?? true)  && thF('HON', true, '#9c8c7a')}
                            {(colsConfig.loy        ?? true)  && thF('LOY', true, '#CC9933')}
                            {(colsConfig.vir        ?? true)  && thF('VIR', true, '#2d7a50')}
                            {(colsConfig.debours    ?? false) && thF('Débours', true)}
                            {(colsConfig.menage     ?? false) && thF('Ménage voyageur', true)}
                          </>
                        })()}
                      </tr>
                    </thead>
                    <tbody>
                      {data.resas.map((r, i) => {
                        const v = r.vent
                        return (
                          <tr key={r.id} style={{ background: i % 2 === 0 ? '#FDFAF4' : '#F7F3EC' }}>
                            <td style={{ padding: '6px 8px', color: '#9C8E7D', fontFamily: 'monospace' }}>{r.code}</td>
                            <td style={{ padding: '6px 8px', color: 'var(--text)' }}>
                              {r.guest_name || '—'}
                              {STATUTS_NON_VENTILABLES.includes(r.final_status) && (r.fin_revenue || 0) > 0 && (
                                <span style={{ marginLeft: 6, fontSize: '0.75em', color: '#9C8E7D', fontStyle: 'italic' }}>(annulée — frais perçus)</span>
                              )}
                            </td>
                            <td style={{ padding: '6px 8px', color: '#4A3728', whiteSpace: 'nowrap' }}>{r.arrival_date ? r.arrival_date.split('-').reverse().join('/') : '—'}</td>
                            <td style={{ padding: '6px 8px' }}>{getCanal(r.platform, r.owner_stay)}</td>
                            <td style={{ padding: '6px 8px', textAlign: 'right', color: '#4A3728' }}>{r.nights || '—'}</td>
                            {(colsConfig.brut      ?? false) && <td style={{ padding: '6px 8px', textAlign: 'right', color: '#4A3728', whiteSpace: 'nowrap' }}>{fmt(r.fin_accommodation || 0)}</td>}
                            {(colsConfig.base_comm  ?? true)  && <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text)', whiteSpace: 'nowrap' }}>{fmt(r.fin_revenue || 0)}</td>}
                            {(colsConfig.hon        ?? true)  && <td style={{ padding: '6px 8px', textAlign: 'right', color: '#9c8c7a', whiteSpace: 'nowrap' }}>{v.HON ? fmt(v.HON.montant_ttc) : '—'}</td>}
                            {(colsConfig.loy        ?? true)  && <td style={{ padding: '6px 8px', textAlign: 'right', color: '#CC9933', fontWeight: 600, whiteSpace: 'nowrap' }}>{v.LOY ? fmt(v.LOY.montant_ht) : '—'}</td>}
                            {(colsConfig.vir        ?? true)  && <td style={{ padding: '6px 8px', textAlign: 'right', color: '#2d7a50', whiteSpace: 'nowrap' }}>{v.VIR ? fmt(v.VIR.montant_ht) : '—'}</td>}
                            {(colsConfig.debours    ?? false) && <td style={{ padding: '6px 8px', textAlign: 'right', color: r.extra > 0 ? '#DC2626' : '#9C8E7D', whiteSpace: 'nowrap' }}>{r.extra > 0 ? fmt(r.extra) : '—'}</td>}
                            {(colsConfig.menage     ?? false) && <td style={{ padding: '6px 8px', textAlign: 'right', color: '#4A3728', whiteSpace: 'nowrap' }}>{r.menage_voyageur > 0 ? fmt(r.menage_voyageur) : '—'}</td>}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  </div>
                ) : (
                  <p style={{ color: '#9C8E7D', fontStyle: 'italic', fontSize: '0.88em' }}>Aucune réservation ce mois.</p>
                )}
              </div>
            )}

            {/* BLOC 3b — Débours hors forfait (sans réservation liée) */}
            {!vueSynthese && (data.extrasGlobaux || []).length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: '0.8em', fontWeight: 600, color: '#9C8E7D', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Débours hors forfait ({(data.extrasGlobaux || []).length})
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82em' }}>
                  <thead>
                    <tr style={{ background: '#EAE3D4', color: 'var(--text)' }}>
                      <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid var(--brand)' }}>Date</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid var(--brand)' }}>Prestation</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '2px solid var(--brand)' }}>Montant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.extrasGlobaux || []).map((p, i) => (
                      <tr key={p.id} style={{ background: i % 2 === 0 ? '#FDFAF4' : '#F7F3EC' }}>
                        <td style={{ padding: '6px 8px', color: '#4A3728', whiteSpace: 'nowrap' }}>{p.date_prestation ? p.date_prestation.split('-').reverse().join('/') : '—'}</td>
                        <td style={{ padding: '6px 8px', color: 'var(--text)' }}>{p.libelle}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: '#4A3728' }}>{fmt(p.montant)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* BLOC 3c — Achats propriétaire (HAOWNER) */}
            {!vueSynthese && (data.haownerList || []).length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: '0.8em', fontWeight: 600, color: '#9C8E7D', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Achats propriétaire ({(data.haownerList || []).length})
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82em' }}>
                  <thead>
                    <tr style={{ background: '#EAE3D4', color: 'var(--text)' }}>
                      <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid var(--brand)' }}>Date</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid var(--brand)' }}>Description</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '2px solid var(--brand)' }}>Montant TTC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.haownerList || []).map((p, i) => (
                      <tr key={p.id} style={{ background: i % 2 === 0 ? '#FDFAF4' : '#F7F3EC' }}>
                        <td style={{ padding: '6px 8px', color: '#4A3728', whiteSpace: 'nowrap' }}>{p.date_prestation ? p.date_prestation.split('-').reverse().join('/') : '—'}</td>
                        <td style={{ padding: '6px 8px', color: 'var(--text)' }}>{p.libelle}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--brand)', fontWeight: 600 }}>{fmt(p.montant_ttc)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ textAlign: 'right', fontSize: '0.75em', color: '#9C8E7D', marginTop: 4 }}>TVA 20% incluse</div>
              </div>
            )}

            {/* BLOC 4 — Avis voyageurs */}
            {!vueSynthese && data.reviews.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: '0.8em', fontWeight: 600, color: '#9C8E7D', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Avis reçus ({data.reviews.length}) — Moyenne {(data.reviews.reduce((s, r) => s + (r.rating || 0), 0) / data.reviews.length).toFixed(1)}/5
                </div>
                {data.reviews.map(r => (
                  <div key={r.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', borderTop: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--brand)', whiteSpace: 'nowrap' }}>{'★'.repeat(Math.round(r.rating || 0))}</span>
                    <span style={{ fontSize: '0.85em', color: '#4A3728', fontStyle: 'italic', flex: 1 }}>
                      "{r.comment || ''}"
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

            {/* BLOC 5b — Personnalisation Oïhan */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: '0.78em', fontWeight: 600, color: 'var(--brand)', display: 'block', marginBottom: 4 }}>✏️ Personnalisation Oïhan</label>
              <textarea value={notePerso} onChange={e => setNotePerso(e.target.value)} onBlur={handleNotePersoBlur}
                placeholder="Événements du mois, contexte particulier, notes pour le LLM… (invisible dans le PDF)"
                rows={3}
                style={{ width: '100%', border: '1px dashed var(--border)', borderRadius: 6, padding: '8px 10px', fontSize: '0.85em', background: '#FDFAF4', color: 'var(--text)', resize: 'vertical', fontFamily: 'inherit' }} />
              <div style={{ fontSize: '0.7em', color: '#9C8E7D', marginTop: 3 }}>Invisible dans le rapport PDF — utilisé uniquement par l'analyse IA.</div>
            </div>

            {/* BLOC 6 — Analyse IA 3 blocs */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: '0.82em', fontWeight: 700, color: 'var(--brand)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Analyse IA</span>
                <button onClick={() => genererBloc('all')} disabled={generatingBloc !== null}
                  style={{ padding: '4px 12px', border: '1px solid var(--brand)', borderRadius: 10, background: generatingBloc === 'all' ? 'var(--brand)' : 'none', color: generatingBloc === 'all' ? '#fff' : 'var(--brand)', fontSize: '0.78em', cursor: 'pointer', fontWeight: 600, opacity: generatingBloc !== null ? 0.6 : 1 }}>
                  {generatingBloc === 'all' ? 'Génération…' : '✨ Tout générer'}
                </button>
              </div>
              {/* Analyse du mois */}
              <div style={{ marginBottom: 10, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, background: '#fff' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: '0.78em', fontWeight: 600, color: 'var(--brand)' }}>Analyse du mois</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => genererBloc('analyse')} disabled={generatingBloc !== null}
                      style={{ padding: '2px 8px', border: '1px solid var(--brand)', borderRadius: 10, background: 'none', color: 'var(--brand)', fontSize: '0.75em', cursor: 'pointer', fontWeight: 600, opacity: generatingBloc !== null ? 0.6 : 1 }}>
                      {generatingBloc === 'analyse' ? '…' : '✨ Générer'}
                    </button>
                    {llmAnalyse && !editingBloc.analyse && (
                      <button onClick={() => setEditingBloc(b => ({ ...b, analyse: true }))}
                        style={{ padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 10, background: 'none', fontSize: '0.75em', cursor: 'pointer' }}>✏️</button>
                    )}
                  </div>
                </div>
                {llmAnalyse && !editingBloc.analyse ? (
                  <div style={{ fontSize: '0.85em', lineHeight: 1.7, color: 'var(--text)', borderLeft: '3px solid var(--brand)', paddingLeft: 12 }}
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(llmAnalyse) }} />
                ) : (
                  <textarea value={llmAnalyse} onChange={e => setLlmAnalyse(e.target.value)}
                    onBlur={() => { handleLlmBlur(); setEditingBloc(b => ({ ...b, analyse: false })) }}
                    placeholder="Cliquer sur ✨ Générer…" rows={4}
                    style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', fontSize: '0.85em', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical', fontFamily: 'inherit' }} />
                )}
              </div>
              {/* Contexte marché */}
              <div style={{ marginBottom: 10, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, background: '#F7F4EF' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: '0.78em', fontWeight: 600, color: 'var(--brand)' }}>Contexte marché</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => genererBloc('contexte')} disabled={generatingBloc !== null}
                      style={{ padding: '2px 8px', border: '1px solid var(--brand)', borderRadius: 10, background: 'none', color: 'var(--brand)', fontSize: '0.75em', cursor: 'pointer', fontWeight: 600, opacity: generatingBloc !== null ? 0.6 : 1 }}>
                      {generatingBloc === 'contexte' ? '…' : '✨ Générer'}
                    </button>
                    {llmContexte && !editingBloc.contexte && (
                      <button onClick={() => setEditingBloc(b => ({ ...b, contexte: true }))}
                        style={{ padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 10, background: 'none', fontSize: '0.75em', cursor: 'pointer' }}>✏️</button>
                    )}
                  </div>
                </div>
                {llmContexte && !editingBloc.contexte ? (
                  <div style={{ fontSize: '0.85em', lineHeight: 1.7, color: 'var(--text)' }}
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(llmContexte) }} />
                ) : (
                  <textarea value={llmContexte} onChange={e => setLlmContexte(e.target.value)}
                    onBlur={() => { handleContexteBlur(); setEditingBloc(b => ({ ...b, contexte: false })) }}
                    placeholder="Cliquer sur ✨ Générer…" rows={3}
                    style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', fontSize: '0.85em', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical', fontFamily: 'inherit' }} />
                )}
              </div>
              {/* Perspectives M+1/M+2 */}
              <div style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, background: '#fff' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: '0.78em', fontWeight: 600, color: 'var(--brand)' }}>Perspectives M+1/M+2</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => genererBloc('tendances')} disabled={generatingBloc !== null}
                      style={{ padding: '2px 8px', border: '1px solid var(--brand)', borderRadius: 10, background: 'none', color: 'var(--brand)', fontSize: '0.75em', cursor: 'pointer', fontWeight: 600, opacity: generatingBloc !== null ? 0.6 : 1 }}>
                      {generatingBloc === 'tendances' ? '…' : '✨ Générer'}
                    </button>
                    {llmTendances && !editingBloc.tendances && (
                      <button onClick={() => setEditingBloc(b => ({ ...b, tendances: true }))}
                        style={{ padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 10, background: 'none', fontSize: '0.75em', cursor: 'pointer' }}>✏️</button>
                    )}
                  </div>
                </div>
                {llmTendances && !editingBloc.tendances ? (
                  <div style={{ fontSize: '0.85em', lineHeight: 1.7, color: 'var(--text)', borderLeft: '3px solid var(--brand)', paddingLeft: 12 }}
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(llmTendances) }} />
                ) : (
                  <textarea value={llmTendances} onChange={e => setLlmTendances(e.target.value)}
                    onBlur={() => { handleTendancesBlur(); setEditingBloc(b => ({ ...b, tendances: false })) }}
                    placeholder="Cliquer sur ✨ Générer…" rows={3}
                    style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', fontSize: '0.85em', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical', fontFamily: 'inherit' }} />
                )}
              </div>
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
              <input type="text" value={email} onChange={e => setEmail(e.target.value)} onBlur={handleEmailBlur}
                placeholder="Email(s) propriétaire — séparer par des virgules"
                style={{ flex: 1, minWidth: 220, fontSize: '0.88em', padding: '8px 10px',
                  border: `1px solid ${email ? '#059669' : '#D97706'}`, borderRadius: 6,
                  background: email ? '#F0FDF4' : '#FFFBEB', color: 'var(--text)', outline: 'none' }}
              />
              <button className="btn btn-secondary" style={{ fontSize: '0.85em', padding: '8px 14px' }}
                onClick={() => setPreviewOpen(true)}>Aperçu</button>
              <button onClick={telechargerPDF} disabled={!data || generatingPDF} className="btn btn-secondary"
                style={{ fontSize: '0.85em', padding: '8px 14px' }}>{generatingPDF ? '⏳ Génération...' : '⬇ PDF'}</button>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82em', color: 'var(--text)', cursor: 'pointer', marginRight: 4 }}>
                <input type="checkbox" checked={joindrePDF} onChange={e => setJoindrePDF(e.target.checked)} style={{ cursor: 'pointer' }} />
                Joindre la facture PDF Evoliz
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82em', color: 'var(--text)', cursor: 'pointer', marginRight: 4 }}>
                <input type="checkbox" checked={useStatement} onChange={e => setUseStatement(e.target.checked)} style={{ cursor: 'pointer' }} />
                Version statement
              </label>
              <button style={{ padding: '8px 14px', border: '1px solid var(--border)', borderRadius: 8, background: 'none', fontSize: '0.85em', cursor: 'pointer' }}
                onClick={() => setShowMailPreview(true)} disabled={!data}>
                👁 Aperçu mail
              </button>
              <button className="btn btn-primary"
                style={{ fontSize: '0.85em', padding: '8px 14px', background: 'var(--brand)', color: '#fff', border: 'none', opacity: statut === 'sending' ? 0.6 : 1 }}
                onClick={envoyer} disabled={statut === 'sending' || !email}>
                {statut === 'sending' ? '…' : 'Envoyer'}
              </button>
            </div>
            {statut === 'error' && erreurDetail && (
              <div style={{ marginTop: 8, padding: '8px 12px', background: '#fff0f0', border: '1px solid #f5c6c6', borderRadius: 6, fontSize: '0.78em', color: '#c0392b' }}>
                ⚠️ {erreurDetail}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal aperçu mail */}
      {showMailPreview && data && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowMailPreview(false)}>
          <div style={{ background: 'var(--bg)', borderRadius: 12, width: '80%', maxWidth: 700, maxHeight: '90vh', overflow: 'auto', padding: 24 }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: '1em' }}>Aperçu du mail</h3>
              <button onClick={() => setShowMailPreview(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2em' }}>×</button>
            </div>
            <div style={{ fontSize: '0.82em', background: 'var(--bg-secondary, #F0EBE1)', padding: '12px 16px', borderRadius: 8, marginBottom: 16, lineHeight: 1.8, border: '1px solid var(--border)' }}>
              <div><strong>De :</strong> oihan@destinationcotebasque.com</div>
              <div><strong>À :</strong> {email || '(email non renseigné)'}</div>
              <div><strong>Objet :</strong> Rapport mensuel {moisLabel} - Destination Cote Basque - {data.bien?.hospitable_name || data.proprio?.nom}</div>
              {useStatement && <div><strong>PJ :</strong> 📎 Statement PDF (paysage)</div>}
              {joindrePDF && <div><strong>PJ :</strong> 📎 Facture PDF Evoliz</div>}
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', height: 500 }}>
              <iframe srcDoc={getMailHTML()} style={{ width: '100%', height: '100%', border: 'none' }} title="Aperçu mail" />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowMailPreview(false)} style={{ padding: '8px 16px', border: '1px solid var(--border)', borderRadius: 8, background: 'none', cursor: 'pointer' }}>Fermer</button>
              <button onClick={() => { setShowMailPreview(false); envoyer() }} style={{ padding: '8px 16px', background: 'var(--brand)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>✉️ Envoyer</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal aperçu */}
      {previewOpen && data && (() => {
        const html = getHTML()
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
