import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { AGENCE } from '../lib/agence'

const MOIS_COURANT = new Date().toISOString().slice(0, 7)

const CATEGORIES = ['telecom', 'abonnement', 'logiciel', 'loyer', 'materiel', 'autre']
const TYPES_PAIEMENT = ['virement', 'cb', 'prelevement', 'cheque', 'especes']
const STATUTS = { a_valider: 'À valider', valide: 'Validé', rejete: 'Rejeté' }
const STATUT_COLORS = {
  a_valider: { bg: '#FEF3C7', color: '#92400E' },
  valide:    { bg: '#D1FAE5', color: '#065F46' },
  rejete:    { bg: '#FEE2E2', color: '#991B1B' },
}

const MODAL_VIDE = {
  mois: MOIS_COURANT,
  fournisseur: '',
  montant_ttc: '',
  montant_ht: '',
  type_paiement: 'virement',
  categorie: '',
  statut: 'a_valider',
  notes: '',
}

export default function PageAchats() {
  const [factures, setFactures]       = useState([])
  const [loading, setLoading]         = useState(true)
  const [moisFiltre, setMoisFiltre]   = useState(MOIS_COURANT)
  const [modal, setModal]             = useState(null) // null | 'new' | facture obj
  const [form, setForm]               = useState(MODAL_VIDE)
  const [saving, setSaving]           = useState(false)
  const [fournisseurs, setFournisseurs] = useState([]) // suggestions autocomplete
  const [detections, setDetections]   = useState([])  // fournisseurs récurrents × mouvements
  const [analyses, setAnalyses]       = useState({})  // id → { loading, ok, message }
  const [scanning, setScanning]       = useState(false)
  const [scanResult, setScanResult]   = useState(null) // résultat du scan + mouvement suggéré
  const [dragOver, setDragOver]       = useState(false)

  const charger = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('facture_achat')
      .select('*')
      .eq('agence', AGENCE)
      .eq('mois', moisFiltre)
      .order('created_at', { ascending: false })
    setFactures(data || [])
    setLoading(false)
  }, [moisFiltre])

  const chargerFournisseurs = useCallback(async () => {
    const { data } = await supabase
      .from('fournisseur_recurrent')
      .select('nom, categorie, pattern_libelle, montant_habituel')
      .eq('agence', AGENCE)
      .eq('actif', true)
      .order('nom')
    setFournisseurs(data || [])
  }, [])

  const scannerFichier = async (file) => {
    setScanning(true)
    setScanResult(null)
    try {
      // Convertir en base64
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result.split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY

      // Appel edge function parse-invoice
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ file_base64: base64, media_type: file.type }),
      })
      const parsed = await res.json()
      if (!parsed.ok) { setScanResult({ error: parsed.error || parsed.raw }); setScanning(false); return }

      // Chercher le mouvement bancaire correspondant
      const moisFacture = parsed.date_facture
        ? parsed.date_facture.slice(0, 7)
        : moisFiltre

      let mouvementSuggere = null
      if (parsed.fournisseur || parsed.montant_ttc) {
        const { data: mouvements } = await supabase
          .from('mouvement_bancaire')
          .select('id, libelle, debit, date_operation')
          .eq('agence', AGENCE)
          .eq('mois_releve', moisFacture)
          .gt('debit', 0)

        if (mouvements?.length && parsed.fournisseur) {
          const pattern = parsed.fournisseur.toUpperCase().split(' ')[0] // premier mot
          const montant = parsed.montant_ttc ? parseFloat(parsed.montant_ttc) : null
          mouvementSuggere = mouvements.find(m => {
            const libelleOk = (m.libelle || '').toUpperCase().includes(pattern)
            const montantOk = !montant || Math.abs(Number(m.debit) - montant) < montant * 0.05
            return libelleOk && montantOk
          }) || mouvements.find(m => (m.libelle || '').toUpperCase().includes(pattern)) || null
        }
      }

      setScanResult({ ...parsed, mouvementSuggere, fichier: file })

      // Pré-remplir le modal
      const moisForm = parsed.date_facture ? parsed.date_facture.slice(0, 7) : moisFiltre
      setForm(prev => ({
        ...prev,
        mois:          moisForm,
        fournisseur:   parsed.fournisseur || prev.fournisseur,
        montant_ttc:   parsed.montant_ttc ?? prev.montant_ttc,
        montant_ht:    parsed.montant_ht ?? prev.montant_ht,
        type_paiement: parsed.type_paiement || prev.type_paiement,
        notes:         parsed.numero_facture ? `Facture ${parsed.numero_facture}` : prev.notes,
      }))
      setModal('new')
    } catch (e) {
      setScanResult({ error: e.message })
    }
    setScanning(false)
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer?.files?.[0] || e.target?.files?.[0]
    if (!file) return
    const ok = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)
    if (!ok) { alert('Format accepté : PDF, JPG, PNG'); return }
    scannerFichier(file)
  }

  const chargerDetections = useCallback(async () => {
    // Mouvements débiteurs du mois
    const { data: mouvements } = await supabase
      .from('mouvement_bancaire')
      .select('libelle, debit, date_operation')
      .eq('agence', AGENCE)
      .eq('mois_releve', moisFiltre)
      .gt('debit', 0)

    // Fournisseurs récurrents actifs
    const { data: fournisseursRec } = await supabase
      .from('fournisseur_recurrent')
      .select('id, nom, pattern_libelle, categorie, montant_habituel')
      .eq('agence', AGENCE)
      .eq('actif', true)
      .order('nom')

    // Factures déjà saisies ce mois
    const { data: facturesMois } = await supabase
      .from('facture_achat')
      .select('fournisseur, montant_ttc')
      .eq('agence', AGENCE)
      .eq('mois', moisFiltre)

    const facturesNoms = new Set((facturesMois || []).map(f => f.fournisseur.toLowerCase()))

    const resultats = (fournisseursRec || []).map(f => {
      const pattern = (f.pattern_libelle || f.nom).toUpperCase()
      const match = (mouvements || []).find(m =>
        (m.libelle || '').toUpperCase().includes(pattern)
      )
      const factureExiste = [...facturesNoms].some(n => n.includes(f.nom.toLowerCase()) || f.nom.toLowerCase().includes(n))
      return {
        ...f,
        mouvement:     match || null,       // mouvement détecté
        factureExiste,                       // facture saisie dans facture_achat
      }
    })

    setDetections(resultats)
  }, [moisFiltre])

  useEffect(() => { charger() }, [charger])
  useEffect(() => { chargerFournisseurs() }, [chargerFournisseurs])
  useEffect(() => { chargerDetections() }, [chargerDetections])

  const ouvrir = (facture = null) => {
    if (facture) {
      setForm({
        mois:          facture.mois,
        fournisseur:   facture.fournisseur,
        montant_ttc:   facture.montant_ttc,
        montant_ht:    facture.montant_ht || '',
        type_paiement: facture.type_paiement || 'virement',
        categorie:     facture.categorie || '',
        statut:        facture.statut || 'a_valider',
        notes:         facture.notes || '',
      })
      setModal(facture)
    } else {
      setForm({ ...MODAL_VIDE, mois: moisFiltre })
      setModal('new')
    }
  }

  const fermer = () => { setModal(null); setForm(MODAL_VIDE); setScanResult(null) }

  const sauvegarder = async () => {
    if (!form.fournisseur || !form.montant_ttc) return
    setSaving(true)
    const payload = {
      agence:                AGENCE,
      mois:                  form.mois,
      fournisseur:           form.fournisseur.trim(),
      montant_ttc:           parseFloat(form.montant_ttc),
      montant_ht:            form.montant_ht ? parseFloat(form.montant_ht) : null,
      type_paiement:         form.type_paiement,
      categorie:             form.categorie || null,
      statut:                form.statut,
      notes:                 form.notes || null,
      mouvement_bancaire_id: scanResult?.mouvementSuggere?.id
        ?? (modal !== 'new' ? (modal.mouvement_bancaire_id || null) : null),
      updated_at:            new Date().toISOString(),
    }
    if (modal === 'new') {
      await supabase.from('facture_achat').insert(payload)
    } else {
      await supabase.from('facture_achat').update(payload).eq('id', modal.id)
    }
    setSaving(false)
    fermer()
    charger()
  }

  const supprimer = async (id) => {
    if (!confirm('Supprimer cette facture ?')) return
    await supabase.from('facture_achat').delete().eq('id', id)
    charger()
  }

  const analyserFacture = async (facture) => {
    setAnalyses(prev => ({ ...prev, [facture.id]: { loading: true } }))
    try {
      const { data: historique } = await supabase
        .from('facture_achat')
        .select('fournisseur, montant_ttc, categorie, mois')
        .eq('agence', AGENCE)
        .eq('fournisseur', facture.fournisseur)
        .neq('id', facture.id)
        .order('mois', { ascending: false })
        .limit(6)

      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY

      const historiqueText = (historique || []).length
        ? (historique || []).map(h => `- ${h.mois} : ${h.montant_ttc} € (${h.categorie || 'non classé'})`).join('\n')
        : 'Aucun historique pour ce fournisseur.'

      const prompt = `Analyse cette facture d'achat et réponds en JSON strict :
{
  "ok": true/false,
  "message": "une phrase courte"
}

Facture à valider :
- Fournisseur : ${facture.fournisseur}
- Montant TTC : ${facture.montant_ttc} €
- Catégorie saisie : ${facture.categorie || 'non renseignée'}
- Type paiement : ${facture.type_paiement || '?'}
- Mois : ${facture.mois}

Historique des 6 dernières factures ${facture.fournisseur} :
${historiqueText}

Vérifie : montant cohérent avec l'historique ? Catégorie correcte pour ce fournisseur ?
Si tout est cohérent → ok:true, message rassurant court.
Si anomalie (montant très différent, catégorie suspecte) → ok:false, message expliquant l'anomalie.`

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/llm-analyse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ prompt }),
      })
      const data = await res.json()
      try {
        const parsed = JSON.parse(data.text)
        setAnalyses(prev => ({ ...prev, [facture.id]: { loading: false, ...parsed } }))
      } catch {
        setAnalyses(prev => ({ ...prev, [facture.id]: { loading: false, ok: true, message: data.text?.slice(0, 120) } }))
      }
    } catch (e) {
      setAnalyses(prev => ({ ...prev, [facture.id]: { loading: false, ok: null, message: 'Analyse indisponible' } }))
    }
  }

  const changerStatut = async (id, statut) => {
    await supabase.from('facture_achat').update({ statut, updated_at: new Date().toISOString() }).eq('id', id)
    setFactures(prev => prev.map(f => f.id === id ? { ...f, statut } : f))
    if (statut === 'valide') {
      const facture = factures.find(f => f.id === id)
      if (facture) analyserFacture({ ...facture, statut })
    }
  }

  // Suggestions fournisseur à partir du champ saisi
  const suggestions = form.fournisseur.length >= 2
    ? fournisseurs.filter(f => f.nom.toLowerCase().includes(form.fournisseur.toLowerCase()))
    : []

  const selectFournisseur = (f) => {
    setForm(prev => ({ ...prev, fournisseur: f.nom, categorie: f.categorie || prev.categorie }))
  }

  // Stats mois
  const totalTTC   = factures.reduce((s, f) => s + Number(f.montant_ttc), 0)
  const nbValides  = factures.filter(f => f.statut === 'valide').length
  const nbAttente  = factures.filter(f => f.statut === 'a_valider').length

  // Navigation mois
  const moisPrecedent = () => {
    const d = new Date(moisFiltre + '-01')
    d.setMonth(d.getMonth() - 1)
    setMoisFiltre(d.toISOString().slice(0, 7))
  }
  const moisSuivant = () => {
    const d = new Date(moisFiltre + '-01')
    d.setMonth(d.getMonth() + 1)
    setMoisFiltre(d.toISOString().slice(0, 7))
  }
  const moisLabel = new Date(moisFiltre + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Achats</h1>
          <p className="page-subtitle">Factures d'achat mensuel — remplace le Word doc</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={() => ouvrir()}>+ Ajouter facture</button>
        </div>
      </div>

      {/* Drop zone scan */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        style={{
          border: `2px dashed ${dragOver ? 'var(--brand)' : 'var(--border)'}`,
          borderRadius: 10, padding: '18px 24px', marginBottom: 20,
          background: dragOver ? 'var(--brand-pale)' : 'var(--bg)',
          display: 'flex', alignItems: 'center', gap: 16,
          transition: 'all 0.15s', cursor: 'pointer',
        }}
        onClick={() => document.getElementById('scan-input').click()}
      >
        <input id="scan-input" type="file" accept=".pdf,image/*" style={{ display: 'none' }} onChange={onDrop} />
        {scanning ? (
          <>
            <div className="spinner" />
            <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>Analyse de la facture en cours…</span>
          </>
        ) : scanResult?.error ? (
          <span style={{ color: '#dc2626', fontSize: 13 }}>✕ Erreur : {scanResult.error}</span>
        ) : (
          <>
            <span style={{ fontSize: 24 }}>📄</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>
                Déposer une facture ici pour scan automatique
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                PDF, JPG ou PNG — Claude extrait fournisseur, montant et rapproche le paiement
              </div>
            </div>
          </>
        )}
      </div>

      {/* Navigation mois */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button className="btn btn-secondary btn-sm" onClick={moisPrecedent}>←</button>
        <span style={{ fontWeight: 700, fontSize: 16, minWidth: 160, textAlign: 'center', textTransform: 'capitalize' }}>{moisLabel}</span>
        <button className="btn btn-secondary btn-sm" onClick={moisSuivant}>→</button>
        <input
          type="month"
          value={moisFiltre}
          onChange={e => setMoisFiltre(e.target.value)}
          style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, color: 'var(--text)' }}
        />
      </div>

      {/* Stats */}
      <div className="stats-row" style={{ marginBottom: 20 }}>
        {[
          { label: 'Total TTC',    value: totalTTC.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }), sub: `${factures.length} facture${factures.length > 1 ? 's' : ''}` },
          { label: 'Validées',     value: nbValides,  sub: 'factures' },
          { label: 'À valider',    value: nbAttente,  sub: 'en attente' },
        ].map(({ label, value, sub }) => (
          <div key={label} className="stat-card">
            <div className="stat-label">{label}</div>
            <div className="stat-value">{value}</div>
            <div className="stat-sub">{sub}</div>
          </div>
        ))}
      </div>

      {/* Détection fournisseurs récurrents */}
      {detections.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: 'var(--text)' }}>
            Fournisseurs récurrents — {new Date(moisFiltre + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {detections.map(d => {
              const detected = !!d.mouvement
              const ok = detected && d.factureExiste
              const warning = detected && !d.factureExiste
              const missing = !detected

              const bg    = ok ? '#D1FAE5' : warning ? '#FEF3C7' : '#F3F4F6'
              const color = ok ? '#065F46' : warning ? '#92400E' : '#6B7280'
              const icon  = ok ? '✓' : warning ? '⚠' : '?'
              const title = ok
                ? `Détecté + facture saisie`
                : warning
                ? `Prélèvement détecté (${Number(d.mouvement.debit).toFixed(2)} €) — facture manquante`
                : `Non détecté dans les relevés ce mois`

              return (
                <div key={d.id} title={title} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 20, background: bg, color, fontSize: 12, fontWeight: 600, cursor: warning ? 'pointer' : 'default' }}
                  onClick={() => {
                    if (!warning) return
                    ouvrir()
                    setForm(prev => ({
                      ...prev,
                      fournisseur:   d.nom,
                      montant_ttc:   d.mouvement ? Number(d.mouvement.debit).toFixed(2) : '',
                      type_paiement: 'prelevement',
                      categorie:     d.categorie || '',
                    }))
                  }}
                >
                  <span>{icon}</span>
                  <span>{d.nom}</span>
                  {warning && d.mouvement && (
                    <span style={{ opacity: 0.8 }}>{Number(d.mouvement.debit).toFixed(2)} €</span>
                  )}
                  {warning && <span style={{ fontSize: 10, opacity: 0.7 }}>+ ajouter</span>}
                </div>
              )
            })}
          </div>
          {detections.some(d => d.mouvement && !d.factureExiste) && (
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10, marginBottom: 0 }}>
              ⚠ Cliquer sur un badge orange pour pré-remplir la facture automatiquement.
            </p>
          )}
        </div>
      )}

      {/* Tableau */}
      <div className="table-container">
        <table>
          <thead>
            <tr>
              {['Fournisseur', 'Catégorie', 'Montant TTC', 'Paiement', 'Statut', 'Notes', 'Actions'].map(h => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Chargement…</td></tr>
            )}
            {!loading && factures.length === 0 && (
              <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                Aucune facture pour {moisLabel}. <button className="btn btn-secondary btn-sm" onClick={() => ouvrir()} style={{ marginLeft: 8 }}>+ Ajouter</button>
              </td></tr>
            )}
            {factures.map(f => {
              const sc = STATUT_COLORS[f.statut] || STATUT_COLORS.a_valider
              const analyse = analyses[f.id]
              return (
                <React.Fragment key={f.id}>
                <tr key={f.id + '-row'}>
                  <td style={{ fontWeight: 600 }}>{f.fournisseur}</td>
                  <td>
                    {f.categorie ? (
                      <span className="badge badge-neutral" style={{ textTransform: 'capitalize' }}>{f.categorie}</span>
                    ) : '—'}
                  </td>
                  <td className="right montant" style={{ fontWeight: 700 }}>
                    {Number(f.montant_ttc).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
                    {f.montant_ht && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
                        HT {Number(f.montant_ht).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
                      </div>
                    )}
                  </td>
                  <td style={{ textTransform: 'capitalize' }}>{f.type_paiement || '—'}</td>
                  <td>
                    <select
                      value={f.statut}
                      onChange={e => changerStatut(f.id, e.target.value)}
                      style={{ padding: '2px 6px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: sc.bg, color: sc.color }}
                    >
                      {Object.entries(STATUTS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </td>
                  <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-muted)', fontSize: 12 }}>
                    {f.notes || '—'}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => ouvrir(f)}>Éditer</button>
                      <button onClick={() => supprimer(f.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 16 }} title="Supprimer">✕</button>
                    </div>
                  </td>
                </tr>
                {analyse && (
                  <tr key={f.id + '-analyse'} style={{ background: analyse.loading ? '#FAFAFA' : analyse.ok ? '#F0FDF4' : analyse.ok === false ? '#FFF7ED' : '#FAFAFA' }}>
                    <td colSpan={7} style={{ padding: '6px 16px', fontSize: 12 }}>
                      {analyse.loading
                        ? <span style={{ color: 'var(--text-muted)' }}>⏳ Analyse en cours…</span>
                        : analyse.ok === true
                        ? <span style={{ color: '#065F46' }}>✓ {analyse.message}</span>
                        : analyse.ok === false
                        ? <span style={{ color: '#92400E' }}>⚠ {analyse.message}</span>
                        : <span style={{ color: 'var(--text-muted)' }}>{analyse.message}</span>
                      }
                    </td>
                  </tr>
                )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: '100%', maxWidth: 520, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12, color: 'var(--text)' }}>
              {modal === 'new' ? 'Nouvelle facture' : 'Modifier la facture'}
            </h2>

            {/* Résultat scan + paiement suggéré */}
            {scanResult && modal === 'new' && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ background: 'var(--brand-pale)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'var(--text)', marginBottom: scanResult.mouvementSuggere ? 8 : 0 }}>
                  ✓ Facture scannée — données pré-remplies. Vérifiez et corrigez si nécessaire.
                </div>
                {scanResult.mouvementSuggere && (
                  <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#1E40AF' }}>
                    💳 Paiement détecté : <strong>{scanResult.mouvementSuggere.libelle}</strong> — {Number(scanResult.mouvementSuggere.debit).toFixed(2)} € le {new Date(scanResult.mouvementSuggere.date_operation).toLocaleDateString('fr-FR')}
                    <div style={{ color: '#6B7280', marginTop: 2 }}>Ce mouvement sera associé à la facture à l'enregistrement.</div>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {/* Mois */}
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">Mois</label>
                <input type="month" className="form-input" value={form.mois} onChange={e => setForm(p => ({ ...p, mois: e.target.value }))} />
              </div>

              {/* Fournisseur */}
              <div className="form-group" style={{ gridColumn: '1 / -1', position: 'relative' }}>
                <label className="form-label">Fournisseur *</label>
                <input
                  className="form-input"
                  value={form.fournisseur}
                  onChange={e => setForm(p => ({ ...p, fournisseur: e.target.value }))}
                  placeholder="SFR, Canal+, Amazon…"
                  autoComplete="off"
                />
                {suggestions.length > 0 && form.fournisseur.length >= 2 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid var(--border)', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 10 }}>
                    {suggestions.map(f => (
                      <div key={f.nom} onClick={() => selectFournisseur(f)}
                        style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, display: 'flex', justifyContent: 'space-between' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                        onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                      >
                        <span>{f.nom}</span>
                        {f.categorie && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{f.categorie}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Montant TTC */}
              <div className="form-group">
                <label className="form-label">Montant TTC * (€)</label>
                <input type="number" step="0.01" className="form-input" value={form.montant_ttc}
                  onChange={e => setForm(p => ({ ...p, montant_ttc: e.target.value }))} placeholder="0.00" />
              </div>

              {/* Montant HT */}
              <div className="form-group">
                <label className="form-label">Montant HT (€)</label>
                <input type="number" step="0.01" className="form-input" value={form.montant_ht}
                  onChange={e => setForm(p => ({ ...p, montant_ht: e.target.value }))} placeholder="optionnel" />
              </div>

              {/* Type paiement */}
              <div className="form-group">
                <label className="form-label">Type paiement</label>
                <select className="form-select" value={form.type_paiement} onChange={e => setForm(p => ({ ...p, type_paiement: e.target.value }))}>
                  {TYPES_PAIEMENT.map(t => <option key={t} value={t} style={{ textTransform: 'capitalize' }}>{t}</option>)}
                </select>
              </div>

              {/* Catégorie */}
              <div className="form-group">
                <label className="form-label">Catégorie</label>
                <select className="form-select" value={form.categorie} onChange={e => setForm(p => ({ ...p, categorie: e.target.value }))}>
                  <option value="">— choisir —</option>
                  {CATEGORIES.map(c => <option key={c} value={c} style={{ textTransform: 'capitalize' }}>{c}</option>)}
                </select>
              </div>

              {/* Statut */}
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">Statut</label>
                <select className="form-select" value={form.statut} onChange={e => setForm(p => ({ ...p, statut: e.target.value }))}>
                  {Object.entries(STATUTS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>

              {/* Notes */}
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">Notes</label>
                <textarea className="form-input" rows={2} value={form.notes}
                  onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                  placeholder="Références, numéro de facture…" style={{ resize: 'vertical' }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="btn btn-secondary" onClick={fermer}>Annuler</button>
              <button className="btn btn-primary" onClick={sauvegarder} disabled={saving || !form.fournisseur || !form.montant_ttc}>
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
