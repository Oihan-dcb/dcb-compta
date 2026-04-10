import { useState, useEffect, useCallback } from 'react'
import MoisSelector, { MOIS_FR } from '../components/MoisSelector'
import { useMoisPersisted } from '../hooks/useMoisPersisted'
import { supabase } from '../lib/supabase'
import { buildComptaMensuelle, exportComptaCSV } from '../services/buildComptaMensuelle'

const moisCourant = new Date().toISOString().slice(0, 7)
const fmt = c => c != null ? ((c / 100).toFixed(2).replace('.', ',') + ' €') : '—'
const fmtN = c => c != null ? ((c / 100).toFixed(2).replace('.', ',')) : '—'

const LEVEL_COLOR  = { error: '#ef4444', warning: '#f59e0b', info: '#6b7280' }
const LEVEL_BG     = { error: '#FEF2F2', warning: '#FFFBEB', info: '#F9FAFB' }
const LEVEL_ICON   = { error: '❌', warning: '⚠️', info: 'ℹ️' }

function StatCard({ label, value, sub }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', minWidth: 130 }}>
      <div style={{ fontSize: '0.75em', color: '#9C8E7D', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: '1.25em', fontWeight: 700, color: 'var(--text)' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.75em', color: '#9C8E7D', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function AlertBadge({ level, count }) {
  if (!count) return null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 7px', borderRadius: 10, fontSize: '0.72em', fontWeight: 700, background: LEVEL_BG[level], color: LEVEL_COLOR[level], border: `1px solid ${LEVEL_COLOR[level]}33` }}>
      {LEVEL_ICON[level]} {count}
    </span>
  )
}

export default function PageComptabilite() {
  const [mois, setMois] = useMoisPersisted()
  const [moisDispos, setMoisDispos] = useState([moisCourant])
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Filtres
  const [filterProprio, setFilterProprio] = useState('')
  const [filterStatutFacture, setFilterStatutFacture] = useState('')
  const [filterAlertsOnly, setFilterAlertsOnly] = useState(false)

  // Chargement mois dispos
  useEffect(() => {
    supabase.from('reservation').select('mois_comptable').eq('agence', 'dcb').not('mois_comptable', 'is', null)
      .then(({ data: d }) => {
        if (!d) return
        const set = [...new Set(d.map(r => r.mois_comptable))].sort((a, b) => b.localeCompare(a))
        if (!set.includes(moisCourant)) set.unshift(moisCourant)
        setMoisDispos(set)
      })
  }, [])

  const charger = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await buildComptaMensuelle(mois)
      setData(result)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [mois])

  useEffect(() => { charger() }, [charger])

  // Liste des propriétaires uniques pour le filtre
  const proprietaires = data
    ? [...new Map(data.rows.filter(r => r.proprietaire_id).map(r => [r.proprietaire_id, r.proprietaire_nom])).entries()]
        .map(([id, nom]) => ({ id, nom })).sort((a, b) => a.nom.localeCompare(b.nom))
    : []

  // Statuts de facture uniques
  const statutsFacture = data
    ? [...new Set(data.rows.map(r => r.facture_statut).filter(Boolean))].sort()
    : []

  // Rows filtrées
  const rowsFiltrees = data ? data.rows.filter(r => {
    if (filterProprio && r.proprietaire_id !== filterProprio) return false
    if (filterStatutFacture) {
      if (filterStatutFacture === '__none__' && r.facture_statut) return false
      if (filterStatutFacture !== '__none__' && r.facture_statut !== filterStatutFacture) return false
    }
    if (filterAlertsOnly && r.alert_count === 0) return false
    return true
  }) : []

  const [year, monthIdx] = mois.split('-')
  const moisLabel = `${MOIS_FR[parseInt(monthIdx) - 1]} ${year}`

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1400, margin: '0 auto' }}>
      {/* En-tête */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.4em', fontWeight: 700, color: 'var(--text)' }}>Comptabilité</h1>
          <div style={{ fontSize: '0.82em', color: '#9C8E7D', marginTop: 2 }}>Vue d'ensemble mensuelle — tous biens</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <MoisSelector mois={mois} setMois={setMois} moisDispos={moisDispos} />
          <button className="btn btn-secondary" onClick={charger} disabled={loading} style={{ padding: '6px 14px' }}>
            {loading ? '…' : '↺'}
          </button>
          {data && (
            <button className="btn btn-secondary" onClick={() => exportComptaCSV(data)} style={{ padding: '6px 14px', fontSize: '0.85em' }}>
              ⬇ CSV
            </button>
          )}
        </div>
      </div>

      {/* Erreur */}
      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '12px 16px', color: '#DC2626', marginBottom: 20 }}>
          {error}
        </div>
      )}

      {/* Alertes globales */}
      {data && data.alerts.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          {['error', 'warning'].map(level => {
            const levelAlerts = data.alerts.filter(a => a.level === level)
            if (!levelAlerts.length) return null
            return (
              <div key={level} style={{ background: LEVEL_BG[level], border: `1px solid ${LEVEL_COLOR[level]}55`, borderRadius: 8, padding: '10px 14px', marginBottom: 8 }}>
                <div style={{ fontWeight: 700, color: LEVEL_COLOR[level], fontSize: '0.85em', marginBottom: 6 }}>
                  {LEVEL_ICON[level]} {level === 'error' ? 'Erreurs bloquantes' : 'Avertissements'} ({levelAlerts.length})
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {levelAlerts.map((a, i) => (
                    <span key={i} style={{ fontSize: '0.8em', background: 'rgba(255,255,255,0.6)', border: `1px solid ${LEVEL_COLOR[level]}44`, borderRadius: 6, padding: '2px 8px', color: 'var(--text)' }}>
                      {a.message}
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Cartes stats */}
      {data && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
          <StatCard label="Biens actifs" value={data.metadata.nb_rows} sub={`${data.metadata.nb_biens} total`} />
          <StatCard label="HON TTC" value={fmt(data.totals.hon_ttc)} sub={`HT ${fmt(data.totals.hon_ht)}`} />
          <StatCard label="FMEN TTC" value={fmt(data.totals.fmen_ttc)} sub={`HT ${fmt(data.totals.fmen_ht)}`} />
          <StatCard label="AUTO HT" value={fmt(data.totals.auto_ht)} />
          <StatCard label="LOY HT" value={fmt(data.totals.loy_ht)} />
          <StatCard label="VIR HT" value={fmt(data.totals.vir_ht)} />
          <StatCard label="TAXE HT" value={fmt(data.totals.taxe_ht)} />
          <StatCard label="Réservations" value={data.totals.nb_resas} sub={`${data.totals.nb_rapprochees} rappr. · ${data.totals.nb_non_rapprochees} non rappr.`} />
        </div>
      )}

      {/* Filtres */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
        <select value={filterProprio} onChange={e => setFilterProprio(e.target.value)}
          style={{ padding: '6px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text)', fontSize: '0.85em' }}>
          <option value="">Tous propriétaires</option>
          {proprietaires.map(p => <option key={p.id} value={p.id}>{p.nom}</option>)}
        </select>
        <select value={filterStatutFacture} onChange={e => setFilterStatutFacture(e.target.value)}
          style={{ padding: '6px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text)', fontSize: '0.85em' }}>
          <option value="">Tous statuts facture</option>
          <option value="__none__">Sans facture</option>
          {statutsFacture.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85em', cursor: 'pointer', color: 'var(--text)' }}>
          <input type="checkbox" checked={filterAlertsOnly} onChange={e => setFilterAlertsOnly(e.target.checked)} />
          Alertes seulement
        </label>
        {(filterProprio || filterStatutFacture || filterAlertsOnly) && (
          <button className="btn btn-secondary" onClick={() => { setFilterProprio(''); setFilterStatutFacture(''); setFilterAlertsOnly(false) }}
            style={{ fontSize: '0.8em', padding: '4px 10px' }}>
            ✕ Réinitialiser
          </button>
        )}
        {data && <span style={{ marginLeft: 'auto', fontSize: '0.8em', color: '#9C8E7D' }}>{rowsFiltrees.length} bien(s)</span>}
      </div>

      {/* Tableau */}
      {loading && !data && (
        <div style={{ textAlign: 'center', padding: 40, color: '#9C8E7D' }}>Chargement…</div>
      )}

      {data && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82em' }}>
            <thead>
              <tr style={{ background: 'var(--bg)', borderBottom: '2px solid var(--border)' }}>
                <th style={th}>Bien</th>
                <th style={th}>Propriétaire</th>
                <th style={{ ...th, textAlign: 'right' }}>Resas</th>
                <th style={{ ...th, textAlign: 'right' }}>Rappr.</th>
                <th style={{ ...th, textAlign: 'right' }}>Non vent.</th>
                <th style={{ ...th, textAlign: 'right' }}>HON HT</th>
                <th style={{ ...th, textAlign: 'right' }}>HON TTC</th>
                <th style={{ ...th, textAlign: 'right' }}>FMEN HT</th>
                <th style={{ ...th, textAlign: 'right' }}>AUTO HT</th>
                <th style={{ ...th, textAlign: 'right' }}>LOY HT</th>
                <th style={{ ...th, textAlign: 'right' }}>VIR HT</th>
                <th style={{ ...th, textAlign: 'right' }}>TAXE</th>
                <th style={th}>Facture</th>
                <th style={{ ...th, textAlign: 'right' }}>Reversement</th>
                <th style={{ ...th, textAlign: 'right' }}>Écart</th>
                <th style={th}>Alertes</th>
              </tr>
            </thead>
            <tbody>
              {rowsFiltrees.length === 0 && (
                <tr>
                  <td colSpan={16} style={{ textAlign: 'center', padding: 30, color: '#9C8E7D', fontStyle: 'italic' }}>
                    Aucun bien actif ce mois
                  </td>
                </tr>
              )}
              {rowsFiltrees.map((r, i) => (
                <tr key={r.bien_id}
                  style={{ background: r.alert_level === 'error' ? '#FFF8F8' : i % 2 === 0 ? 'var(--bg-card)' : 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
                  <td style={td}>
                    <span style={{ fontWeight: 600 }}>{r.bien_code || '—'}</span>
                    {r.bien_nom && <div style={{ fontSize: '0.85em', color: '#9C8E7D', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.bien_nom}</div>}
                  </td>
                  <td style={td}>{r.proprietaire_nom || <span style={{ color: '#9C8E7D', fontStyle: 'italic' }}>—</span>}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{r.nb_resas}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {r.nb_rapprochees > 0
                      ? <span style={{ color: '#059669', fontWeight: 600 }}>{r.nb_rapprochees}</span>
                      : <span style={{ color: '#9C8E7D' }}>0</span>}
                    {r.nb_non_rapprochees > 0 && <span style={{ color: '#f59e0b', marginLeft: 4 }}>({r.nb_non_rapprochees})</span>}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {r.nb_non_ventilees > 0
                      ? <span style={{ color: '#ef4444', fontWeight: 600 }}>{r.nb_non_ventilees}</span>
                      : <span style={{ color: '#9C8E7D' }}>0</span>}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.hon_ht ? fmtN(r.hon_ht) : '—'}</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: r.hon_ttc ? 600 : 400 }}>{r.hon_ttc ? fmtN(r.hon_ttc) : '—'}</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.fmen_ht ? fmtN(r.fmen_ht) : '—'}</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.auto_ht ? fmtN(r.auto_ht) : '—'}</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.loy_ht ? fmtN(r.loy_ht) : '—'}</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.vir_ht ? fmtN(r.vir_ht) : '—'}</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.taxe_ht ? fmtN(r.taxe_ht) : '—'}</td>
                  <td style={td}>
                    {r.facture_statut
                      ? <span style={{ padding: '2px 7px', borderRadius: 10, fontSize: '0.8em', fontWeight: 600, background: r.facture_statut === 'validee' ? '#D1FAE5' : '#FEF3C7', color: r.facture_statut === 'validee' ? '#059669' : '#92400E' }}>{r.facture_statut}</span>
                      : r.hon_ttc > 0
                        ? <span style={{ color: '#ef4444', fontWeight: 600, fontSize: '0.8em' }}>manquante</span>
                        : <span style={{ color: '#9C8E7D', fontSize: '0.8em' }}>—</span>}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {r.facture_montant_reversement != null ? fmtN(r.facture_montant_reversement) : '—'}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {r.ecart_reversement_proprio != null
                      ? <span style={{ color: Math.abs(r.ecart_reversement_proprio) > 100 ? '#f59e0b' : '#059669', fontWeight: Math.abs(r.ecart_reversement_proprio) > 100 ? 700 : 400 }}>
                          {r.ecart_reversement_proprio >= 0 ? '+' : ''}{fmtN(r.ecart_reversement_proprio)}
                        </span>
                      : '—'}
                  </td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <AlertBadge level="error"   count={r.alerts.filter(a => a.level === 'error').length} />
                      <AlertBadge level="warning" count={r.alerts.filter(a => a.level === 'warning').length} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            {/* Ligne totaux */}
            {data && rowsFiltrees.length > 0 && (
              <tfoot>
                <tr style={{ background: 'var(--bg)', borderTop: '2px solid var(--brand)', fontWeight: 700 }}>
                  <td style={{ ...td, color: 'var(--brand)' }}>TOTAL</td>
                  <td style={td} />
                  <td style={{ ...td, textAlign: 'right' }}>{rowsFiltrees.reduce((s, r) => s + r.nb_resas, 0)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{rowsFiltrees.reduce((s, r) => s + r.nb_rapprochees, 0)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{rowsFiltrees.reduce((s, r) => s + r.nb_non_ventilees, 0)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{fmtN(rowsFiltrees.reduce((s, r) => s + r.hon_ht,   0))}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{fmtN(rowsFiltrees.reduce((s, r) => s + r.hon_ttc,  0))}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{fmtN(rowsFiltrees.reduce((s, r) => s + r.fmen_ht,  0))}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{fmtN(rowsFiltrees.reduce((s, r) => s + r.auto_ht,  0))}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{fmtN(rowsFiltrees.reduce((s, r) => s + r.loy_ht,   0))}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{fmtN(rowsFiltrees.reduce((s, r) => s + r.vir_ht,   0))}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{fmtN(rowsFiltrees.reduce((s, r) => s + r.taxe_ht,  0))}</td>
                  <td style={td} />
                  <td style={td} />
                  <td style={td} />
                  <td style={td} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {data && (
        <div style={{ marginTop: 10, fontSize: '0.75em', color: '#9C8E7D', textAlign: 'right' }}>
          Généré le {new Date(data.metadata.generated_at).toLocaleString('fr-FR')} · {data.metadata.nb_rows} biens actifs
        </div>
      )}
    </div>
  )
}

const th = {
  padding: '9px 10px',
  textAlign: 'left',
  fontWeight: 600,
  fontSize: '0.85em',
  color: '#9C8E7D',
  whiteSpace: 'nowrap',
}

const td = {
  padding: '8px 10px',
  verticalAlign: 'middle',
  whiteSpace: 'nowrap',
}
