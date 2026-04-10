import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { formatMontant } from '../lib/hospitable'
import { toggleOwnerStay } from '../hooks/useOwnerStay'
import { calculerVentilationResa } from '../services/ventilation'
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
      await supabase.from('reservation').update({ ventilation_calculee: true }).eq('id', resa.id)
      if (onSaved) onSaved(false, { id: resa.id, ventilation: lignes, ventilation_calculee: true })
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

export default function ModalResa({ resa, onClose, onSaved }) {
  if (!resa) return null
  const ventil = resa.ventilation || []
  const isManual = resa.platform === 'manual'
  const [editing, setEditing] = useState(false)
  const [modeVentil, setModeVentil] = useState('normal')
  const [ventilating, setVentilating] = useState(false)
  const [paiementsInfo, setPaiementsInfo] = useState([])
  const [editingRevenu, setEditingRevenu] = useState(false)
  const [revenuVal, setRevenuVal] = useState('')
  const [savingRevenu, setSavingRevenu] = useState(false)
  useEffect(() => {
    if (!resa?.id) return
    supabase.from('reservation_paiement')
      .select('montant, type_paiement, description_paiement, date_paiement, mouvement_id')
      .eq('reservation_id', resa.id)
      .then(({ data }) => setPaiementsInfo(data || []))
  }, [resa?.id])

  async function saveRevenu() {
    setSavingRevenu(true)
    try {
      const newVal = Math.round(parseFloat(revenuVal.replace(',', '.')) * 100)
      const { error: delErr } = await supabase.from('ventilation').delete().eq('reservation_id', resa.id)
      if (delErr) throw delErr
      const { error: updErr } = await supabase.from('reservation').update({ fin_revenue: newVal, ventilation_calculee: false }).eq('id', resa.id)
      if (updErr) throw updErr
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

        {/* Infos */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16, fontSize: '0.9em' }}>
          {[
            ['Code', <strong className="mono">{resa.code}</strong>],
            ['Plateforme', <span className={`badge badge-${resa.platform}`}>{resa.platform}</span>],
            ['Check-in', <strong>{resa.arrival_date ? format(new Date(resa.arrival_date), 'd MMM yyyy', { locale: fr }) : '—'}</strong>],
            ['Nuits', <strong>{resa.nights}</strong>],
            ['Voyageur', <strong>{resa.guest_name || '—'}</strong>],
            ['Statut réservation', resa.final_status === 'cancelled'
              ? <span style={{ color: '#dc2626', fontWeight: 700 }}>⚠ Annulée</span>
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
              <div style={{ fontWeight: 700, fontSize: '0.8em', color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Ventilation</div>
              {isManual && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setEditing(true)}
                    style={{ fontSize: '0.8em', padding: '3px 10px', background: '#f5f5f5', border: '1px solid #ddd', borderRadius: 5, cursor: 'pointer' }}>
                    ✏️ Modifier
                  </button>
                  <BoutonProprio resa={resa} onDone={handleProprio} />
                </div>
              )}
            </div>
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
            {paiementsInfo.length > 0 && (
              <div style={{ marginTop: 12, padding: '10px 12px', background: '#FFFBEB', borderRadius: 8, border: '1px solid #FCD34D', fontSize: '0.85em' }}>
                <div style={{ fontWeight: 700, color: '#92400E', marginBottom: 6, textTransform: 'uppercase', fontSize: '0.75em', letterSpacing: '0.05em' }}>
                  💳 Paiements reçus voyageur
                </div>
                {paiementsInfo.map((p, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderTop: i > 0 ? '1px solid #FDE68A' : 'none' }}>
                    <div>
                      <span style={{ fontWeight: 600, color: '#D97706', marginRight: 8 }}>
                        {p.type_paiement === 'acompte' ? 'Acompte' : p.type_paiement === 'solde' ? 'Solde' : 'Total'}
                      </span>
                      {p.description_paiement && <span style={{ color: '#78350F', fontSize: '0.9em' }}>{p.description_paiement}</span>}
                    </div>
                    <strong style={{ color: '#92400E' }}>
                      {p.date_paiement ? new Date(p.date_paiement).toLocaleDateString('fr-FR') : ''} — {(p.montant/100).toFixed(2)} €
                    </strong>
                  </div>
                ))}
              </div>
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
                      if (modeVentil === 'proprio') await supabase.from('reservation').update({ owner_stay: true }).eq('id', resa.id)
                      await calculerVentilationResa({ ...resa, owner_stay: modeVentil === 'proprio' ? true : resa.owner_stay })
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
      </div>
    </div>
  )
}
