import { useState, useEffect, useMemo } from 'react'
import MoisSelector from '../components/MoisSelector'
import { useMoisPersisted } from '../hooks/useMoisPersisted'
import { supabase } from '../lib/supabase'
import { AGENCE } from '../lib/agence'
import { exportRapprochementBancaire } from '../services/exportRapprochementBancaire'
import { exportAutoDebours, exportAutoDeboursCombined } from '../services/exportAutoDebours'
import { exportFacturesEvoliz } from '../services/exportFacturesEvoliz'
import { exportReservationsDetaillees } from '../services/exportReservationsDetaillees'
import { exportDeboursPrestations, exportDeboursPrestationsCombined } from '../services/exportDeboursPrestations'
import { buildComptaMensuelle, downloadComptaCSV, exportComptaCSV } from '../services/buildComptaMensuelle'
import { envoyerExportsComptable } from '../services/envoyerExportsComptable'
import { genererSCTVirementsProprios, genererSCTHonorairesDCB, genererSCTVirementsPropriosLC, genererSCTInternesLC } from '../services/exportSCT'

const moisCourant = new Date().toISOString().slice(0, 7)

// Parse un CSV séparé par ; avec guillemets
function parseCSV(text) {
  const lines = text.replace(/^\uFEFF/, '').split('\n')
  return lines.map(line => {
    const cells = []
    let cur = ''
    let inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++ }
        else inQ = !inQ
      } else if (ch === ';' && !inQ) {
        cells.push(cur); cur = ''
      } else {
        cur += ch
      }
    }
    cells.push(cur)
    return cells
  })
}

function isDecorativeRow(cells) {
  const joined = cells.join('').trim()
  return joined === '' || /^[═─\s]+$/.test(joined)
}

function isSectionHeader(cells) {
  const first = (cells[0] || '').trim()
  return (
    first.startsWith('BIEN :') ||
    first.startsWith('RELEVE DE') ||
    first.startsWith('TOTAL') ||
    first.startsWith('Sous-total') ||
    first.startsWith('TOTAUX') ||
    first === 'TOTAUX & CONTROLES' ||
    first === 'DESTINATION COTE BASQUE' ||
    /^[A-ZÀÉÈÊ\s&·]+$/.test(first) && first.length > 3
  )
}

function PreviewModal({ titre, csv, onClose, onDownload, downloading }) {
  const rows = useMemo(() => parseCSV(csv), [csv])

  // Trouver la ligne qui ressemble à un header de colonnes (max de cellules non vides)
  const headerRowIdx = useMemo(() => {
    let best = -1; let bestCount = 0
    rows.forEach((r, i) => {
      const filled = r.filter(c => c.trim()).length
      if (filled > bestCount) { bestCount = filled; best = i }
    })
    return best
  }, [rows])

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(44,36,22,0.45)', display: 'flex', flexDirection: 'column' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: 'var(--bg, #F7F3EC)', display: 'flex', flexDirection: 'column', height: '100%', maxWidth: '100vw' }}>
        {/* Header modal */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: '2px solid var(--brand, #CC9933)', background: '#EAE3D4', flexShrink: 0 }}>
          <div style={{ flex: 1, fontWeight: 700, fontSize: '1em', color: 'var(--text, #2C2416)' }}>{titre}</div>
          <button
            className="btn btn-secondary"
            onClick={onDownload}
            disabled={downloading}
            style={{ fontSize: '0.82em' }}
          >
            {downloading ? 'Génération...' : 'Télécharger CSV'}
          </button>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2em', color: '#9C8E7D', lineHeight: 1, padding: '4px 8px' }}
          >
            ✕
          </button>
        </div>

        {/* Table scrollable */}
        <div style={{ overflow: 'auto', flex: 1, padding: '0' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: '0.78em', width: '100%', tableLayout: 'auto' }}>
            <tbody>
              {rows.map((row, i) => {
                const isEmpty = row.every(c => !c.trim())
                const isDecor = isDecorativeRow(row)
                const isHeader = i === headerRowIdx
                const isSection = !isHeader && isSectionHeader(row)

                if (isEmpty) return (
                  <tr key={i}><td colSpan={row.length || 1} style={{ height: 6 }} /></tr>
                )
                if (isDecor) return null

                return (
                  <tr
                    key={i}
                    style={{
                      background: isHeader
                        ? 'var(--brand, #CC9933)'
                        : isSection
                          ? '#EAE3D4'
                          : i % 2 === 0 ? 'white' : '#FAF8F4',
                    }}
                  >
                    {row.map((cell, j) => (
                      <td
                        key={j}
                        style={{
                          padding: '5px 10px',
                          border: '1px solid #E8E0D0',
                          whiteSpace: 'nowrap',
                          fontWeight: isHeader || isSection ? 700 : 400,
                          color: isHeader ? 'white' : 'var(--text, #2C2416)',
                          maxWidth: 260,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={cell}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default function PageExports() {
  const [mois, setMois] = useMoisPersisted()
  const [moisDispos, setMoisDispos] = useState([moisCourant])
  const [loading, setLoading] = useState({})
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [preview, setPreview] = useState(null) // { titre, csv, downloadFn }

  const [showEmailForm, setShowEmailForm] = useState(false)
  const [emailDest, setEmailDest] = useState('')
  const [emailCC, setEmailCC] = useState('')
  const [emailMessage, setEmailMessage] = useState('')
  const [emailExports, setEmailExports] = useState({
    rapprochement: false, auto: false, factures: false, compta: false, achats: false, bilan_lld: false
  })
  const [sendingEmail, setSendingEmail] = useState(false)

  const [biens, setBiens] = useState([])
  const [bienFilter, setBienFilter] = useState({})
  const [bienFilterOpen, setBienFilterOpen] = useState(false)

  useEffect(() => {
    supabase.from('reservation').select('mois_comptable').then(({ data: res }) => {
      const [cy, cm] = moisCourant.split('-').map(Number)
      const thisYearMonths = Array.from({ length: cm }, (_, i) =>
        `${cy}-${String(i + 1).padStart(2, '0')}`)
      const uniq = [...new Set([...thisYearMonths, ...(res || []).map(d => d.mois_comptable).filter(Boolean)])]
        .sort((a, b) => b.localeCompare(a))
      setMoisDispos(uniq)
    })
  }, [])

  // Fermer la preview si on change de mois
  useEffect(() => { setPreview(null) }, [mois])

  // Charger les biens actifs du mois sélectionné pour le filtre
  useEffect(() => {
    setBiens([])
    setBienFilter({})
    Promise.all([
      supabase.from('reservation').select('bien_id').eq('mois_comptable', mois),
      supabase.from('ventilation').select('bien_id').eq('mois_comptable', mois),
    ]).then(([{ data: resasData }, { data: ventilData }]) => {
      const ids = [...new Set([
        ...(resasData || []).map(r => r.bien_id),
        ...(ventilData || []).map(v => v.bien_id),
      ].filter(Boolean))]
      if (ids.length === 0) return
      supabase.from('bien')
        .select('id, code, hospitable_name, proprietaire_id, proprietaire:proprietaire_id(id, nom, prenom)')
        .eq('agence', AGENCE)
        .in('id', ids)
        .order('hospitable_name')
        .then(({ data, error }) => {
          if (error) { console.error('PageExports biens filter:', error); return }
          const list = data || []
          setBiens(list)
          const init = {}
          for (const b of list) init[b.id] = true
          setBienFilter(init)
        })
    })
  }, [mois])

  const selectedBienIds = useMemo(() => {
    if (biens.length === 0) return null
    const all = biens.every(b => bienFilter[b.id] !== false)
    if (all) return null
    return biens.filter(b => bienFilter[b.id] !== false).map(b => b.id)
  }, [biens, bienFilter])

  const nbSelected = useMemo(() => biens.filter(b => bienFilter[b.id] !== false).length, [biens, bienFilter])

  const propGroups = useMemo(() => {
    const groups = {}
    for (const b of biens) {
      const pid = b.proprietaire_id || '__sans__'
      const nom = b.proprietaire ? `${b.proprietaire.prenom || ''} ${b.proprietaire.nom || ''}`.trim() : 'Sans propriétaire'
      if (!groups[pid]) groups[pid] = { nom, biens: [] }
      groups[pid].biens.push(b)
    }
    return Object.values(groups).sort((a, b) => a.nom.localeCompare(b.nom))
  }, [biens])

  function downloadCSVBlob(csv, filename) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  async function consulterCSV(type, titre, generator, filename, bienIds = null) {
    setLoading(prev => ({ ...prev, [type + '_preview']: true }))
    setError(null)
    try {
      const csv = await generator(mois, bienIds)
      setPreview({
        titre: `${titre} — ${mois}`,
        csv,
        downloadFn: () => downloadCSVBlob(csv, filename.replace('{mois}', mois)),
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(prev => ({ ...prev, [type + '_preview']: false }))
    }
  }

  async function consulterCompta() {
    setLoading(prev => ({ ...prev, compta_preview: true }))
    setError(null)
    try {
      const data = await buildComptaMensuelle(mois, selectedBienIds)
      const csv = exportComptaCSV(data)
      setPreview({
        titre: `Comptabilité mensuelle — ${mois}`,
        csv,
        downloadFn: () => downloadComptaCSV(data),
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(prev => ({ ...prev, compta_preview: false }))
    }
  }

  async function telechargerCSV(type, filename, generator, bienIds = null) {
    setLoading(prev => ({ ...prev, [type]: true }))
    setError(null)
    try {
      const csv = await generator(mois, bienIds)
      downloadCSVBlob(csv, filename.replace('{mois}', mois))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(prev => ({ ...prev, [type]: false }))
    }
  }

  async function telechargerXLSX() {
    setLoading(prev => ({ ...prev, debours: true }))
    setError(null)
    try {
      const blob = await exportDeboursPrestations(mois, selectedBienIds)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `DCB_Debours_Prestations_${mois}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(prev => ({ ...prev, debours: false }))
    }
  }

  async function telechargerCompta() {
    setLoading(prev => ({ ...prev, compta: true }))
    setError(null)
    try {
      const data = await buildComptaMensuelle(mois, selectedBienIds)
      downloadComptaCSV(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(prev => ({ ...prev, compta: false }))
    }
  }

  async function genererBilanLLD() {
    setLoading(prev => ({ ...prev, bilan_lld: true }))
    setError(null)
    try {
      const { data, error } = await supabase.functions.invoke('bilan-lld', {
        body: { mois, agence: AGENCE, envoyer_email: false },
      })
      if (error) throw error
      if (data?.pdf_url) window.open(data.pdf_url, '_blank')
      else throw new Error('URL PDF non retournée')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(prev => ({ ...prev, bilan_lld: false }))
    }
  }

  async function envoyerEmail() {
    if (!emailDest.trim()) { setError('Email destinataire requis'); return }
    const exportsSelectionnes = Object.entries(emailExports)
      .filter(([, checked]) => checked).map(([key]) => key)
    if (exportsSelectionnes.length === 0) { setError('Sélectionnez au moins un export'); return }

    setSendingEmail(true)
    setError(null)
    setSuccess(null)
    try {
      await envoyerExportsComptable(mois, emailDest, emailCC, exportsSelectionnes, emailMessage, selectedBienIds)
      setSuccess('Email envoyé avec succès')
      setShowEmailForm(false)
      setEmailDest(''); setEmailCC(''); setEmailMessage('')
    } catch (err) {
      setError('Erreur envoi : ' + err.message)
    } finally {
      setSendingEmail(false)
    }
  }

  return (
    <div style={{ padding: '24px', maxWidth: 900, margin: '0 auto' }}>
      {preview && (
        <PreviewModal
          titre={preview.titre}
          csv={preview.csv}
          onClose={() => setPreview(null)}
          onDownload={preview.downloadFn}
          downloading={false}
        />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.4em', fontWeight: 700, color: 'var(--text)' }}>Exports</h1>
          <div style={{ fontSize: '0.82em', color: '#9C8E7D', marginTop: 2 }}>Téléchargements et envoi comptable</div>
        </div>
        <MoisSelector mois={mois} setMois={setMois} moisDispos={moisDispos} />
      </div>

      {/* Filtre par bien */}
      {biens.length > 0 && (
        <div style={{ marginBottom: 20, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <button
            onClick={() => setBienFilterOpen(o => !o)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px', background: selectedBienIds ? '#FFF8E7' : '#EAE3D4',
              border: 'none', cursor: 'pointer', textAlign: 'left',
              borderBottom: bienFilterOpen ? '1px solid var(--border)' : 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '0.88em', fontWeight: 600, color: 'var(--text)' }}>
                Filtre biens
              </span>
              <span style={{
                fontSize: '0.78em', padding: '1px 7px', borderRadius: 10,
                background: selectedBienIds ? 'var(--brand)' : '#C8BBA8', color: 'white',
              }}>
                {nbSelected}/{biens.length}
              </span>
              {selectedBienIds && (
                <span style={{ fontSize: '0.75em', color: '#CC7700', fontWeight: 500 }}>filtre actif</span>
              )}
            </div>
            <span style={{ fontSize: '0.75em', color: '#9C8E7D' }}>{bienFilterOpen ? '▲' : '▼'}</span>
          </button>

          {bienFilterOpen && (
            <div style={{ padding: '12px 14px', background: 'white' }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: '0.78em', padding: '3px 10px' }}
                  onClick={() => setBienFilter(prev => { const n = {}; for (const k of Object.keys(prev)) n[k] = true; return n })}
                >
                  Tout
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: '0.78em', padding: '3px 10px' }}
                  onClick={() => setBienFilter(prev => { const n = {}; for (const k of Object.keys(prev)) n[k] = false; return n })}
                >
                  Aucun
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {propGroups.map(group => (
                  <div key={group.nom}>
                    <div style={{ fontSize: '0.78em', fontWeight: 700, color: '#9C8E7D', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                      {group.nom}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
                      {group.biens.map(b => (
                        <label key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: '0.85em' }}>
                          <input
                            type="checkbox"
                            checked={bienFilter[b.id] !== false}
                            onChange={e => setBienFilter(prev => ({ ...prev, [b.id]: e.target.checked }))}
                          />
                          <span style={{ color: bienFilter[b.id] !== false ? 'var(--text)' : '#B0A090' }}>
                            {b.hospitable_name || b.code}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <div style={{ padding: 12, background: '#FEF2F2', border: '1px solid #EF5350', borderRadius: 6, marginBottom: 16, color: '#C62828', fontSize: '0.9em' }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ padding: 12, background: '#E8F5E9', border: '1px solid #66BB6A', borderRadius: 6, marginBottom: 16, color: '#2E7D32', fontSize: '0.9em' }}>
          {success}
        </div>
      )}

      {/* COMPTABLE */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: '1em', fontWeight: 700, color: '#9C8E7D', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 14px 0' }}>
          Comptable
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <ExportCard
            titre="Rapprochement bancaire"
            description="Mouvements bancaires + ventilation — audit mensuel complet"
            loading={loading.rapprochement}
            loadingPreview={loading.rapprochement_preview}
            onClick={() => telechargerCSV('rapprochement', `DCB_Rapprochement_${mois}.csv`, exportRapprochementBancaire)}
            onPreview={() => consulterCSV('rapprochement', 'Rapprochement bancaire', exportRapprochementBancaire, `DCB_Rapprochement_${mois}.csv`)}
          />
          <ExportCard
            titre="AUTO & Débours"
            description="Relevé de prestations par AE — un onglet par AE"
            loading={loading.auto}
            loadingPreview={loading.auto_preview}
            onPreview={() => consulterCSV('auto', 'AUTO & Débours', exportAutoDeboursCombined, `DCB_AUTO_Debours_${mois}.csv`, selectedBienIds)}
            onClick={async () => {
              setLoading(prev => ({ ...prev, auto: true }))
              setError(null)
              try {
                const blob = await exportAutoDebours(mois, selectedBienIds)
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `DCB_AUTO_Debours_${mois}.xlsx`
                a.click()
                URL.revokeObjectURL(url)
              } catch (err) { setError(err.message) }
              finally { setLoading(prev => ({ ...prev, auto: false })) }
            }}
            format="XLSX"
          />
          <ExportCard
            titre="Factures Evoliz"
            description="Honoraires + débours — statuts et montants"
            loading={loading.factures}
            loadingPreview={loading.factures_preview}
            onClick={() => telechargerCSV('factures', `DCB_Factures_Evoliz_${mois}.csv`, exportFacturesEvoliz, selectedBienIds)}
            onPreview={() => consulterCSV('factures', 'Factures Evoliz', exportFacturesEvoliz, `DCB_Factures_Evoliz_${mois}.csv`, selectedBienIds)}
          />
          <ExportCard
            titre="Comptabilité mensuelle"
            description="Vue agrégée par bien — HON/FMEN/AUTO/LOY/VIR/TAXE/COM + alertes"
            loading={loading.compta}
            loadingPreview={loading.compta_preview}
            onClick={telechargerCompta}
            onPreview={consulterCompta}
          />
          <ExportCard
            titre="Bilan étudiants (LLD)"
            description="Loyers, virements propriétaires et soldes du mois — PDF généré"
            loading={loading.bilan_lld}
            onClick={genererBilanLLD}
            format="PDF"
          />
        </div>

        <div style={{ marginTop: 14 }}>
          {!showEmailForm ? (
            <button className="btn btn-primary" onClick={() => setShowEmailForm(true)} style={{ width: '100%' }}>
              Envoyer au comptable par email
            </button>
          ) : (
            <div style={{ padding: 16, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8 }}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 4, fontSize: '0.85em', fontWeight: 600 }}>Destinataire *</label>
                <input type="email" value={emailDest} onChange={e => setEmailDest(e.target.value)}
                  placeholder="comptable@cabinet.fr"
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, boxSizing: 'border-box' }} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 4, fontSize: '0.85em', fontWeight: 600 }}>CC (optionnel)</label>
                <input type="email" value={emailCC} onChange={e => setEmailCC(e.target.value)}
                  placeholder="assistante@cabinet.fr"
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, boxSizing: 'border-box' }} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85em', fontWeight: 600 }}>Exports à joindre</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    { key: 'rapprochement', label: 'Rapprochement bancaire',    desc: 'Mouvements bancaires + ventilation comptable par réservation' },
                    { key: 'auto',          label: 'AUTO & Débours',            desc: 'Relevé de prestations par auto-entrepreneur — missions et extras par bien' },
                    { key: 'factures',      label: 'Factures Evoliz',           desc: 'Factures honoraires et débours propriétaires — HT, TTC, statut, réversement' },
                    { key: 'compta',        label: 'Comptabilité mensuelle',    desc: 'Agrégat par bien — HON, FMEN, AUTO, LOY, VIR, TAXE, COM + alertes' },
                    { key: 'achats',        label: "Factures d'achat",          desc: 'Factures fournisseurs et charges de la période' },
                    { key: 'bilan_lld',     label: 'Bilan étudiants (LLD)',     desc: 'Loyers, virements propriétaires et soldes du mois — locations longues durée' },
                  ].map(({ key, label, desc }) => (
                    <label key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
                      <input type="checkbox" checked={emailExports[key]}
                        onChange={e => setEmailExports(prev => ({ ...prev, [key]: e.target.checked }))}
                        style={{ marginTop: 3, flexShrink: 0 }} />
                      <div>
                        <div style={{ fontSize: '0.88em', fontWeight: 600, color: 'var(--text)' }}>{label}</div>
                        <div style={{ fontSize: '0.78em', color: '#9C8E7D', marginTop: 1 }}>{desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              {selectedBienIds && (
                <div style={{ marginBottom: 12, padding: '8px 10px', background: '#FFF8E7', border: '1px solid #E8C830', borderRadius: 6, fontSize: '0.82em', color: '#8B6800' }}>
                  Filtre actif : {nbSelected}/{biens.length} biens inclus dans les exports
                </div>
              )}
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 4, fontSize: '0.85em', fontWeight: 600 }}>Message (optionnel)</label>
                <textarea value={emailMessage} onChange={e => setEmailMessage(e.target.value)}
                  placeholder="Bonjour,&#10;Vous trouverez ci-joint..."
                  rows={4}
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={envoyerEmail} disabled={sendingEmail} style={{ flex: 1 }}>
                  {sendingEmail ? 'Envoi...' : 'Envoyer'}
                </button>
                <button className="btn btn-secondary" onClick={() => setShowEmailForm(false)} disabled={sendingEmail}>
                  Annuler
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* LOCATIONS LONGUES — VIREMENTS SCT */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: '1em', fontWeight: 700, color: '#9C8E7D', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 14px 0' }}>
          Locations longues — Virements SEPA
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <ExportCard
            titre="Virements propriétaires"
            description="Fichier SCT XML (pain.001.001.03) — un virement par proprio, statut à virer"
            loading={loading.sct_proprios}
            onClick={async () => {
              setLoading(prev => ({ ...prev, sct_proprios: true }))
              setError(null)
              try {
                const xml = await genererSCTVirementsProprios(mois)
                const blob = new Blob([xml], { type: 'application/xml;charset=utf-8;' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `DCB_SCT_Proprios_${mois}.xml`
                a.click()
                URL.revokeObjectURL(url)
              } catch (err) { setError(err.message) }
              finally { setLoading(prev => ({ ...prev, sct_proprios: false })) }
            }}
            format="XML"
          />
          <ExportCard
            titre="Virement honoraires DCB"
            description="Fichier SCT XML — virement des honoraires LLD du compte loyers vers compte principal"
            loading={loading.sct_honoraires}
            onClick={async () => {
              setLoading(prev => ({ ...prev, sct_honoraires: true }))
              setError(null)
              try {
                const xml = await genererSCTHonorairesDCB(mois)
                const blob = new Blob([xml], { type: 'application/xml;charset=utf-8;' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `DCB_SCT_Honoraires_${mois}.xml`
                a.click()
                URL.revokeObjectURL(url)
              } catch (err) { setError(err.message) }
              finally { setLoading(prev => ({ ...prev, sct_honoraires: false })) }
            }}
            format="XML"
          />
        </div>
      </section>

      {/* LOCATIONS COURTES — VIREMENTS SCT */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: '1em', fontWeight: 700, color: '#9C8E7D', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 14px 0' }}>
          Locations courtes — Virements SEPA
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <ExportCard
            titre="Virements propriétaires"
            description="Fichier SCT XML — 1 virement par bien (VIR = LOY + TAXE), groupe Maïté agrégé"
            loading={loading.sct_proprios_lc}
            onClick={async () => {
              setLoading(prev => ({ ...prev, sct_proprios_lc: true }))
              setError(null)
              try {
                const xml = await genererSCTVirementsPropriosLC(mois)
                const blob = new Blob([xml], { type: 'application/xml;charset=utf-8;' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `DCB_SCT_Proprios_LC_${mois}.xml`
                a.click()
                URL.revokeObjectURL(url)
              } catch (err) { setError(err.message) }
              finally { setLoading(prev => ({ ...prev, sct_proprios_lc: false })) }
            }}
            format="XML"
          />
          <ExportCard
            titre="Virements internes (HON + COM + FMEN + Stripe)"
            description="Fichier SCT XML — séquestre LC → agence (HON/COM/FMEN TTC) + agence → séquestre LC (frais Stripe)"
            loading={loading.sct_internes_lc}
            onClick={async () => {
              setLoading(prev => ({ ...prev, sct_internes_lc: true }))
              setError(null)
              try {
                const xml = await genererSCTInternesLC(mois)
                const blob = new Blob([xml], { type: 'application/xml;charset=utf-8;' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `DCB_SCT_Internes_LC_${mois}.xml`
                a.click()
                URL.revokeObjectURL(url)
              } catch (err) { setError(err.message) }
              finally { setLoading(prev => ({ ...prev, sct_internes_lc: false })) }
            }}
            format="XML"
          />
        </div>
      </section>

      {/* GESTION INTERNE */}
      <section>
        <h2 style={{ fontSize: '1em', fontWeight: 700, color: '#9C8E7D', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 14px 0' }}>
          Gestion interne
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <ExportCard
            titre="Réservations détaillées"
            description="Toutes les resas + ventilation — vue opérationnelle"
            loading={loading.resas}
            loadingPreview={loading.resas_preview}
            onClick={() => telechargerCSV('resas', `DCB_Reservations_${mois}.csv`, exportReservationsDetaillees, selectedBienIds)}
            onPreview={() => consulterCSV('resas', 'Réservations détaillées', exportReservationsDetaillees, `DCB_Reservations_${mois}.csv`, selectedBienIds)}
          />
          <ExportCard
            titre="Débours & Prestations"
            description="Prestations hors forfait + frais propriétaire (2 onglets)"
            loading={loading.debours}
            loadingPreview={loading.debours_preview}
            onClick={telechargerXLSX}
            onPreview={() => consulterCSV('debours', 'Débours & Prestations', exportDeboursPrestationsCombined, `DCB_Debours_Prestations_${mois}.csv`, selectedBienIds)}
            format="XLSX"
          />
        </div>
      </section>
    </div>
  )
}

function ExportCard({ titre, description, loading, loadingPreview, onClick, onPreview, format = 'CSV' }) {
  return (
    <div style={{
      padding: '14px 16px',
      background: 'var(--bg-card, white)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 16,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: '0.92em', color: 'var(--text)', marginBottom: 3 }}>{titre}</div>
        <div style={{ fontSize: '0.82em', color: '#9C8E7D' }}>{description}</div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
        {onPreview && (
          <button
            className="btn btn-secondary"
            onClick={onPreview}
            disabled={loadingPreview || loading}
            style={{ fontSize: '0.85em' }}
          >
            {loadingPreview ? 'Chargement...' : 'Consulter'}
          </button>
        )}
        <button
          className="btn btn-secondary"
          onClick={onClick}
          disabled={loading || loadingPreview}
          style={{ fontSize: '0.85em' }}
        >
          {loading ? 'Génération...' : `Télécharger ${format}`}
        </button>
      </div>
    </div>
  )
}
