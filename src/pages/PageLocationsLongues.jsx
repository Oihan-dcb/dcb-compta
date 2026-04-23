import { AGENCE } from '../lib/agence'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import MoisSelector from '../components/MoisSelector'
import { formatMontant } from '../lib/hospitable'
import { useMoisPersisted } from '../hooks/useMoisPersisted'
import {
  listerEtudiants,
  creerEtudiant,
  modifierEtudiant,
  archiverEtudiant,
  supprimerEtudiant,
  montantTotalEtudiant,
  montantVirementProprio,
  listerLoyersMois,
  initialiserLoyersMois,
  marquerLoyerRecu,
  marquerLoyerStatut,
  listerVirementsMois,
  marquerVirementEffectue,
  getCautionEtudiant,
  mettreAJourCaution,
  listerDocuments,
  uploaderDocument,
  supprimerDocument,
  getSignedUrl,
  listerLoyersEtudiant,
  listerVirementsEtudiant,
  listerLogsEtudiant,
  ajouterLog,
} from '../services/locationsLongues'
import {
  parserFichierLLD,
  importerMouvementsLLD,
  listerMouvementsLLD,
  listerMoisDisposLLD,
  supprimerMouvementLLD,
} from '../services/lldBanque'

const moisCourant = new Date().toISOString().slice(0, 7)
const RELANCES_ACTIVES_DEPUIS = '2026-05'
const relancesAutorisees = () => moisCourant >= RELANCES_ACTIVES_DEPUIS
function fmtDate(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

const STATUT_LOYER = {
  attendu:  { label: 'Attendu',    color: '#B45309', bg: '#FFF7ED' },
  recu:     { label: 'Reçu ✓',    color: '#059669', bg: '#D1FAE5' },
  en_retard:{ label: 'En retard',  color: '#DC2626', bg: '#FEE2E2' },
  exonere:  { label: 'Exonéré',   color: '#6B7280', bg: '#F3F4F6' },
}

const STATUT_VIREMENT = {
  a_virer: { label: 'À virer',  color: '#B45309', bg: '#FFF7ED' },
  vire:    { label: 'Viré ✓',   color: '#059669', bg: '#D1FAE5' },
}

const STATUT_ETUDIANT = {
  actif:      { label: 'Actif',      color: '#059669', bg: '#D1FAE5' },
  en_attente: { label: 'En attente', color: '#B45309', bg: '#FFF7ED' },
  parti:      { label: 'Parti',      color: '#6B7280', bg: '#F3F4F6' },
}

const STATUT_CAUTION = {
  en_cours:          { label: 'En cours',         color: '#059669', bg: '#D1FAE5' },
  a_rendre:          { label: 'À rendre',          color: '#B45309', bg: '#FFF7ED' },
  rendue:            { label: 'Rendue ✓',          color: '#6B7280', bg: '#F3F4F6' },
  retenue_partielle: { label: 'Retenue partielle', color: '#DC2626', bg: '#FEE2E2' },
}

const TYPES_DOC = [
  { type: 'contrat_location', label: 'Contrat de location' },
  { type: 'eds_entree',       label: 'État des lieux — entrée' },
  { type: 'eds_sortie',       label: 'État des lieux — sortie' },
]

const FORM_ETUDIANT_EMPTY = {
  nom: '', prenom: '', email: '', telephone: '',
  bien_id: '', proprietaire_id: '', adresse_complete: '',
  date_entree: new Date().toISOString().slice(0, 10),
  date_sortie_prevue: '',
  loyer_nu: '', supplement_loyer: '0', charges_eau: '0',
  charges_copro: '0', charges_internet: '0',
  honoraires_dcb: '', caution: '', jour_paiement_attendu: '5',
  statut: 'actif',
  type_bail: 'etudiant',
}

export default function PageLocationsLongues() {
  const [mois, setMois] = useMoisPersisted()
  const [onglet, setOnglet] = useState(() => localStorage.getItem('tab_lld') || 'mensuel') // 'mensuel' | 'etudiants'
  useEffect(() => localStorage.setItem('tab_lld', onglet), [onglet])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  // Vue mensuelle
  const [loyers, setLoyers] = useState([])
  const [virements, setVirements] = useState([])

  // Vue étudiants
  const [etudiants, setEtudiants] = useState([])
  const [biens, setBiens] = useState([])
  const [proprios, setProprios] = useState([])

  // Modal loyer reçu
  const [loyerModal, setLoyerModal] = useState(null)
  const [dateReception, setDateReception] = useState(new Date().toISOString().slice(0, 10))
  const [montantRecu, setMontantRecu] = useState('')

  // Modal étudiant
  const [showModalEtudiant, setShowModalEtudiant] = useState(false)
  const [editingEtudiant, setEditingEtudiant] = useState(null)
  const [formEtudiant, setFormEtudiant] = useState(FORM_ETUDIANT_EMPTY)
  const [saving, setSaving] = useState(false)

  // Bilan mensuel
  const [generatingBilan, setGeneratingBilan] = useState(false)

  // Archivage / suppression
  const [voirArchives, setVoirArchives] = useState(false)
  const [confirmSuppr, setConfirmSuppr] = useState(null) // { etudiant, action }
  const [actioning, setActioning] = useState(false)

  // Loyers mois courant (pour indicateurs dans l'onglet Étudiants)
  const [loyersCourant, setLoyersCourant] = useState([])

  // Onglet Suivi
  const [suiviEtudiantId, setSuiviEtudiantId] = useState('')
  const [suiviLoyers, setSuiviLoyers] = useState([])
  const [suiviVirements, setSuiviVirements] = useState([])
  const [suiviCautionData, setSuiviCautionData] = useState(null)
  const [suiviDocs, setSuiviDocs] = useState([])
  const [suiviLogs, setSuiviLogs] = useState([])
  const [suiviLoading, setSuiviLoading] = useState(false)

  // Dossier étudiant
  const [dossierEtudiant, setDossierEtudiant] = useState(null)
  const [docs, setDocs] = useState([])
  const [caution, setCaution] = useState(null)
  const [uploadingType, setUploadingType] = useState(null)

  // Onglet Banque LLD
  const [banqueCompte, setBanqueCompte] = useState('loyers')
  const [banqueMois, setBanqueMois] = useState(moisCourant)
  const [banqueMoisDispos, setBanqueMoisDispos] = useState([])
  const [banqueMouvements, setBanqueMouvements] = useState([])
  const [banqueLoading, setBanqueLoading] = useState(false)
  const [banqueParsed, setBanqueParsed] = useState(null) // { rows, moisDispos, total }
  const [banqueMoisImport, setBanqueMoisImport] = useState('')
  const [banqueImporting, setBanqueImporting] = useState(false)

  useEffect(() => { chargerReferentiels() }, [])
  useEffect(() => { if (onglet === 'mensuel') chargerMensuel() }, [mois, onglet])
  useEffect(() => { if (onglet === 'etudiants') chargerEtudiants(voirArchives) }, [onglet, voirArchives])
  useEffect(() => { if (onglet === 'suivi' && !etudiants.length) chargerEtudiants() }, [onglet])
  useEffect(() => { if (suiviEtudiantId) chargerSuivi(suiviEtudiantId) }, [suiviEtudiantId])
  useEffect(() => {
    if (onglet === 'banque') chargerBanque(banqueCompte, banqueMois)
  }, [onglet, banqueCompte, banqueMois])

  useEffect(() => {
    const channel = supabase.channel('lld-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'loyer_suivi' }, () => {
        if (onglet === 'mensuel') chargerMensuel()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'virement_proprio_suivi' }, () => {
        if (onglet === 'mensuel') chargerMensuel()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [onglet, mois])

  async function chargerReferentiels() {
    const [{ data: b }, { data: p }] = await Promise.all([
      supabase.from('bien').select('id, code, hospitable_name, proprietaire_id, adresse').eq('agence', AGENCE).eq('listed', true).order('code'),
      supabase.from('proprietaire').select('id, nom, prenom').eq('agence', AGENCE).order('nom'),
    ])
    setBiens(b || [])
    setProprios(p || [])
  }

  async function chargerMensuel() {
    setLoading(true)
    setError(null)
    try {
      const [l, v] = await Promise.all([
        listerLoyersMois(mois),
        listerVirementsMois(mois),
      ])
      setLoyers(l)
      setVirements(v)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function chargerEtudiants(avecArchives = voirArchives) {
    setLoading(true)
    setError(null)
    try {
      const [ets, lc] = await Promise.all([
        listerEtudiants(AGENCE, null, avecArchives),
        listerLoyersMois(moisCourant),
      ])
      setEtudiants(ets)
      setLoyersCourant(lc)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirmerAction() {
    if (!confirmSuppr) return
    setActioning(true); setError(null)
    try {
      if (confirmSuppr.action === 'archiver') {
        await archiverEtudiant(confirmSuppr.etudiant.id, true)
        setSuccess(`${confirmSuppr.etudiant.nom} archivé — envois auto désactivés`)
      } else if (confirmSuppr.action === 'desarchiver') {
        await archiverEtudiant(confirmSuppr.etudiant.id, false)
        setSuccess(`${confirmSuppr.etudiant.nom} réactivé`)
      } else if (confirmSuppr.action === 'supprimer') {
        await supprimerEtudiant(confirmSuppr.etudiant.id)
        setSuccess(`${confirmSuppr.etudiant.nom} supprimé définitivement`)
      }
      setConfirmSuppr(null)
      await chargerEtudiants()
    } catch (e) {
      setError(e.message)
    } finally {
      setActioning(false)
    }
  }

  async function initialiserMois() {
    setLoading(true)
    setError(null)
    try {
      const result = await initialiserLoyersMois(mois)
      setLoyers(result)
      const v = await listerVirementsMois(mois)
      setVirements(v)
      setSuccess(`Mois ${mois} initialisé — ${result.length} étudiant(s)`)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function soumettreReception(e) {
    e.preventDefault()
    if (!loyerModal) return
    setSaving(true)
    setError(null)
    const loyerId    = loyerModal.id
    const hasEmail   = !!loyerModal.etudiant?.email
    try {
      const montantCentimes = Math.round(parseFloat(montantRecu) * 100)
      await marquerLoyerRecu(loyerId, {
        montant_recu:   montantCentimes,
        date_reception: dateReception,
      })
      // Log loyer reçu
      await ajouterLog({
        agence:         AGENCE,
        etudiant_id:    loyerModal.etudiant_id,
        loyer_suivi_id: loyerId,
        type:           'loyer_recu',
        canal:          'ui',
        statut:         'ok',
        mois:           loyerModal.mois,
        details:        { montant: montantCentimes, date_reception: dateReception },
      })
      setLoyerModal(null)
      await chargerMensuel()

      // Quittance automatique si l'étudiant a un email
      if (hasEmail) {
        setSuccess('Loyer reçu ✓ — envoi quittance…')
        const { error: qErr } = await supabase.functions.invoke('generer-quittance', {
          body: { loyer_suivi_id: loyerId, envoyer_email: true },
        })
        setSuccess(qErr ? 'Loyer reçu ✓ — quittance non envoyée (erreur)' : 'Loyer reçu ✓ — quittance envoyée par email')
      } else {
        setSuccess('Loyer reçu ✓ — pas d\'email étudiant, quittance à envoyer manuellement')
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function envoyerQuittance(loyerSuiviId) {
    setError(null)
    try {
      const { data, error } = await supabase.functions.invoke('generer-quittance', {
        body: { loyer_suivi_id: loyerSuiviId, envoyer_email: true },
      })
      if (error) throw error
      setSuccess(`Quittance envoyée${data?.email_envoye ? ' par email' : ' (pas d\'email étudiant)'}`)
      await chargerMensuel()
    } catch (e) {
      setError(e.message)
    }
  }

  async function changerStatutLoyer(id, statut) {
    setError(null)
    try {
      await marquerLoyerStatut(id, statut)
      await chargerMensuel()
    } catch (e) {
      setError(e.message)
    }
  }

  // ── Relance SMS manuelle ──────────────────────────────────────────────
  async function envoyerRelanceManuelle(loyerSuiviId) {
    if (!relancesAutorisees()) {
      setError('Relances désactivées — actives à partir de mai 2026')
      return
    }
    setSuccess(null)
    setError(null)
    try {
      const { data, error } = await supabase.functions.invoke('relance-loyer', {
        body: { loyer_suivi_id: loyerSuiviId },
      })
      if (error) throw error
      const detail = data?.detail?.[0]
      if (detail?.sms_ok || detail?.email_ok) {
        setSuccess(`Relance envoyée — SMS: ${detail.sms_ok ? '✓' : '✗'} Email: ${detail.email_ok ? '✓' : '✗'}`)
      } else {
        setSuccess('Relance traitée (vérifier les coordonnées de l\'étudiant)')
      }
      await chargerSuivi(suiviEtudiantId)
    } catch (e) {
      setError('Erreur relance : ' + e.message)
    }
  }

  // ── Quittance PDF — signed URL ────────────────────────────────────────
  async function ouvrirQuittancePdf(etudiantId, mois) {
    const path = `quittances/${etudiantId}/${mois}.pdf`
    try {
      const url = await getSignedUrl(path)
      window.open(url, '_blank')
    } catch {
      setError('Impossible d\'ouvrir la quittance — fichier introuvable.')
    }
  }

  // ── Suivi étudiant ────────────────────────────────────────────────────
  async function chargerSuivi(etudiantId) {
    setSuiviLoading(true)
    try {
      const [l, v, c, d, logs] = await Promise.all([
        listerLoyersEtudiant(etudiantId, AGENCE),
        listerVirementsEtudiant(etudiantId, AGENCE),
        getCautionEtudiant(etudiantId),
        listerDocuments(etudiantId),
        listerLogsEtudiant(etudiantId, AGENCE),
      ])
      setSuiviLoyers(l)
      setSuiviVirements(v)
      setSuiviCautionData(c)
      setSuiviDocs(d)
      setSuiviLogs(logs)
    } catch (e) {
      setError(e.message)
    } finally {
      setSuiviLoading(false)
    }
  }

  // ── Bilan mensuel ─────────────────────────────────────────────────────
  async function genererBilan(envoyer_email = false) {
    setGeneratingBilan(envoyer_email ? 'envoyer' : 'apercu')
    setError(null)
    try {
      const { data, error } = await supabase.functions.invoke('bilan-lld', {
        body: { mois, agence: AGENCE, envoyer_email },
      })
      if (error) throw error
      if (data?.pdf_url) window.open(data.pdf_url, '_blank')
      setSuccess(data?.email_envoye ? 'Bilan envoyé au comptable ✓' : 'Bilan généré')
    } catch (e) {
      setError(e.message)
    } finally {
      setGeneratingBilan(false)
    }
  }

  // ── Banque LLD ─────────────────────────────────────────────────────────
  async function chargerBanque(compte, mois) {
    setBanqueLoading(true); setError(null)
    try {
      const [mvts, moisDispos] = await Promise.all([
        listerMouvementsLLD(compte, mois),
        listerMoisDisposLLD(compte),
      ])
      setBanqueMouvements(mvts)
      setBanqueMoisDispos(moisDispos)
    } catch (e) { setError(e.message) }
    finally { setBanqueLoading(false) }
  }

  async function handleFichierBanque(file) {
    if (!file) return
    setError(null); setBanqueParsed(null)
    try {
      const parsed = await parserFichierLLD(file)
      if (!parsed.total) { setError('Aucune ligne trouvée dans le fichier'); return }
      setBanqueParsed(parsed)
      setBanqueMoisImport(parsed.moisDispos[0] || '')
    } catch (e) { setError('Erreur parsing CSV : ' + e.message) }
  }

  async function handleImporterBanque() {
    if (!banqueParsed || !banqueMoisImport) return
    setBanqueImporting(true); setError(null)
    try {
      const n = await importerMouvementsLLD(banqueParsed.rows, banqueCompte, banqueMoisImport)
      setSuccess(`${n} mouvement(s) importé(s) — compte ${banqueCompte}, ${banqueMoisImport}`)
      setBanqueParsed(null)
      await chargerBanque(banqueCompte, banqueMoisImport)
      setBanqueMois(banqueMoisImport)
    } catch (e) { setError(e.message) }
    finally { setBanqueImporting(false) }
  }

  async function handleSupprimerMouvement(id) {
    setError(null)
    try {
      await supprimerMouvementLLD(id)
      setBanqueMouvements(prev => prev.filter(m => m.id !== id))
    } catch (e) { setError(e.message) }
  }

  // ── Dossier ────────────────────────────────────────────────────────────
  async function ouvrirDossier(e) {
    setError(null)
    setDossierEtudiant(e)
    const [d, c] = await Promise.all([listerDocuments(e.id), getCautionEtudiant(e.id)])
    setDocs(d)
    setCaution(c)
  }

  async function handleUpload(type, file) {
    if (!file) return
    setUploadingType(type)
    setError(null)
    try {
      await uploaderDocument(dossierEtudiant.id, type, file)
      setDocs(await listerDocuments(dossierEtudiant.id))
      setSuccess('Document uploadé')
    } catch (e) {
      setError(e.message)
    } finally {
      setUploadingType(null)
    }
  }

  async function handleSupprimer(doc) {
    setError(null)
    try {
      await supprimerDocument(doc.id, doc.file_url)
      setDocs(await listerDocuments(dossierEtudiant.id))
    } catch (e) {
      setError(e.message)
    }
  }

  async function ouvrirDoc(filePath) {
    try {
      const url = await getSignedUrl(filePath)
      window.open(url, '_blank')
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleCaution(newStatut, extra = {}) {
    if (!caution) return
    const edsPresent = docs.some(d => d.type === 'eds_sortie')
    if ((newStatut === 'a_rendre' || newStatut === 'rendue') && !edsPresent) {
      setError('EDS de sortie requis avant de rendre la caution')
      return
    }
    setError(null)
    try {
      await mettreAJourCaution(caution.id, { statut: newStatut, ...extra })
      setCaution(c => ({ ...c, statut: newStatut, ...extra }))
      setSuccess('Caution mise à jour')
    } catch (e) {
      setError(e.message)
    }
  }

  async function confirmerVirement(id) {
    const today = new Date().toISOString().slice(0, 10)
    setError(null)
    try {
      await marquerVirementEffectue(id, today)
      setSuccess('Virement marqué effectué')
      await chargerMensuel()
    } catch (e) {
      setError(e.message)
    }
  }

  function ouvrirModalEtudiant(etudiant = null) {
    if (etudiant) {
      setFormEtudiant({
        nom:                   etudiant.nom,
        prenom:                etudiant.prenom || '',
        email:                 etudiant.email || '',
        telephone:             etudiant.telephone || '',
        bien_id:               etudiant.bien_id || '',
        proprietaire_id:       etudiant.proprietaire_id || '',
        adresse_complete:      etudiant.adresse_complete || '',
        date_entree:           etudiant.date_entree,
        date_sortie_prevue:    etudiant.date_sortie_prevue || '',
        loyer_nu:              (etudiant.loyer_nu / 100).toFixed(2),
        supplement_loyer:      (etudiant.supplement_loyer / 100).toFixed(2),
        charges_eau:           (etudiant.charges_eau / 100).toFixed(2),
        charges_copro:         (etudiant.charges_copro / 100).toFixed(2),
        charges_internet:      (etudiant.charges_internet / 100).toFixed(2),
        honoraires_dcb:        (etudiant.honoraires_dcb / 100).toFixed(2),
        caution:               (etudiant.caution / 100).toFixed(2),
        jour_paiement_attendu: String(etudiant.jour_paiement_attendu),
        statut:                etudiant.statut,
        type_bail:             etudiant.type_bail || 'etudiant',
      })
      setEditingEtudiant(etudiant)
    } else {
      setFormEtudiant(FORM_ETUDIANT_EMPTY)
      setEditingEtudiant(null)
    }
    setShowModalEtudiant(true)
    setError(null)
  }

  async function soumettreEtudiant(e) {
    e.preventDefault()
    if (!formEtudiant.nom || !formEtudiant.date_entree || !formEtudiant.loyer_nu || !formEtudiant.honoraires_dcb) {
      setError('Nom, date d\'entrée, loyer nu et honoraires DCB requis')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = {
        agence:                AGENCE,
        nom:                   formEtudiant.nom.trim(),
        prenom:                formEtudiant.prenom.trim() || null,
        email:                 formEtudiant.email.trim() || null,
        telephone:             formEtudiant.telephone.trim() || null,
        bien_id:               formEtudiant.bien_id || null,
        proprietaire_id:       formEtudiant.proprietaire_id || null,
        adresse_complete:      formEtudiant.adresse_complete.trim() || null,
        date_entree:           formEtudiant.date_entree,
        date_sortie_prevue:    formEtudiant.date_sortie_prevue || null,
        loyer_nu:              Math.round(parseFloat(formEtudiant.loyer_nu) * 100),
        supplement_loyer:      Math.round(parseFloat(formEtudiant.supplement_loyer || '0') * 100),
        charges_eau:           Math.round(parseFloat(formEtudiant.charges_eau || '0') * 100),
        charges_copro:         Math.round(parseFloat(formEtudiant.charges_copro || '0') * 100),
        charges_internet:      Math.round(parseFloat(formEtudiant.charges_internet || '0') * 100),
        honoraires_dcb:        Math.round(parseFloat(formEtudiant.honoraires_dcb) * 100),
        caution:               Math.round(parseFloat(formEtudiant.caution || '0') * 100),
        jour_paiement_attendu: parseInt(formEtudiant.jour_paiement_attendu, 10),
        statut:                formEtudiant.statut,
        type_bail:             formEtudiant.type_bail || 'etudiant',
      }
      if (editingEtudiant) {
        await modifierEtudiant(editingEtudiant.id, payload)
        setSuccess('Locataire modifié')
      } else {
        await creerEtudiant(payload)
        await initialiserLoyersMois(mois, AGENCE)
        setSuccess('Locataire créé')
      }
      setShowModalEtudiant(false)
      await chargerEtudiants()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Calculs solde mensuel ──────────────────────────────────────────────
  const totalLoyers = loyers
    .filter(l => l.statut === 'recu')
    .reduce((s, l) => s + (l.montant_recu || 0), 0)
  const totalVirements = virements
    .filter(v => v.statut === 'vire')
    .reduce((s, v) => s + (v.montant || 0), 0)
  const solde = totalLoyers - totalVirements
  const nbLoyersAttendus  = loyers.filter(l => l.statut === 'attendu' || l.statut === 'en_retard').length
  const nbVirementsAFaire = virements.filter(v => v.statut === 'a_virer').length

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Locations longues durée</h1>
          <p className="page-subtitle">
            {onglet === 'mensuel'
              ? <>
                  {loyers.length} étudiant(s) · solde <strong style={{ color: solde === 0 ? '#059669' : '#DC2626' }}>{formatMontant(solde)}</strong>
                  {nbLoyersAttendus > 0 && <span style={{ color: '#DC2626', marginLeft: 8 }}>· {nbLoyersAttendus} loyer(s) en attente</span>}
                  {nbVirementsAFaire > 0 && <span style={{ color: '#B45309', marginLeft: 8 }}>· {nbVirementsAFaire} virement(s) à faire</span>}
                </>
              : <>{etudiants.length} étudiant(s) enregistré(s)</>
            }
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {onglet === 'mensuel' && (
            <>
              <MoisSelector mois={mois} setMois={setMois} moisDispos={[moisCourant]} />
              <button className="btn btn-secondary" onClick={chargerMensuel} disabled={loading}>↺</button>
              {loyers.length > 0 && (
                <>
                  <button className="btn btn-secondary" onClick={() => genererBilan(false)}
                    disabled={!!generatingBilan}
                    title="Aperçu PDF sans envoi">
                    {generatingBilan === 'apercu' ? <><span className="spinner" /> PDF…</> : '👁 Aperçu'}
                  </button>
                  <button className="btn btn-secondary" onClick={() => genererBilan(true)}
                    disabled={!!generatingBilan}
                    title="Générer et envoyer au comptable">
                    {generatingBilan === 'envoyer' ? <><span className="spinner" /> Envoi…</> : '📤 Comptable'}
                  </button>
                </>
              )}
              {loyers.length === 0 && (
                <button className="btn btn-primary" onClick={initialiserMois} disabled={loading}>
                  Initialiser le mois
                </button>
              )}
            </>
          )}
          {onglet === 'etudiants' && (
            <>
              <button className="btn btn-secondary" onClick={() => setVoirArchives(v => !v)}
                style={{ color: voirArchives ? 'var(--brand)' : undefined }}>
                {voirArchives ? '📦 Avec archivés' : '📦 Archivés'}
              </button>
              <button className="btn btn-primary" onClick={() => ouvrirModalEtudiant()}>
                + Ajouter un étudiant
              </button>
            </>
          )}
        </div>
      </div>

      {/* Onglets */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '2px solid var(--border)' }}>
        {[['mensuel', 'Mensuel'], ['suivi', 'Suivi'], ['etudiants', 'Locataires'], ['banque', 'Banque LLD']].map(([key, label]) => (
          <button key={key} onClick={() => setOnglet(key)}
            style={{
              padding: '8px 18px', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600,
              background: 'none', borderBottom: onglet === key ? '2px solid var(--brand)' : '2px solid transparent',
              color: onglet === key ? 'var(--brand)' : 'var(--text-muted)',
              marginBottom: -2,
            }}>
            {label}
          </button>
        ))}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {loading && <div className="loading-state"><span className="spinner" /> Chargement…</div>}

      {/* ── Vue mensuelle ── */}
      {!loading && onglet === 'mensuel' && (
        <>
          {loyers.length === 0 ? (
            <div className="empty-state">
              Aucune donnée pour {mois}.<br />
              <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={initialiserMois}>
                Initialiser le mois
              </button>
            </div>
          ) : (
            <>
              {/* Tableau loyers */}
              <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', margin: '0 0 10px' }}>
                Loyers
              </h2>
              <div className="table-container" style={{ marginBottom: 28 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Étudiant</th>
                      <th>Bien</th>
                      <th style={{ textAlign: 'right' }}>Attendu</th>
                      <th>Statut</th>
                      <th>Date réception</th>
                      <th style={{ textAlign: 'right' }}>Reçu</th>
                      <th>Quittance</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {loyers.map(l => {
                      const e = l.etudiant
                      const total = e ? montantTotalEtudiant(e) : 0
                      const st = STATUT_LOYER[l.statut] || {}
                      const ecart = l.montant_recu && l.montant_recu !== total
                      return (
                        <tr key={l.id}>
                          <td style={{ fontWeight: 600 }}>
                            {e ? `${e.nom}${e.prenom ? ' ' + e.prenom : ''}` : '—'}
                          </td>
                          <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                            {e?.bien?.code || '—'}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>
                            {formatMontant(total)}
                          </td>
                          <td>
                            <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 12, fontWeight: 600, color: st.color, background: st.bg }}>
                              {st.label}
                            </span>
                          </td>
                          <td style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                            {fmtDate(l.date_reception)}
                          </td>
                          <td style={{ textAlign: 'right', color: ecart ? '#DC2626' : undefined, fontWeight: ecart ? 700 : 400 }}>
                            {l.montant_recu ? formatMontant(l.montant_recu) : '—'}
                            {ecart && <span style={{ fontSize: 11, marginLeft: 4 }}>⚠</span>}
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {l.quittance_envoyee_at
                              ? <span style={{ color: '#059669' }}>✓ {fmtDate(l.quittance_envoyee_at)}</span>
                              : '—'}
                          </td>
                          <td style={{ display: 'flex', gap: 4 }}>
                            {l.statut !== 'recu' && l.statut !== 'exonere' && (
                              <button className="btn btn-secondary" style={{ fontSize: 12, padding: '3px 8px', color: '#059669' }}
                                onClick={() => {
                                  setLoyerModal(l)
                                  setMontantRecu(e ? (montantTotalEtudiant(e) / 100).toFixed(2) : '')
                                  setDateReception(new Date().toISOString().slice(0, 10))
                                }}>
                                ✓ Reçu
                              </button>
                            )}
                            {l.statut === 'recu' && !l.quittance_envoyee_at && (
                              <button className="btn btn-secondary" style={{ fontSize: 12, padding: '3px 8px', color: '#059669' }}
                                onClick={() => envoyerQuittance(l.id)}
                                title="Générer et envoyer la quittance PDF par email">
                                📄 Quittance
                              </button>
                            )}
                            {l.statut === 'recu' && l.quittance_envoyee_at && (
                              <button className="btn btn-secondary" style={{ fontSize: 12, padding: '3px 8px', color: '#6B7280' }}
                                onClick={() => envoyerQuittance(l.id)}
                                title="Renvoyer la quittance">
                                ↺ Quittance
                              </button>
                            )}
                            {l.statut === 'recu' && (
                              <button className="btn btn-secondary" style={{ fontSize: 12, padding: '3px 8px', color: '#6B7280' }}
                                onClick={() => changerStatutLoyer(l.id, 'attendu')}>
                                ← Annuler
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Tableau virements proprio */}
              <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', margin: '0 0 10px' }}>
                Virements propriétaires
              </h2>
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Étudiant</th>
                      <th>Propriétaire</th>
                      <th style={{ textAlign: 'right' }}>Montant</th>
                      <th>Statut</th>
                      <th>Date virement</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {virements.map(v => {
                      const e = v.etudiant
                      const st = STATUT_VIREMENT[v.statut] || {}
                      const proprio = e?.proprietaire
                        ? `${e.proprietaire.nom}${e.proprietaire.prenom ? ' ' + e.proprietaire.prenom : ''}`
                        : '—'
                      return (
                        <tr key={v.id}>
                          <td style={{ fontWeight: 600 }}>
                            {e ? `${e.nom}${e.prenom ? ' ' + e.prenom : ''}` : '—'}
                          </td>
                          <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>{proprio}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatMontant(v.montant)}</td>
                          <td>
                            <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 12, fontWeight: 600, color: st.color, background: st.bg }}>
                              {st.label}
                            </span>
                          </td>
                          <td style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                            {fmtDate(v.date_virement)}
                          </td>
                          <td>
                            {v.statut === 'a_virer' && (
                              <button className="btn btn-secondary" style={{ fontSize: 12, padding: '3px 8px', color: '#059669' }}
                                onClick={() => confirmerVirement(v.id)}>
                                ✓ Viré
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Solde */}
              <div style={{ marginTop: 20, padding: '12px 18px', background: solde === 0 ? '#D1FAE5' : '#FEE2E2', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontWeight: 700, color: solde === 0 ? '#059669' : '#DC2626' }}>
                  Solde du mois : {formatMontant(solde)}
                </span>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  (loyers reçus {formatMontant(totalLoyers)} − virements effectués {formatMontant(totalVirements)})
                </span>
                {solde === 0 && <span style={{ color: '#059669', fontWeight: 700 }}>✓ Équilibré</span>}
              </div>
            </>
          )}
        </>
      )}

      {/* ── Vue étudiants ── */}
      {!loading && onglet === 'etudiants' && (
        <>
          {etudiants.length === 0 ? (
            <div className="empty-state">
              Aucun locataire enregistré.
              <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => ouvrirModalEtudiant()}>
                + Ajouter un locataire
              </button>
            </div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Locataire</th>
                    <th>Bien</th>
                    <th>Entrée</th>
                    <th>Sortie prévue</th>
                    <th style={{ textAlign: 'right' }}>Total / mois</th>
                    <th style={{ textAlign: 'right' }}>Verso proprio</th>
                    <th style={{ textAlign: 'right' }}>Honoraires DCB</th>
                    <th style={{ textAlign: 'right' }}>Caution</th>
                    <th>Statut</th>
                    <th style={{ whiteSpace: 'nowrap' }}>Mois courant</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {etudiants.map(e => {
                    const total  = montantTotalEtudiant(e)
                    const verso  = montantVirementProprio(e)
                    const st     = STATUT_ETUDIANT[e.statut] || {}
                    const lc     = loyersCourant.find(l => l.etudiant_id === e.id)
                    const stLc   = lc ? (STATUT_LOYER[lc.statut] || {}) : null
                    return (
                      <tr key={e.id} style={{ opacity: e.archived ? 0.55 : 1 }}>
                        <td style={{ fontWeight: 600 }}>
                          {e.nom}{e.prenom ? ' ' + e.prenom : ''}
                          <div style={{ display: 'flex', gap: 4, marginTop: 2, flexWrap: 'wrap' }}>
                            {e.archived && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: '#F3F4F6', color: '#6B7280' }}>Archivé</span>}
                            {e.type_bail === 'mobilite' && (
                              <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: '#EDE9FE', color: '#6D28D9' }}>Mobilité</span>
                            )}
                            {e.type_bail === 'habitation' && (
                              <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: '#ECFDF5', color: '#059669' }}>Habitation</span>
                            )}
                            {e.email && <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>{e.email}</span>}
                          </div>
                        </td>
                        <td style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                          {e.bien?.code || '—'}
                        </td>
                        <td style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{fmtDate(e.date_entree)}</td>
                        <td style={{ fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {fmtDate(e.date_sortie_prevue)}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatMontant(total)}</td>
                        <td style={{ textAlign: 'right', color: '#059669' }}>{formatMontant(verso)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--brand)' }}>{formatMontant(e.honoraires_dcb)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{formatMontant(e.caution)}</td>
                        <td>
                          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 12, fontWeight: 600, color: st.color, background: st.bg }}>
                            {st.label}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                          {!lc ? (
                            <span style={{ color: 'var(--text-muted)' }}>—</span>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <span style={{ fontWeight: 600, color: stLc.color }}>{stLc.label}</span>
                              {lc.nb_relances > 0 && (
                                <span style={{ color: lc.nb_relances >= 3 ? '#DC2626' : '#B45309' }}>
                                  {lc.nb_relances} relance{lc.nb_relances > 1 ? 's' : ''}
                                </span>
                              )}
                              {lc.quittance_envoyee_at ? (
                                <span style={{ color: '#059669' }}>
                                  Quittance ✓
                                  <button
                                    className="btn btn-secondary"
                                    style={{ fontSize: 10, padding: '1px 5px', marginLeft: 4 }}
                                    title="Télécharger la quittance"
                                    onClick={() => ouvrirQuittancePdf(e.id, lc.mois)}>
                                    ⬇
                                  </button>
                                </span>
                              ) : (
                                <span style={{ color: 'var(--text-muted)' }}>Pas de quittance</span>
                              )}
                            </div>
                          )}
                        </td>
                        <td style={{ verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', gap: 3, alignItems: 'center', flexWrap: 'nowrap' }}>
                            {!e.archived && (<>
                              <button className="btn btn-secondary" style={{ fontSize: 13, padding: '3px 7px' }}
                                onClick={() => ouvrirModalEtudiant(e)} title="Modifier">✏</button>
                              <button className="btn btn-secondary" style={{ fontSize: 13, padding: '3px 7px' }}
                                onClick={() => ouvrirDossier(e)} title="Dossier">📁</button>
                              <button className="btn btn-secondary" style={{ fontSize: 13, padding: '3px 7px' }}
                                onClick={() => { setSuiviEtudiantId(e.id); setOnglet('suivi') }} title="Suivi">📋</button>
                            </>)}
                            {e.archived ? (<>
                              <button className="btn btn-secondary" style={{ fontSize: 12, padding: '3px 8px', color: '#059669' }}
                                onClick={() => setConfirmSuppr({ etudiant: e, action: 'desarchiver' })} title="Réactiver">↩</button>
                              <button className="btn btn-secondary" style={{ fontSize: 13, padding: '3px 7px', color: '#DC2626' }}
                                onClick={() => setConfirmSuppr({ etudiant: e, action: 'supprimer' })} title="Supprimer définitivement">🗑</button>
                            </>) : (
                              <button className="btn btn-secondary" style={{ fontSize: 13, padding: '3px 7px', color: '#B45309' }}
                                onClick={() => setConfirmSuppr({ etudiant: e, action: 'archiver' })} title="Archiver">📦</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── Vue Suivi ── */}
      {onglet === 'suivi' && (
        <div>
          {/* Sélecteur étudiant */}
          <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
            <select className="form-select" style={{ maxWidth: 280 }}
              value={suiviEtudiantId}
              onChange={e => setSuiviEtudiantId(e.target.value)}>
              <option value="">— Sélectionner un locataire —</option>
              {etudiants.map(e => (
                <option key={e.id} value={e.id}>
                  {e.bien?.code ? `[${e.bien.code}] ` : ''}{e.nom}{e.prenom ? ' ' + e.prenom : ''}{e.statut !== 'actif' ? ` (${e.statut})` : ''}
                </option>
              ))}
            </select>
            {suiviEtudiantId && <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => chargerSuivi(suiviEtudiantId)}>↺</button>}
          </div>

          {suiviLoading && <div className="loading-state"><span className="spinner" /> Chargement…</div>}

          {suiviEtudiantId && !suiviLoading && (() => {
            const etudiant = etudiants.find(e => e.id === suiviEtudiantId)
            if (!etudiant) return null

            const totalLoysRecu = suiviLoyers.filter(l => l.statut === 'recu').reduce((s, l) => s + (l.montant_recu || 0), 0)
            const totalVire = suiviVirements.filter(v => v.statut === 'vire').reduce((s, v) => s + (v.montant || 0), 0)

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

                {/* Fiche résumé */}
                <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', display: 'flex', gap: 32, flexWrap: 'wrap' }}>
                  <div><div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Bien</div><div style={{ fontWeight: 600 }}>{etudiant.bien?.code || '—'}</div></div>
                  <div><div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Entrée</div><div style={{ fontWeight: 600 }}>{fmtDate(etudiant.date_entree)}</div></div>
                  <div><div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Sortie prévue</div><div style={{ fontWeight: 600 }}>{fmtDate(etudiant.date_sortie_prevue)}</div></div>
                  <div><div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Total / mois</div><div style={{ fontWeight: 600, color: 'var(--brand)' }}>{formatMontant(montantTotalEtudiant(etudiant))}</div></div>
                  <div><div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Documents</div>
                    <div style={{ fontWeight: 600 }}>
                      {['contrat_location','eds_entree','eds_sortie'].map(t => (
                        <span key={t} title={t} style={{ marginRight: 4, color: suiviDocs.some(d => d.type === t) ? '#059669' : '#B45309' }}>
                          {suiviDocs.some(d => d.type === t) ? '✓' : '⚠'}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div><div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Caution</div>
                    <div style={{ fontWeight: 600 }}>
                      {suiviCautionData
                        ? <span style={{ color: STATUT_CAUTION[suiviCautionData.statut]?.color }}>{STATUT_CAUTION[suiviCautionData.statut]?.label}</span>
                        : '—'}
                    </div>
                  </div>
                </div>

                {/* Historique loyers */}
                <div>
                  <h2 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 10px' }}>
                    Loyers — {suiviLoyers.length} mois · encaissé {formatMontant(totalLoysRecu)}
                  </h2>
                  {suiviLoyers.length === 0
                    ? <div className="empty-state" style={{ padding: '20px' }}>Aucun loyer enregistré</div>
                    : (
                      <div className="table-container">
                        <table className="table">
                          <thead><tr>
                            <th>Mois</th><th>Statut</th>
                            <th style={{ textAlign: 'right' }}>Montant reçu</th>
                            <th>Date réception</th>
                            <th>Relances</th>
                            <th>Quittance</th>
                            <th></th>
                          </tr></thead>
                          <tbody>
                            {suiviLoyers.map(l => {
                              const st = STATUT_LOYER[l.statut] || {}
                              return (
                                <tr key={l.id}>
                                  <td style={{ fontWeight: 600 }}>{l.mois}</td>
                                  <td><span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 12, fontWeight: 600, color: st.color, background: st.bg }}>{st.label}</span></td>
                                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{l.montant_recu ? formatMontant(l.montant_recu) : '—'}</td>
                                  <td style={{ fontSize: 13, color: 'var(--text-muted)' }}>{fmtDate(l.date_reception)}</td>
                                  <td style={{ fontSize: 13 }}>
                                    {l.nb_relances > 0
                                      ? <span style={{ color: l.nb_relances >= 3 ? '#DC2626' : '#B45309', fontWeight: 600 }}>
                                          {l.nb_relances} relance{l.nb_relances > 1 ? 's' : ''}
                                          {l.date_derniere_relance && <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 4 }}>({fmtDate(l.date_derniere_relance)})</span>}
                                        </span>
                                      : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                                  </td>
                                  <td style={{ fontSize: 12 }}>
                                    {l.quittance_envoyee_at ? (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <span style={{ color: '#059669' }}>✓ {fmtDate(l.quittance_envoyee_at)}</span>
                                        <button className="btn btn-secondary"
                                          style={{ fontSize: 11, padding: '1px 6px' }}
                                          title="Ouvrir / télécharger la quittance PDF"
                                          onClick={() => ouvrirQuittancePdf(suiviEtudiantId, l.mois)}>
                                          ⬇
                                        </button>
                                      </div>
                                    ) : (
                                      <span style={{ color: 'var(--text-muted)' }}>—</span>
                                    )}
                                  </td>
                                  <td style={{ whiteSpace: 'nowrap' }}>
                                    {l.statut === 'recu' && (
                                      <button className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 7px', color: '#6B7280' }}
                                        onClick={() => envoyerQuittance(l.id)}
                                        title={l.quittance_envoyee_at ? 'Renvoyer la quittance' : 'Envoyer la quittance'}>
                                        {l.quittance_envoyee_at ? '↺ quittance' : '📄 quittance'}
                                      </button>
                                    )}
                                    {(l.statut === 'attendu' || l.statut === 'en_retard') && (
                                      relancesAutorisees()
                                        ? <button className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 7px', color: '#B45309', marginLeft: 4 }}
                                            onClick={() => envoyerRelanceManuelle(l.id)}
                                            title="Envoyer une relance SMS + email maintenant">
                                            📨 relancer
                                          </button>
                                        : <button
                                            style={{ fontSize: 11, padding: '2px 8px', marginLeft: 4, background: '#FEE2E2', color: '#DC2626', border: '1px solid #FECACA', borderRadius: 5, cursor: 'pointer', fontWeight: 600 }}
                                            onClick={() => { setSuccess(null); setError('Loyer non perçu — relances automatiques actives en mai 2026. Contactez le locataire directement.') }}
                                            title="Loyer non perçu">
                                            📨 Loyer non reçu
                                          </button>
                                    )}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                </div>

                {/* Historique virements */}
                <div>
                  <h2 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 10px' }}>
                    Virements proprio — viré {formatMontant(totalVire)}
                  </h2>
                  {suiviVirements.length === 0
                    ? <div className="empty-state" style={{ padding: '20px' }}>Aucun virement enregistré</div>
                    : (
                      <div className="table-container">
                        <table className="table">
                          <thead><tr>
                            <th>Mois</th>
                            <th style={{ textAlign: 'right' }}>Montant</th>
                            <th>Statut</th>
                            <th>Date virement</th>
                          </tr></thead>
                          <tbody>
                            {suiviVirements.map(v => {
                              const st = STATUT_VIREMENT[v.statut] || {}
                              return (
                                <tr key={v.id}>
                                  <td style={{ fontWeight: 600 }}>{v.mois}</td>
                                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{v.montant ? formatMontant(v.montant) : '—'}</td>
                                  <td><span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 12, fontWeight: 600, color: st.color, background: st.bg }}>{st.label}</span></td>
                                  <td style={{ fontSize: 13, color: 'var(--text-muted)' }}>{fmtDate(v.date_virement)}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                </div>

                {/* Journal d'activité */}
                <div style={{ marginTop: 8 }}>
                  <h2 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 10px' }}>
                    Journal d'activité — {suiviLogs.length} entrée{suiviLogs.length !== 1 ? 's' : ''}
                  </h2>
                  {suiviLogs.length === 0 ? (
                    <div className="empty-state" style={{ padding: '20px' }}>Aucune activité enregistrée</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {suiviLogs.map(log => {
                        const icons = {
                          sms_relance:       { icon: '📱', color: '#B45309', label: 'SMS relance' },
                          email_relance:     { icon: '📧', color: '#B45309', label: 'Email relance' },
                          relance_manuelle:  { icon: '📨', color: '#7C3AED', label: 'Relance manuelle' },
                          relance_escalade:  { icon: '🚨', color: '#DC2626', label: 'Escalade' },
                          quittance_envoyee: { icon: '📄', color: '#059669', label: 'Quittance envoyée' },
                          loyer_recu:        { icon: '✅', color: '#059669', label: 'Loyer reçu' },
                          virement_effectue: { icon: '💸', color: '#059669', label: 'Virement effectué' },
                        }
                        const meta = icons[log.type] || { icon: '•', color: '#6B7280', label: log.type }
                        const date = new Date(log.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                        return (
                          <div key={log.id} style={{
                            display: 'flex', alignItems: 'flex-start', gap: 10,
                            background: log.statut === 'erreur' ? '#FEF2F2' : '#F7F3EC',
                            border: `1px solid ${log.statut === 'erreur' ? '#FCA5A5' : 'var(--border)'}`,
                            borderRadius: 6, padding: '8px 12px', fontSize: 13,
                          }}>
                            <span style={{ fontSize: 16, lineHeight: 1.3 }}>{meta.icon}</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                                <span style={{ fontWeight: 600, color: meta.color }}>{meta.label}</span>
                                <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{date}</span>
                              </div>
                              <div style={{ color: '#555', fontSize: 12, marginTop: 2 }}>
                                {log.mois && <span style={{ marginRight: 8 }}>Mois : <strong>{log.mois}</strong></span>}
                                {log.canal && <span style={{ marginRight: 8 }}>Canal : {log.canal}</span>}
                                {log.destinataire && <span style={{ marginRight: 8 }}>→ {log.destinataire}</span>}
                                {log.details?.montant && <span>Montant : {formatMontant(log.details.montant)}</span>}
                                {log.details?.nb_relance && <span style={{ marginLeft: 8 }}>Relance #{log.details.nb_relance}</span>}
                                {log.details?.message && <span style={{ marginLeft: 8, fontStyle: 'italic' }}>{log.details.message}</span>}
                                {log.statut === 'erreur' && <span style={{ color: '#DC2626', marginLeft: 8, fontWeight: 600 }}>✗ Erreur</span>}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

              </div>
            )
          })()}
        </div>
      )}

      {/* Modal loyer reçu */}
      {loyerModal && (
        <div className="modal-overlay" onClick={() => setLoyerModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h2>Loyer reçu</h2>
              <button className="modal-close" onClick={() => setLoyerModal(null)}>✗</button>
            </div>
            <form onSubmit={soumettreReception}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label className="form-label">Date de réception *</label>
                  <input className="form-input" type="date" required
                    value={dateReception}
                    onChange={e => setDateReception(e.target.value)} />
                </div>
                <div>
                  <label className="form-label">Montant reçu (€) *</label>
                  <input className="form-input" type="number" min="0.01" step="0.01" required
                    value={montantRecu}
                    onChange={e => setMontantRecu(e.target.value)} />
                </div>
                {error && <div className="alert alert-error">{error}</div>}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setLoyerModal(null)}>Annuler</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <><span className="spinner" /> Enregistrement…</> : 'Confirmer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal étudiant (ajout / édition) */}
      {showModalEtudiant && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 560 }}>
            <div className="modal-header">
              <h2>{editingEtudiant ? 'Modifier le locataire' : 'Ajouter un locataire'}</h2>
              <button className="modal-close" onClick={() => setShowModalEtudiant(false)}>✗</button>
            </div>
            <form onSubmit={soumettreEtudiant}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label className="form-label">Nom *</label>
                    <input className="form-input" type="text" required
                      value={formEtudiant.nom}
                      onChange={e => setFormEtudiant(f => ({ ...f, nom: e.target.value }))} />
                  </div>
                  <div>
                    <label className="form-label">Prénom</label>
                    <input className="form-input" type="text"
                      value={formEtudiant.prenom}
                      onChange={e => setFormEtudiant(f => ({ ...f, prenom: e.target.value }))} />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label className="form-label">Email</label>
                    <input className="form-input" type="email"
                      value={formEtudiant.email}
                      onChange={e => setFormEtudiant(f => ({ ...f, email: e.target.value }))} />
                  </div>
                  <div>
                    <label className="form-label">Téléphone</label>
                    <input className="form-input" type="tel"
                      value={formEtudiant.telephone}
                      onChange={e => setFormEtudiant(f => ({ ...f, telephone: e.target.value }))} />
                  </div>
                </div>

                <div>
                  <label className="form-label">Bien</label>
                  <select className="form-select"
                    value={formEtudiant.bien_id}
                    onChange={e => {
                      const bien = biens.find(b => b.id === e.target.value)
                      setFormEtudiant(f => ({
                        ...f,
                        bien_id:          e.target.value,
                        proprietaire_id:  bien?.proprietaire_id || f.proprietaire_id,
                        adresse_complete: bien?.adresse || f.adresse_complete,
                      }))
                    }}>
                    <option value="">— Sélectionner un bien —</option>
                    {biens.map(b => (
                      <option key={b.id} value={b.id}>{b.code} — {b.hospitable_name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="form-label">Propriétaire</label>
                  <select className="form-select"
                    value={formEtudiant.proprietaire_id}
                    onChange={e => setFormEtudiant(f => ({ ...f, proprietaire_id: e.target.value }))}>
                    <option value="">— Sélectionner un propriétaire —</option>
                    {proprios.map(p => (
                      <option key={p.id} value={p.id}>{p.nom}{p.prenom ? ' ' + p.prenom : ''}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="form-label">Adresse complète du logement (pour quittances)</label>
                  <input className="form-input" type="text" placeholder="ex : 3 rue du Port, 64200 Biarritz"
                    value={formEtudiant.adresse_complete}
                    onChange={e => setFormEtudiant(f => ({ ...f, adresse_complete: e.target.value }))} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <div>
                    <label className="form-label">Date d'entrée *</label>
                    <input className="form-input" type="date" required
                      value={formEtudiant.date_entree}
                      onChange={e => setFormEtudiant(f => ({ ...f, date_entree: e.target.value }))} />
                  </div>
                  <div>
                    <label className="form-label">Sortie prévue</label>
                    <input className="form-input" type="date"
                      value={formEtudiant.date_sortie_prevue}
                      onChange={e => setFormEtudiant(f => ({ ...f, date_sortie_prevue: e.target.value }))} />
                  </div>
                  <div>
                    <label className="form-label">Jour paiement</label>
                    <input className="form-input" type="number" min="1" max="28"
                      value={formEtudiant.jour_paiement_attendu}
                      onChange={e => setFormEtudiant(f => ({ ...f, jour_paiement_attendu: e.target.value }))} />
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10 }}>
                    Montants mensuels (€) — fixes à la création
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                    <div>
                      <label className="form-label">Loyer nu * (CC)</label>
                      <input className="form-input" type="number" min="0" step="0.01" required
                        value={formEtudiant.loyer_nu}
                        onChange={e => setFormEtudiant(f => ({ ...f, loyer_nu: e.target.value }))} />
                    </div>
                    <div>
                      <label className="form-label">Supplément</label>
                      <input className="form-input" type="number" min="0" step="0.01"
                        value={formEtudiant.supplement_loyer}
                        onChange={e => setFormEtudiant(f => ({ ...f, supplement_loyer: e.target.value }))} />
                    </div>
                    <div>
                      <label className="form-label">Charges eau</label>
                      <input className="form-input" type="number" min="0" step="0.01"
                        value={formEtudiant.charges_eau}
                        onChange={e => setFormEtudiant(f => ({ ...f, charges_eau: e.target.value }))} />
                    </div>
                    <div>
                      <label className="form-label">Charges copro</label>
                      <input className="form-input" type="number" min="0" step="0.01"
                        value={formEtudiant.charges_copro}
                        onChange={e => setFormEtudiant(f => ({ ...f, charges_copro: e.target.value }))} />
                    </div>
                    <div>
                      <label className="form-label">Internet</label>
                      <input className="form-input" type="number" min="0" step="0.01"
                        value={formEtudiant.charges_internet}
                        onChange={e => setFormEtudiant(f => ({ ...f, charges_internet: e.target.value }))} />
                    </div>
                    <div>
                      <label className="form-label">Honoraires DCB *</label>
                      <input className="form-input" type="number" min="0" step="0.01" required
                        value={formEtudiant.honoraires_dcb}
                        onChange={e => setFormEtudiant(f => ({ ...f, honoraires_dcb: e.target.value }))} />
                    </div>
                  </div>

                  {/* Récap calculé */}
                  {formEtudiant.loyer_nu && formEtudiant.honoraires_dcb && (() => {
                    const total = (parseFloat(formEtudiant.loyer_nu) || 0) +
                                  (parseFloat(formEtudiant.supplement_loyer) || 0) +
                                  (parseFloat(formEtudiant.charges_eau) || 0) +
                                  (parseFloat(formEtudiant.charges_copro) || 0) +
                                  (parseFloat(formEtudiant.charges_internet) || 0)
                    const verso = total - (parseFloat(formEtudiant.honoraires_dcb) || 0)
                    return (
                      <div style={{ marginTop: 10, padding: '8px 12px', background: 'var(--bg)', borderRadius: 8, fontSize: 13, display: 'flex', gap: 20 }}>
                        <span>Total locataire : <strong>{total.toFixed(2)} €</strong></span>
                        <span style={{ color: '#059669' }}>Verso proprio : <strong>{verso.toFixed(2)} €</strong></span>
                        <span style={{ color: 'var(--brand)' }}>DCB : <strong>{parseFloat(formEtudiant.honoraires_dcb).toFixed(2)} €</strong></span>
                      </div>
                    )
                  })()}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <div>
                    <label className="form-label">Caution (€)</label>
                    <input className="form-input" type="number" min="0" step="0.01"
                      value={formEtudiant.caution}
                      onChange={e => setFormEtudiant(f => ({ ...f, caution: e.target.value }))} />
                  </div>
                  <div>
                    <label className="form-label">Type de bail</label>
                    <select className="form-select"
                      value={formEtudiant.type_bail}
                      onChange={e => setFormEtudiant(f => ({ ...f, type_bail: e.target.value }))}>
                      <option value="etudiant">Bail étudiant</option>
                      <option value="mobilite">Bail mobilité</option>
                      <option value="habitation">Bail habitation</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Statut</label>
                    <select className="form-select"
                      value={formEtudiant.statut}
                      onChange={e => setFormEtudiant(f => ({ ...f, statut: e.target.value }))}>
                      <option value="actif">Actif</option>
                      <option value="en_attente">En attente</option>
                      <option value="parti">Parti</option>
                    </select>
                  </div>
                </div>

                {error && <div className="alert alert-error">{error}</div>}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModalEtudiant(false)}>Annuler</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <><span className="spinner" /> Enregistrement…</> : (editingEtudiant ? 'Enregistrer' : 'Créer')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Modal dossier étudiant */}
      {dossierEtudiant && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 580 }}>
            <div className="modal-header">
              <h2>Dossier — {dossierEtudiant.nom}{dossierEtudiant.prenom ? ' ' + dossierEtudiant.prenom : ''}</h2>
              <button className="modal-close" onClick={() => { setDossierEtudiant(null); setError(null) }}>✗</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

              {/* Documents */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                  Documents
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {TYPES_DOC.map(({ type, label }) => {
                    const existing = docs.filter(d => d.type === type)
                    return (
                      <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg)', borderRadius: 8 }}>
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>
                          {existing.length > 0
                            ? <span style={{ color: '#059669' }}>✓ </span>
                            : <span style={{ color: '#B45309' }}>⚠ </span>}
                          {label}
                        </span>
                        {existing.length > 0 && existing.map(doc => (
                          <span key={doc.id} style={{ display: 'flex', gap: 4 }}>
                            <button className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 7px' }}
                              onClick={() => ouvrirDoc(doc.file_url)}
                              title={doc.notes}>
                              ↗ Ouvrir
                            </button>
                            <button className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 7px', color: '#DC2626' }}
                              onClick={() => handleSupprimer(doc)}>
                              ✕
                            </button>
                          </span>
                        ))}
                        <label style={{ cursor: 'pointer' }}>
                          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{ display: 'none' }}
                            onChange={e => { if (e.target.files[0]) handleUpload(type, e.target.files[0]); e.target.value = '' }} />
                          <span className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 7px', color: uploadingType === type ? '#999' : undefined }}>
                            {uploadingType === type ? '…' : '+ Upload'}
                          </span>
                        </label>
                      </div>
                    )
                  })}

                  {/* Autres docs */}
                  {docs.filter(d => d.type === 'autre').map(doc => (
                    <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg)', borderRadius: 8 }}>
                      <span style={{ flex: 1, fontSize: 13 }}>📄 {doc.notes || 'Autre document'}</span>
                      <button className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 7px' }} onClick={() => ouvrirDoc(doc.file_url)}>↗ Ouvrir</button>
                      <button className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 7px', color: '#DC2626' }} onClick={() => handleSupprimer(doc)}>✕</button>
                    </div>
                  ))}
                  <label style={{ cursor: 'pointer', alignSelf: 'flex-start' }}>
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{ display: 'none' }}
                      onChange={e => { if (e.target.files[0]) handleUpload('autre', e.target.files[0]); e.target.value = '' }} />
                    <span className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 7px' }}>
                      {uploadingType === 'autre' ? '…' : '+ Autre document'}
                    </span>
                  </label>
                </div>
              </div>

              {/* Caution */}
              {caution && (
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                    Caution — {(dossierEtudiant.caution / 100).toFixed(2)} €
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ padding: '3px 10px', borderRadius: 10, fontSize: 12, fontWeight: 600,
                      color: STATUT_CAUTION[caution.statut]?.color,
                      background: STATUT_CAUTION[caution.statut]?.bg }}>
                      {STATUT_CAUTION[caution.statut]?.label}
                    </span>
                    {caution.statut === 'en_cours' && (
                      <button className="btn btn-secondary" style={{ fontSize: 12, padding: '3px 8px', color: '#B45309' }}
                        onClick={() => handleCaution('a_rendre')}>
                        Marquer à rendre
                      </button>
                    )}
                    {caution.statut === 'a_rendre' && (
                      <>
                        <button className="btn btn-secondary" style={{ fontSize: 12, padding: '3px 8px', color: '#059669' }}
                          onClick={() => handleCaution('rendue', { date_rendu: new Date().toISOString().slice(0, 10), montant_rendu: dossierEtudiant.caution })}>
                          ✓ Rendue intégralement
                        </button>
                        <button className="btn btn-secondary" style={{ fontSize: 12, padding: '3px 8px', color: '#DC2626' }}
                          onClick={() => handleCaution('retenue_partielle')}>
                          Retenue partielle
                        </button>
                      </>
                    )}
                    {caution.date_rendu && (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>le {fmtDate(caution.date_rendu)}</span>
                    )}
                  </div>
                  {!docs.some(d => d.type === 'eds_sortie') && caution.statut === 'en_cours' && (
                    <div style={{ marginTop: 8, fontSize: 12, color: '#B45309' }}>
                      ⚠ EDS de sortie requis pour rendre la caution
                    </div>
                  )}
                </div>
              )}

              {error && <div className="alert alert-error">{error}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => { setDossierEtudiant(null); setError(null) }}>Fermer</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Vue Banque LLD ── */}
      {onglet === 'banque' && (() => {
        const totalCredit = banqueMouvements.reduce((s, m) => s + (m.credit || 0), 0)
        const totalDebit  = banqueMouvements.reduce((s, m) => s + (m.debit  || 0), 0)
        const solde       = totalCredit - totalDebit
        return (
          <div>
            {/* Sélecteur compte + mois */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
              {[['loyers', 'Compte Loyers'], ['cautions', 'Compte Cautions']].map(([val, label]) => (
                <button key={val} onClick={() => setBanqueCompte(val)}
                  style={{
                    padding: '6px 16px', borderRadius: 8, border: '2px solid',
                    borderColor: banqueCompte === val ? 'var(--brand)' : 'var(--border)',
                    background: banqueCompte === val ? 'var(--brand)' : 'var(--bg)',
                    color: banqueCompte === val ? '#fff' : 'var(--text)',
                    fontWeight: 700, fontSize: 13, cursor: 'pointer',
                  }}>
                  {label}
                </button>
              ))}
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 8 }}>
                <select className="form-select" style={{ maxWidth: 140 }}
                  value={banqueMois}
                  onChange={e => setBanqueMois(e.target.value)}>
                  {banqueMoisDispos.length === 0
                    ? <option value={moisCourant}>{moisCourant}</option>
                    : banqueMoisDispos.map(m => <option key={m} value={m}>{m}</option>)
                  }
                </select>
                <button className="btn btn-secondary" onClick={() => chargerBanque(banqueCompte, banqueMois)} disabled={banqueLoading}>↺</button>
              </div>
              <label style={{ marginLeft: 'auto', cursor: 'pointer' }}>
                <input type="file" accept=".csv,.txt" style={{ display: 'none' }}
                  onChange={e => { if (e.target.files[0]) handleFichierBanque(e.target.files[0]); e.target.value = '' }} />
                <span className="btn btn-primary" style={{ fontSize: 13 }}>⬆ Importer CSV</span>
              </label>
            </div>

            {/* Panel d'import après sélection fichier */}
            {banqueParsed && (
              <div style={{ marginBottom: 18, padding: '14px 18px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10 }}>
                <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 14 }}>
                  Fichier chargé — {banqueParsed.total} ligne(s) détectée(s)
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 13 }}>
                    Mois à importer :
                    <select className="form-select" style={{ marginLeft: 8, width: 'auto', display: 'inline-block' }}
                      value={banqueMoisImport}
                      onChange={e => setBanqueMoisImport(e.target.value)}>
                      {banqueParsed.moisDispos.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    Compte cible : <strong>{banqueCompte}</strong>
                  </div>
                  <button className="btn btn-primary" onClick={handleImporterBanque} disabled={banqueImporting || !banqueMoisImport}>
                    {banqueImporting ? <><span className="spinner" /> Import…</> : '✓ Confirmer l\'import'}
                  </button>
                  <button className="btn btn-secondary" onClick={() => setBanqueParsed(null)}>Annuler</button>
                </div>
              </div>
            )}

            {banqueLoading && <div className="loading-state"><span className="spinner" /> Chargement…</div>}

            {!banqueLoading && banqueMouvements.length === 0 && (
              <div className="empty-state">
                Aucun mouvement pour {banqueCompte} — {banqueMois}.<br />
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Importez un relevé CSV Caisse d'Épargne.</span>
              </div>
            )}

            {!banqueLoading && banqueMouvements.length > 0 && (
              <>
                {/* Solde */}
                <div style={{ display: 'flex', gap: 20, marginBottom: 14, padding: '10px 16px', background: 'var(--bg)', borderRadius: 8, fontSize: 13, flexWrap: 'wrap' }}>
                  <span style={{ color: '#059669', fontWeight: 700 }}>↑ Crédits : {formatMontant(totalCredit)}</span>
                  <span style={{ color: '#DC2626', fontWeight: 700 }}>↓ Débits : {formatMontant(totalDebit)}</span>
                  <span style={{ fontWeight: 700, color: solde >= 0 ? '#059669' : '#DC2626' }}>
                    Solde : {formatMontant(solde)}
                  </span>
                  <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>{banqueMouvements.length} opération(s)</span>
                </div>

                <div className="table-container">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Libellé</th>
                        <th>Détail</th>
                        <th style={{ textAlign: 'right', color: '#059669' }}>Crédit</th>
                        <th style={{ textAlign: 'right', color: '#DC2626' }}>Débit</th>
                        <th>Statut</th>
                        <th>Locataire</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {banqueMouvements.map(m => (
                        <tr key={m.id} style={{ opacity: m.statut === 'ignore' ? 0.45 : 1 }}>
                          <td style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{fmtDate(m.date_operation)}</td>
                          <td style={{ fontSize: 13, maxWidth: 220, wordBreak: 'break-word' }}>{m.libelle || '—'}</td>
                          <td style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 160, wordBreak: 'break-word' }}>{m.detail || '—'}</td>
                          <td style={{ textAlign: 'right', fontWeight: m.credit ? 700 : 400, color: m.credit ? '#059669' : 'var(--text-muted)' }}>
                            {m.credit ? formatMontant(m.credit) : '—'}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: m.debit ? 700 : 400, color: m.debit ? '#DC2626' : 'var(--text-muted)' }}>
                            {m.debit ? formatMontant(m.debit) : '—'}
                          </td>
                          <td>
                            <span style={{
                              display: 'inline-block', padding: '2px 7px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                              background: m.statut === 'rapproche' ? '#D1FAE5' : m.statut === 'ignore' ? '#F3F4F6' : '#FFF7ED',
                              color:      m.statut === 'rapproche' ? '#059669' : m.statut === 'ignore' ? '#6B7280' : '#B45309',
                            }}>
                              {m.statut === 'rapproche' ? 'Rapproché ✓' : m.statut === 'ignore' ? 'Ignoré' : 'En attente'}
                            </span>
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {m.etudiant ? `${m.etudiant.nom}${m.etudiant.prenom ? ' ' + m.etudiant.prenom : ''}` : '—'}
                          </td>
                          <td>
                            <button className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 6px', color: '#DC2626' }}
                              onClick={() => handleSupprimerMouvement(m.id)} title="Supprimer">✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )
      })()}

      {/* Modal confirmation archivage / suppression */}
      {confirmSuppr && (
        <div className="modal-overlay" onClick={() => setConfirmSuppr(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h2>
                {confirmSuppr.action === 'archiver' && 'Archiver le locataire'}
                {confirmSuppr.action === 'desarchiver' && 'Réactiver le locataire'}
                {confirmSuppr.action === 'supprimer' && 'Supprimer définitivement'}
              </h2>
              <button className="modal-close" onClick={() => setConfirmSuppr(null)}>✗</button>
            </div>
            <div className="modal-body">
              {confirmSuppr.action === 'archiver' && (
                <p style={{ fontSize: 14 }}>
                  Archiver <strong>{confirmSuppr.etudiant.nom}{confirmSuppr.etudiant.prenom ? ' ' + confirmSuppr.etudiant.prenom : ''}</strong> ?<br />
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Les envois automatiques (relances, quittances) seront désactivés. La fiche reste consultable.</span>
                </p>
              )}
              {confirmSuppr.action === 'desarchiver' && (
                <p style={{ fontSize: 14 }}>
                  Réactiver <strong>{confirmSuppr.etudiant.nom}{confirmSuppr.etudiant.prenom ? ' ' + confirmSuppr.etudiant.prenom : ''}</strong> ?<br />
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Les envois automatiques seront réactivés.</span>
                </p>
              )}
              {confirmSuppr.action === 'supprimer' && (
                <p style={{ fontSize: 14 }}>
                  Supprimer définitivement <strong>{confirmSuppr.etudiant.nom}{confirmSuppr.etudiant.prenom ? ' ' + confirmSuppr.etudiant.prenom : ''}</strong> ?<br />
                  <span style={{ color: '#DC2626', fontSize: 13 }}>Cette action supprime tous les loyers, virements, caution, documents et logs associés. Irréversible.</span>
                </p>
              )}
              {error && <div className="alert alert-error" style={{ marginTop: 10 }}>{error}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setConfirmSuppr(null)} disabled={actioning}>Annuler</button>
              <button
                className="btn btn-primary"
                style={{ background: confirmSuppr.action === 'supprimer' ? '#DC2626' : undefined, borderColor: confirmSuppr.action === 'supprimer' ? '#DC2626' : undefined }}
                onClick={handleConfirmerAction}
                disabled={actioning}>
                {actioning ? <><span className="spinner" /> …</> : (
                  confirmSuppr.action === 'archiver' ? '📦 Archiver' :
                  confirmSuppr.action === 'desarchiver' ? '↩ Réactiver' :
                  '🗑 Supprimer'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
