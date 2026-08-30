// src/components/ModalRapportsGroupes.jsx — traitement groupé des rapports propriétaires
// (PageRapports.jsx, 30/08/2026). Deux modes :
//   - 'download' : génère le PDF de chaque rapport en attente et les regroupe dans un zip unique.
//   - 'send'     : envoie chaque rapport en attente par email (même chemin que le bouton
//                  "Envoyer" de la vue simple : PDF joint si "Joindre le statement" est coché).
//
// Traite les proprios dans l'ordre, un par un. Si un rapport contient des "ajustements réservation
// non qualifiés" (réservations annulées avec frais perçus — même mécanisme que la vue détaillée),
// le traitement s'arrête sur ce proprio et affiche les mêmes boutons de qualification que la vue
// simple : impossible de générer/envoyer tant qu'il en reste, pour ne jamais publier un rapport
// dont un montant reste à trancher.
//
// Hors périmètre (volontaire) : Maison Maïté et tout bien en groupe_facturation='MAITE'. Le choix
// chambre/global y est un arbitrage manuel qui doit rester sur la vue simple — cf.
// src/services/rapportBatch.js.
import { useState, useEffect, useCallback, useRef } from 'react'
import JSZip from 'jszip'
import { authPostRaw } from '../lib/authFetch'
import { supabase } from '../lib/supabase'
import { genererRapportHTML, envoyerRapportEmail } from '../services/rapportProprietaire'
import { genererStatementHTML, genererMailStatementHTML } from '../services/rapportStatement'
import { qualifierAjustement } from '../services/ventilation'
import { chargerRapportPourItem, buildRendererPayloadFrom, listeProprioEnAttente } from '../services/rapportBatch'
import { AGENCE } from '../lib/agence'

const fmt = c => ((c || 0) / 100).toFixed(2).replace('.', ',') + ' €'

const STATUT_LABEL = {
  attente:     { label: 'En attente',        color: '#9C8E7D', bg: '#F0EBE1' },
  chargement:  { label: 'Chargement…',       color: '#D97706', bg: '#FEF3C7' },
  a_qualifier: { label: '⚠️ À trancher',      color: '#DC2626', bg: '#FEE2E2' },
  pret:        { label: '✓ Prêt',            color: '#059669', bg: '#D1FAE5' },
  traitement:  { label: 'Traitement…',       color: '#D97706', bg: '#FEF3C7' },
  fait:        { color: '#059669', bg: '#D1FAE5' }, // libellé précisé au rendu (PDF généré / Envoyé)
  erreur:      { label: 'Erreur',            color: '#DC2626', bg: '#FEE2E2' },
}

export default function ModalRapportsGroupes({ mode, mois, moisLabel, propsFiltres, biensEnvoyes, bienIdsActifs, useStatement, joindrePDF, onClose, onEnvoye }) {
  const [items, setItems] = useState(() => listeProprioEnAttente(propsFiltres, biensEnvoyes, bienIdsActifs, AGENCE)
    .map(x => ({ ...x, statut: 'attente' })))
  const [running, setRunning] = useState(false)
  const [currentIdx, setCurrentIdx] = useState(-1)
  const [menageInputs, setMenageInputs] = useState({})
  const [qualifyingId, setQualifyingId] = useState(null)
  const [globalError, setGlobalError] = useState(null)
  const [zipReady, setZipReady] = useState(null) // { blob, filename }
  const waitResolveRef = useRef(null)
  const stopRef = useRef(false)

  useEffect(() => () => { stopRef.current = true }, [])

  const patchItem = useCallback((idx, patch) => {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it))
  }, [])

  // Recharge un item et renvoie son nombre d'ajustements restant à qualifier.
  async function rechargerEtEvaluer(idx, proprio, bienId) {
    const loaded = await chargerRapportPourItem(proprio, bienId, mois)
    patchItem(idx, { ...loaded, statut: loaded.nbAQualifier > 0 ? 'a_qualifier' : 'pret' })
    return loaded
  }

  async function qualifier(idx, ajustementId, type) {
    setQualifyingId(ajustementId)
    try {
      const extra = type === 'menage'
        ? {
            montantFmen: Math.round((parseFloat(String(menageInputs[ajustementId]?.fmen || '0').replace(',', '.')) || 0) * 100),
            montantAuto: Math.round((parseFloat(String(menageInputs[ajustementId]?.auto || '0').replace(',', '.')) || 0) * 100),
          }
        : {}
      await qualifierAjustement(ajustementId, type, extra)
      const it = items[idx]
      const loaded = await rechargerEtEvaluer(idx, it.proprio, it.bienId)
      if (loaded.nbAQualifier === 0 && waitResolveRef.current) {
        const r = waitResolveRef.current
        waitResolveRef.current = null
        r()
      }
    } catch (e) {
      setGlobalError(e.message)
    } finally {
      setQualifyingId(null)
    }
  }

  function attendreQualification() {
    return new Promise(resolve => { waitResolveRef.current = resolve })
  }

  async function genererUnPdf(item) {
    const rapportData = buildRendererPayloadFrom(item)
    const html = useStatement
      ? genererStatementHTML(item.proprio, mois, rapportData)
      : genererRapportHTML(item.proprio, mois, rapportData, rapportData.colonnes)
    const res = await authPostRaw('/api/generate-pdf', { html, orientation: useStatement ? 'landscape' : 'portrait' })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || 'Erreur génération PDF')
    }
    return res.blob()
  }

  async function envoyerUnRapport(item) {
    const rapportData = buildRendererPayloadFrom(item)
    let htmlBody, prependAttachments = []
    if (useStatement) {
      const statementHtml = genererStatementHTML(item.proprio, mois, rapportData)
      htmlBody = genererMailStatementHTML(item.proprio, mois, rapportData)
      const pdfRes = await authPostRaw('/api/generate-pdf', { html: statementHtml, orientation: 'landscape' })
      if (pdfRes.ok) {
        const ab = await pdfRes.arrayBuffer()
        const u8 = new Uint8Array(ab)
        let base64 = ''
        for (let i = 0; i < u8.length; i += 3072) base64 += btoa(String.fromCharCode(...u8.slice(i, i + 3072)))
        const bienNom = (item.bien?.hospitable_name || '').replace(/[^a-zA-Z0-9]/g, '_') || 'bien'
        prependAttachments = [{ filename: `Statement_${bienNom}_${mois}.pdf`, content_base64: base64 }]
      }
    } else {
      htmlBody = genererRapportHTML(item.proprio, mois, rapportData, rapportData.colonnes)
    }
    const emails = (item.proprio.email || '').split(/[,;]/).map(e => e.trim()).filter(e => e.includes('@'))
    if (!emails.length) throw new Error(`Pas d'email pour ${item.proprio.nom}`)
    const bienName = item.bien?.hospitable_name || item.proprio?.nom
    await envoyerRapportEmail({ ...item.proprio, email: emails, bienName }, mois, htmlBody, joindrePDF, prependAttachments)
    await supabase.from('bien_notes').upsert(
      { bien_id: item.bienId, mois, rapport_envoye_at: new Date().toISOString() },
      { onConflict: 'bien_id,mois' }
    )
  }

  async function demarrer() {
    setRunning(true)
    setGlobalError(null)
    stopRef.current = false
    const zip = mode === 'download' ? new JSZip() : null
    for (let idx = 0; idx < items.length; idx++) {
      if (stopRef.current) break
      setCurrentIdx(idx)
      patchItem(idx, { statut: 'chargement' })
      let loaded
      try {
        loaded = await rechargerEtEvaluer(idx, items[idx].proprio, items[idx].bienId)
      } catch (e) {
        patchItem(idx, { statut: 'erreur', error: e.message })
        continue
      }
      if (loaded.nbAQualifier > 0) {
        await attendreQualification()
        if (stopRef.current) break
      }
      const item = { ...items[idx], ...loaded }
      patchItem(idx, { statut: 'traitement' })
      try {
        if (mode === 'download') {
          const blob = await genererUnPdf(item)
          const bienNom = (item.bien?.hospitable_name || item.proprio?.nom || 'rapport').replace(/[^a-zA-Z0-9]/g, '_')
          zip.file(`Rapport_${bienNom}_${mois}.pdf`, blob)
          patchItem(idx, { statut: 'fait_pdf' })
        } else {
          await envoyerUnRapport(item)
          onEnvoye?.(item.bienId)
          patchItem(idx, { statut: 'fait_envoye' })
        }
      } catch (e) {
        patchItem(idx, { statut: 'erreur', error: e.message })
      }
    }
    if (mode === 'download' && zip && !stopRef.current) {
      const blob = await zip.generateAsync({ type: 'blob' })
      setZipReady({ blob, filename: `Rapports_${mois}.zip` })
    }
    setRunning(false)
    setCurrentIdx(-1)
  }

  function telechargerZip() {
    if (!zipReady) return
    const url = URL.createObjectURL(zipReady.blob)
    const a = document.createElement('a')
    a.href = url
    a.download = zipReady.filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const nbFait = items.filter(it => it.statut === 'fait_pdf' || it.statut === 'fait_envoye').length
  const nbErreur = items.filter(it => it.statut === 'erreur').length
  const itemEnCoursQualif = currentIdx >= 0 ? items[currentIdx] : null

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 12, maxWidth: 640, width: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(0,0,0,.25)' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 style={{ fontSize: '1.1em', fontWeight: 700, color: 'var(--text)', flex: 1 }}>
            {mode === 'download' ? '📦 Télécharger tous les rapports' : '✉️ Envoi groupé des rapports'} — {moisLabel}
          </h2>
          <button onClick={onClose} disabled={running} style={{ background: 'none', border: 'none', fontSize: 20, cursor: running ? 'default' : 'pointer', color: '#9C8E7D', opacity: running ? .4 : 1 }}>✕</button>
        </div>

        <div style={{ padding: '14px 20px', overflowY: 'auto', flex: 1 }}>
          {items.length === 0 && (
            <p style={{ color: '#9C8E7D', fontSize: '0.9em' }}>
              Aucun rapport en attente ce mois-ci (tous déjà envoyés, ou uniquement Maison Maïté — traitée à part depuis la vue simple).
            </p>
          )}

          {items.length > 0 && (
            <p style={{ fontSize: '0.85em', color: '#6B5E4E', marginBottom: 12 }}>
              {items.length} rapport(s) en attente. Maison Maïté (mode chambre/global) n'est pas incluse ici — à traiter depuis la vue simple.
            </p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {items.map((it, idx) => {
              const st = STATUT_LABEL[it.statut === 'fait_pdf' ? 'fait' : it.statut === 'fait_envoye' ? 'fait' : it.statut] || STATUT_LABEL.attente
              const label = it.statut === 'fait_pdf' ? '✓ PDF généré' : it.statut === 'fait_envoye' ? '✓ Envoyé' : st.label
              return (
                <div key={it.proprio.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, background: idx === currentIdx ? '#FDF5E8' : 'transparent', border: idx === currentIdx ? '1px solid var(--brand)' : '1px solid transparent' }}>
                  <span style={{ flex: 1, fontSize: '0.9em', color: 'var(--text)' }}>{it.bien?.hospitable_name || it.bien?.code || it.proprio.nom} <span style={{ color: '#9C8E7D' }}>— {it.proprio.nom}</span></span>
                  <span style={{ fontSize: '0.75em', fontWeight: 700, color: st.color, background: st.bg, padding: '2px 8px', borderRadius: 10 }}>{label}</span>
                </div>
              )
            })}
          </div>

          {itemEnCoursQualif?.statut === 'a_qualifier' && (
            <div style={{ marginTop: 16, padding: 12, background: '#FFFBEB', border: '1px solid #f59e0b55', borderRadius: 8 }}>
              <p style={{ fontSize: '0.85em', fontWeight: 700, color: '#92400E', marginBottom: 8 }}>
                {itemEnCoursQualif.bien?.hospitable_name} — ajustement(s) à trancher avant de continuer :
              </p>
              {(itemEnCoursQualif.result.resas || []).flatMap(r => (r.ajustements || [])
                .filter(a => a.statut === 'a_qualifier')
                .map(adj => (
                  <div key={adj.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: '0.85em', padding: '6px 0', borderTop: '1px solid #f59e0b33' }}>
                    <span style={{ fontStyle: 'italic', color: '#6B5E4E' }}>{adj.label}</span>
                    <span style={{ fontWeight: 700, color: (adj.montant || 0) < 0 ? '#DC2626' : '#059669' }}>{(adj.montant || 0) < 0 ? fmt(adj.montant) : `+ ${fmt(adj.montant)}`}</span>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button onClick={() => qualifier(currentIdx, adj.id, 'hebergement')} disabled={qualifyingId === adj.id} className="btn btn-secondary" style={{ padding: '3px 10px', fontSize: '0.9em' }}>
                        {qualifyingId === adj.id ? '…' : 'Hébergement'}
                      </button>
                      <span style={{ fontSize: '0.8em', color: '#9C8E7D' }}>FMEN</span>
                      <input type="text" inputMode="decimal" placeholder="0,00"
                        onChange={e => setMenageInputs(prev => ({ ...prev, [adj.id]: { ...prev[adj.id], fmen: e.target.value } }))}
                        style={{ width: 55, fontSize: '0.9em', padding: '2px 5px', border: '1px solid var(--border)', borderRadius: 4 }} />
                      <span style={{ fontSize: '0.8em', color: '#9C8E7D' }}>AUTO</span>
                      <input type="text" inputMode="decimal" placeholder="0,00"
                        onChange={e => setMenageInputs(prev => ({ ...prev, [adj.id]: { ...prev[adj.id], auto: e.target.value } }))}
                        style={{ width: 55, fontSize: '0.9em', padding: '2px 5px', border: '1px solid var(--border)', borderRadius: 4 }} />
                      <button onClick={() => qualifier(currentIdx, adj.id, 'menage')} disabled={qualifyingId === adj.id} className="btn btn-secondary" style={{ padding: '3px 10px', fontSize: '0.9em' }}>
                        {qualifyingId === adj.id ? '…' : 'Ménage / extra'}
                      </button>
                      <button onClick={() => qualifier(currentIdx, adj.id, 'aucun')} disabled={qualifyingId === adj.id} className="btn btn-secondary" style={{ padding: '3px 10px', fontSize: '0.9em' }}>
                        {qualifyingId === adj.id ? '…' : 'Sans impact'}
                      </button>
                    </div>
                  </div>
                )))}
            </div>
          )}

          {globalError && <p style={{ marginTop: 12, color: '#DC2626', fontSize: '0.85em' }}>⚠️ {globalError}</p>}
        </div>

        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '0.8em', color: '#9C8E7D', flex: 1 }}>
            {nbFait}/{items.length} traité(s){nbErreur > 0 ? ` · ${nbErreur} erreur(s)` : ''}
          </span>
          {!zipReady && (
            <button onClick={demarrer} disabled={running || items.length === 0} className="btn btn-secondary"
              style={{ padding: '8px 16px', fontWeight: 600, opacity: (running || items.length === 0) ? .5 : 1 }}>
              {running ? '⏳ Traitement…' : (mode === 'download' ? '▶ Générer les PDF' : '▶ Envoyer à tous')}
            </button>
          )}
          {zipReady && (
            <button onClick={telechargerZip} style={{ padding: '8px 16px', fontWeight: 700, borderRadius: 8, border: 'none', background: 'var(--brand)', color: '#fff', cursor: 'pointer' }}>
              ⬇ Télécharger le zip ({zipReady.filename})
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
