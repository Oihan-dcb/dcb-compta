import { useState, useEffect, useCallback, useRef } from 'react'
import MoisSelector, { MOIS_FR } from '../components/MoisSelector'
import { useMoisPersisted } from '../hooks/useMoisPersisted'
import { supabase } from '../lib/supabase'
import {
  genererRapportHTML, envoyerRapportEmail
} from '../services/rapportProprietaire'
import { genererStatementHTML, genererMailStatementHTML } from '../services/rapportStatement'
import { buildRapportData as buildRapportDataService } from '../services/buildRapportData'
import { STATUTS_NON_VENTILABLES } from '../lib/constants'
import { AGENCE } from '../lib/agence'

const moisCourant = new Date().toISOString().substring(0, 7)
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
  const [mois, setMois] = useMoisPersisted()
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
  const [saisirMenageId, setSaisirMenageId] = useState(null)
  const [saisirMontant, setSaisirMontant] = useState('')
  const [savingMenage, setSavingMenage] = useState(false)
  const reqRef = useRef(0)

  useEffect(() => {
    supabase
      .from('proprietaire')
      .select('id, nom, email, bien!inner(id, code, hospitable_name, ville, listed, agence, groupe_facturation, rapport_config)')
      .eq('bien.agence', AGENCE)
      .eq('actif', true)
      .order('nom')
      .then(({ data: props }) => {
        setProprietaires(props || [])
        if (props?.length) {
          const maiteOwner = props.find(p => (p.bien || []).some(b => b.groupe_facturation === 'MAITE'))
          setSelectedPropId((maiteOwner || props[0]).id)
        }
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
    const biens = (proprio?.bien || []).filter(b => b.listed && b.agence === AGENCE)
    const maiteFirst = biens.find(b => b.groupe_facturation === 'MAITE')
    setSelectedBienId((maiteFirst || biens[0])?.id || '')
    setData(null)
    setColsConfig({})
    setEmail('')
    setLoading(true)
    setNote('')
    setNoteReco('')
    setLlmAnalyse('')
    setLlmContexte('')
    setLlmTendances('')
    setEditingBloc({ analyse: false, contexte: false, tendances: false })
    setStatut('idle')
    setPreviewOpen(false)
    setModeMaite('chambre')
  }, [selectedPropId, proprietaires])

  useEffect(() => {
    setData(null)
    setStatut('idle')
    setPreviewOpen(false)
    setBienIdsActifs(null)
    Promise.all([
      supabase.from('reservation').select('bien_id').eq('mois_comptable', mois)
        .or('fin_revenue.gt.0,final_status.not.in.("cancelled","not_accepted","declined","expired")'),
      supabase.from('bien_notes').select('bien_id').eq('mois', mois).not('rapport_envoye_at', 'is', null),
    ]).then(([{ data: resasBiens }, { data: rapports }]) => {
      setBienIdsActifs(new Set((resasBiens || []).map(r => r.bien_id)))
      setBiensEnvoyes(new Set((rapports || []).map(r => r.bien_id)))
    })
  }, [mois])

  // Quand bienIdsActifs filtre les proprios, si selectedPropId n'est plus visible
  // dans le dropdown (filtré car pas de resas ce mois), le <select> affiche visuellement
  // le premier item mais l'état reste sur l'ancien proprio → données incorrectes.
  // Ce guard resélectionne le premier proprio valide (MAITE en priorité).
  useEffect(() => {
    if (bienIdsActifs === null || !proprietaires.length) return
    const filtered = proprietaires.filter(p => (p.bien || []).some(b => bienIdsActifs.has(b.id)))
    if (!filtered.length || filtered.some(p => p.id === selectedPropId)) return
    const maiteFirst = filtered.find(p => (p.bien || []).some(b => b.groupe_facturation === 'MAITE'))
    setSelectedPropId((maiteFirst || filtered[0]).id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bienIdsActifs, proprietaires])

  const saveMenageProprio = async (row) => {
    const montantCents = Math.round(parseFloat(saisirMontant.replace(',', '.')) * 100)
    if (isNaN(montantCents) || montantCents <= 0) return
    setSavingMenage(true)
    try {
      await supabase.from('ventilation').upsert({
        reservation_id: row.id,
        bien_id: row.bien_id,
        mois: mois,
        code: 'FMEN',
        libelle: 'Forfait ménage séjour propriétaire',
        montant_ht: montantCents,
        montant_ttc: montantCents,
      }, { onConflict: 'reservation_id,code' })
      setSaisirMenageId(null)
      setSaisirMontant('')
      await charger()
    } finally {
      setSavingMenage(false)
    }
  }

  const charger = useCallback(async () => {
    if (!selectedBienId || !selectedPropId) return
    // Guard race condition : selectedBienId doit appartenir à selectedPropId
    // (état intermédiaire pendant le changement de proprio)
    const proprio = proprietaires.find(p => p.id === selectedPropId)
    const bienIds = (proprio?.bien || []).map(b => b.id)
    if (!bienIds.includes(selectedBienId)) return
    const reqId = ++reqRef.current
    setLoading(true)
    setError(null)
    try {
      setEmail(proprio?.email || '')
      const maiteIdsLocal = (proprio?.bien || []).filter(b => b.groupe_facturation === 'MAITE').map(b => b.id)
      const isGlobal = modeMaite === 'global' && maiteIdsLocal.length > 0

      // Notes (UI state) + données métier en parallèle
      const [notesRow, result] = await Promise.all([
        supabase.from('bien_notes')
          .select('note_marche, note_recommandations, note_analyse_llm, note_contexte, note_tendances, note_personnalisation')
          .eq('bien_id', selectedBienId).eq('mois', mois).maybeSingle()
          .then(r => r.data || {}),
        buildRapportDataService(selectedBienId, selectedPropId, mois, { isGlobal, maiteIds: maiteIdsLocal }),
      ])

      setNote(notesRow.note_marche || '')
      setNoteReco(notesRow.note_recommandations || '')
      setLlmAnalyse(notesRow.note_analyse_llm || '')
      setLlmContexte(notesRow.note_contexte || '')
      setLlmTendances(notesRow.note_tendances || '')
      setNotePerso(notesRow.note_personnalisation || '')

      const { kpis, kpisN1, reviews } = result
      const alertes = []
      if (kpis.tauxOcc < 50 && kpis.nbResas > 0) alertes.push({ type: 'warn', msg: `Taux d'occupation faible (${kpis.tauxOcc} %)` })
      if (reviews.length === 0 && kpis.nbResas > 0) alertes.push({ type: 'info', msg: 'Aucun avis reçu ce mois' })
      if (!proprio?.email) alertes.push({ type: 'warn', msg: 'Email propriétaire manquant' })
      if (kpisN1.caHeb > 0 && kpis.caHeb < kpisN1.caHeb * 0.8) alertes.push({ type: 'warn', msg: `CA en baisse vs N-1 (${fmt(kpis.caHeb)} vs ${fmt(kpisN1.caHeb)})` })

      if (reqRef.current !== reqId) return
      setData({
        ...result,
        proprio,
        bien: (proprio?.bien || []).find(b => b.id === selectedBienId),
        alertes,
      })
    } catch (err) {
      if (reqRef.current !== reqId) return
      setError(err.message)
    } finally {
      if (reqRef.current === reqId) setLoading(false)
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
        `https://api.open-meteo.com/v1/forecast?latitude=${meteoLat}&longitude=${meteoLon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,sunshine_duration&timezone=Europe%2FParis&past_days=31&forecast_days=14`
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
    const bienVille = data.bien?.ville || ''
    const isBordeaux = bienVille.toLowerCase().includes('bordeaux')
    const villeLabel = isBordeaux ? 'Bordeaux' : 'la Côte Basque'
    const agenceLabel = isBordeaux ? 'Destination Bordeaux' : 'Destination Côte Basque'
    const meteoLat = isBordeaux ? '44.84' : '43.48'
    const meteoLon = isBordeaux ? '-0.58' : '-1.56'

    const [m1yr, m1mo] = m1.split('-').map(Number)
    const [m2yr, m2mo] = m2.split('-').map(Number)
    const nextMoisLabel = MOIS_FR[m1mo - 1] + ' ' + m1yr
    const nextNextMoisLabel = MOIS_FR[m2mo - 1] + ' ' + m2yr
    const totalNuitsFutures = (resasFutures || []).reduce((s, r) => s + (r.nights || 0), 0)
    const meteoPrevisions = meteoFutur || 'Données météo non disponibles pour les prochaines semaines.'

    const SYSTEM_PROMPT = `Tu es Oïhan, gérant de ${agenceLabel}.
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
- Lecture du niveau de demande locative à ${villeLabel} ce mois
- Mise en perspective du marché local (événements, vacances, dynamique de la destination)

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

  // Assemble le payload pour les renderers HTML (injecte les textes LLM/notes qui sont UI state)
  function buildRendererPayload() {
    const bienEffectif = (isMaite && modeMaite === 'global')
      ? { ...data.bien, hospitable_name: 'Maison Maïté' }
      : data.bien
    return {
      kpis: data.kpis, resas: data.resas, reviews: data.reviews,
      bien: bienEffectif, llmAnalyse, llmContexte, llmTendances, kpisN1: data.kpisN1,
      noteMoisMoy: data.noteMoisMoy, noteGlobaleMoy: data.noteGlobaleMoy,
      nbReviewsGlobal: data.nbReviewsGlobal,
      notes: [{ bienName: bienEffectif?.hospitable_name, note }],
      noteContexte: note,
      noteReco,
      tauxCommission: data.tauxCommission || 0,
      extrasGlobaux: data?.extrasGlobaux || [],
      extrasParResa: data?.extrasParResa || [],
      haownerList: data?.haownerList || [],
      ownerStayMenageList: data?.ownerStayList || [],
      fraisProprietaire: data?.frais || [],
      colonnes: colsConfig,
    }
  }

  function getHTML() {
    const rapportData = buildRendererPayload()
    return useStatement
      ? genererStatementHTML(data.proprio, mois, rapportData)
      : genererRapportHTML(data.proprio, mois, rapportData, rapportData.colonnes)
  }

  function getMailHTML() {
    const rapportData = buildRendererPayload()
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
        const rapportData = buildRendererPayload()
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
      await envoyerRapportEmail({ ...data.proprio, email: emails, bienName }, mois, htmlBody, joindrePDF, prependAttachments)
      console.log('[envoyer] étape 5 — bien_notes upsert')
      await supabase.from('bien_notes').upsert(
        { bien_id: selectedBienId, mois, rapport_envoye_at: new Date().toISOString() },
        { onConflict: 'bien_id,mois' }
      )
      setBiensEnvoyes(prev => new Set([...prev, selectedBienId]))
      setStatut('sent')
    } catch (e) {
      console.error('ERREUR ENVOI STATEMENT:', e)
      if (e?.uncertainSend) {
        setStatut('envoi_incertain')
        setErreurDetail(e?.message || String(e))
      } else {
        setStatut('error')
        setErreurDetail(e?.message || String(e))
      }
    }
  }

  const proprio = proprietaires.find(p => p.id === selectedPropId)
  const biensActifs = (proprio?.bien || []).filter(b => b.listed && b.agence === AGENCE)
  const isMaite = (proprio?.bien || []).some(b => b.groupe_facturation === 'MAITE')
  const maiteIds = (proprio?.bien || []).filter(b => b.groupe_facturation === 'MAITE').map(b => b.id)
  const biensActifsMaite = biensActifs.filter(b => b.groupe_facturation === 'MAITE')
  const propsFiltres = (bienIdsActifs === null
    ? proprietaires
    : proprietaires.filter(p => (p.bien || []).some(b => bienIdsActifs.has(b.id)))
  ).map(p => ({
    ...p,
    bien: [...(p.bien || [])].sort((a, b) => (a.code || '').localeCompare(b.code || '')),
  })).sort((a, b) => {
    const aMaite = (a.bien || []).some(b => b.groupe_facturation === 'MAITE') ? 0 : 1
    const bMaite = (b.bien || []).some(b => b.groupe_facturation === 'MAITE') ? 0 : 1
    if (aMaite !== bMaite) return aMaite - bMaite
    const codeA = (a.bien?.[0]?.code || '').toLowerCase()
    const codeB = (b.bien?.[0]?.code || '').toLowerCase()
    return codeA.localeCompare(codeB)
  })
  const [year, monthIdx] = mois.split('-')
  const moisLabel = MOIS_FR[parseInt(monthIdx) - 1] + ' ' + year

  const STATUT_STYLES = {
    idle:             { label: 'Non envoyé',     color: '#9C8E7D', bg: '#F0EBE1' },
    sending:          { label: 'Envoi…',         color: '#D97706', bg: '#FEF3C7' },
    sent:             { label: 'Envoyé ✓',       color: '#059669', bg: '#D1FAE5' },
    error:            { label: 'Erreur',         color: '#DC2626', bg: '#FEE2E2' },
    envoi_incertain:  { label: 'Envoi incertain',color: '#D97706', bg: '#FEF3C7' },
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
            const isMaiteP = (p.bien || []).some(b => b.groupe_facturation === 'MAITE')
            const codes = isMaiteP
              ? 'Maison Maïté'
              : (p.bien || []).filter(b => b.listed && b.agence === AGENCE).map(b => b.code).filter(Boolean).join(', ')
            return (
              <option key={p.id} value={p.id} style={{ color: bienEnvoye ? '#9C8E7D' : 'inherit' }}>
                {bienEnvoye ? '✓ ' : ''}{codes ? `${codes} — ` : ''}{p.nom}
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
            {(isMaite && modeMaite !== 'global' ? biensActifsMaite : biensActifs).map(b => <option key={b.id} value={b.id}>{b.code ? `${b.code} — ` : ''}{b.hospitable_name}</option>)}
          </select>
        )}
        <button onClick={charger} disabled={loading}
          style={{ padding: '8px 14px', border: '1px solid var(--border)', borderRadius: 8, background: '#fff', color: 'var(--text)', fontSize: '0.88em', cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.5 : 1 }}>
          ↻ Actualiser
        </button>
      </div>

{error && <div style={{ background: '#FEE2E2', color: '#DC2626', padding: '10px 14px', borderRadius: 8, marginBottom: 16 }}>{error}</div>}
      {loading && !data && <div style={{ color: '#9C8E7D', marginBottom: 16 }}>Chargement…</div>}

      {data && (
        <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          {/* Header card */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', background: '#EAE3D4', borderBottom: '2px solid var(--brand)', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: '1.05em', flex: 1 }}>
              {modeMaite === 'global' ? 'Maison Maïté' : (data.bien?.hospitable_name || proprio?.nom)} — {moisLabel}
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
                    { key: 'brut',      label: 'Brut voyageur',  def: false },
                    { key: 'net_plat',  label: 'Net plateforme', def: false },
                    { key: 'base_comm', label: 'Base comm.',     def: true  },
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
                            {(colsConfig.net_plat   ?? false) && thF('Net plateforme', true)}
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
                            {(colsConfig.brut      ?? false) && <td style={{ padding: '6px 8px', textAlign: 'right', color: '#4A3728', whiteSpace: 'nowrap' }}>{r.owner_stay ? '—' : fmt(r.gross_revenue || 0)}</td>}
                            {(colsConfig.net_plat   ?? false) && <td style={{ padding: '6px 8px', textAlign: 'right', color: '#4A3728', whiteSpace: 'nowrap' }}>{r.owner_stay ? '—' : fmt(r.fin_revenue || 0)}</td>}
                            {(colsConfig.base_comm  ?? true)  && <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text)', whiteSpace: 'nowrap' }}>{r.owner_stay ? '—' : fmt(r.base_comm || 0)}</td>}
                            {(colsConfig.hon        ?? true)  && <td style={{ padding: '6px 8px', textAlign: 'right', color: '#9c8c7a', whiteSpace: 'nowrap' }}>{v.HON ? fmt(v.HON.montant_ttc) : '—'}</td>}
                            {(colsConfig.loy        ?? true)  && <td style={{ padding: '6px 8px', textAlign: 'right', color: '#CC9933', fontWeight: 600, whiteSpace: 'nowrap' }}>{v.LOY ? fmt(v.LOY.montant_ht) : '—'}</td>}
                            {(colsConfig.vir        ?? true)  && <td style={{ padding: '6px 8px', textAlign: 'right', color: '#2d7a50', whiteSpace: 'nowrap' }}>{v.VIR ? fmt(v.VIR.montant_ht) : '—'}</td>}
                            {(colsConfig.debours    ?? false) && <td style={{ padding: '6px 8px', textAlign: 'right', color: r.extra > 0 ? '#DC2626' : '#9C8E7D', whiteSpace: 'nowrap' }}>{r.extra > 0 ? fmt(r.extra) : '—'}</td>}
                            {(colsConfig.menage     ?? false) && <td style={{ padding: '6px 8px', textAlign: 'right', color: '#4A3728', whiteSpace: 'nowrap' }}>{r.menage_voyageur > 0 ? fmt(r.menage_voyageur) : '—'}</td>}
                          </tr>
                        )
                      })}
                      {(() => {
                        const tot = data.resas.reduce((acc, r) => {
                          const v = r.vent
                          acc.brut      += r.gross_revenue || 0
                          acc.net_plat  += r.owner_stay ? 0 : (r.fin_revenue || 0)
                          acc.base_comm += r.base_comm || 0
                          acc.hon       += v.HON?.montant_ttc || 0
                          acc.loy       += v.LOY?.montant_ht  || 0
                          acc.vir       += v.VIR?.montant_ht  || 0
                          acc.debours   += r.extra || 0
                          acc.menage    += r.menage_voyageur || 0
                          return acc
                        }, { brut: 0, net_plat: 0, base_comm: 0, hon: 0, loy: 0, vir: 0, debours: 0, menage: 0 })
                        const S = { padding: '8px 8px', fontWeight: 700, whiteSpace: 'nowrap', borderTop: '2px solid var(--brand)', background: '#EAE3D4' }
                        const tdT = (val, color) => <td style={{ ...S, textAlign: 'right', color: color || 'var(--text)' }}>{fmt(val)}</td>
                        return (
                          <tr>
                            <td colSpan={5} style={{ ...S, color: 'var(--text)', letterSpacing: '0.05em', fontSize: '0.9em' }}>TOTAL</td>
                            {(colsConfig.brut      ?? false) && tdT(tot.brut)}
                            {(colsConfig.net_plat   ?? false) && tdT(tot.net_plat)}
                            {(colsConfig.base_comm  ?? true)  && tdT(tot.base_comm)}
                            {(colsConfig.hon        ?? true)  && tdT(tot.hon,      '#9c8c7a')}
                            {(colsConfig.loy        ?? true)  && tdT(tot.loy,      '#CC9933')}
                            {(colsConfig.vir        ?? true)  && tdT(tot.vir,      '#2d7a50')}
                            {(colsConfig.debours    ?? false) && tdT(tot.debours)}
                            {(colsConfig.menage     ?? false) && tdT(tot.menage)}
                          </tr>
                        )
                      })()}
                    </tbody>
                  </table>
                  </div>
                ) : (
                  <p style={{ color: '#9C8E7D', fontStyle: 'italic', fontSize: '0.88em' }}>Aucune réservation ce mois.</p>
                )}
              </div>
            )}

            {/* BLOC 3b/3c/4b — Charges DCB */}
            {!vueSynthese && ((data.extrasGlobaux || []).length > 0 || (data.haownerList || []).length > 0 || data.frais.length > 0 || (data.ownerStayList || []).length > 0) && (() => {
              const total = (data.extrasGlobaux || []).length + (data.haownerList || []).length + data.frais.length + (data.ownerStayList || []).length
              const allRows = [
                ...(data.extrasGlobaux || []).map(p => ({ ...p, _type: 'debours' })),
                ...(data.haownerList || []).map(p => ({ ...p, _type: 'achat' })),
                ...(data.ownerStayList || []).map(p => ({ ...p, _type: 'menage_proprio' })),
                ...data.frais.map(f => ({ ...f, _type: 'frais' })),
              ]
              return (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: '0.8em', fontWeight: 600, color: '#9C8E7D', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Charges DCB ({total})
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82em' }}>
                    <thead>
                      <tr style={{ background: '#EAE3D4', color: 'var(--text)' }}>
                        <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid var(--brand)' }}>Date</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid var(--brand)' }}>Type</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid var(--brand)' }}>Description</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '2px solid var(--brand)' }}>Montant</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid var(--brand)' }}>Statut</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allRows.map((row, i) => {
                        const isDebours     = row._type === 'debours'
                        const isAchat       = row._type === 'achat'
                        const isFrais       = row._type === 'frais'
                        const isMenageProprio = row._type === 'menage_proprio'
                        const date = isMenageProprio
                          ? (row.arrival_date ? row.arrival_date.split('-').reverse().join('/') : '—')
                          : isDebours || isAchat
                          ? (row.date_prestation ? row.date_prestation.split('-').reverse().join('/') : '—')
                          : (row.date ? row.date.split('-').reverse().join('/') : '—')
                        const label   = isMenageProprio
                          ? `${row.libelle || 'Ménage séjour propriétaire'}${row.guest_name ? ` — ${row.guest_name}` : ''}`
                          : row.libelle || row.description || '—'
                        const isRemboursement = isFrais && row.mode_traitement === 'remboursement'
                        const typeLabel = isDebours ? 'Débours' : isAchat ? 'Achat' : isMenageProprio ? 'Ménage' : isRemboursement ? 'Remboursement' : 'Frais'
                        const typeColor = isDebours ? '#9C8E7D' : isAchat ? 'var(--brand)' : isMenageProprio ? '#4A3728' : isRemboursement ? '#059669' : '#c2410c'
                        // Montant cell — pour les frais facturés, décomposer déduit vs reliquat
                        const fraisFacture = isFrais && row.statut === 'facture' && row.statut_deduction && row.statut_deduction !== 'en_attente'
                        const montantCell = isAchat
                          ? <span style={{ color: 'var(--brand)', fontWeight: 600 }}>{fmt(row.montant_ttc)}</span>
                          : isMenageProprio
                          ? row.a_saisir
                            ? saisirMenageId === row.id
                              ? <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <input
                                    type="text" value={saisirMontant}
                                    onChange={e => setSaisirMontant(e.target.value)}
                                    placeholder="0.00"
                                    style={{ width: 70, padding: '2px 6px', border: '1px solid var(--brand)', borderRadius: 4, fontSize: '0.9em' }}
                                    onKeyDown={e => { if (e.key === 'Enter') saveMenageProprio(row); if (e.key === 'Escape') { setSaisirMenageId(null); setSaisirMontant('') } }}
                                    autoFocus
                                  />
                                  <button onClick={() => saveMenageProprio(row)} disabled={savingMenage}
                                    style={{ padding: '2px 8px', background: 'var(--brand)', color: '#fff', border: 'none', borderRadius: 4, fontSize: '0.85em', cursor: 'pointer' }}>
                                    {savingMenage ? '…' : '✓'}
                                  </button>
                                  <button onClick={() => { setSaisirMenageId(null); setSaisirMontant('') }}
                                    style={{ padding: '2px 6px', background: 'transparent', border: '1px solid #D9CEB8', borderRadius: 4, fontSize: '0.85em', cursor: 'pointer' }}>
                                    ✕
                                  </button>
                                </span>
                              : <button onClick={() => { setSaisirMenageId(row.id); setSaisirMontant('') }}
                                  style={{ background: 'none', border: 'none', color: '#B45309', fontStyle: 'italic', fontSize: '0.9em', textDecoration: 'underline', cursor: 'pointer', padding: 0 }}>
                                  à saisir →
                                </button>
                            : <span style={{ color: '#4A3728' }}>{fmt(row.montant)}</span>
                          : isDebours
                          ? <span style={{ color: '#4A3728' }}>{fmt(row.montant)}</span>
                          : fraisFacture && row.statut_deduction !== 'totalement_deduit'
                          ? <span style={{ lineHeight: 1.5 }}>
                              {row.montant_deduit_loy > 0 && <span style={{ display: 'block', color: '#059669', fontSize: '0.9em' }}>↓ {fmt(row.montant_deduit_loy)} déduit</span>}
                              {row.montant_reliquat > 0  && <span style={{ display: 'block', color: '#DC2626', fontSize: '0.9em' }}>! {fmt(row.montant_reliquat)} reliquat</span>}
                            </span>
                          : isRemboursement
                          ? <span style={{ color: '#059669', fontWeight: 600 }}>+ {fmt(row.montant_ttc)}</span>
                          : <span style={{ color: '#DC2626' }}>{fmt(row.montant_ttc)}</span>
                        // Badge statut
                        const DEDUCTION_BADGE = {
                          totalement_deduit:    { label: 'Déduit ✓',   color: '#059669', bg: '#D1FAE5' },
                          partiellement_deduit: { label: 'Partiel ⚠',  color: '#B45309', bg: '#FFF7ED' },
                          non_deduit:           { label: 'Reliquat',   color: '#DC2626', bg: '#FEE2E2' },
                        }
                        const fraisBadge = isFrais
                          ? (DEDUCTION_BADGE[row.statut_deduction] || { label: row.statut || 'en attente', color: '#B45309', bg: '#FEF3C7' })
                          : isMenageProprio && row.a_saisir
                          ? { label: '⚠ À saisir', color: '#92400e', bg: '#FEF3C7' }
                          : null
                        return (
                          <tr key={`${row._type}-${row.id}`} style={{ background: i % 2 === 0 ? '#FDFAF4' : '#F7F3EC' }}>
                            <td style={{ padding: '6px 8px', color: '#4A3728', whiteSpace: 'nowrap' }}>{date}</td>
                            <td style={{ padding: '6px 8px', color: typeColor, fontWeight: 500, whiteSpace: 'nowrap' }}>{typeLabel}</td>
                            <td style={{ padding: '6px 8px', color: 'var(--text)' }}>{label}{isAchat && <span style={{ fontSize: '0.8em', color: '#9C8E7D', marginLeft: 4 }}>TTC</span>}</td>
                            <td style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>{montantCell}</td>
                            <td style={{ padding: '6px 8px' }}>
                              {fraisBadge && (
                                <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: '0.78em', fontWeight: 600,
                                  background: fraisBadge.bg, color: fraisBadge.color }}>
                                  {fraisBadge.label}
                                </span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            })()}

            {/* BLOC 5 — Avis voyageurs */}
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
            {statut === 'envoi_incertain' && (
              <div style={{ marginTop: 8, padding: '10px 14px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 6, fontSize: '0.78em', color: '#92400e' }}>
                <div style={{ marginBottom: 8 }}>
                  ⚠️ Envoi incertain : une erreur réseau est survenue après l'envoi. Dans certains cas, l'email est quand même bien parti. Vérifie la réception avant de relancer.
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    style={{ padding: '4px 10px', border: '1px solid #d97706', borderRadius: 5, background: '#fff', color: '#92400e', fontSize: '0.9em', cursor: 'pointer' }}
                    onClick={async () => {
                      await supabase.from('bien_notes').upsert(
                        { bien_id: selectedBienId, mois, rapport_envoye_at: new Date().toISOString() },
                        { onConflict: 'bien_id,mois' }
                      )
                      setBiensEnvoyes(prev => new Set([...prev, selectedBienId]))
                      setStatut('sent')
                    }}>
                    Marquer comme envoyé
                  </button>
                  <button
                    style={{ padding: '4px 10px', border: '1px solid #d97706', borderRadius: 5, background: '#fff', color: '#92400e', fontSize: '0.9em', cursor: 'pointer' }}
                    onClick={() => { setStatut('idle'); setErreurDetail('') }}>
                    Réessayer
                  </button>
                </div>
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
