import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { formatMontant, fetchReservationById } from '../lib/hospitable'
import { toggleOwnerStay } from '../hooks/useOwnerStay'
import { calculerVentilationResa, ajusterVentilationManuelle, reactiverVentilationAuto } from '../services/ventilation'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

const TVA_RATE = 0.20

function calcFromField(line, field, value) {
  const updated = { ...line, [field]: value }
  const isTVAZero = parseFloat(line.tva) === 0 || line.tva === '' || line.tva === '0'

  if (field === 'ttc') {
    const ttc = parseFloat(value) || 0
    if (isTVAZero) {
      updated.ht = ttc.toFixed(2)
      updated.tva = '0'
    } else {
      const ht = Math.round(ttc / 1.20 * 100) / 100
      updated.ht = ht.toFixed(2)
      updated.tva = Math.round((ttc - ht) * 100 ) / 100
    }
  } else if (field === 'ht') {
    const ht = parseFloat(value) || 0
    if (isTVAZero) {
      updated.tva = '0'
      updated.ttc = ht.toFixed(2)
    } else {
      const tva = Math.round(ht * TVA_RATE * 100) / 100
      updated.tva = tva.toFixed(2)
      updated.ttc = (ht + tva).toFixed(2)
    }
  } else if (field === 'tva') {
    const ht = parseFloat(updated.ht) || 0
    const tva = parseFloat(value) || 0
    updated.ttc = (ht + tva).toFixed(2)
  }
  return updated
}

function BoutonProprio({ resa, onDone }) {
  const [loading, setLoading] = useState(false)
  async function handleClick() {
    setLoading(true)
    try {
      await toggleOwnerStay(resa)
      if (onDone) onDone()
    } catch (e) {
      alert('Erreur : ' + e.message)
    } finally {
      setLoading(false)
    }
  }
  return (
    <button
      onClick={handleClick}
      disabled={loading}
      style={{
        fontSize: '0.8em', padding: '3px 10px', borderRadius: 5, cursor: 'pointer',
        border: '1px solid #d1d5db',
        background: resa.owner_stay ? '#f59e0b' : '#f3f4f6',
        color: resa.owner_stay ? 'white' : '#374151',
        fontWeight: resa.owner_stay ? 600 : 400,
      }}>
      {loading ? '…' : resa.owner_stay ? '🏠 Proprio ✓' : '🏠 Proprio'}
    </button>
  )
}

// Ajustement manuel « total constant » (fonctionnalité rare) : saisir les TTC des
// prestations (HON / FMEN / AUTO), le HT se recalcule (TTC/1,20), et LOY + VIR
// absorbent le delta — le total de la résa ne change JAMAIS. Pose le verrou
// ventilation_manuelle : plus aucun recalcul auto n'écrase ces montants.
function AjusterVentil({ resa, ventil, onDone, onCancel }) {
  const EDITABLE = ['HON', 'FMEN', 'AUTO', 'MEN']
  const HORS_DELTA = ['MEN']   // factuel, hors identité — n'impacte pas le LOY
  const editables = ventil.filter(v => EDITABLE.includes(v.code))
  const loy = ventil.find(v => v.code === 'LOY')
  const vir = ventil.find(v => v.code === 'VIR')
  const autres = ventil.filter(v => !EDITABLE.includes(v.code) && v.code !== 'LOY' && v.code !== 'VIR')
  const [vals, setVals] = useState(() => Object.fromEntries(editables.map(v => [v.code, ((v.montant_ttc ?? v.montant_ht ?? 0) / 100).toFixed(2)])))
  const [saving, setSaving] = useState(false)
  const parse = (x) => { const n = Math.round(parseFloat(String(x).replace(',', '.')) * 100); return isNaN(n) || n < 0 ? null : n }

  let delta = 0, invalid = false
  for (const v of editables) {
    const n = parse(vals[v.code])
    if (n === null) { invalid = true; continue }
    if (!HORS_DELTA.includes(v.code)) delta += (v.montant_ttc ?? v.montant_ht ?? 0) - n
  }
  const loyNew = (loy?.montant_ht || 0) + delta
  const fmtE = (c) => (c / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' €'

  async function save() {
    setSaving(true)
    try {
      const edits = Object.fromEntries(editables.map(v => [v.code, parse(vals[v.code])]))
      await ajusterVentilationManuelle(resa, edits)
      if (onDone) onDone()
    } catch (e) {
      alert('Erreur : ' + e.message)
    } finally { setSaving(false) }
  }

  return (
    <div style={{ borderTop: '1px solid #eee', paddingTop: 12 }}>
      <div style={{ fontWeight: 700, fontSize: '0.8em', color: '#B45309', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
        ⚖️ Ajustement manuel — total constant
      </div>
      <table style={{ width: '100%', fontSize: '0.9em' }}>
        <thead>
          <tr style={{ color: '#888', fontSize: '0.8em' }}>
            <th style={{ textAlign: 'left', paddingBottom: 6 }}>Code</th>
            <th style={{ textAlign: 'right', paddingBottom: 6 }}>HT (calculé)</th>
            <th style={{ textAlign: 'right', paddingBottom: 6 }}>TTC</th>
          </tr>
        </thead>
        <tbody>
          {editables.map(v => {
            const n = parse(vals[v.code])
            const ht = n === null ? null : (v.code === 'AUTO' || v.code === 'MEN' ? n : Math.round(n / 1.2))
            return (
              <tr key={v.code} style={{ borderTop: '1px solid #eee' }}>
                <td style={{ padding: '6px 0' }}><strong>{v.code}</strong> <span style={{ color: '#999', fontSize: '0.85em' }}>{v.libelle}{HORS_DELTA.includes(v.code) ? ' · hors total, n\'impacte pas le LOY' : ''}</span></td>
                <td style={{ textAlign: 'right', color: '#666' }}>{ht === null ? '—' : fmtE(ht)}</td>
                <td style={{ textAlign: 'right', padding: '4px 0' }}>
                  <input value={vals[v.code]} onChange={e => setVals(p => ({ ...p, [v.code]: e.target.value }))}
                    style={{ width: 100, textAlign: 'right', padding: '4px 6px', border: '1px solid ' + (parse(vals[v.code]) === null ? '#DC2626' : '#ccc'), borderRadius: 5 }} /> €
                  {v.code === 'FMEN' && (() => {
                    // Flux naturel : MEN factuel (voyageur) → AUTO réel (portail AE) → FMEN = le reste.
                    const men = parse(vals.MEN) ?? (ventil.find(x => x.code === 'MEN')?.montant_ht ?? 0)
                    const auto = parse(vals.AUTO) ?? 0
                    const suggere = Math.max(0, men - auto)
                    return men > 0 && suggere !== parse(vals[v.code]) ? (
                      <div onClick={() => setVals(p => ({ ...p, FMEN: (suggere / 100).toFixed(2) }))}
                        style={{ fontSize: '0.75em', color: '#B45309', cursor: 'pointer', textDecoration: 'underline', marginTop: 2 }}>
                        caler sur MEN − AUTO = {(suggere / 100).toFixed(2)} €
                      </div>
                    ) : null
                  })()}
                  {v.code === 'AUTO' && v.montant_reel != null && v.montant_reel !== parse(vals[v.code]) && (
                    <div onClick={() => setVals(p => ({ ...p, AUTO: (v.montant_reel / 100).toFixed(2) }))}
                      style={{ fontSize: '0.75em', color: '#B45309', cursor: 'pointer', textDecoration: 'underline', marginTop: 2 }}>
                      réel portail AE : {(v.montant_reel / 100).toFixed(2)} €
                    </div>
                  )}
                  {v.code === 'MEN' && (() => {
                    // Règle métier : MEN ≈ FMEN + AUTO (+ part ménage remontée au proprio via LOY).
                    // Raccourci : caler MEN sur FMEN + AUTO saisis.
                    const suggere = (parse(vals.FMEN) ?? 0) + (parse(vals.AUTO) ?? 0)
                    return suggere > 0 && suggere !== parse(vals[v.code]) ? (
                      <div onClick={() => setVals(p => ({ ...p, MEN: (suggere / 100).toFixed(2) }))}
                        style={{ fontSize: '0.75em', color: '#B45309', cursor: 'pointer', textDecoration: 'underline', marginTop: 2 }}>
                        caler sur FMEN + AUTO = {(suggere / 100).toFixed(2)} €
                      </div>
                    ) : null
                  })()}
                </td>
              </tr>
            )
          })}
          {loy && (
            <tr style={{ borderTop: '1px solid #eee', background: '#F0FDF4' }}>
              <td style={{ padding: '6px 0' }}><strong>LOY</strong> <span style={{ color: '#999', fontSize: '0.85em' }}>absorbe le delta</span></td>
              <td style={{ textAlign: 'right', color: loyNew < 0 ? '#DC2626' : '#15803D', fontWeight: 700 }} colSpan={2}>
                {fmtE(loy.montant_ht || 0)} → {fmtE(loyNew)} {vir ? '(VIR suit)' : ''}
              </td>
            </tr>
          )}
          {autres.map(v => (
            <tr key={v.code} style={{ borderTop: '1px solid #eee', color: '#999' }}>
              <td style={{ padding: '6px 0' }}>{v.code} <span style={{ fontSize: '0.85em' }}>{v.libelle} (inchangé)</span></td>
              <td style={{ textAlign: 'right' }} colSpan={2}>{fmtE(v.montant_ttc ?? v.montant_ht ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: '0.8em', color: loyNew < 0 ? '#DC2626' : '#15803D', marginTop: 8, fontWeight: 600 }}>
        {loyNew < 0 ? '⛔ Le reversement propriétaire deviendrait négatif' : '✓ Total de la résa inchangé — les recalculs auto seront désactivés pour cette résa'}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #ddd', background: '#fff', cursor: 'pointer' }}>Annuler</button>
        <button onClick={save} disabled={saving || invalid || loyNew < 0}
          style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: (saving || invalid || loyNew < 0) ? '#aaa' : '#B45309', color: '#fff', fontWeight: 600, cursor: (saving || invalid || loyNew < 0) ? 'not-allowed' : 'pointer' }}>
          {saving ? '…' : 'Enregistrer l\'ajustement'}
        </button>
      </div>
    </div>
  )
}

function VentilationEdit({ resa, ventil, onSaved, onCancel }) {
  const [lines, setLines] = useState(() =>
    ventil.length > 0
      ? ventil.map(v => ({
          code: v.code,
          libelle: v.libelle,
          ht: (v.montant_ht / 100).toFixed(2),
          tva: (v.montant_tva / 100).toFixed(2),
          ttc: (v.montant_ttc / 100).toFixed(2),
        }))
      : [{ code: 'HON', libelle: 'Honoraires de gestion', ht: '', tva: '', ttc: '' }]
  )
  const [saving, setSaving] = useState(false)

  function update(i, field, value) {
    setLines(l => l.map((line, idx) => idx !== i ? line : calcFromField(line, field, value)))
  }

  async function save() {
    setSaving(true)
    try {
      await supabase.from('ventilation').delete().eq('reservation_id', resa.id)
      const lignes = lines
        .filter(l => l.code && parseFloat(l.ttc) > 0)
        .map(l => ({
          reservation_id: resa.id,
          bien_id: resa.bien?.id,
          proprietaire_id: resa.bien?.proprietaire_id || null,
          code: l.code.toUpperCase(),
          libelle: l.libelle,
          montant_ht: Math.round(parseFloat(l.ht || 0) * 100),
          montant_tva: Math.round(parseFloat(l.tva || 0) * 100),
          montant_ttc: Math.round(parseFloat(l.ttc || 0) * 100),
          taux_tva: parseFloat(l.tva) > 0 ? 20 : 0,
          mois_comptable: resa.mois_comptable,
          calcul_source: 'manual',
        }))
      if (lignes.length > 0) {
        const { error } = await supabase.from('ventilation').insert(lignes)
        if (error) throw error
      }
      // Saisie libre = ajustement manuel : verrou contre les recalculs auto (migration 226)
      await supabase.from('reservation').update({ ventilation_calculee: true, ventilation_manuelle: true }).eq('id', resa.id)
      if (onSaved) onSaved(false, { id: resa.id, ventilation: lignes, ventilation_calculee: true, ventilation_manuelle: true })
    } catch (err) {
      alert('Erreur : ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ borderTop: '1px solid #eee', paddingTop: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 12, fontSize: '0.8em', color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        Ventilation manuelle
      </div>
      <table style={{ width: '100%', fontSize: '0.85em', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: '#888', fontSize: '0.8em' }}>
            <th style={{ textAlign: 'left', paddingBottom: 6, width: 70 }}>Code</th>
            <th style={{ textAlign: 'left', paddingBottom: 6 }}>Libellé</th>
            <th style={{ textAlign: 'right', paddingBottom: 6, width: 75 }}>HT €</th>
            <th style={{ textAlign: 'right', paddingBottom: 6, width: 65 }}>TVA €</th>
            <th style={{ textAlign: 'right', paddingBottom: 6, width: 75 }}>TTC €</th>
            <th style={{ width: 24 }}></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr key={i} style={{ borderTop: '1px solid #f0f0f0' }}>
              <td style={{ padding: '4px 4px 4px 0' }}>
                <select value={line.code} onChange={e => update(i, 'code', e.target.value)}
                  style={{ width: '100%', fontSize: '0.85em', padding: 3, border: '1px solid #ddd', borderRadius: 4 }}>
                  {['HON','FMEN','AUTO','LOY','TAXE','VIR','DIV'].map(c => <option key={c}>{c}</option>)}
                </select>
              </td>
              <td style={{ padding: 4 }}>
                <input value={line.libelle} onChange={e => update(i, 'libelle', e.target.value)}
                  style={{ width: '100%', fontSize: '0.85em', padding: 3, border: '1px solid #ddd', borderRadius: 4 }} />
              </td>
              {['ht', 'tva', 'ttc'].map(f => (
                <td key={f} style={{ padding: 4 }}>
                  <input type="number" step="0.01" value={line[f]} onChange={e => update(i, f, e.target.value)}
                    style={{ width: '100%', fontSize: '0.85em', padding: 3, border: '1px solid #ddd', borderRadius: 4, textAlign: 'right', fontWeight: f === 'ttc' ? 600 : 400 }} />
                </td>
              ))}
              <td style={{ padding: '4px 0 4px 4px' }}>
                <button onClick={() => setLines(l => l.filter((_, idx) => idx !== i))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: '1em', padding: '0 2px' }}>×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button onClick={() => setLines(l => [...l, { code: 'LOY', libelle: 'Reversement propriétaire', ht: '', tva: '', ttc: '' }])}
          style={{ fontSize: '0.85em', padding: '5px 12px', background: '#f5f5f5', border: '1px solid #ddd', borderRadius: 6, cursor: 'pointer' }}>
          + Ligne
        </button>
        <button onClick={save} disabled={saving}
          style={{ fontSize: '0.85em', padding: '5px 16px', background: 'var(--brand)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
          {saving ? 'Enregistrement…' : '✓ Enregistrer'}
        </button>
        <button onClick={onCancel}
          style={{ fontSize: '0.85em', padding: '5px 12px', background: '#f5f5f5', border: '1px solid #ddd', borderRadius: 6, cursor: 'pointer', marginLeft: 'auto' }}>
          Annuler
        </button>
      </div>
    </div>
  )
}

function EncaissementsRecap({ virements, finRevenue }) {
  if (!virements?.length && !finRevenue) return null
  const totalEncaisse = virements.reduce((s, v) => s + (v.montant || 0), 0)
  const ecart = finRevenue ? totalEncaisse - finRevenue : 0
  const hasEcart = Math.abs(ecart) > 2

  return (
    <div style={{ marginTop: 14, borderTop: '1px solid #eee', paddingTop: 14 }}>
      <div style={{ fontWeight: 700, fontSize: '0.78em', color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
        Virements reçus
      </div>
      {virements.length === 0 ? (
        <div style={{ color: '#9CA3AF', fontSize: '0.88em', fontStyle: 'italic' }}>Aucun virement bancaire lié</div>
      ) : (
        <table style={{ width: '100%', fontSize: '0.88em', borderCollapse: 'collapse' }}>
          <tbody>
            {virements.map((v, i) => (
              <tr key={i} style={{ borderTop: i > 0 ? '1px solid #f0f0f0' : 'none' }}>
                <td style={{ padding: '4px 0', color: '#666', whiteSpace: 'nowrap' }}>
                  {v.date ? new Date(v.date).toLocaleDateString('fr-FR') : '—'}
                </td>
                <td style={{ padding: '4px 8px', color: '#555', fontSize: '0.9em', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>
                  {v.libelle || '—'}
                </td>
                <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {((v.montant || 0) / 100).toFixed(2)} €
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid #e5e7eb' }}>
              <td colSpan={2} style={{ padding: '5px 0', fontWeight: 700, fontSize: '0.9em' }}>Total encaissé</td>
              <td style={{ padding: '5px 0', textAlign: 'right', fontWeight: 700 }}>{(totalEncaisse / 100).toFixed(2)} €</td>
            </tr>
            {finRevenue > 0 && (
              <tr>
                <td colSpan={2} style={{ padding: '2px 0', color: '#888', fontSize: '0.85em' }}>Revenue attendu</td>
                <td style={{ padding: '2px 0', textAlign: 'right', color: '#888', fontSize: '0.85em' }}>{(finRevenue / 100).toFixed(2)} €</td>
              </tr>
            )}
            {finRevenue > 0 && ecart < -2 && (
              <tr>
                <td colSpan={2} style={{ padding: '4px 0', color: '#D97706', fontWeight: 700, fontSize: '0.9em' }}>Solde à recevoir</td>
                <td style={{ padding: '4px 0', textAlign: 'right', color: '#D97706', fontWeight: 700, fontSize: '0.9em' }}>{(Math.abs(ecart) / 100).toFixed(2)} €</td>
              </tr>
            )}
            {hasEcart && ecart > 0 && (
              <tr>
                <td colSpan={3} style={{ padding: '6px 8px', background: '#FEF2F2', borderRadius: 6, color: '#DC2626', fontWeight: 700, fontSize: '0.88em' }}>
                  Trop perçu : +{(ecart / 100).toFixed(2)} €
                </td>
              </tr>
            )}
          </tfoot>
        </table>
      )}
    </div>
  )
}

export default function ModalResa({ resa, onClose, onSaved }) {
  if (!resa) return null
  const ventil = resa.ventilation || []
  const isManual = resa.platform === 'manual' || (resa.final_status === 'cancelled' && (resa.platform === 'direct' || resa.platform === 'manual'))
  const [editing, setEditing] = useState(false)
  const [adjusting, setAdjusting] = useState(false)
  const [modeVentil, setModeVentil] = useState('normal')
  const [ventilating, setVentilating] = useState(false)
  const [virements, setVirements] = useState([])
  const [paiementsContrat, setPaiementsContrat] = useState([])
  const [editingRevenu, setEditingRevenu] = useState(false)
  const [revenuVal, setRevenuVal] = useState('')
  const [savingRevenu, setSavingRevenu] = useState(false)

  useEffect(() => {
    if (!resa?.code) return
    supabase.from('paiement_contrat').select('*').eq('reservation_id', resa.code).order('date_paiement', { ascending: true })
      .then(({ data }) => setPaiementsContrat(data || []))
  }, [resa?.code])

  useEffect(() => {
    if (!resa?.id) return
    async function fetchVirements() {
      const seen = new Map() // mouvement_id → virement
      // Chemin 1 : reservation_paiement → mouvement_bancaire
      const { data: rp } = await supabase
        .from('reservation_paiement')
        .select('montant, type_paiement, description_paiement, date_paiement, mouvement_id, mouvement_bancaire(id, date_operation, libelle, credit, canal)')
        .eq('reservation_id', resa.id)
      for (const p of rp || []) {
        const mb = p.mouvement_bancaire
        const key = mb?.id || ('rp_' + p.date_paiement)
        if (!seen.has(key)) seen.set(key, {
          mouvement_id: mb?.id || null,
          date: mb?.date_operation || p.date_paiement,
          libelle: mb?.libelle || p.description_paiement || '—',
          montant: mb?.credit || p.montant,
          canal: mb?.canal || null,
          type_paiement: p.type_paiement,
        })
      }
      // Chemin 2 : payout_reservation → payout_hospitable → mouvement_bancaire
      const { data: pr } = await supabase
        .from('payout_reservation')
        .select('payout_hospitable(id, amount, date_payout, mouvement_id, mouvement_bancaire(id, date_operation, libelle, credit, canal))')
        .eq('reservation_id', resa.id)
      for (const row of pr || []) {
        const ph = row.payout_hospitable
        if (!ph?.mouvement_id) continue
        const mb = ph.mouvement_bancaire
        const key = mb?.id || ph.mouvement_id
        if (!seen.has(key)) seen.set(key, {
          mouvement_id: mb?.id || ph.mouvement_id,
          date: mb?.date_operation || ph.date_payout,
          libelle: mb?.libelle || '—',
          montant: mb?.credit || ph.amount,
          canal: mb?.canal || 'airbnb',
          type_paiement: 'total',
        })
      }
      // Chemin 3 : ventilation.mouvement_id → mouvement_bancaire (manual, direct)
      const { data: vents } = await supabase
        .from('ventilation')
        .select('mouvement_id, mouvement_bancaire(id, date_operation, libelle, credit, canal)')
        .eq('reservation_id', resa.id)
        .not('mouvement_id', 'is', null)
      for (const v of vents || []) {
        const mb = v.mouvement_bancaire
        if (!mb?.id) continue
        if (!seen.has(mb.id)) seen.set(mb.id, {
          mouvement_id: mb.id,
          date: mb.date_operation,
          libelle: mb.libelle || '—',
          montant: mb.credit,
          canal: mb.canal || null,
          type_paiement: 'total',
        })
      }
      setVirements([...seen.values()].sort((a, b) => (a.date || '').localeCompare(b.date || '')))
    }
    fetchVirements()
  }, [resa?.id])

  async function saveRevenu() {
    setSavingRevenu(true)
    try {
      const newVal = Math.round(parseFloat(revenuVal.replace(',', '.')) * 100)
      const { error: delErr } = await supabase.from('ventilation').delete().eq('reservation_id', resa.id)
      if (delErr) throw delErr
      const { data: updData, error: updErr } = await supabase.from('reservation').update({ fin_revenue: newVal, ventilation_calculee: false }).eq('id', resa.id).select('id, fin_revenue')
      if (updErr) throw updErr
      if (!updData || updData.length === 0) throw new Error(`Aucune ligne modifiée — vérifier RLS sur table reservation (id: ${resa.id})`)
      setEditingRevenu(false)
      if (onSaved) onSaved(false, { id: resa.id, fin_revenue: newVal, ventilation: [], ventilation_calculee: false })
    } catch (e) {
      alert('Erreur : ' + e.message)
    } finally {
      setSavingRevenu(false)
    }
  }

  function handleProprio() {
    onClose()
    if (onSaved) setTimeout(() => onSaved(true), 100)
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <div
        style={{ background: '#ffffff', color: '#1a1a2e', borderRadius: 12, padding: 28, minWidth: 500, maxWidth: 620, maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: '#1a1a2e' }}>{resa.bien?.hospitable_name || resa.bien?.code || '—'}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#666' }}>×</button>
        </div>

        {/* Prolongation */}
        {resa.isProlongation && (
          <div style={{ marginBottom: 14, padding: '8px 14px', background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 8, fontSize: '0.88em', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '1.1em' }}>↗</span>
            <span style={{ color: '#78350F' }}>
              <strong>Prolongation de séjour</strong>
              {resa.originalResaCode && <> — ménage rattaché à <span className="mono" style={{ fontWeight: 700 }}>{resa.originalResaCode}</span></>}
              {!resa.originalResaCode && <> — ménage rattaché à la résa originale</>}
            </span>
          </div>
        )}

        {/* Infos */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16, fontSize: '0.9em' }}>
          {[
            ['Code', <strong className="mono">{resa.code}</strong>],
            ['Plateforme', <span className={`badge badge-${resa.platform}`}>{resa.platform}</span>],
            ['Check-in', <strong>{resa.arrival_date ? format(new Date(resa.arrival_date), 'd MMM yyyy', { locale: fr }) : '—'}</strong>],
            ['Nuits', <strong>{resa.nights}</strong>],
            ['Voyageur', <strong>{resa.guest_name || '—'}</strong>],
            ['Statut réservation', resa.final_status === 'cancelled'
              ? <span style={{ color: '#dc2626', fontWeight: 700 }}>
                  ⚠ Annulée{resa.fin_revenue > 0 ? <span style={{ fontWeight: 400, fontSize: '0.85em', marginLeft: 6 }}>— frais perçus</span> : null}
                </span>
              : <span style={{ color: '#16a34a', fontWeight: 700 }}>✓ Confirmée</span>],
            ['Revenue net', isManual ? (
              editingRevenu
                ? <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                    <input type="number" step="0.01" value={revenuVal} onChange={e => setRevenuVal(e.target.value)}
                      autoFocus onKeyDown={e => { if (e.key === 'Enter') saveRevenu(); if (e.key === 'Escape') setEditingRevenu(false) }}
                      style={{ width: 80, padding: '2px 6px', border: '1px solid #CC9933', borderRadius: 4, fontSize: '0.95em', fontWeight: 600 }} />
                    <button onClick={saveRevenu} disabled={savingRevenu}
                      style={{ fontSize: '0.75em', padding: '2px 8px', background: 'var(--brand)', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                      {savingRevenu ? '…' : '✓'}
                    </button>
                    <button onClick={() => setEditingRevenu(false)}
                      style={{ fontSize: '0.75em', padding: '2px 6px', background: '#f5f5f5', border: '1px solid #ddd', borderRadius: 4, cursor: 'pointer' }}>
                      ✕
                    </button>
                  </span>
                : <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    <strong>{resa.fin_revenue ? formatMontant(resa.fin_revenue) : '—'}</strong>
                    <button onClick={() => { setRevenuVal(((resa.fin_revenue || 0) / 100).toFixed(2)); setEditingRevenu(true) }}
                      style={{ fontSize: '0.7em', padding: '1px 6px', background: '#f5f5f5', border: '1px solid #ddd', borderRadius: 4, cursor: 'pointer', color: '#666' }}>
                      ✏️
                    </button>
                  </span>
            ) : <strong>{resa.fin_revenue ? formatMontant(resa.fin_revenue) : '—'}</strong>],
          ].map(([label, val]) => (
            <div key={label}>
              <span style={{ color: '#888', fontSize: '0.8em', textTransform: 'uppercase' }}>{label}</span>
              <br />{val}
            </div>
          ))}
        </div>

        {/* Alerte ménage manquant — owner_stay sans FMEN */}
        {resa.owner_stay && resa.platform === 'manual' && !ventil.some(v => v.code === 'FMEN') && (
          <div style={{ margin: '12px 0', padding: '10px 14px', background: '#FFF7ED', border: '1px solid #FCD34D', borderRadius: 8, fontSize: '0.88em' }}>
            <span style={{ fontWeight: 700, color: '#92400E' }}>⚠ Ménage non saisi</span>
            <span style={{ color: '#78350F', marginLeft: 8 }}>
              Séjour proprio — saisir le montant ménage réel depuis Hospitable (créance propriétaire).
            </span>
          </div>
        )}

        {/* Ventilation */}
        {isManual && editing ? (
          <VentilationEdit
            resa={resa}
            ventil={ventil}
            onSaved={() => { setEditing(false); if (onSaved) onSaved() }}
            onCancel={() => setEditing(false)}
          />
        ) : ventil.length > 0 ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #eee', paddingTop: 16, marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: '0.8em', color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Ventilation{resa.ventilation_manuelle ? ' · ✋ ajustée manuellement' : ''}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {!adjusting && ventil.some(v => ['LOY', 'MEN', 'FMEN', 'HON', 'AUTO'].includes(v.code)) && (
                  <button onClick={() => setAdjusting(true)}
                    title="Ajuster les prestations (TTC) à total constant — LOY absorbe le delta"
                    style={{ fontSize: '0.8em', padding: '3px 10px', background: '#FFF7ED', border: '1px solid #FDBA74', borderRadius: 5, cursor: 'pointer', color: '#B45309' }}>
                    ⚖️ Ajuster
                  </button>
                )}
                {resa.ventilation_manuelle && (
                  <button onClick={async () => {
                    if (!window.confirm('Réactiver le calcul automatique ?\n\nLa ventilation sera recalculée immédiatement et vos ajustements manuels seront remplacés.')) return
                    try {
                      await reactiverVentilationAuto(resa.id)
                      await calculerVentilationResa({ ...resa, ventilation_manuelle: false })
                      if (onSaved) onSaved()
                    } catch (e) { alert('Erreur : ' + e.message) }
                  }}
                    style={{ fontSize: '0.8em', padding: '3px 10px', background: '#f5f5f5', border: '1px solid #ddd', borderRadius: 5, cursor: 'pointer' }}>
                    ↺ Réactiver le calcul auto
                  </button>
                )}
                {isManual && (
                  <>
                    <button onClick={() => setEditing(true)}
                      style={{ fontSize: '0.8em', padding: '3px 10px', background: '#f5f5f5', border: '1px solid #ddd', borderRadius: 5, cursor: 'pointer' }}>
                      ✏️ Modifier
                    </button>
                    <BoutonProprio resa={resa} onDone={handleProprio} />
                  </>
                )}
              </div>
            </div>
            {adjusting ? (
              <AjusterVentil resa={resa} ventil={ventil}
                onDone={() => { setAdjusting(false); if (onSaved) onSaved() }}
                onCancel={() => setAdjusting(false)} />
            ) : null}
            {!adjusting && (
            <table style={{ width: '100%', fontSize: '0.9em' }}>
              <thead>
                <tr style={{ color: '#888', fontSize: '0.8em' }}>
                  {['Code', 'Libellé', 'HT', 'TVA', 'TTC'].map(h => (
                    <th key={h} style={{ textAlign: h === 'Code' || h === 'Libellé' ? 'left' : 'right', paddingBottom: 6 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ventil.map((v, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #eee' }}>
                    <td style={{ padding: '6px 0' }}><strong>{v.code}</strong></td>
                    <td style={{ padding: '6px 8px', color: '#555' }}>{v.libelle}</td>
                    <td style={{ textAlign: 'right', padding: '6px 0' }}>{formatMontant(v.montant_ht)}</td>
                    <td style={{ textAlign: 'right', padding: '6px 0', color: '#999' }}>{v.montant_tva > 0 ? formatMontant(v.montant_tva) : '—'}</td>
                    <td style={{ textAlign: 'right', padding: '6px 0' }}><strong>{formatMontant(v.montant_ttc)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
          </>
        ) : (
          <div style={{ borderTop: '1px solid #eee', paddingTop: 16 }}>
            {isManual ? (
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.8em', color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                  Mode de ventilation
                </div>
                {[
                  { val: 'normal', label: 'Ventilation normale', desc: 'HON + FMEN + AUTO + LOY calculés automatiquement' },
                  { val: 'proprio', label: 'Séjour propriétaire', desc: 'Marquer comme séjour propriétaire — saisir FMEN manuellement (déduit du LOY ou facturé séparément)' },
                  { val: 'manuel', label: 'Manuel', desc: 'Saisie libre des montants' },
                ].map(opt => (
                  <label key={opt.val} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
                    <input type="radio" name="modeVentil" value={opt.val}
                      checked={modeVentil === opt.val} onChange={() => setModeVentil(opt.val)}
                      style={{ marginTop: 3 }} />
                    <span>
                      <span style={{ fontWeight: 600, fontSize: '0.9em' }}>{opt.label}</span>
                      <span style={{ display: 'block', fontSize: '0.8em', color: '#888' }}>{opt.desc}</span>
                    </span>
                  </label>
                ))}
                <button
                  disabled={ventilating}
                  onClick={async () => {
                    if (modeVentil === 'manuel') { setEditing(true); return }
                    setVentilating(true)
                    try {
                      let resaToVentil = { ...resa, owner_stay: modeVentil === 'proprio' ? true : resa.owner_stay }
                      if (modeVentil === 'proprio') {
                        await supabase.from('reservation').update({ owner_stay: true }).eq('id', resa.id)
                        // Si fin_revenue manquant, chercher le cleaning fee dans cet ordre :
                        // 1. hospitable_raw déjà en DB (zéro appel API)
                        // 2. API Hospitable individuelle (fonctionne en prod)
                        // 3. bien.forfait_menage_proprio (valeur de référence)
                        if (!resaToVentil.fin_revenue) {
                          const rawFee = (resa.hospitable_raw?.financials?.guest?.fees || [])
                            .find(f => f.label?.toLowerCase().includes('cleaning'))?.amount
                          let cleaningFee = rawFee
                          if (!cleaningFee) {
                            try {
                              const resaHosp = await fetchReservationById(resa.hospitable_id, { include: 'financials' })
                              cleaningFee = (resaHosp?.financials?.guest?.fees || [])
                                .find(f => f.label?.toLowerCase().includes('cleaning'))?.amount
                            } catch (_) {}
                          }
                          if (!cleaningFee) {
                            const { data: bienData } = await supabase.from('bien').select('forfait_menage_proprio').eq('id', resa.bien_id).single()
                            cleaningFee = bienData?.forfait_menage_proprio || null
                          }
                          if (cleaningFee) {
                            await supabase.from('reservation').update({ fin_revenue: cleaningFee }).eq('id', resa.id)
                            resaToVentil = { ...resaToVentil, fin_revenue: cleaningFee }
                          }
                        }
                      }
                      await calculerVentilationResa(resaToVentil)
                      if (onSaved) onSaved()
                    } catch (e) {
                      alert('Erreur : ' + e.message)
                    } finally {
                      setVentilating(false)
                    }
                  }}
                  style={{ marginTop: 6, fontSize: '0.85em', padding: '6px 18px', background: 'var(--brand)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                  {ventilating ? 'Calcul…' : '⚡ Appliquer'}
                </button>
              </div>
            ) : (
              <div style={{ color: '#999', fontSize: '0.9em', fontStyle: 'italic' }}>Pas encore ventilée.</div>
            )}
          </div>
        )}
        <EncaissementsRecap virements={virements} finRevenue={resa.fin_revenue} />

        {/* Paiements contrat DCB (Stripe) */}
        {paiementsContrat.length > 0 && (
          <div style={{ marginTop: 14, borderTop: '1px solid #eee', paddingTop: 14 }}>
            <div style={{ fontWeight: 700, fontSize: '0.78em', color: '#CC9933', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              💳 Paiements contrat reçus
            </div>
            <table style={{ width: '100%', fontSize: '0.88em', borderCollapse: 'collapse' }}>
              <tbody>
                {paiementsContrat.map(p => (
                  <tr key={p.id} style={{ borderTop: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '4px 0', color: '#666', whiteSpace: 'nowrap' }}>
                      {p.date_paiement ? new Date(p.date_paiement).toLocaleDateString('fr-FR') : '—'}
                    </td>
                    <td style={{ padding: '4px 8px', color: '#555', fontSize: '0.9em' }}>
                      <span style={{ background: p.type === 'acompte' ? '#FEF3C7' : '#DCFCE7', color: p.type === 'acompte' ? '#92400E' : '#166534', borderRadius: 4, padding: '1px 6px', fontWeight: 600, fontSize: '0.85em' }}>
                        {p.type}
                      </span>
                      {p.stripe_payment_intent_id && (
                        <span style={{ marginLeft: 6, color: '#9CA3AF', fontSize: '0.8em', fontFamily: 'monospace' }}>
                          {p.stripe_payment_intent_id.slice(0, 20)}…
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: 600, color: '#166534', whiteSpace: 'nowrap' }}>
                      +{((p.montant_cts || 0) / 100).toFixed(2)} €
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid #D9CEB8' }}>
                  <td colSpan={2} style={{ padding: '5px 0', fontWeight: 700, fontSize: '0.9em', color: '#CC9933' }}>Total contrat encaissé</td>
                  <td style={{ padding: '5px 0', textAlign: 'right', fontWeight: 700, color: '#CC9933' }}>
                    {(paiementsContrat.reduce((s, p) => s + (p.montant_cts || 0), 0) / 100).toFixed(2)} €
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
