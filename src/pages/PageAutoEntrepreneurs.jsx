import { AGENCE } from '../lib/agence'
import { useState, useEffect } from 'react'
import { getAutoEntrepreneurs, saveAutoEntrepreneur, deleteAutoEntrepreneur, createAEWithAuth, createAEAccess, resetAEPassword } from '../services/autoEntrepreneurs'
import { supabase } from '../lib/supabase'

function escapeHtml(str) {
  if (!str) return ''
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const EMPTY_AE = {
  nom: '', prenom: '', siret: '', adresse: '', code_postal: '', ville: '',
  email: '', telephone: '', iban: '', ical_url: '', ical_pro: '', ical_perso: '', taux_horaire: 2500, note: '', actif: true, type: 'ae'
}

export default function PageAutoEntrepreneurs() {
  const [aes, setAes] = useState([])
  const [prestationTypes, setPrestationTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState(() => localStorage.getItem('tab_ae') || 'vision') // 'vision' | 'aes' | 'prestations'
  useEffect(() => localStorage.setItem('tab_ae', tab), [tab])
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_AE)
  const [saving, setSaving] = useState(false)
  const [credentials, setCredentials] = useState(null)
  const [syncMois, setSyncMois] = useState(() => new Date().toISOString().slice(0, 7))
  const [syncing, setSyncing] = useState(false)
  const [syncResults, setSyncResults] = useState(null) // { email, password, nom } après création
  const [moisBalance, setMoisBalance] = useState(() => new Date().toISOString().slice(0, 7))
  const [balance, setBalance] = useState(null) // { nb_auto, auto_provision, auto_saisis, auto_reel, fmen_provision, fmen_reel }
  const [visionMois, setVisionMois] = useState(() => new Date().toISOString().slice(0, 7))
  const [visionData, setVisionData] = useState([])
  const [loadingVision, setLoadingVision] = useState(false)
  const [virementsAE, setVirementsAE] = useState([])
  const [liensVirementsAE, setLiensVirementsAE] = useState({})
  const [commentairesAE, setCommentairesAE] = useState({})
  const [loadingVirementsAE, setLoadingVirementsAE] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [confirmModal, setConfirmModal] = useState(null)
  // Heures staff
  const [heuresMois, setHeuresMois] = useState(() => new Date().toISOString().slice(0, 7))
  const [heuresAeId, setHeuresAeId] = useState(null)
  const [heures, setHeures] = useState({})
  const [loadingHeures, setLoadingHeures] = useState(false)
  const [sendingNavette, setSendingNavette] = useState(false)
  const [showAperçuNavette, setShowAperçuNavette] = useState(false)
  // Saisie en groupe
  const [groupeActif, setGroupeActif] = useState(false)
  const [joursSelectionnes, setJoursSelectionnes] = useState(new Set())
  const [groupeDebut, setGroupeDebut] = useState('09:00')
  const [groupeFin, setGroupeFin] = useState('17:00')
  const [groupePause, setGroupePause] = useState(60)
  // Prestation type form
  const [editingPT, setEditingPT] = useState(null)
  const [formPT, setFormPT] = useState({ nom: '', description: '', taux_defaut: 25, unite: 'heure' })
  const [errorPT, setErrorPT] = useState(null)

  useEffect(() => {
    charger(true)  // autoSync au chargement
    chargerVision(visionMois)
    // Realtime : rafraîchit si des missions ou des AEs sont ajoutés/modifiés
    const channel = supabase.channel('ae-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mission_menage' },
        () => charger()
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'auto_entrepreneur' },
        () => charger()
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  async function charger(autoSync = false) {
    setLoading(true)
    try {
      const [aesData, ptData] = await Promise.all([
        getAutoEntrepreneurs(),
        supabase.from('prestation_type').select('*').order('nom').then(r => r.data || [])
      ])
      setAes(aesData)
      setPrestationTypes(ptData)
      if (autoSync) {
        const moisCourant = new Date().toISOString().slice(0, 7)
        syncTousLesAEs(aesData, moisCourant)
      }
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  // ── Heures staff ──────────────────────────────────────────────────────
  function getDaysOfMonth(mois) {
    const [y, m] = mois.split('-').map(Number)
    const days = []
    const d = new Date(y, m - 1, 1)
    const pad = n => String(n).padStart(2, '0')
    while (d.getMonth() === m - 1) {
      days.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
      d.setDate(d.getDate() + 1)
    }
    return days
  }

  function netHeures(row) {
    if (!row?.heure_debut || !row?.heure_fin) return null
    const [h1, m1] = row.heure_debut.split(':').map(Number)
    const [h2, m2] = row.heure_fin.split(':').map(Number)
    const min = (h2 * 60 + m2) - (h1 * 60 + m1) - (row.pause_min || 0)
    return min > 0 ? +(min / 60).toFixed(2) : 0
  }

  async function chargerHeures(aeId = heuresAeId, mois = heuresMois) {
    if (!aeId) return
    setLoadingHeures(true)
    const { data } = await supabase.from('staff_heures_jour')
      .select('*').eq('ae_id', aeId).eq('mois', mois)
    const map = {}
    for (const row of data || []) map[row.date] = row
    setHeures(map)
    setLoadingHeures(false)
  }

  async function sauvegarderJour(date, values) {
    const existing = heures[date]
    const payload = { agence: AGENCE, ae_id: heuresAeId, mois: heuresMois, date, ...values }
    if (existing?.id) payload.id = existing.id
    const { data, error: e } = await supabase.from('staff_heures_jour')
      .upsert(payload, { onConflict: 'ae_id,date' }).select().single()
    if (!e && data) setHeures(prev => ({ ...prev, [date]: data }))
  }

  async function appliquerGroupe() {
    if (!joursSelectionnes.size) return
    const updates = [...joursSelectionnes].map(date => ({
      agence: AGENCE, ae_id: heuresAeId, mois: heuresMois, date,
      heure_debut: groupeDebut, heure_fin: groupeFin,
      pause_min: groupePause, type_absence: null, notes: null,
      ...(heures[date]?.id ? { id: heures[date].id } : {}),
    }))
    const { data, error: e } = await supabase.from('staff_heures_jour')
      .upsert(updates, { onConflict: 'ae_id,date' }).select()
    if (!e && data) {
      const updated = { ...heures }
      for (const row of data) updated[row.date] = row
      setHeures(updated)
      setJoursSelectionnes(new Set())
    }
  }

  async function toggleAutoSendNavette(aeId, current) {
    await supabase.from('auto_entrepreneur').update({ auto_send_navette: !current }).eq('id', aeId)
    setAes(prev => prev.map(a => a.id === aeId ? { ...a, auto_send_navette: !current } : a))
  }

  function genererHtmlNavette() {
    const ae = aes.find(a => a.id === heuresAeId)
    if (!ae) return null
    const days = getDaysOfMonth(heuresMois)
    const moisLabel = new Date(heuresMois + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    const moisLabelCap = moisLabel.charAt(0).toUpperCase() + moisLabel.slice(1)

    const ABSENCES_LABEL = {
      conge_paye: 'Congés payés', maladie: 'Maladie',
      rtt: 'RTT', ferie: 'Férié', repos: 'Repos compensateur'
    }
    const fmt2 = d => d ? d.split('-').reverse().join('/') : ''

    // Heures sup par semaine (S1=j1-7, S2=j8-14, S3=j15-21, S4=j22+)
    const semH = [0, 0, 0, 0]
    let totalH = 0
    for (const d of days) {
      const jour = parseInt(d.split('-')[2])
      const si = jour <= 7 ? 0 : jour <= 14 ? 1 : jour <= 21 ? 2 : 3
      const h = netHeures(heures[d])
      if (h) { semH[si] += h; totalH += h }
    }
    const sup = semH.map(h => Math.max(0, h - 35))

    // Plages d'absences
    const absences = []
    let cur = null
    for (const d of days) {
      const abs = heures[d]?.type_absence || null
      if (abs) {
        if (cur && cur.motif === abs) { cur.fin = d }
        else { cur = { motif: abs, debut: d, fin: d }; absences.push(cur) }
      } else { cur = null }
    }

    // Détail journalier (annexe)
    const JOURS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']
    const ABSENCES_COURT = { conge_paye: 'CP', maladie: 'Maladie', rtt: 'RTT', ferie: 'Férié', repos: 'Repos' }
    let lignes = ''
    for (const d of days) {
      const row = heures[d]
      const date = new Date(d + 'T12:00:00')
      const isWE = date.getDay() === 0 || date.getDay() === 6
      const h = netHeures(row)
      const absence = row?.type_absence ? (ABSENCES_COURT[row.type_absence] || row.type_absence) : ''
      lignes += `<tr style="background:${isWE ? '#f9fafb' : '#fff'}">
        <td style="padding:4px 8px;border:1px solid #e5e7eb;color:${isWE ? '#9ca3af' : '#374151'}">${JOURS[date.getDay()]} ${date.getDate()}</td>
        <td style="padding:4px 8px;border:1px solid #e5e7eb;text-align:center">${row?.heure_debut || ''}</td>
        <td style="padding:4px 8px;border:1px solid #e5e7eb;text-align:center">${row?.heure_fin || ''}</td>
        <td style="padding:4px 8px;border:1px solid #e5e7eb;text-align:center">${row?.pause_min ? row.pause_min + ' min' : ''}</td>
        <td style="padding:4px 8px;border:1px solid #e5e7eb;text-align:center;font-weight:600;color:${h ? '#15803d' : '#6b7280'}">${h !== null ? h.toFixed(2) + 'h' : absence}</td>
        <td style="padding:4px 8px;border:1px solid #e5e7eb;font-size:11px;color:#6b7280">${escapeHtml(row?.notes)}</td>
      </tr>`
    }

    const td = 'padding:6px 8px;border:1px solid #999;font-size:12px;'
    const th = 'padding:6px 8px;border:1px solid #999;font-size:11px;background:#f3f4f6;font-weight:600;text-align:center;'
    const tdA = 'padding:6px 8px;border:1px solid #999;font-size:12px;'

    // Ligne(s) employé : première ligne avec heures + première absence, lignes suivantes = absences
    const nbLignes = Math.max(1, absences.length)
    let lignesEmploye = ''
    for (let i = 0; i < nbLignes; i++) {
      const abs = absences[i]
      if (i === 0) {
        lignesEmploye += `<tr>
          <td style="${td}">${escapeHtml(ae.matricule)}</td>
          <td style="${td};font-weight:600">${escapeHtml(ae.nom).toUpperCase()}</td>
          <td style="${td}">${escapeHtml(ae.prenom)}</td>
          <td style="${td};text-align:center">35</td>
          <td style="${td};text-align:center">${sup[0] > 0 ? sup[0].toFixed(2) : ''}</td>
          <td style="${td};text-align:center">${sup[1] > 0 ? sup[1].toFixed(2) : ''}</td>
          <td style="${td};text-align:center">${sup[2] > 0 ? sup[2].toFixed(2) : ''}</td>
          <td style="${td};text-align:center">${sup[3] > 0 ? sup[3].toFixed(2) : ''}</td>
          <td style="${td}"></td><td style="${td}"></td>
          <td style="${td}"></td><td style="${td}"></td>
          <td style="${td}">${abs ? escapeHtml(ABSENCES_LABEL[abs.motif] || abs.motif) : ''}</td>
          <td style="${td};text-align:center">${abs ? fmt2(abs.debut) : ''}</td>
          <td style="${td};text-align:center">${abs ? fmt2(abs.fin) : ''}</td>
          <td style="${td}"></td>
        </tr>`
      } else {
        lignesEmploye += `<tr>
          <td style="${td}" colspan="12"></td>
          <td style="${td}">${abs ? escapeHtml(ABSENCES_LABEL[abs.motif] || abs.motif) : ''}</td>
          <td style="${td};text-align:center">${abs ? fmt2(abs.debut) : ''}</td>
          <td style="${td};text-align:center">${abs ? fmt2(abs.fin) : ''}</td>
          <td style="${td}"></td>
        </tr>`
      }
    }

    const html = `<div style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto;font-size:13px">
      <table style="width:100%;border-collapse:collapse;margin-bottom:10px">
        <tr>
          <td style="font-size:20px;font-weight:700;padding:6px 0">FICHE NAVETTE</td>
          <td style="text-align:right;font-size:13px;font-weight:600">MOIS DE PAIE : ${moisLabelCap.toUpperCase()}</td>
        </tr>
      </table>
      <table style="width:100%;border-collapse:collapse;margin-bottom:14px;border:1px solid #999">
        <tr>
          <td style="${td};font-weight:600">NOM ENTREPRISE</td>
          <td style="${td}">SARL DESTINATION COTE BASQUE</td>
          <td style="${td};font-weight:600;text-align:right">COMPACT</td>
        </tr>
        <tr>
          <td style="${td}">Téléphone : 05 59 55 41 46</td>
          <td colspan="2" style="${td}"></td>
        </tr>
      </table>
      <table style="width:100%;border-collapse:collapse;border:1px solid #999">
        <thead>
          <tr style="background:#e8e8e8">
            <th colspan="3" style="${th}">SALARIÉ</th>
            <th colspan="1" style="${th}">Heures<br>Normales</th>
            <th colspan="4" style="${th}">Heures sup</th>
            <th colspan="2" style="${th}">Primes brutes</th>
            <th style="${th}">Acompte</th>
            <th style="${th}">repas</th>
            <th colspan="3" style="${th}">ABSENCES</th>
            <th style="${th}">Observations</th>
          </tr>
          <tr style="background:#f3f4f6">
            <th style="${th}">Matricule</th>
            <th style="${th}">Nom</th>
            <th style="${th}">Prénom</th>
            <th style="${th}">Heures<br>contrat</th>
            <th style="${th}">S1</th>
            <th style="${th}">S2</th>
            <th style="${th}">S3</th>
            <th style="${th}">S4</th>
            <th style="${th}">Montant</th>
            <th style="${th}">Dénomination</th>
            <th style="${th}">Acompte</th>
            <th style="${th}">repas</th>
            <th style="${th}">Motif absences</th>
            <th style="${th}">Date départ</th>
            <th style="${th}">Date fin</th>
            <th style="${th}">Saisie arrêt, remboursements frais, déplacements, formation…</th>
          </tr>
        </thead>
        <tbody>${lignesEmploye}</tbody>
      </table>
      <p style="font-size:11px;color:#6b7280;margin-top:8px">
        congés payés &nbsp;|&nbsp; maladie &nbsp;|&nbsp; absences non rémunérées &nbsp;|&nbsp; accident de travail &nbsp;|&nbsp; évènement familial
      </p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
      <p style="font-size:11px;font-weight:600;color:#374151;margin-bottom:6px">Détail journalier (annexe)</p>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:#f3f4f6">
          <th style="${th};text-align:left">Jour</th>
          <th style="${th}">Début</th>
          <th style="${th}">Fin</th>
          <th style="${th}">Pause</th>
          <th style="${th}">Heures</th>
          <th style="${th};text-align:left">Notes</th>
        </tr></thead>
        <tbody>${lignes}</tbody>
        <tfoot><tr style="background:#f0fdf4;font-weight:700">
          <td colspan="4" style="${td}">Total ${moisLabelCap}</td>
          <td style="${td};text-align:center;color:#15803d">${totalH.toFixed(2)}h</td>
          <td style="${td}"></td>
        </tr></tfoot>
      </table>
      <p style="color:#9ca3af;font-size:10px;margin-top:12px">Généré depuis DCB Compta</p>
    </div>`

    return { ae, moisLabelCap, totalH, html }
  }

  async function envoyerNavette() {
    const result = genererHtmlNavette()
    if (!result) return
    const { ae, moisLabelCap, html } = result

    setSendingNavette(true)
    setError(null)
    try {
      const { data: r, error: e } = await supabase.functions.invoke('smtp-send', {
        body: { to: 'anne@compact.fr', subject: `Navette paie ${ae.prenom} ${ae.nom} — ${moisLabelCap}`, html }
      })
      if (e) throw e
      if (!r?.ok) throw new Error(r?.error || 'Erreur envoi')
      setSuccess(`Navette envoyée à anne@compact.fr`)
    } catch (e) {
      setError('Navette : ' + e.message)
    } finally {
      setSendingNavette(false)
    }
  }

  async function chargerBalance(mois) {
    const { data } = await supabase
      .from('ventilation')
      .select('code, montant_ht, montant_reel')
      .eq('mois_comptable', mois)
      .in('code', ['AUTO', 'FMEN'])
    if (!data) return
    const auto = data.filter(v => v.code === 'AUTO')
    const fmen = data.filter(v => v.code === 'FMEN')
    setBalance({
      mois,
      nb_auto: auto.length,
      auto_provision: auto.reduce((s, v) => s + (v.montant_ht || 0), 0),
      auto_saisis: auto.filter(v => v.montant_reel != null).length,
      auto_reel: auto.filter(v => v.montant_reel != null).reduce((s, v) => s + (v.montant_reel || 0), 0),
      fmen_provision: fmen.reduce((s, v) => s + (v.montant_ht || 0), 0),
      fmen_reel: fmen.filter(v => v.montant_reel != null).reduce((s, v) => s + (v.montant_reel || 0), 0),
    })
  }

  async function chargerVision(mois) {
    setLoadingVision(true)
    setMoisBalance(mois)
    chargerBalance(mois)
    const [{ data: prestData }, { data: missionsData }] = await Promise.all([
      supabase
        .from('prestation_hors_forfait')
        .select('id, ae_id, bien_id, date_prestation, montant, statut, description, bien:bien_id!inner(code, hospitable_name, agence), prestation_type:prestation_type_id(nom)')
        .eq('mois', mois)
        .eq('bien.agence', AGENCE)
        .not('ae_id', 'is', null)
        .order('date_prestation'),
      supabase
        .from('mission_menage')
        .select('id, ae_id, bien_id, date_mission, titre_ical, duree_heures, montant, bien:bien_id!inner(code, hospitable_name, agence, provision_ae_ref)')
        .eq('mois', mois)
        .eq('bien.agence', AGENCE)
        .neq('statut', 'cancelled')
        .order('date_mission')
    ])
    const prests = (prestData || []).map(p => ({ ...p, _type: 'prestation', _date: p.date_prestation }))
    const missions = (missionsData || []).map(m => ({ ...m, _type: 'mission', _date: m.date_mission }))
    setVisionData([...prests, ...missions])
    setLoadingVision(false)
  }

  async function chargerVirementsAE(mois) {
    setLoadingVirementsAE(true)
    try {
      const [y, m] = mois.split('-').map(Number)
      const d2 = new Date(y, m, 1)
      const moisSuivant = `${d2.getFullYear()}-${String(d2.getMonth()+1).padStart(2,'0')}`
      const { data } = await supabase
        .from('mouvement_bancaire')
        .select('id, date_operation, libelle, detail, debit, credit, canal, mois_releve')
        .in('mois_releve', [mois, moisSuivant])
        .gt('debit', 0)
        .order('date_operation')
      setVirementsAE(data || [])
      const saved = localStorage.getItem(`dcb_ctrl_vir_ae_${mois}`)
      if (saved) {
        const { liens, commentaires } = JSON.parse(saved)
        setLiensVirementsAE(liens || {})
        setCommentairesAE(commentaires || {})
      } else {
        setLiensVirementsAE({})
        setCommentairesAE({})
      }
    } catch (err) { setError(err.message) }
    finally { setLoadingVirementsAE(false) }
  }

  function sauvegarderCtrlAE(newLiens, newComm) {
    localStorage.setItem(`dcb_ctrl_vir_ae_${visionMois}`, JSON.stringify({ liens: newLiens, commentaires: newComm }))
  }

  function autoMatchVirementAE(ae, virsDispos) {
    const tokens = [ae.nom?.toLowerCase(), ae.prenom?.toLowerCase()].filter(t => t && t.length > 2)
    return virsDispos.find(v => {
      const hay = ((v.detail || '') + ' ' + (v.libelle || '')).toLowerCase()
      return tokens.some(t => hay.includes(t))
    }) || null
  }

  function ouvrir(ae) { setForm(ae ? { ...ae } : EMPTY_AE); setEditing(ae ? ae.id : 'new'); setError(null); setSuccess(null) }
  function fermer() { setEditing(null); setError(null) }
  function change(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function resetMdp(ae) {
    if (!ae.email) { setError('Email requis pour réinitialiser le mot de passe'); return }
    const isReset = !!ae.ae_user_id
    setConfirmModal({
      message: isReset
        ? `Régénérer le mot de passe de ${ae.prenom} ${ae.nom} ?\nUn nouveau mot de passe temporaire sera généré.`
        : `Créer l'accès portail pour ${ae.prenom} ${ae.nom} ?\nUn mot de passe temporaire sera généré et l'AE lié à un compte Auth.`,
      onConfirm: async () => {
        setConfirmModal(null)
        setSaving(true)
        try {
          const result = isReset
            ? await resetAEPassword(ae.id, ae.email)
            : await createAEAccess(ae.id, ae.email)
          setSuccess(`Mot de passe : ${result?.password}`)
          await charger()
        } catch(err) { setError(err.message) }
        finally { setSaving(false) }
      }
    })
  }

  async function syncTousLesAEs(aesParam, moisParam) {
    const liste = (aesParam || aes).filter(a => a.ical_url && a.actif !== false)
    const moisCible = moisParam || syncMois
    if (!liste.length) return
    setSyncing(true); setSyncResults(null); setError(null)
    const results = []
    for (const ae of liste) {
      try {
        const r = await fetch('/api/ae-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'sync', ae_id: ae.id, mois: moisCible })
        })
        const d = await r.json()
        results.push({ nom: ae.prenom + ' ' + ae.nom, ...d })
      } catch (err) {
        results.push({ nom: ae.prenom + ' ' + ae.nom, error: err.message })
      }
    }
    setSyncResults(results)
    setSyncing(false)
  }

  async function sauvegarder() {
    if (!form.nom.trim()) { setError('Le nom est requis'); return }
    setSaving(true); setError(null)
    try {
      const data = { ...form, taux_horaire: parseInt(form.taux_horaire) || 2500 }
      // taux_horaire est en centimes en base mais on affiche en €
      if (editing !== 'new') data.id = editing
      await saveAutoEntrepreneur(data)
      setSuccess(editing === 'new' ? 'Auto-entrepreneur créé ✓' : 'Fiche mise à jour ✓')
      await charger()
      setTimeout(() => { fermer(); setSuccess(null) }, 1200)
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  async function supprimer(id) {
    setConfirmModal({
      message: 'Supprimer cet auto-entrepreneur ?\nCette action est irréversible.',
      onConfirm: async () => {
        setConfirmModal(null)
        try { await deleteAutoEntrepreneur(id); await charger() }
        catch (err) { setError(err.message) }
      }
    })
  }

  async function envoyerIdentifiants(ae) {
    const portailUrl = 'https://dcb-portail-ae.vercel.app'
    const mdp = ae.mdp_temporaire || '(non disponible - recréer le compte)'
    const msg = `Bonjour ${ae.prenom || ae.nom},\n\nVoici vos accès au portail Destination Côte Basque 🌅\n\nURL : ${portailUrl}\nEmail : ${ae.email}\nMot de passe : ${mdp}\n\nConnectez-vous pour voir vos missions et déclarer vos prestations.\n\nÀ bientôt,\nDestination Côte Basque`
    await navigator.clipboard.writeText(msg)
    setSuccess('Message copié ! Collez-le dans un SMS ou email.')
    setTimeout(() => setSuccess(null), 3000)
  }

  async function sauvegarderPT() {
    if (!formPT.nom.trim()) return
    setSaving(true)
    setErrorPT(null)
    try {
      const data = { ...formPT, taux_defaut: Math.round(parseFloat(formPT.taux_defaut) * 100) || 2500, actif: true }
      if (editingPT && editingPT !== 'new') {
        const { error } = await supabase.from('prestation_type').update(data).eq('id', editingPT)
        if (error) throw error
      } else {
        const { error } = await supabase.from('prestation_type').insert(data)
        if (error) throw error
      }
      await charger()
      setEditingPT(null)
    } catch (err) { setErrorPT(err.message) }
    finally { setSaving(false) }
  }

  async function supprimerPT(id) {
    setConfirmModal({
      message: 'Supprimer ce type de prestation ?\nCette action est irréversible.',
      onConfirm: async () => {
        setConfirmModal(null)
        await supabase.from('prestation_type').delete().eq('id', id)
        await charger()
      }
    })
  }

  const inp = (k, label, opts = {}) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>{label}</label>
      <input value={form[k] ?? ''} onChange={e => change(k, e.target.value)}
        style={{ padding: '8px 10px', borderRadius: 7, border: '1.5px solid #e5e7eb', fontSize: 13, outline: 'none' }}
        {...opts} />
    </div>
  )

  const TAB_STYLE = active => ({
    padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
    background: active ? '#1a3a6e' : '#f3f4f6', color: active ? '#fff' : '#555'
  })

  return (
       <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Staff</h1>
          <p style={{ margin: '4px 0 0', color: '#666', fontSize: 14 }}>Prestataires ménage — {aes.length} configuré(s)</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {tab === 'aes' && <button onClick={() => ouvrir(null)} style={{ background: '#1a3a6e', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>+ Ajouter AE</button>}
          {tab === 'prestations' && <button onClick={() => { setFormPT({ nom: '', description: '', taux_defaut: 25, unite: 'heure' }); setEditingPT('new') }} style={{ background: '#1a3a6e', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>+ Ajouter prestation</button>}
        </div>
      </div>

      {success && !editing && !editingPT && <div style={{ background: '#DCFCE7', borderRadius: 8, padding: '10px 16px', marginBottom: 14, fontSize: 13, color: '#15803D' }}>✓ {success}</div>}
      {error && !editing && <div style={{ background: '#FEE2E2', borderRadius: 8, padding: '10px 16px', marginBottom: 14, fontSize: 13, color: '#B91C1C' }}>✕ {error}</div>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button style={TAB_STYLE(tab === 'vision')} onClick={() => { setTab('vision'); chargerVision(visionMois) }}>📊 Vision mensuelle</button>
        <button style={TAB_STYLE(tab === 'aes')} onClick={() => setTab('aes')}>🧹 Staff & AE ({aes.length})</button>
        <button style={TAB_STYLE(tab === 'prestations')} onClick={() => setTab('prestations')}>⚙️ Types de prestations ({prestationTypes.length})</button>
        <button style={TAB_STYLE(tab === 'controle')} onClick={() => { setTab('controle'); chargerVirementsAE(visionMois); chargerVision(visionMois) }}>🔍 Contrôle virements</button>
        <button style={TAB_STYLE(tab === 'heures')} onClick={() => setTab('heures')}>⏱ Heures staff</button>
      </div>

      {loading && aes.length === 0 ? <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>Chargement...</div> : (
        <>
          {tab === 'aes' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {aes.length === 0 && (
                <div style={{ textAlign: 'center', padding: 60, color: '#aaa', background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb' }}>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>🧹</div>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>Aucun auto-entrepreneur configuré</div>
                  <div style={{ fontSize: 13 }}>Cliquez sur "+ Ajouter AE" pour créer la première fiche</div>
                </div>
              )}
              {/* Sync iCal global */}
              <div style={{ background: '#F0FAFB', borderRadius: 10, padding: '12px 16px', marginBottom: 14, border: '1px solid #A5D8E0e', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#0891B2' }}>📅 Sync iCal</span>
                <input type="month" value={syncMois} onChange={e => setSyncMois(e.target.value)}
                  style={{ padding: '4px 10px', borderRadius: 6, border: '1.5px solid #E4A853', fontSize: 13 }} />
                <button onClick={syncTousLesAEs} disabled={syncing}
                  style={{ background: syncing ? '#94a3b8' : '#0891B2', color: '#fff', border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: syncing ? 'not-allowed' : 'pointer' }}>
                  {syncing ? '⏳ En cours...' : '🔄 Sync tous'}
                </button>
                {syncResults && (
                  <div style={{ width: '100%', marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {syncResults.map((res, i) => (
                      <div key={i} style={{ fontSize: 12, display: 'flex', gap: 8 }}>
                        <span style={{ fontWeight: 600, color: '#0891B2', minWidth: 130 }}>{res.nom}</span>
                        {res.error
                          ? <span style={{ color: '#dc2626' }}>✕ {res.error}</span>
                          : <span style={{ color: '#16a34a' }}>✓ {res.created} nouvelle(s) / {res.total_events} événements iCal</span>
                        }
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {aes.map(ae => (
                <div key={ae.id} style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 22, background: ae.actif ? '#1a3a6e' : '#9ca3af', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, flexShrink: 0 }}>
                    {(ae.prenom?.[0] || ae.nom[0]).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{ae.prenom} {ae.nom}</div>
                    <div style={{ fontSize: 12, color: '#888', marginTop: 2, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      {ae.siret && <span>SIRET: {ae.siret}</span>}
                      {ae.email && <span>{ae.email}</span>}
                      {ae.ville && <span>📍 {ae.ville}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                    <div style={{ background: '#f0fdf4', color: '#16a34a', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600 }}>
                      {((ae.taux_horaire || 2500) / 100).toFixed(0)} €/h
                    </div>
                    {ae.ical_url && <div style={{ background: '#eff6ff', color: '#CC9933', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600 }}>📅 iCal</div>}
                {ae.type === 'staff' && <div style={{ background: '#fef3c7', color: '#92400e', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 700 }}>🌅 DCB Staff</div>}
                    <button onClick={() => envoyerIdentifiants(ae)} title="Copier message avec identifiants" style={{ background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0', borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}>📨 Identifiants</button>
                    {(!ae.mdp_temporaire || !ae.ae_user_id) && ae.email && (
                      <button onClick={() => resetMdp(ae)} title="Créer/réinitialiser le mot de passe" style={{ background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa', borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}>🔑 {ae.ae_user_id ? 'Regen mdp' : 'Créer accès'}</button>
                    )}
                    <button onClick={() => ouvrir(ae)} style={{ background: '#f3f4f6', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>Modifier</button>
                    <button onClick={() => supprimer(ae.id)} style={{ background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'vision' && (() => {
            const fmt = v => ((v || 0) / 100).toFixed(2) + ' €'
            const rowsFlat = visionData.map(m => ({
              ...m,
              aeNom: (() => { const a = aes.find(x => x.id === m.ae_id); return a ? `${a.prenom || ''} ${a.nom}`.trim() : '—' })()
            }))
            const grandTotal = rowsFlat.reduce((s, m) => {
              if (m._type === 'mission') return s + (m.montant || 0)
              if (m._type === 'prestation' && m.statut === 'valide') return s + (m.montant || 0)
              return s
            }, 0)
            // Groupe par AE
            const parAe = {}
            for (const m of rowsFlat) {
              if (!parAe[m.ae_id]) parAe[m.ae_id] = { ae: aes.find(x => x.id === m.ae_id), missions: [] }
              parAe[m.ae_id].missions.push(m)
            }
            const aeGroups = Object.values(parAe).map(({ ae, missions }) => {
              const aeObj = ae
              const menages = missions.filter(m => m._type === 'mission')
              const provision = menages.reduce((s, m) => s + (m.bien?.provision_ae_ref || 0), 0)
              const reel = menages.filter(m => m.montant).reduce((s, m) => s + (m.montant || 0), 0)
              const totalAeVal = missions.reduce((s, m) => {
                if (m._type === 'mission') return s + (m.montant || 0)
                if (m._type === 'prestation' && m.statut === 'valide') return s + (m.montant || 0)
                return s
              }, 0)
              return { ae, missions, provision, reel, totalAeVal }
            }).sort((a, b) => b.totalAeVal - a.totalAeVal)
            return (
              <div>
                {/* Sélecteur mois + export */}
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                    <button onClick={() => { const [y,m] = visionMois.split('-').map(Number); const d = new Date(y, m-2, 1); const nm = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; setVisionMois(nm); chargerVision(nm) }}
                      style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '7px 0 0 7px', padding: '6px 10px', cursor: 'pointer', fontSize: 16, borderRight: 'none' }}>‹</button>
                    <span style={{ fontWeight: 700, fontSize: 14, padding: '6px 14px', border: '1px solid var(--border)', minWidth: 140, textAlign: 'center' }}>
                      {new Date(visionMois + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
                    </span>
                    <button onClick={() => { const [y,m] = visionMois.split('-').map(Number); const d = new Date(y, m, 1); const nm = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; setVisionMois(nm); chargerVision(nm) }}
                      style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '0 7px 7px 0', padding: '6px 10px', cursor: 'pointer', fontSize: 16, borderLeft: 'none' }}>›</button>
                  </div>
                  {loadingVision && <span style={{ fontSize: 13, color: '#888' }}>⏳ Chargement…</span>}
                  {grandTotal > 0 && (
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginLeft: 8 }}>
                      Total : {fmt(grandTotal)}
                    </span>
                  )}
                </div>
                {/* Table récap globale */}
                {aeGroups.length > 0 && (
                  <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', marginBottom: 18, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: '#F7F4EF', borderBottom: '2px solid var(--brand)' }}>
                          <th style={{ padding: '9px 16px', textAlign: 'left', fontWeight: 700, textTransform: 'none', fontSize: 13, color: 'var(--text)' }}>Staff / AE</th>
                          <th style={{ padding: '9px 8px', textAlign: 'right', fontWeight: 700, textTransform: 'none', fontSize: 13, color: 'var(--text)' }}>Ménages</th>
                          <th style={{ padding: '9px 8px', textAlign: 'right', fontWeight: 700, textTransform: 'none', fontSize: 13, color: 'var(--text)' }}>Provision</th>
                          <th style={{ padding: '9px 8px', textAlign: 'right', fontWeight: 700, textTransform: 'none', fontSize: 13, color: 'var(--text)' }}>Réel</th>
                          <th style={{ padding: '9px 8px', textAlign: 'right', fontWeight: 700, textTransform: 'none', fontSize: 13, color: 'var(--text)' }}>Écart</th>
                          <th style={{ padding: '9px 8px', textAlign: 'right', fontWeight: 700, textTransform: 'none', fontSize: 13, color: 'var(--text)' }}>% total</th>
                          <th style={{ padding: '9px 16px' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {aeGroups.map(({ ae, missions, provision, reel, totalAeVal }) => {
                          const nb = missions.filter(m => m._type === 'mission').length
                          const ecart = reel > 0 ? reel - provision : null
                          const ecartMissing = reel === 0 && provision > 0
                          const pctG = grandTotal > 0 ? Math.round((totalAeVal / grandTotal) * 100) : 0
                          return (
                            <tr key={ae?.id || 'inc'} style={{ borderBottom: '1px solid #f3f4f6' }}>
                              <td style={{ padding: '8px 16px', fontWeight: 600 }}>{ae ? `${ae.prenom || ''} ${ae.nom}`.trim() : '—'}</td>
                              <td style={{ padding: '8px', textAlign: 'right', color: '#666' }}>{nb}</td>
                              <td style={{ padding: '8px', textAlign: 'right', color: '#888' }}>{provision > 0 ? fmt(provision) : '—'}</td>
                              <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600, color: reel > 0 ? '#16a34a' : '#888' }}>{reel > 0 ? fmt(reel) : '—'}</td>
                              <td style={{ padding: '8px', textAlign: 'right', fontWeight: ecart != null || ecartMissing ? 600 : 400, color: ecartMissing ? '#d97706' : ecart == null ? '#888' : ecart > 0 ? '#dc2626' : ecart < 0 ? '#16a34a' : '#888' }}>
                                {ecartMissing ? 'À saisir' : ecart == null ? '—' : (ecart >= 0 ? '+' : '') + fmt(ecart)}
                              </td>
                              <td style={{ padding: '8px', textAlign: 'right' }}>
                                <span style={{ color: '#888', fontSize: 12 }}>{pctG}%</span>
                                <span style={{ display: 'inline-block', width: 50, height: 4, background: '#e5e7eb', borderRadius: 2, marginLeft: 6, verticalAlign: 'middle' }}>
                                  <span style={{ display: 'block', width: `${pctG}%`, height: '100%', background: 'var(--brand)', borderRadius: 2 }} />
                                </span>
                              </td>
                              <td style={{ padding: '8px 16px', textAlign: 'right' }}></td>
                            </tr>
                          )
                        })}
                        <tr style={{ background: '#F7F4EF', borderTop: '2px solid var(--brand)', fontWeight: 700 }}>
                          <td style={{ padding: '9px 16px' }}>TOTAL</td>
                          <td style={{ padding: '9px 8px', textAlign: 'right' }}>{aeGroups.reduce((s, g) => s + g.missions.filter(m => m._type === 'mission').length, 0)}</td>
                          <td style={{ padding: '9px 8px', textAlign: 'right', color: '#888' }}>{fmt(aeGroups.reduce((s, g) => s + g.provision, 0))}</td>
                          <td style={{ padding: '9px 8px', textAlign: 'right', color: '#16a34a' }}>{fmt(aeGroups.reduce((s, g) => s + g.reel, 0))}</td>
                          <td colSpan={3} style={{ padding: '9px 8px', textAlign: 'right', color: '#888', fontSize: 13 }}>{fmt(grandTotal)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Cards par AE */}
                {aeGroups.length === 0 && !loadingVision && (
                  <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>Aucune mission ce mois.</div>
                )}
                {aeGroups.map(({ ae, missions, provision, reel, totalAeVal }) => {
                  const totalAe = totalAeVal
                  const nbMissions = missions.filter(m => m._type === 'mission').length
                  const nbValide = missions.filter(m => m._type === 'prestation' && m.statut === 'valide').length
                  const nbEnAttente = missions.filter(m => m._type === 'prestation' && m.statut === 'en_attente').length
                  const nbAnnule = missions.filter(m => m._type === 'prestation' && m.statut === 'annule').length
                  const pct = grandTotal > 0 ? Math.round((totalAe / grandTotal) * 100) : 0
                  const ecartAe = reel > 0 ? reel - provision : null
                  const ecartAeMissing = reel === 0 && provision > 0
                  return (
                    <div key={ae?.id || 'inconnu'} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', marginBottom: 14, overflow: 'hidden' }}>
                      {/* Header AE */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 18px', background: '#F7F4EF', borderBottom: '2px solid var(--brand)' }}>
                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--brand)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15, flexShrink: 0 }}>
                          {(ae?.prenom || ae?.nom || '?')[0].toUpperCase()}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: 15 }}>{ae ? `${ae.prenom || ''} ${ae.nom}`.trim() : '—'}</div>
                          <div style={{ fontSize: 12, color: '#888', marginTop: 1 }}>
                            {nbMissions > 0 && <span>{nbMissions} ménage{nbMissions !== 1 ? 's' : ''}</span>}
                            {nbValide > 0 && <span style={{ marginLeft: nbMissions > 0 ? 8 : 0 }}>{nbValide} extra validé{nbValide !== 1 ? 's' : ''}</span>}
                            {nbEnAttente > 0 && <span style={{ color: '#d97706', marginLeft: 8 }}>{nbEnAttente} extra en attente</span>}
                            {nbAnnule > 0 && <span style={{ color: '#9c8c7a', marginLeft: 8 }}>{nbAnnule} annulé{nbAnnule !== 1 ? 's' : ''}</span>}
                          </div>
                          {provision > 0 && (
                            <div style={{ fontSize: 11, marginTop: 3, display: 'flex', gap: 10 }}>
                              <span style={{ color: '#888' }}>Provision : {fmt(provision)}</span>
                              {reel > 0 && <span style={{ color: '#16a34a', fontWeight: 600 }}>Réel : {fmt(reel)}</span>}
                              {ecartAeMissing && <span style={{ color: '#d97706', fontWeight: 600 }}>À saisir</span>}
                              {ecartAe != null && <span style={{ color: ecartAe > 0 ? '#dc2626' : '#16a34a', fontWeight: 600 }}>Écart : {ecartAe >= 0 ? '+' : ''}{fmt(ecartAe)}</span>}
                            </div>
                          )}
                        </div>
                        <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                          <div style={{ fontSize: 20, fontWeight: 700, color: '#16a34a' }}>{fmt(totalAe)}</div>
                          {grandTotal > 0 && (
                            <div style={{ fontSize: 12, color: '#888' }}>
                              {pct}% du total
                              <div style={{ marginTop: 4, height: 4, width: 80, background: '#e5e7eb', borderRadius: 2, display: 'inline-block', verticalAlign: 'middle', marginLeft: 6 }}>
                                <div style={{ height: '100%', width: `${pct}%`, background: 'var(--brand)', borderRadius: 2 }} />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      {/* Missions */}
                      <div style={{ padding: '0 0 4px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                          <tbody>
                            {missions.sort((a, b) => (a._date || '').localeCompare(b._date || '')).map(m => {
                              const STATUT_C = { valide: '#16a34a', en_attente: '#d97706', annule: '#9c8c7a' }
                              const isMission = m._type === 'mission'
                              const date = isMission ? m.date_mission : m.date_prestation
                              const label = isMission
                                ? (m.titre_ical || 'Ménage')
                                : (m.description || m.prestation_type?.nom || '—')
                              const statutBadge = isMission
                                ? (m.montant ? <span style={{ fontSize: 11, color: '#16a34a' }}>✓</span> : <span style={{ fontSize: 11, color: '#d97706' }}>à saisir</span>)
                                : <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: `${STATUT_C[m.statut]}20`, color: STATUT_C[m.statut] || '#888' }}>
                                    {m.statut === 'valide' ? '✓' : m.statut === 'annule' ? '✕' : '⏳'}
                                  </span>
                              return (
                                <tr key={`${m._type}-${m.id}`} style={{ borderBottom: '1px solid #f3f4f6', background: isMission ? 'transparent' : '#FFFBF0' }}>
                                  <td style={{ padding: '7px 18px', color: '#666', whiteSpace: 'nowrap', fontSize: 12 }}>
                                    {date ? date.split('-').reverse().join('/') : '—'}
                                  </td>
                                  <td style={{ padding: '7px 8px', fontWeight: 600, color: 'var(--brand)', fontSize: 12 }}>
                                    {m.bien?.code || '—'}
                                  </td>
                                  <td style={{ padding: '7px 8px', color: 'var(--text)', flex: 1 }}>
                                    {!isMission && <span style={{ fontSize: 10, background: '#FFF8EC', color: '#CC9933', border: '1px solid #E4A853', borderRadius: 3, padding: '1px 5px', marginRight: 5 }}>extra</span>}
                                    {label}
                                    {isMission && m.duree_heures && <span style={{ color: '#888', fontSize: 11, marginLeft: 6 }}>{m.duree_heures}h</span>}
                                  </td>
                                  <td style={{ padding: '7px 18px', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                    {fmt(m.montant)}
                                  </td>
                                  <td style={{ padding: '7px 18px', textAlign: 'right' }}>
                                    {statutBadge}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })()}

          {tab === 'controle' && (() => {
            const fmtDate = d => d ? d.split('-').reverse().join('/') : '—'
            const fmt = v => ((v || 0) / 100).toFixed(2) + ' €'

            // Montant attendu par AE : missions + prestations validées du mois
            const montantAttendu = aeId => visionData
              .filter(m => m.ae_id === aeId && (m._type === 'mission' || (m._type === 'prestation' && m.statut === 'valide')))
              .reduce((s, m) => s + (m.montant || 0), 0)

            // Pré-calcul allLiés pour exclure des autres dropdowns
            const allLiesAE = new Set()
            for (const ae of aes) {
              const manualId = liensVirementsAE[ae.id]
              if (manualId && manualId !== 'none') {
                allLiesAE.add(manualId)
              } else if (!manualId) {
                const auto = autoMatchVirementAE(ae, virementsAE)
                if (auto) allLiesAE.add(auto.id)
              }
            }

            const getVirLie = ae => {
              const val = liensVirementsAE[ae.id]
              if (val === 'none') return null
              if (val) return virementsAE.find(v => v.id === val) || null
              return autoMatchVirementAE(ae, virementsAE)
            }

            const aesActifs = aes.filter(ae => ae.actif !== false)
            const totalAttendu = aesActifs.reduce((s, ae) => s + montantAttendu(ae.id), 0)
            const totalVire = aesActifs.reduce((s, ae) => {
              const v = getVirLie(ae)
              return s + (v ? (v.debit || 0) : 0)
            }, 0)

            return (
              <div>
                {/* Sélecteur mois */}
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                    <button onClick={() => { const [y,m] = visionMois.split('-').map(Number); const d = new Date(y, m-2, 1); const nm = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; setVisionMois(nm); chargerVirementsAE(nm); chargerVision(nm) }}
                      style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '7px 0 0 7px', padding: '6px 10px', cursor: 'pointer', fontSize: 16, borderRight: 'none' }}>‹</button>
                    <span style={{ fontWeight: 700, fontSize: 14, padding: '6px 14px', border: '1px solid var(--border)', minWidth: 140, textAlign: 'center' }}>
                      {new Date(visionMois + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
                    </span>
                    <button onClick={() => { const [y,m] = visionMois.split('-').map(Number); const d = new Date(y, m, 1); const nm = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; setVisionMois(nm); chargerVirementsAE(nm); chargerVision(nm) }}
                      style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '0 7px 7px 0', padding: '6px 10px', cursor: 'pointer', fontSize: 16, borderLeft: 'none' }}>›</button>
                  </div>
                  <button onClick={() => chargerVirementsAE(visionMois)} disabled={loadingVirementsAE}
                    style={{ background: loadingVirementsAE ? '#94a3b8' : 'var(--brand)', color: '#fff', border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: loadingVirementsAE ? 'not-allowed' : 'pointer' }}>
                    {loadingVirementsAE ? '⏳' : '↺ Actualiser'}
                  </button>
                  <span style={{ fontSize: 13, color: '#888' }}>{virementsAE.length} virement(s) sortant(s) trouvé(s)</span>
                </div>

                {/* Table contrôle */}
                <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden', marginBottom: 18 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#F7F4EF', borderBottom: '2px solid var(--brand)' }}>
                        <th style={{ padding: '9px 16px', textAlign: 'left', fontWeight: 700, color: 'var(--text)' }}>Staff / AE</th>
                        <th style={{ padding: '9px 8px', textAlign: 'right', fontWeight: 700, color: 'var(--text)' }}>Attendu</th>
                        <th style={{ padding: '9px 8px', textAlign: 'left', fontWeight: 700, color: 'var(--text)', minWidth: 260 }}>Virement rapproché</th>
                        <th style={{ padding: '9px 8px', textAlign: 'right', fontWeight: 700, color: 'var(--text)' }}>Viré</th>
                        <th style={{ padding: '9px 8px', textAlign: 'right', fontWeight: 700, color: 'var(--text)' }}>Écart</th>
                        <th style={{ padding: '9px 16px', textAlign: 'left', fontWeight: 700, color: 'var(--text)' }}>Commentaire</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aesActifs.map(ae => {
                        const attendu = montantAttendu(ae.id)
                        const virLie = getVirLie(ae)
                        const vire = virLie ? (virLie.debit || 0) : 0
                        const ecart = attendu > 0 || vire > 0 ? vire - attendu : null
                        const isAuto = !liensVirementsAE[ae.id] && !!virLie
                        const isNone = liensVirementsAE[ae.id] === 'none'
                        const statut = attendu === 0 && vire === 0 ? 'inactif'
                          : isNone ? 'non_lie'
                          : ecart === null ? 'attente'
                          : Math.abs(ecart) <= 1 ? 'ok'
                          : ecart > 0 ? 'surplus'
                          : 'manque'

                        // Options dropdown : virements non liés à d'autres AEs + celui déjà lié ici
                        const opts = virementsAE.filter(v => !allLiesAE.has(v.id) || virLie?.id === v.id)

                        return (
                          <tr key={ae.id} style={{ borderBottom: '1px solid #f3f4f6', background: statut === 'ok' ? '#f0fdf4' : statut === 'inactif' ? '#fafafa' : 'transparent' }}>
                            <td style={{ padding: '8px 16px', fontWeight: 600 }}>
                              {ae.prenom ? `${ae.prenom} ${ae.nom}` : ae.nom}
                              {ae.type === 'staff' && <span style={{ fontSize: 10, background: '#fef3c7', color: '#92400e', borderRadius: 4, padding: '1px 5px', marginLeft: 6, fontWeight: 700 }}>staff</span>}
                            </td>
                            <td style={{ padding: '8px', textAlign: 'right', color: attendu > 0 ? 'var(--text)' : '#aaa', fontWeight: attendu > 0 ? 600 : 400 }}>
                              {attendu > 0 ? fmt(attendu) : '—'}
                            </td>
                            <td style={{ padding: '8px' }}>
                              <select
                                value={liensVirementsAE[ae.id] || ''}
                                onChange={e => {
                                  const val = e.target.value === '' ? undefined : e.target.value
                                  // '' = reset (auto), 'none' = non lié explicite, id = manuel
                                  const newVal = e.target.value === '' ? undefined : e.target.value
                                  const newLiens = { ...liensVirementsAE }
                                  if (newVal === undefined) delete newLiens[ae.id]
                                  else newLiens[ae.id] = newVal
                                  setLiensVirementsAE(newLiens)
                                  sauvegarderCtrlAE(newLiens, commentairesAE)
                                }}
                                style={{ width: '100%', padding: '5px 8px', borderRadius: 6, border: `1.5px solid ${isAuto ? '#d97706' : virLie ? '#16a34a' : '#e5e7eb'}`, fontSize: 12, background: isAuto ? '#FFFBF0' : '#fff' }}
                              >
                                <option value="">— auto —</option>
                                <option value="none">✕ Non lié</option>
                                {opts.map(v => (
                                  <option key={v.id} value={v.id}>
                                    {(v.detail || v.libelle || '').substring(0, 40)} · {fmt(v.debit)} · {fmtDate(v.date_operation)}
                                  </option>
                                ))}
                              </select>
                              {isAuto && virLie && <div style={{ fontSize: 10, color: '#d97706', marginTop: 2 }}>auto-détecté</div>}
                            </td>
                            <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600, color: vire > 0 ? '#16a34a' : '#aaa' }}>
                              {vire > 0 ? fmt(vire) : isNone ? <span style={{ color: '#9c8c7a', fontSize: 11 }}>non lié</span> : '—'}
                            </td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>
                              {statut === 'ok' && <span style={{ color: '#16a34a', fontWeight: 700 }}>✓ OK</span>}
                              {statut === 'manque' && <span style={{ color: '#dc2626', fontWeight: 700 }}>{(ecart / 100).toFixed(2)} €</span>}
                              {statut === 'surplus' && <span style={{ color: '#d97706', fontWeight: 700 }}>+{(ecart / 100).toFixed(2)} €</span>}
                              {statut === 'attente' && <span style={{ color: '#888', fontSize: 11 }}>—</span>}
                              {statut === 'non_lie' && <span style={{ color: '#9c8c7a', fontSize: 11 }}>—</span>}
                              {statut === 'inactif' && <span style={{ color: '#ccc', fontSize: 11 }}>—</span>}
                            </td>
                            <td style={{ padding: '8px 16px' }}>
                              <input
                                value={commentairesAE[ae.id] || ''}
                                onChange={e => {
                                  const newComm = { ...commentairesAE, [ae.id]: e.target.value }
                                  setCommentairesAE(newComm)
                                  sauvegarderCtrlAE(liensVirementsAE, newComm)
                                }}
                                placeholder="Note…"
                                style={{ width: '100%', padding: '4px 8px', borderRadius: 5, border: '1px solid #e5e7eb', fontSize: 12 }}
                              />
                            </td>
                          </tr>
                        )
                      })}
                      {/* Ligne totaux */}
                      <tr style={{ background: '#F7F4EF', borderTop: '2px solid var(--brand)', fontWeight: 700 }}>
                        <td style={{ padding: '9px 16px' }}>TOTAL</td>
                        <td style={{ padding: '9px 8px', textAlign: 'right' }}>{fmt(totalAttendu)}</td>
                        <td style={{ padding: '9px 8px' }}></td>
                        <td style={{ padding: '9px 8px', textAlign: 'right', color: '#16a34a' }}>{fmt(totalVire)}</td>
                        <td style={{ padding: '9px 8px', textAlign: 'right', color: Math.abs(totalVire - totalAttendu) <= 1 ? '#16a34a' : '#dc2626', fontWeight: 700 }}>
                          {totalAttendu > 0 || totalVire > 0
                            ? (Math.abs(totalVire - totalAttendu) <= 1
                              ? '✓ Équilibré'
                              : `${((totalVire - totalAttendu) / 100).toFixed(2)} €`)
                            : '—'}
                        </td>
                        <td style={{ padding: '9px 16px' }}></td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Virements sortants non rapprochés */}
                {(() => {
                  const nonRapr = virementsAE.filter(v => !allLiesAE.has(v.id))
                  if (!nonRapr.length) return null
                  return (
                    <div style={{ background: '#FFFBF0', borderRadius: 10, border: '1px solid #E4A853', padding: '12px 16px' }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: '#d97706', marginBottom: 8 }}>
                        ⚠ {nonRapr.length} virement(s) sortant(s) non rapproché(s)
                      </div>
                      {nonRapr.map(v => (
                        <div key={v.id} style={{ fontSize: 12, color: '#78350f', display: 'flex', gap: 12, padding: '3px 0', borderBottom: '1px solid #fde68a' }}>
                          <span style={{ color: '#888' }}>{fmtDate(v.date_operation)}</span>
                          <span style={{ flex: 1 }}>{v.detail || v.libelle}</span>
                          <span style={{ fontWeight: 700 }}>{fmt(v.debit)}</span>
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </div>
            )
          })()}

          {tab === 'heures' && (() => {
            const JOURS_LONG = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi']
            const ABSENCES = [
              { value: '', label: '— Travaillé' },
              { value: 'conge_paye', label: 'Congé payé' },
              { value: 'maladie', label: 'Maladie' },
              { value: 'rtt', label: 'RTT' },
              { value: 'ferie', label: 'Férié' },
              { value: 'repos', label: 'Repos' },
            ]
            const ABSENCES_LABEL = { conge_paye: 'CP', maladie: 'Maladie', rtt: 'RTT', ferie: 'Férié', repos: 'Repos' }
            const staffList = aes.filter(a => a.type === 'staff' || a.type === 'assistante')
            const days = getDaysOfMonth(heuresMois)
            let totalH = 0
            days.forEach(d => { const h = netHeures(heures[d]); if (h) totalH += h })

            return (
              <div>
                <div style={{ display: 'flex', gap: 10, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select value={heuresAeId || ''}
                    onChange={e => { const id = e.target.value || null; setHeuresAeId(id); setHeures({}); if (id) chargerHeures(id, heuresMois) }}
                    style={{ padding: '8px 12px', borderRadius: 8, border: '1.5px solid #e5e7eb', fontSize: 13 }}>
                    <option value="">— Sélectionner un membre —</option>
                    {staffList.map(a => <option key={a.id} value={a.id}>{a.prenom} {a.nom}</option>)}
                  </select>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button onClick={() => { const d = new Date(heuresMois + '-01'); d.setMonth(d.getMonth()-1); const m = d.toISOString().slice(0,7); setHeuresMois(m); setHeures({}); if (heuresAeId) chargerHeures(heuresAeId, m) }}
                      style={{ background: 'var(--white)', border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 16 }}>‹</button>
                    <span style={{ fontWeight: 700, fontSize: 15, minWidth: 130, textAlign: 'center' }}>
                      {new Date(heuresMois + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
                    </span>
                    <button onClick={() => { const d = new Date(heuresMois + '-01'); d.setMonth(d.getMonth()+1); const m = d.toISOString().slice(0,7); setHeuresMois(m); setHeures({}); if (heuresAeId) chargerHeures(heuresAeId, m) }}
                      style={{ background: 'var(--white)', border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 16 }}>›</button>
                  </div>
                  {loadingHeures && <span style={{ fontSize: 13, color: '#888' }}>Chargement…</span>}
                  {(() => {
                    const now = new Date()
                    const isCurrent = heuresMois === now.toISOString().slice(0, 7)
                    if (!isCurrent) return null
                    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
                    const sendDay = lastDay - 2
                    const daysLeft = sendDay - now.getDate()
                    if (daysLeft < 0 || daysLeft > 5) return null
                    const color = daysLeft >= 4 ? '#16a34a' : daysLeft === 3 ? '#ca8a04' : daysLeft <= 1 ? '#dc2626' : '#ea580c'
                    const bg = daysLeft >= 4 ? '#f0fdf4' : daysLeft === 3 ? '#fefce8' : daysLeft <= 1 ? '#fef2f2' : '#fff7ed'
                    const border = daysLeft >= 4 ? '#bbf7d0' : daysLeft === 3 ? '#fde68a' : daysLeft <= 1 ? '#fecaca' : '#fed7aa'
                    return (
                      <span style={{ fontSize: 12, fontWeight: 700, color, background: bg, border: `1px solid ${border}`, borderRadius: 8, padding: '5px 10px' }}>
                        📤 Navette dans {daysLeft === 0 ? 'aujourd\'hui' : `J-${daysLeft}`}
                      </span>
                    )
                  })()}
                  {heuresAeId && (
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button onClick={() => { setGroupeActif(v => !v); setJoursSelectionnes(new Set()) }}
                        style={{ padding: '8px 14px', borderRadius: 8, background: groupeActif ? '#fef9c3' : 'var(--white)', color: '#854d0e', border: '1px solid #fde68a', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                        ⚡ Saisie rapide
                      </button>
                      {(() => {
                        const ae = aes.find(a => a.id === heuresAeId)
                        if (!ae) return null
                        return (
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#374151', cursor: 'pointer', padding: '6px 10px', borderRadius: 8, border: '1px solid #e5e7eb', background: 'var(--white)' }}>
                            <input type="checkbox" checked={!!ae.auto_send_navette}
                              onChange={() => toggleAutoSendNavette(ae.id, ae.auto_send_navette)}
                              style={{ width: 14, height: 14 }} />
                            Envoi auto navette
                          </label>
                        )
                      })()}
                      <button onClick={() => setShowAperçuNavette(v => !v)}
                        style={{ padding: '8px 14px', borderRadius: 8, background: showAperçuNavette ? '#EAE3D4' : 'var(--white)', color: '#2C2416', border: '1px solid #D9CEB8', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                        👁 Aperçu
                      </button>
                      <button onClick={envoyerNavette} disabled={sendingNavette}
                        style={{ padding: '8px 18px', borderRadius: 8, background: '#1a3a6e', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                        {sendingNavette ? 'Envoi…' : '📤 Navette Compact'}
                      </button>
                    </div>
                  )}
                </div>

                {groupeActif && heuresAeId && (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', marginBottom: 12, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#854d0e' }}>⚡ Saisie rapide</span>
                    <label style={{ fontSize: 12, color: '#374151', display: 'flex', alignItems: 'center', gap: 4 }}>
                      Début
                      <input type="time" value={groupeDebut} onChange={e => setGroupeDebut(e.target.value)}
                        style={{ padding: '3px 6px', borderRadius: 5, border: '1px solid #d1d5db', fontSize: 12 }} />
                    </label>
                    <label style={{ fontSize: 12, color: '#374151', display: 'flex', alignItems: 'center', gap: 4 }}>
                      Fin
                      <input type="time" value={groupeFin} onChange={e => setGroupeFin(e.target.value)}
                        style={{ padding: '3px 6px', borderRadius: 5, border: '1px solid #d1d5db', fontSize: 12 }} />
                    </label>
                    <label style={{ fontSize: 12, color: '#374151', display: 'flex', alignItems: 'center', gap: 4 }}>
                      Pause (min)
                      <input type="number" min="0" max="120" value={groupePause} onChange={e => setGroupePause(parseInt(e.target.value) || 0)}
                        style={{ width: 55, padding: '3px 6px', borderRadius: 5, border: '1px solid #d1d5db', fontSize: 12 }} />
                    </label>
                    <button onClick={appliquerGroupe} disabled={!joursSelectionnes.size}
                      style={{ padding: '6px 14px', borderRadius: 7, background: joursSelectionnes.size ? '#854d0e' : '#d1d5db', color: '#fff', border: 'none', cursor: joursSelectionnes.size ? 'pointer' : 'default', fontSize: 12, fontWeight: 600 }}>
                      Appliquer ({joursSelectionnes.size} jour{joursSelectionnes.size !== 1 ? 's' : ''})
                    </button>
                  </div>
                )}

                {!heuresAeId ? (
                  <div style={{ textAlign: 'center', padding: 48, color: '#9ca3af', fontSize: 14 }}>
                    Sélectionnez un membre du staff pour saisir ses heures
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#f3f4f6' }}>
                        {groupeActif && <th style={{ padding: '8px 6px', border: '1px solid #e5e7eb', width: 32 }}></th>}
                        <th style={{ padding: '8px 10px', textAlign: 'left', border: '1px solid #e5e7eb' }}>Jour</th>
                        <th style={{ padding: '8px 10px', border: '1px solid #e5e7eb', width: 90 }}>Début</th>
                        <th style={{ padding: '8px 10px', border: '1px solid #e5e7eb', width: 90 }}>Fin</th>
                        <th style={{ padding: '8px 10px', border: '1px solid #e5e7eb', width: 85 }}>Pause (min)</th>
                        <th style={{ padding: '8px 10px', border: '1px solid #e5e7eb', width: 75 }}>Heures</th>
                        <th style={{ padding: '8px 10px', border: '1px solid #e5e7eb', width: 150 }}>Absence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {days.map(d => {
                        const date = new Date(d + 'T12:00:00')
                        const dow = date.getDay()
                        const isWE = dow === 0 || dow === 6
                        const row = heures[d] || {}
                        const h = netHeures(row)

                        function save(overrides = {}) {
                          const merged = { ...row, ...overrides }
                          sauvegarderJour(d, {
                            heure_debut: merged.heure_debut || null,
                            heure_fin: merged.heure_fin || null,
                            pause_min: merged.pause_min || 0,
                            type_absence: merged.type_absence || null,
                            notes: merged.notes || null,
                          })
                        }

                        return (
                          <tr key={d} style={{ background: joursSelectionnes.has(d) ? '#fefce8' : isWE ? '#f9fafb' : '#fff' }}>
                            {groupeActif && (
                              <td style={{ padding: '3px 6px', border: '1px solid #e5e7eb', textAlign: 'center' }}>
                                <input type="checkbox" checked={joursSelectionnes.has(d)}
                                  onChange={() => setJoursSelectionnes(prev => { const s = new Set(prev); s.has(d) ? s.delete(d) : s.add(d); return s })}
                                  style={{ width: 14, height: 14, cursor: 'pointer' }} />
                              </td>
                            )}
                            <td style={{ padding: '6px 10px', border: '1px solid #e5e7eb', color: isWE ? '#9ca3af' : '#374151', fontWeight: isWE ? 400 : 500 }}>
                              {JOURS_LONG[dow]} {date.getDate()}
                            </td>
                            <td style={{ padding: '3px 5px', border: '1px solid #e5e7eb' }}>
                              <input type="time" value={row.heure_debut || ''} disabled={!!row.type_absence}
                                onChange={e => setHeures(p => ({ ...p, [d]: { ...p[d], heure_debut: e.target.value } }))}
                                onBlur={e => save({ heure_debut: e.target.value })}
                                style={{ width: '100%', padding: '4px 5px', border: '1px solid #e5e7eb', borderRadius: 5, fontSize: 12, background: row.type_absence ? '#f3f4f6' : '#fff' }} />
                            </td>
                            <td style={{ padding: '3px 5px', border: '1px solid #e5e7eb' }}>
                              <input type="time" value={row.heure_fin || ''} disabled={!!row.type_absence}
                                onChange={e => setHeures(p => ({ ...p, [d]: { ...p[d], heure_fin: e.target.value } }))}
                                onBlur={e => save({ heure_fin: e.target.value })}
                                style={{ width: '100%', padding: '4px 5px', border: '1px solid #e5e7eb', borderRadius: 5, fontSize: 12, background: row.type_absence ? '#f3f4f6' : '#fff' }} />
                            </td>
                            <td style={{ padding: '3px 5px', border: '1px solid #e5e7eb' }}>
                              <input type="number" min="0" max="120" value={row.pause_min ?? ''} disabled={!!row.type_absence}
                                onChange={e => setHeures(p => ({ ...p, [d]: { ...p[d], pause_min: e.target.value === '' ? 0 : parseInt(e.target.value) } }))}
                                onBlur={e => save({ pause_min: parseInt(e.target.value) || 0 })}
                                style={{ width: '100%', padding: '4px 5px', border: '1px solid #e5e7eb', borderRadius: 5, fontSize: 12, background: row.type_absence ? '#f3f4f6' : '#fff' }} />
                            </td>
                            <td style={{ padding: '6px 10px', border: '1px solid #e5e7eb', textAlign: 'center', fontWeight: 600 }}>
                              {row.type_absence
                                ? <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 400 }}>{ABSENCES_LABEL[row.type_absence] || row.type_absence}</span>
                                : h !== null ? <span style={{ color: '#15803d' }}>{h.toFixed(2)}h</span> : ''}
                            </td>
                            <td style={{ padding: '3px 5px', border: '1px solid #e5e7eb' }}>
                              <select value={row.type_absence || ''}
                                onChange={e => {
                                  const abs = e.target.value || null
                                  const next = { ...row, type_absence: abs, heure_debut: abs ? null : row.heure_debut, heure_fin: abs ? null : row.heure_fin }
                                  setHeures(p => ({ ...p, [d]: next }))
                                  sauvegarderJour(d, { heure_debut: next.heure_debut, heure_fin: next.heure_fin, pause_min: next.pause_min || 0, type_absence: abs, notes: next.notes || null })
                                }}
                                style={{ width: '100%', padding: '4px 5px', border: '1px solid #e5e7eb', borderRadius: 5, fontSize: 12 }}>
                                {ABSENCES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                              </select>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: '#f0fdf4', fontWeight: 700 }}>
                        <td colSpan={groupeActif ? 5 : 4} style={{ padding: '8px 10px', border: '1px solid #e5e7eb' }}>Total</td>
                        <td style={{ padding: '8px 10px', border: '1px solid #e5e7eb', textAlign: 'center', color: '#15803d' }}>{totalH.toFixed(2)}h</td>
                        <td style={{ border: '1px solid #e5e7eb' }} />
                      </tr>
                    </tfoot>
                  </table>
                )}

                {showAperçuNavette && heuresAeId && (() => {
                  const result = genererHtmlNavette()
                  if (!result) return null
                  return (
                    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}
                      onClick={e => { if (e.target === e.currentTarget) setShowAperçuNavette(false) }}>
                      <div style={{ background: '#fff', borderRadius: 12, border: '2px solid #D9CEB8', maxWidth: 960, width: '100%', overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
                        <div style={{ background: '#EAE3D4', padding: '10px 18px', fontSize: 12, fontWeight: 600, color: '#2C2416', borderBottom: '1px solid #D9CEB8', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span>👁 Aperçu — email vers anne@compact.fr</span>
                          <button onClick={() => setShowAperçuNavette(false)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#2C2416', lineHeight: 1 }}>✕</button>
                        </div>
                        <div style={{ padding: 20, background: '#fff', overflowX: 'auto' }}
                          dangerouslySetInnerHTML={{ __html: result.html }} />
                      </div>
                    </div>
                  )
                })()}
              </div>
            )
          })()}

          {tab === 'prestations' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {prestationTypes.map(pt => (
                <div key={pt.id} style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{pt.nom}</div>
                    {pt.description && <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{pt.description}</div>}
                  </div>
                  <div style={{ background: '#f0fdf4', color: '#16a34a', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600 }}>
                    {(pt.taux_defaut / 100).toFixed(0)} €/{pt.unite === 'forfait' ? 'forfait' : 'h'}
                  </div>
                  <div style={{ fontSize: 11, color: '#888', background: '#f3f4f6', borderRadius: 5, padding: '3px 8px' }}>{pt.unite}</div>
                  <button onClick={() => { setFormPT({ nom: pt.nom, description: pt.description || '', taux_defaut: pt.taux_defaut / 100, unite: pt.unite }); setEditingPT(pt.id) }} style={{ background: '#f3f4f6', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>Modifier</button>
                  <button onClick={() => supprimerPT(pt.id)} style={{ background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Modal AE */}
      {editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 28, width: '100%', maxWidth: 620, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{editing === 'new' ? 'Nouvel AE' : 'Modifier la fiche'}</h2>
              <button onClick={fermer} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#888' }}>✕</button>
            </div>
            {error && <div style={{ background: '#FEE2E2', borderRadius: 7, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#B91C1C' }}>✕ {error}</div>}
            {success && <div style={{ background: '#DCFCE7', borderRadius: 7, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#15803D' }}>✓ {success}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {inp('nom', 'Nom *')}
              {inp('prenom', 'Prénom')}
              {inp('siret', 'SIRET', { placeholder: '000 000 000 00000' })}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>Type</label>
                <select value={form.type || 'ae'} onChange={e => change('type', e.target.value)}
                  style={{ padding: '8px 10px', borderRadius: 7, border: '1.5px solid #e5e7eb', fontSize: 13 }}>
                  <option value="ae">🧹 Auto-entrepreneur</option>
                  <option value="staff">🌅 Staff DCB</option>
                  <option value="assistante">🗂️ Assistante DCB</option>
                </select>
              </div>
              {form.type !== 'staff' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>Taux horaire (€/h)</label>
                <input type="number" step="0.5" min="0" value={(form.taux_horaire || 2500) / 100}
                  onChange={e => change('taux_horaire', Math.round(parseFloat(e.target.value || 0) * 100))}
                  style={{ padding: '8px 10px', borderRadius: 7, border: '1.5px solid #e5e7eb', fontSize: 13 }} />
              </div>
              )}
              <div style={{ gridColumn: '1/-1' }}>{inp('adresse', 'Adresse')}</div>
              {inp('code_postal', 'Code postal')}
              {inp('ville', 'Ville')}
              {inp('email', 'Email', { type: 'email' })}
              {inp('telephone', 'Téléphone')}
              <div style={{ gridColumn: '1/-1' }}>{inp('iban', 'IBAN', { placeholder: 'FR76 0000 0000 0000 0000 0000 000' })}</div>
              <div style={{ gridColumn: '1/-1', background: '#fffbeb', borderRadius: 10, border: '1px solid #fde68a', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 2 }}>📅 Calendriers iCal</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#CC9933' }}>
                    Hospitable (missions) — <span style={{ fontWeight: 400, color: '#9ca3af' }}>lecture seule, généré par Hospitable</span>
                  </label>
                  <input value={form.ical_url ?? ''} readOnly
                    style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 11, background: '#f9fafb', color: '#6b7280', cursor: 'default', fontFamily: 'monospace' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#0891B2' }}>
                    Planning pro — <span style={{ fontWeight: 400, color: '#6b7280' }}>RDVs pro visibles dans PowerHouse avec leur titre</span>
                  </label>
                  <input value={form.ical_pro ?? ''} onChange={e => change('ical_pro', e.target.value)}
                    placeholder="webcal:// ou https://... (Google Cal, Outlook pro…)"
                    style={{ padding: '7px 10px', borderRadius: 6, border: '1.5px solid #0891B2', fontSize: 12 }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#7C3AED' }}>
                    Perso (indispos) — <span style={{ fontWeight: 400, color: '#6b7280' }}>affiché "Indispo" dans PowerHouse, titre jamais visible</span>
                  </label>
                  <input value={form.ical_perso ?? ''} onChange={e => change('ical_perso', e.target.value)}
                    placeholder="webcal:// ou https://... (Apple Calendar, Google Cal perso…)"
                    style={{ padding: '7px 10px', borderRadius: 6, border: '1.5px solid #7C3AED', fontSize: 12 }} />
                </div>
              </div>
              <div style={{ gridColumn: '1/-1', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>Note</label>
                <textarea value={form.note ?? ''} onChange={e => change('note', e.target.value)} rows={2}
                  style={{ padding: '8px 10px', borderRadius: 7, border: '1.5px solid #e5e7eb', fontSize: 13, resize: 'vertical' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={fermer} style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>Annuler</button>
              <button onClick={sauvegarder} disabled={saving}
                style={{ background: '#1a3a6e', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? .7 : 1 }}>
                {saving ? 'Enregistrement...' : '✓ Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Modal credentials après création AE */}
      {credentials && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 32, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Compte créé !</h2>
              <p style={{ margin: '8px 0 0', color: '#666', fontSize: 14 }}>{credentials.nom} peut maintenant accéder au portail</p>
            </div>
            <div style={{ background: '#f8fafc', borderRadius: 12, padding: 20, marginBottom: 20, border: '1px solid #e5e7eb' }}>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', marginBottom: 4 }}>URL du portail</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1a3a6e', wordBreak: 'break-all' }}>https://dcb-portail-ae.vercel.app</div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', marginBottom: 4 }}>Email</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{credentials.email}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', marginBottom: 4 }}>Mot de passe temporaire</div>
                <div style={{ fontSize: 18, fontWeight: 900, color: '#1a3a6e', letterSpacing: 2, fontFamily: 'monospace' }}>{credentials.password}</div>
                <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>⚠️ À communiquer à l'AE — il pourra le modifier depuis le portail</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => {
                const txt = `Portail DCB : https://dcb-portail-ae.vercel.app\nEmail : ${credentials.email}\nMot de passe : ${credentials.password}`
                navigator.clipboard.writeText(txt)
                setSuccess('Copié !')
                setTimeout(() => setSuccess(null), 2000)
              }} style={{ flex: 1, background: '#f3f4f6', border: 'none', borderRadius: 10, padding: '12px', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
                📋 Copier les infos
              </button>
              <button onClick={() => setCredentials(null)}
                style={{ flex: 1, background: '#1a3a6e', color: '#fff', border: 'none', borderRadius: 10, padding: '12px', fontSize: 13, cursor: 'pointer', fontWeight: 700 }}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal type de prestation */}
      {editingPT && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 28, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{editingPT === 'new' ? 'Nouvelle prestation' : 'Modifier prestation'}</h2>
              <button onClick={() => { setEditingPT(null); setErrorPT(null) }} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#888' }}>✕</button>
            </div>
            {errorPT && <div style={{ background: '#FEE2E2', borderRadius: 7, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#B91C1C' }}>✕ {errorPT}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>Nom *</label>
                <input value={formPT.nom} onChange={e => setFormPT(f => ({ ...f, nom: e.target.value }))}
                  style={{ padding: '8px 10px', borderRadius: 7, border: '1.5px solid #e5e7eb', fontSize: 13 }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>Description</label>
                <input value={formPT.description} onChange={e => setFormPT(f => ({ ...f, description: e.target.value }))}
                  style={{ padding: '8px 10px', borderRadius: 7, border: '1.5px solid #e5e7eb', fontSize: 13 }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>Taux défaut (€)</label>
                  <input type="number" step="0.5" min="0" value={formPT.taux_defaut}
                    onChange={e => setFormPT(f => ({ ...f, taux_defaut: parseFloat(e.target.value) || 0 }))}
                    style={{ padding: '8px 10px', borderRadius: 7, border: '1.5px solid #e5e7eb', fontSize: 13 }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>Unité</label>
                  <select value={formPT.unite} onChange={e => setFormPT(f => ({ ...f, unite: e.target.value }))}
                    style={{ padding: '8px 10px', borderRadius: 7, border: '1.5px solid #e5e7eb', fontSize: 13 }}>
                    <option value="heure">Par heure</option>
                    <option value="forfait">Forfait</option>
                  </select>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={() => setEditingPT(null)} style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>Annuler</button>
              <button onClick={sauvegarderPT} disabled={saving}
                style={{ background: '#1a3a6e', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                ✓ Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Balance AUTO/FMEN */}
      {balance && (() => {
        const ecartAuto = balance.auto_saisis > 0 ? balance.auto_reel - balance.auto_provision : null
        const ecartFmen = balance.auto_saisis > 0 ? balance.fmen_reel - balance.fmen_provision : null
        const fmt = v => (v / 100).toFixed(2) + ' €'
        const fmtEcart = v => (v >= 0 ? '+' : '') + (v / 100).toFixed(2) + ' €'
        return (
          <div style={{ display:'flex', gap:12, marginBottom:20, flexWrap:'wrap', alignItems:'center' }}>
            <input type="month" value={moisBalance}
              onChange={e => { setMoisBalance(e.target.value); chargerBalance(e.target.value) }}
              style={{ fontSize:13, padding:'3px 8px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg-input)' }}
            />
            <span style={{ fontSize:12, color:'var(--text-muted)' }}>{balance.auto_saisis}/{balance.nb_auto} missions saisies</span>
            {[
              { label: 'AUTO provision', val: fmt(balance.auto_provision), color: '#888', flag: null },
              { label: 'AUTO réel', val: ecartAuto != null ? fmt(balance.auto_reel) : '—',
                color: ecartAuto != null ? (ecartAuto > 0 ? '#dc2626' : '#16a34a') : '#888',
                flag: ecartAuto != null ? (ecartAuto > 0 ? '🔴 ' : '🟢 ') + fmtEcart(ecartAuto) : null },
              { label: 'FMEN provision', val: fmt(balance.fmen_provision), color: '#888', flag: null },
              { label: 'FMEN réel', val: ecartFmen != null ? fmt(balance.fmen_reel) : '—',
                color: ecartFmen != null ? (ecartFmen < 0 ? '#16a34a' : '#dc2626') : '#888',
                flag: ecartFmen != null ? (ecartFmen < 0 ? '🟢 ' : '🔴 ') + fmtEcart(ecartFmen) : null },
            ].map(item => (
              <div key={item.label} style={{ background:'var(--bg-card,#fff)', border:'1px solid var(--border,#e5e7eb)', borderRadius:10, padding:'10px 16px', minWidth:150 }}>
                <div style={{ fontSize:11, color:'var(--text-muted,#888)', marginBottom:4 }}>{item.label}</div>
                <div style={{ fontSize:18, fontWeight:600, color: item.color }}>{item.val}</div>
                {item.flag && <div style={{ fontSize:11, color: item.color, marginTop:2 }}>{item.flag}</div>}
              </div>
            ))}
          </div>
        )
      })()}

      {/* Modal confirmation suppression — indépendant de balance */}
      {confirmModal && (
        <div style={{ position:'fixed',inset:0,background:'rgba(44,36,22,0.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000 }}>
          <div style={{ background:'var(--bg,#F7F3EC)',border:'2px solid var(--brand,#CC9933)',borderRadius:16,padding:'28px 32px',maxWidth:400,width:'90%',boxShadow:'0 8px 32px rgba(44,36,22,0.18)' }}>
            <p style={{ margin:'0 0 24px',color:'var(--text,#2C2416)',fontSize:14,lineHeight:1.6,whiteSpace:'pre-line' }}>{confirmModal.message}</p>
            <div style={{ display:'flex',gap:10,justifyContent:'flex-end' }}>
              <button onClick={() => setConfirmModal(null)}
                style={{ padding:'9px 18px',borderRadius:8,border:'1.5px solid var(--border,#D9CEB8)',background:'white',color:'var(--text,#2C2416)',cursor:'pointer',fontWeight:600,fontSize:13 }}>
                Annuler
              </button>
              <button onClick={confirmModal.onConfirm}
                style={{ padding:'9px 18px',borderRadius:8,border:'none',background:'#DC2626',color:'white',cursor:'pointer',fontWeight:700,fontSize:13 }}>
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}