import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import MoisSelector, { MOIS_FR } from '../components/MoisSelector'
import { useMoisPersisted } from '../hooks/useMoisPersisted'
import { supabase } from '../lib/supabase'
import { buildComptaMensuelle } from '../services/buildComptaMensuelle'
import { syncStripeAcomptesSequestre, HAS_STRIPE_SEQUESTRE } from '../services/syncStripeAcomptesSequestre'
import { AGENCE } from '../lib/agence'

const moisCourant = new Date().toISOString().slice(0, 7)
const NF  = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmt = c => c != null ? NF.format(c / 100) + ' €' : '—'
const fmtN = c => c != null ? NF.format(c / 100) : '—'
const fmtDate = d => d ? d.slice(0, 10).split('-').reverse().join('/') : '—'

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
  const [tab, setTab] = useState(() => localStorage.getItem('tab_compta') || 'mensuelle')
  const switchTab = t => { setTab(t); localStorage.setItem('tab_compta', t) }

  const [mois, setMois] = useMoisPersisted()
  const [moisDispos, setMoisDispos] = useState([moisCourant])
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Reversements faits (bien_id → fait_at ISO string)
  const [reversementsFaits, setReversementsFaits] = useState({})

  // Filtres
  const [filterProprio, setFilterProprio] = useState('')
  const [filterStatutFacture, setFilterStatutFacture] = useState('')
  const [filterAlertsOnly, setFilterAlertsOnly] = useState(false)

  // Visibilité colonnes
  const COLS_DEFS = [
    { key: 'resas',       label: 'Resas',       def: true },
    { key: 'rappr',       label: 'Rappr.',       def: true },
    { key: 'non_vent',    label: 'Non vent.',    def: false },
    { key: 'hon_ht',      label: 'HON HT',       def: false },
    { key: 'hon_tva',     label: 'HON TVA',      def: false },
    { key: 'hon_ttc',     label: 'HON TTC',      def: true },
    { key: 'com_ttc',     label: 'COM TTC',      def: true },
    { key: 'fmen_ht',     label: 'FMEN HT',      def: true },
    { key: 'fmen_tva',    label: 'FMEN TVA',     def: false },
    { key: 'fmen_ttc',    label: 'FMEN TTC',     def: false },
    { key: 'auto_ht',     label: 'AUTO HT',      def: true },
    { key: 'loy_ht',               label: 'LOY HT',        def: true },
    { key: 'frais_loy',            label: 'Frais HA proprio.', def: false },
    { key: 'prest_deduct',         label: 'Prest. déduit',    def: false },
    { key: 'taxe',                 label: 'TAXE',          def: true },
    { key: 'reversement_calcule',  label: 'Reversement',   def: true },
    { key: 'fait',                 label: 'Fait',          def: true },
    { key: 'facture',              label: 'Facture',       def: true },
    { key: 'reversement_facture',  label: 'Rev. facturé',  def: false },
    { key: 'ecart_facture',        label: 'Écart facture', def: false },
  ]
  const [colsVisible, setColsVisible] = useState(() => {
    try {
      const saved = localStorage.getItem('compta_cols_visible')
      if (saved) {
        const parsed = JSON.parse(saved)
        // Fusionner avec les défauts pour les nouvelles colonnes éventuelles
        const defaults = Object.fromEntries(COLS_DEFS.map(c => [c.key, c.def]))
        return { ...defaults, ...parsed }
      }
    } catch (_) {}
    return Object.fromEntries(COLS_DEFS.map(c => [c.key, c.def]))
  })
  const col = k => colsVisible[k] ?? COLS_DEFS.find(c => c.key === k)?.def ?? true

  // Persister les colonnes à chaque changement
  useEffect(() => {
    try { localStorage.setItem('compta_cols_visible', JSON.stringify(colsVisible)) } catch (_) {}
  }, [colsVisible])

  // Chargement mois dispos — même logique que PageRapports
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

  const charger = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [result, { data: faits }] = await Promise.all([
        buildComptaMensuelle(mois),
        supabase.from('reversement_fait').select('bien_id, fait_at').eq('mois', mois).eq('agence', AGENCE),
      ])
      setData(result)
      setReversementsFaits(Object.fromEntries((faits || []).map(f => [f.bien_id, f.fait_at])))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [mois])

  const toggleFait = useCallback(async (bienId, currentFaitAt) => {
    if (currentFaitAt) {
      // Décocher → supprimer
      await supabase.from('reversement_fait').delete().eq('bien_id', bienId).eq('mois', mois).eq('agence', AGENCE)
      setReversementsFaits(prev => { const n = { ...prev }; delete n[bienId]; return n })
    } else {
      // Cocher → insérer
      const fait_at = new Date().toISOString()
      await supabase.from('reversement_fait').upsert({ bien_id: bienId, mois, agence: AGENCE, fait_at }, { onConflict: 'bien_id,mois,agence' })
      setReversementsFaits(prev => ({ ...prev, [bienId]: fait_at }))
    }
  }, [mois])

  useEffect(() => {
    charger()
    const onVisible = () => { if (document.visibilityState === 'visible') charger() }
    document.addEventListener('visibilitychange', onVisible)
    const channel = supabase.channel('compta-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservation' }, () => charger())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ventilation' }, () => charger())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'facture_evoliz' }, () => charger())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'frais_proprietaire' }, () => charger())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prestation_hors_forfait' }, () => charger())
      .subscribe()
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(channel)
    }
  }, [charger])

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

  // Groupement Maison Maïté (groupe_facturation non null)
  const GROUPE_LABELS = { MAITE: 'Maison Maïté' }
  const [collapsedGroups, setCollapsedGroups] = useState(new Set())
  const toggleGroup = key => setCollapsedGroups(s => {
    const next = new Set(s)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  const groupedView = useMemo(() => {
    const groupsMap = {}
    for (const r of rowsFiltrees) {
      if (r.groupe_facturation) {
        if (!groupsMap[r.groupe_facturation]) groupsMap[r.groupe_facturation] = []
        groupsMap[r.groupe_facturation].push(r)
      }
    }
    const seenGroups = new Set()
    const result = []
    for (const r of rowsFiltrees) {
      if (r.groupe_facturation) {
        const gk = r.groupe_facturation
        if (!seenGroups.has(gk)) {
          seenGroups.add(gk)
          const children = groupsMap[gk]
          const nsum = key => children.reduce((s, c) => s + (c[key] || 0), 0)
          const first = children[0]
          const allAlerts = children.flatMap(c => c.alerts)
          const parent = {
            _isGroup: true,
            _groupKey: gk,
            bien_id: `group_${gk}`,
            bien_code: null,
            bien_nom: GROUPE_LABELS[gk] || gk,
            proprietaire_id: first.proprietaire_id,
            proprietaire_nom: first.proprietaire_nom,
            nb_resas: nsum('nb_resas'), nb_rapprochees: nsum('nb_rapprochees'),
            nb_non_rapprochees: nsum('nb_non_rapprochees'), nb_non_ventilees: nsum('nb_non_ventilees'),
            hon_ht: nsum('hon_ht'), hon_tva: nsum('hon_tva'), hon_ttc: nsum('hon_ttc'),
            com_ttc: nsum('com_ttc'),
            fmen_ht: nsum('fmen_ht'), fmen_tva: nsum('fmen_tva'), fmen_ttc: nsum('fmen_ttc'),
            auto_ht: nsum('auto_ht'), loy_ht: nsum('loy_ht'),
            frais_loy: nsum('frais_loy'), prest_deduct: nsum('prest_deduct'),
            reversement_calcule: nsum('reversement_calcule'), taxe_ht: nsum('taxe_ht'),
            facture_statut: first.facture_statut,
            facture_montant_reversement: nsum('facture_montant_reversement'),
            ecart_reversement_proprio: first.ecart_reversement_proprio,
            alerts: allAlerts,
            alert_count: allAlerts.length,
            alert_level: allAlerts.some(a => a.level === 'error') ? 'error' : allAlerts.some(a => a.level === 'warning') ? 'warning' : null,
            alert_codes: [...new Set(allAlerts.map(a => a.code))],
          }
          result.push({ type: 'group', key: gk, parent, children })
        }
      } else {
        result.push({ type: 'single', row: r })
      }
    }
    return result
  }, [rowsFiltrees])

  const [year, monthIdx] = mois.split('-')
  const moisLabel = `${MOIS_FR[parseInt(monthIdx) - 1]} ${year}`

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1400, margin: '0 auto' }}>
      {/* En-tête */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.4em', fontWeight: 700, color: 'var(--text)' }}>Comptabilité</h1>
        </div>
        {tab === 'mensuelle' && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <MoisSelector mois={mois} setMois={setMois} moisDispos={moisDispos} />
            <button className="btn btn-secondary" onClick={charger} disabled={loading} style={{ padding: '6px 14px' }}>
              {loading ? '…' : '↺'}
            </button>
          </div>
        )}
      </div>

      {/* Onglets */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '2px solid var(--border)' }}>
        {[
          { key: 'mensuelle', label: 'Vue mensuelle' },
          { key: 'sequestre', label: 'Séquestre' },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => switchTab(key)}
            style={{ padding: '8px 20px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.9em', fontWeight: tab === key ? 700 : 400, color: tab === key ? 'var(--brand)' : '#9C8E7D', borderBottom: tab === key ? '2px solid var(--brand)' : '2px solid transparent', marginBottom: -2, transition: 'color 0.15s' }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'sequestre' && <OngletSequestre />}

      {tab === 'mensuelle' && <>
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
                <div style={{ fontWeight: 700, color: LEVEL_COLOR[level], fontSize: '0.85em', marginBottom: 8 }}>
                  {LEVEL_ICON[level]} {level === 'error' ? 'Erreurs bloquantes' : 'Avertissements'} ({levelAlerts.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {levelAlerts.map((a, i) => {
                    const row = data.rows.find(r => r.bien_id === a.bien_id)
                    return (
                      <div key={i} style={{ fontSize: '0.82em', background: 'rgba(255,255,255,0.55)', border: `1px solid ${LEVEL_COLOR[level]}33`, borderRadius: 6, padding: '5px 10px' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                          {row && <span style={{ fontWeight: 700, color: 'var(--text)', minWidth: 120 }}>{row.bien_nom}</span>}
                          <span style={{ color: 'var(--text)', flex: 1 }}>{a.message}</span>
                          {row && a.code === 'VIR_SANS_RAPPROCHEMENT' && row.nb_non_rapprochees > 0 && (
                            <span style={{ color: LEVEL_COLOR[level], fontWeight: 700, whiteSpace: 'nowrap' }}>{row.nb_non_rapprochees} non rappr.</span>
                          )}
                          {row && a.code === 'NO_FACTURE' && row.hon_ttc > 0 && (
                            <span style={{ color: LEVEL_COLOR[level], fontWeight: 700, whiteSpace: 'nowrap' }}>{fmt(row.hon_ttc)}</span>
                          )}
                          {row && a.code === 'NON_VENTILEES' && row.nb_non_ventilees > 0 && (
                            <span style={{ color: LEVEL_COLOR[level], fontWeight: 700, whiteSpace: 'nowrap' }}>{row.nb_non_ventilees} non vent.</span>
                          )}
                        </div>
                        {/* Détail ECART_REVERSEMENT */}
                        {a.code === 'ECART_REVERSEMENT' && a.details && (
                          <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${LEVEL_COLOR[level]}22`, display: 'flex', flexWrap: 'wrap', gap: '2px 14px', fontSize: '0.92em', color: '#6B5E4E' }}>
                            <span>LOY <strong>{fmtN(a.details.loy_ht)}</strong></span>
                            {a.details.frais_loy    > 0 && <span>− Frais HA proprio. <strong>{fmtN(a.details.frais_loy)}</strong></span>}
                            {a.details.frais_direct > 0 && <span>− Frais HA fact. direct <strong>{fmtN(a.details.frais_direct)}</strong></span>}
                            {a.details.prest_deduct > 0 && <span>− Prestations <strong>{fmtN(a.details.prest_deduct)}</strong></span>}
                            {a.details.debours_prop > 0 && <span>− Débours <strong>{fmtN(a.details.debours_prop)}</strong></span>}
                            {a.details.owner_stay_absorb > 0 && <span>− Séjour proprio <strong>{fmtN(a.details.owner_stay_absorb)}</strong></span>}
                            {a.details.remboursements > 0 && <span>+ Remb. <strong>{fmtN(a.details.remboursements)}</strong></span>}
                            <span style={{ marginLeft: 4, fontWeight: 700, color: 'var(--text)' }}>= <strong>{fmtN(a.details.reversement_calcule)}</strong></span>
                            <span style={{ color: '#9C8E7D' }}>| facturé <strong>{fmtN(a.details.reversement_facture)}</strong></span>
                          </div>
                        )}
                        {/* Détail VIR_SANS_RAPPROCHEMENT */}
                        {a.code === 'VIR_SANS_RAPPROCHEMENT' && a.details?.resas?.length > 0 && (
                          <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${LEVEL_COLOR[level]}22`, display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {a.details.resas.map((r, ri) => (
                              <div key={ri} style={{ display: 'flex', gap: 10, fontSize: '0.92em', color: '#6B5E4E', alignItems: 'baseline' }}>
                                <span style={{ fontWeight: 700, minWidth: 110 }}>{r.code}</span>
                                <span style={{ minWidth: 140 }}>{fmtDate(r.arrival_date)} → {fmtDate(r.departure_date)}</span>
                                {r.guest_name && <span style={{ color: '#9C8E7D', flex: 1 }}>{r.guest_name}</span>}
                                {r.platform && (() => {
                                  const PC = { airbnb: '#FF5A5F', booking: '#003580', direct: '#2E7D32', manual: '#78909C' }
                                  const c = PC[r.platform] || '#8B7355'
                                  return <span style={{ background: c + '22', color: c, fontWeight: 700, fontSize: '0.85em', padding: '1px 6px', borderRadius: 4, whiteSpace: 'nowrap', textTransform: 'capitalize' }}>{r.platform}</span>
                                })()}
                                {r.fin_revenue > 0 && <span style={{ marginLeft: 'auto', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtN(r.fin_revenue)} €</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
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
          <StatCard label="TAXE HT" value={fmt(data.totals.taxe_ht)} />
          <StatCard label="Réservations" value={data.totals.nb_resas} sub={`${data.totals.nb_rapprochees} rappr. · ${data.totals.nb_non_rapprochees} non rappr.`} />
          {data.fraisStripe && (
            <div style={{ background: '#F5F3FF', border: '1px solid #635BFF', borderRadius: 10, padding: '14px 18px', minWidth: 130 }}>
              <div style={{ fontSize: '0.75em', color: '#635BFF', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Frais Stripe</div>
              <div style={{ fontSize: '1.25em', fontWeight: 700, color: '#3730A3' }}>{(data.fraisStripe.total / 100).toFixed(2)} €</div>
              <div style={{ fontSize: '0.75em', color: '#635BFF', marginTop: 2 }}>→ virer vers cpt gestion</div>
            </div>
          )}
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

      {/* Sélecteur colonnes */}
      <div style={{ marginBottom: 14, padding: '8px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
        <span style={{ fontSize: '0.8em', fontWeight: 600, color: '#9C8E7D', marginRight: 6 }}>Colonnes :</span>
        {COLS_DEFS.map(({ key, label }) => (
          <label key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.8em', cursor: 'pointer', marginRight: 8 }}>
            <input type="checkbox" checked={colsVisible[key] ?? false}
              onChange={e => setColsVisible(v => ({ ...v, [key]: e.target.checked }))} />
            {label}
          </label>
        ))}
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
                {col('resas')       && <th style={{ ...th, textAlign: 'right' }}>Resas</th>}
                {col('rappr')       && <th style={{ ...th, textAlign: 'right' }}>Rappr.</th>}
                {col('non_vent')    && <th style={{ ...th, textAlign: 'right' }}>Non vent.</th>}
                {col('hon_ht')      && <th style={{ ...th, textAlign: 'right' }}>HON HT</th>}
                {col('hon_tva')     && <th style={{ ...th, textAlign: 'right' }}>HON TVA</th>}
                {col('hon_ttc')     && <th style={{ ...th, textAlign: 'right' }}>HON TTC</th>}
                {col('com_ttc')     && <th style={{ ...th, textAlign: 'right' }}>COM TTC</th>}
                {col('fmen_ht')     && <th style={{ ...th, textAlign: 'right' }}>FMEN HT</th>}
                {col('fmen_tva')    && <th style={{ ...th, textAlign: 'right' }}>FMEN TVA</th>}
                {col('fmen_ttc')    && <th style={{ ...th, textAlign: 'right' }}>FMEN TTC</th>}
                {col('auto_ht')     && <th style={{ ...th, textAlign: 'right' }}>AUTO HT</th>}
                {col('loy_ht')              && <th style={{ ...th, textAlign: 'right' }}>LOY HT</th>}
                {col('frais_loy')           && <th style={{ ...th, textAlign: 'right' }}>Frais HA proprio.</th>}
                {col('prest_deduct')        && <th style={{ ...th, textAlign: 'right' }}>Prest. déduit</th>}
                {col('taxe')                && <th style={{ ...th, textAlign: 'right' }}>TAXE</th>}
                {col('reversement_calcule') && <th style={{ ...th, textAlign: 'right' }}>Reversement</th>}
                {col('fait')               && <th style={{ ...th, textAlign: 'center' }}>Fait</th>}
                {col('facture')             && <th style={th}>Facture</th>}
                {col('reversement_facture') && <th style={{ ...th, textAlign: 'right' }}>Rev. facturé</th>}
                {col('ecart_facture')       && <th style={{ ...th, textAlign: 'right' }}>Écart facture</th>}
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
              {groupedView.flatMap((item, i) => {
                const renderCells = (r, isChild) => <>
                  {col('resas')    && <td style={{ ...td, textAlign: 'right', opacity: isChild ? 0.8 : 1 }}>{r.nb_resas}</td>}
                  {col('rappr')    && <td style={{ ...td, textAlign: 'right' }}>
                    {r.nb_rapprochees > 0 ? <span style={{ color: '#059669', fontWeight: 600 }}>{r.nb_rapprochees}</span> : <span style={{ color: '#9C8E7D' }}>0</span>}
                    {r.nb_non_rapprochees > 0 && <span style={{ color: '#f59e0b', marginLeft: 4 }}>({r.nb_non_rapprochees})</span>}
                  </td>}
                  {col('non_vent') && <td style={{ ...td, textAlign: 'right' }}>
                    {r.nb_non_ventilees > 0 ? <span style={{ color: '#ef4444', fontWeight: 600 }}>{r.nb_non_ventilees}</span> : <span style={{ color: '#9C8E7D' }}>0</span>}
                  </td>}
                  {col('hon_ht')      && <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.hon_ht ? fmtN(r.hon_ht) : '—'}</td>}
                  {col('hon_tva')     && <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.hon_tva ? fmtN(r.hon_tva) : '—'}</td>}
                  {col('hon_ttc')     && <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: r.hon_ttc ? 600 : 400 }}>{r.hon_ttc ? fmtN(r.hon_ttc) : '—'}</td>}
                  {col('com_ttc')     && <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: r.com_ttc ? 600 : 400 }}>{r.com_ttc ? fmtN(r.com_ttc) : '—'}</td>}
                  {col('fmen_ht')     && <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.fmen_ht ? fmtN(r.fmen_ht) : '—'}</td>}
                  {col('fmen_tva')    && <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.fmen_tva ? fmtN(r.fmen_tva) : '—'}</td>}
                  {col('fmen_ttc')    && <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.fmen_ttc ? fmtN(r.fmen_ttc) : '—'}</td>}
                  {col('auto_ht')     && <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.auto_ht ? fmtN(r.auto_ht) : '—'}</td>}
                  {col('loy_ht')              && <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.loy_ht ? fmtN(r.loy_ht) : '—'}</td>}
                  {col('frais_loy')           && <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.frais_loy ? <span style={{ color: '#E65100' }}>-{fmtN(r.frais_loy)}</span> : '—'}</td>}
                  {col('prest_deduct')        && <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.prest_deduct ? <span style={{ color: '#E65100' }}>-{fmtN(r.prest_deduct)}</span> : '—'}</td>}
                  {col('taxe')                && <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.taxe_ht ? fmtN(r.taxe_ht) : '—'}</td>}
                  {col('reversement_calcule') && <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: r.reversement_calcule ? 600 : 400 }}>{r.reversement_calcule ? fmtN(r.reversement_calcule) : '—'}</td>}
                  {col('fait') && <td style={{ ...td, textAlign: 'center' }}>
                    {!isChild && (() => {
                      const faitAt = reversementsFaits[r.bien_id]
                      const d = faitAt ? new Date(faitAt) : null
                      const label = d
                        ? `Virement fait le ${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}h`
                        : ''
                      return (
                        <div title={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} onClick={() => toggleFait(r.bien_id, faitAt)}>
                          <span style={{ fontSize: 18, color: faitAt ? '#059669' : '#D9CEB8', lineHeight: 1 }}>
                            {faitAt ? '✅' : '○'}
                          </span>
                          {faitAt && <span style={{ fontSize: '0.7em', color: '#059669', whiteSpace: 'nowrap' }}>
                            {d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} {d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}h
                          </span>}
                        </div>
                      )
                    })()}
                  </td>}
                  {col('facture')             && <td style={td}>
                    {isChild ? <span style={{ color: '#9C8E7D', fontSize: '0.8em' }}>—</span>
                      : r.facture_statut
                        ? <span style={{ padding: '2px 7px', borderRadius: 10, fontSize: '0.8em', fontWeight: 600, background: r.facture_statut === 'validee' ? '#D1FAE5' : '#FEF3C7', color: r.facture_statut === 'validee' ? '#059669' : '#92400E' }}>{r.facture_statut}</span>
                        : r.hon_ttc > 0
                          ? <span style={{ color: '#ef4444', fontWeight: 600, fontSize: '0.8em' }}>manquante</span>
                          : <span style={{ color: '#9C8E7D', fontSize: '0.8em' }}>—</span>}
                  </td>}
                  {col('reversement_facture') && <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#9C8E7D' }}>
                    {!isChild && r.facture_montant_reversement != null ? fmtN(r.facture_montant_reversement) : '—'}
                  </td>}
                  {col('ecart_facture') && <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {!isChild && r.ecart_reversement_proprio != null
                      ? <span style={{ color: Math.abs(r.ecart_reversement_proprio) > 100 ? '#f59e0b' : '#059669', fontWeight: Math.abs(r.ecart_reversement_proprio) > 100 ? 700 : 400 }}>
                          {r.ecart_reversement_proprio >= 0 ? '+' : ''}{fmtN(r.ecart_reversement_proprio)}
                        </span>
                      : '—'}
                  </td>}
                  <td style={td}>
                    {r.alerts.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {r.alerts.map((a, ai) => (
                          <span key={ai} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.76em', color: LEVEL_COLOR[a.level], fontWeight: 600, whiteSpace: 'nowrap' }}>
                            {LEVEL_ICON[a.level]} {a.message}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                </>

                if (item.type === 'single') {
                  const r = item.row
                  return [
                    <tr key={r.bien_id} style={{ background: r.alert_level === 'error' ? '#FFF8F8' : i % 2 === 0 ? 'var(--bg-card)' : 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
                      <td style={td}>
                        <span style={{ fontWeight: 600 }}>{r.bien_code || '—'}</span>
                        {r.bien_nom && <div style={{ fontSize: '0.85em', color: '#9C8E7D', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.bien_nom}</div>}
                      </td>
                      <td style={td}>{r.proprietaire_nom || <span style={{ color: '#9C8E7D', fontStyle: 'italic' }}>—</span>}</td>
                      {renderCells(r, false)}
                    </tr>
                  ]
                }

                // Groupe parent + enfants
                const { key, parent, children } = item
                const expanded = !collapsedGroups.has(key)
                return [
                  // Ligne parent
                  <tr key={`group_${key}`} style={{ background: '#FBF7EE', borderBottom: '1px solid var(--border)', borderLeft: '3px solid var(--brand)' }}>
                    <td style={{ ...td, fontWeight: 700 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button onClick={() => toggleGroup(key)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', color: 'var(--brand)', fontSize: '0.9em', lineHeight: 1 }}>
                          {expanded ? '▼' : '▶'}
                        </button>
                        <div>
                          <span style={{ color: 'var(--brand)' }}>{parent.bien_nom}</span>
                          <div style={{ fontSize: '0.75em', color: '#9C8E7D', fontWeight: 400 }}>{children.length} chambres</div>
                        </div>
                      </div>
                    </td>
                    <td style={td}>{parent.proprietaire_nom}</td>
                    {renderCells(parent, false)}
                  </tr>,
                  // Lignes enfants (si dépliées)
                  ...(!expanded ? [] : children.map(r => (
                    <tr key={r.bien_id} style={{ background: '#FAF8F4', borderBottom: '1px solid var(--border)' }}>
                      <td style={{ ...td, paddingLeft: 28 }}>
                        <span style={{ fontWeight: 600, fontSize: '0.9em' }}>{r.bien_code || '—'}</span>
                        {r.bien_nom && <div style={{ fontSize: '0.8em', color: '#9C8E7D', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.bien_nom}</div>}
                      </td>
                      <td style={{ ...td, color: '#9C8E7D', fontSize: '0.85em' }}>—</td>
                      {renderCells(r, true)}
                    </tr>
                  ))),
                ]
              })}
            </tbody>
            {/* Ligne totaux */}
            {data && rowsFiltrees.length > 0 && (
              <tfoot>
                <tr style={{ background: 'var(--bg)', borderTop: '2px solid var(--brand)', fontWeight: 700 }}>
                  <td style={{ ...td, color: 'var(--brand)' }}>TOTAL</td>
                  <td style={td} />
                  {col('resas')       && <td style={{ ...td, textAlign: 'right' }}>{rowsFiltrees.reduce((s, r) => s + r.nb_resas, 0)}</td>}
                  {col('rappr')       && <td style={{ ...td, textAlign: 'right' }}>{rowsFiltrees.reduce((s, r) => s + r.nb_rapprochees, 0)}</td>}
                  {col('non_vent')    && <td style={{ ...td, textAlign: 'right' }}>{rowsFiltrees.reduce((s, r) => s + r.nb_non_ventilees, 0)}</td>}
                  {col('hon_ht')      && <td style={{ ...td, textAlign: 'right' }}>{fmtN(rowsFiltrees.reduce((s, r) => s + r.hon_ht,   0))}</td>}
                  {col('hon_tva')     && <td style={{ ...td, textAlign: 'right' }}>{fmtN(rowsFiltrees.reduce((s, r) => s + r.hon_tva,  0))}</td>}
                  {col('hon_ttc')     && <td style={{ ...td, textAlign: 'right' }}>{fmtN(rowsFiltrees.reduce((s, r) => s + r.hon_ttc,  0))}</td>}
                  {col('com_ttc')     && <td style={{ ...td, textAlign: 'right' }}>{fmtN(rowsFiltrees.reduce((s, r) => s + r.com_ttc,  0))}</td>}
                  {col('fmen_ht')     && <td style={{ ...td, textAlign: 'right' }}>{fmtN(rowsFiltrees.reduce((s, r) => s + r.fmen_ht,  0))}</td>}
                  {col('fmen_tva')    && <td style={{ ...td, textAlign: 'right' }}>{fmtN(rowsFiltrees.reduce((s, r) => s + r.fmen_tva, 0))}</td>}
                  {col('fmen_ttc')    && <td style={{ ...td, textAlign: 'right' }}>{fmtN(rowsFiltrees.reduce((s, r) => s + r.fmen_ttc, 0))}</td>}
                  {col('auto_ht')     && <td style={{ ...td, textAlign: 'right' }}>{fmtN(rowsFiltrees.reduce((s, r) => s + r.auto_ht,  0))}</td>}
                  {col('loy_ht')              && <td style={{ ...td, textAlign: 'right' }}>{fmtN(rowsFiltrees.reduce((s, r) => s + r.loy_ht,              0))}</td>}
                  {col('frais_loy')           && <td style={{ ...td, textAlign: 'right', color: '#E65100' }}>{fmtN(rowsFiltrees.reduce((s, r) => s + r.frais_loy,          0))}</td>}
                  {col('prest_deduct')        && <td style={{ ...td, textAlign: 'right', color: '#E65100' }}>{fmtN(rowsFiltrees.reduce((s, r) => s + r.prest_deduct,        0))}</td>}
                  {col('taxe')                && <td style={{ ...td, textAlign: 'right' }}>{fmtN(rowsFiltrees.reduce((s, r) => s + r.taxe_ht,             0))}</td>}
                  {col('reversement_calcule') && <td style={{ ...td, textAlign: 'right' }}>{fmtN(rowsFiltrees.reduce((s, r) => s + r.reversement_calcule, 0))}</td>}
                  {col('fait')               && <td style={{ ...td, textAlign: 'center', fontSize: '0.8em', color: '#9C8E7D' }}>{Object.keys(reversementsFaits).length > 0 ? `${Object.keys(reversementsFaits).length} ✅` : ''}</td>}
                  {col('facture')             && <td style={td} />}
                  {col('reversement_facture') && <td style={td} />}
                  {col('ecart_facture')       && <td style={td} />}
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
      </>}
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

// ── Onglet Séquestre ──────────────────────────────────────────────────────────

const BADGE = {
  fiable:  { bg: '#D1FAE5', color: '#065F46', label: 'Fiable — prouvé banque' },
  calcule: { bg: '#DBEAFE', color: '#1E40AF', label: 'Calculé — ventilation' },
  proxy:   { bg: '#FEF3C7', color: '#92400E', label: 'Proxy — facture Evoliz' },
  estime:  { bg: '#FEF3C7', color: '#92400E', label: 'Estimé — partiel' },
  absent:  { bg: '#F1F5F9', color: '#64748B', label: 'Absent — non rapproché' },
}

function SeqLigne({ label, montant, fiabilite, detail, indent, highlight, dimmed }) {
  const b = BADGE[fiabilite] || {}
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 10,
      padding: '8px 14px',
      paddingLeft: indent ? 32 : 14,
      background: highlight ? 'var(--bg)' : 'transparent',
      borderRadius: highlight ? 8 : 0,
      borderLeft: indent ? '2px solid var(--border)' : 'none',
      opacity: dimmed ? 0.5 : 1,
    }}>
      <span style={{ flex: 1, fontSize: '0.88em', color: dimmed ? '#9C8E7D' : 'var(--text)', fontWeight: highlight ? 700 : 400 }}>{label}</span>
      {detail && <span style={{ fontSize: '0.78em', color: '#9C8E7D' }}>{detail}</span>}
      {fiabilite && <span style={{ fontSize: '0.72em', fontWeight: 600, padding: '1px 7px', borderRadius: 8, background: b.bg, color: b.color, whiteSpace: 'nowrap' }}>{b.label}</span>}
      <span style={{ fontSize: fiabilite === 'absent' ? '0.88em' : '0.95em', fontWeight: highlight ? 700 : 600, fontVariantNumeric: 'tabular-nums', minWidth: 110, textAlign: 'right', color: highlight ? 'var(--brand)' : dimmed ? '#9C8E7D' : 'var(--text)' }}>
        {montant === null ? '—' : fmt(montant)}
      </span>
    </div>
  )
}

function SeqSeparateur({ label }) {
  return (
    <div style={{ padding: '14px 14px 4px', fontSize: '0.75em', fontWeight: 700, color: '#9C8E7D', textTransform: 'uppercase', letterSpacing: '0.07em', borderTop: '1px solid var(--border)', marginTop: 8 }}>
      {label}
    </div>
  )
}

const MOIS_LABELS = {
  '2025-01': 'Janvier 2025', '2025-02': 'Février 2025', '2025-03': 'Mars 2025',
  '2025-04': 'Avril 2025',   '2025-05': 'Mai 2025',    '2025-06': 'Juin 2025',
  '2025-07': 'Juillet 2025', '2025-08': 'Août 2025',   '2025-09': 'Septembre 2025',
  '2025-10': 'Octobre 2025', '2025-11': 'Novembre 2025','2025-12': 'Décembre 2025',
}
const fmtE = v => v != null ? new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + ' €' : '—'
const sumE = (arr, key) => arr.reduce((s, i) => s + (i[key] ?? 0), 0)

function StatCardE({ label, value, sub, color }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', minWidth: 140 }}>
      <div style={{ fontSize: '0.72em', color: '#9C8E7D', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: '1.15em', fontWeight: 700, color: color || 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.72em', color: '#9C8E7D', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// ── Export CSV ────────────────────────────────────────────────────────────────
function exportCSV(items, moisFiltre) {
  const NF2 = v => v != null ? String(v).replace('.', ',') : ''
  const headers = ['Mois','Bien','Propriétaire','VIR proprio','HON TTC','HON HT','Ménages','Débours','Taxe séjour','COM distrib','Note','Source','Facture directe']
  const rows = items.map(i => [
    i.mois,
    i.bien_name,
    i.owner_name || '',
    NF2(i.vir_montant),
    NF2(i.hon_ttc),
    NF2(i.hon_ht),
    NF2(i.menages),
    NF2(i.debours),
    NF2(i.taxe_sejour),
    NF2(i.com_distrib),
    i.vir_note || '',
    i.source || '',
    i.facture_chaos ? 'oui' : '',
  ])
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(';')).join('\n')
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `sequestre_2025${moisFiltre !== 'all' ? '_' + moisFiltre : ''}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Bilan component (Tableau 1 type Lauian) ───────────────────────────────────
function BilanSequestre({ items }) {
  const [bilan, setBilan] = useState(null)
  const [saving, setSaving] = useState(false)
  const [soldeSaisie, setSoldeSaisie] = useState('')
  const [cautionsSaisie, setCautionsSaisie] = useState('')
  const [ajustements, setAjustements] = useState([])
  const [newLabel, setNewLabel] = useState('')
  const [newMontant, setNewMontant] = useState('')
  const [newColor, setNewColor] = useState('normal') // 'normal' | 'rouge' | 'orange'
  const [shineData, setShineData] = useState([])

  useEffect(() => {
    supabase.from('sequestre_bilan').select('*').eq('agence', AGENCE).eq('annee', 2025).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setBilan(data)
          setSoldeSaisie(data.solde_bancaire != null ? String(data.solde_bancaire).replace('.', ',') : '')
          setCautionsSaisie(data.compte_cautions != null ? String(data.compte_cautions).replace('.', ',') : '')
          setAjustements(data.ajustements || [])
        }
      })
    supabase.from('sequestre_shine_mensuel').select('*').eq('agence', AGENCE).like('mois', '2025-%').order('mois')
      .then(({ data }) => { if (data) setShineData(data) })
  }, [])

  const parseNum = s => { const v = parseFloat(String(s).replace(',', '.')); return isNaN(v) ? null : v }

  const sauvegarder = async () => {
    setSaving(true)
    const payload = {
      agence: AGENCE, annee: 2025,
      solde_bancaire: parseNum(soldeSaisie),
      compte_cautions: parseNum(cautionsSaisie),
      ajustements,
      updated_at: new Date().toISOString(),
    }
    if (bilan?.id) {
      await supabase.from('sequestre_bilan').update(payload).eq('id', bilan.id)
    } else {
      const { data } = await supabase.from('sequestre_bilan').insert(payload).select().single()
      if (data) setBilan(data)
    }
    setSaving(false)
  }

  const ajouterLigne = () => {
    if (!newLabel.trim()) return
    const isInfo = newColor === 'info'
    if (!isInfo && newMontant.trim() === '') return
    setAjustements(a => [...a, {
      label: newLabel.trim(),
      montant: parseNum(newMontant),
      couleur: isInfo ? 'normal' : newColor,
      ...(isInfo ? { info_only: true } : {})
    }])
    setNewLabel(''); setNewMontant(''); setNewColor('normal')
  }

  const supprimerLigne = idx => setAjustements(a => a.filter((_, i) => i !== idx))

  // Calculs
  const solde = parseNum(soldeSaisie) ?? 0
  const cautions = parseNum(cautionsSaisie) ?? 0
  const totalBanque = solde + cautions

  const totVir = sumE(items, 'vir_montant')
  const totHonTtc = sumE(items, 'hon_ttc')
  const totMen = sumE(items, 'menages')
  const totDeb = sumE(items, 'debours')
  const totTaxe = sumE(items, 'taxe_sejour')
  const totCom = sumE(items, 'com_distrib')
  const totAjust = ajustements.reduce((s, a) => a.info_only ? s : s + (a.montant ?? 0), 0)
  const totalCalcule = totVir + totHonTtc + totMen + totDeb + totTaxe + totCom + totAjust
  const delta = totalBanque - totalCalcule

  const deltaAbs = Math.abs(delta)
  const deltaColor = deltaAbs < 100 ? '#065F46' : deltaAbs < 1000 ? '#92400E' : '#DC2626'
  const deltaBg = deltaAbs < 100 ? '#D1FAE5' : deltaAbs < 1000 ? '#FEF3C7' : '#FEE2E2'

  const COULEUR_STYLE = {
    normal: { color: 'var(--text)', fontWeight: 600 },
    rouge:  { color: '#DC2626', fontWeight: 600 },
    orange: { color: '#92400E', fontWeight: 600 },
    info:   { color: '#1D4ED8', fontWeight: 500 },
  }

  return (
    <div style={{ maxWidth: 640 }}>
      {/* Inputs bancaires */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ background: '#F0EAD8', padding: '10px 16px', fontWeight: 700, fontSize: '0.85em', color: '#5C4B2A', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Comptes bancaires au 31/12/2025
        </div>
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label style={{ flex: 1, fontSize: '0.88em', fontWeight: 600, color: 'var(--text)' }}>Solde séquestre LC (relevé bancaire)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input value={soldeSaisie} onChange={e => setSoldeSaisie(e.target.value)}
                style={{ width: 130, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.9em', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                placeholder="ex: 33 052,35" />
              <span style={{ fontSize: '0.85em', color: '#9C8E7D' }}>€</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label style={{ flex: 1, fontSize: '0.88em', fontWeight: 600, color: 'var(--text)' }}>Compte excédent cautions</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input value={cautionsSaisie} onChange={e => setCautionsSaisie(e.target.value)}
                style={{ width: 130, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.9em', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                placeholder="ex: 1 914,60" />
              <span style={{ fontSize: '0.85em', color: '#9C8E7D' }}>€</span>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
            <span style={{ fontSize: '0.88em', fontWeight: 700 }}>TOTAL BANQUE</span>
            <span style={{ fontSize: '1.1em', fontWeight: 700, color: parseNum(soldeSaisie) != null ? '#065F46' : '#9C8E7D', fontVariantNumeric: 'tabular-nums' }}>
              {parseNum(soldeSaisie) != null ? fmtE(totalBanque) : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Décomposition calculée */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ background: '#F0EAD8', padding: '10px 16px', fontWeight: 700, fontSize: '0.85em', color: '#5C4B2A', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Décomposition — source : rapports Hospitable 2025
        </div>
        {[
          { label: 'Virements proprios (VIR)', montant: totVir, color: '#065F46' },
          { label: 'Honoraires DCB (HON TTC)', montant: totHonTtc },
          { label: 'Ménages', montant: totMen },
          { label: 'Débours / frais', montant: totDeb },
          ...(totTaxe > 0 ? [{ label: 'Taxe de séjour', montant: totTaxe }] : []),
          ...(totCom > 0 ? [{ label: 'Commissions distributeurs', montant: totCom }] : []),
        ].map(({ label, montant, color }) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 16px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: '0.88em', color: 'var(--text)' }}>{label}</span>
            <span style={{ fontSize: '0.92em', fontWeight: 600, color: color || 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{fmtE(montant)}</span>
          </div>
        ))}

        {/* Ajustements manuels */}
        {ajustements.map((a, idx) => (
          <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 16px', borderBottom: '1px solid var(--border)', background: a.info_only ? '#EFF6FF' : '#FDFAF4' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {a.info_only && <span style={{ fontSize: '0.7em', background: '#DBEAFE', color: '#1D4ED8', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>INFO</span>}
              <span style={{ fontSize: '0.88em', ...COULEUR_STYLE[a.info_only ? 'info' : (a.couleur || 'normal')] }}>{a.label}</span>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: '0.92em', fontWeight: 600, ...COULEUR_STYLE[a.info_only ? 'info' : (a.couleur || 'normal')], fontVariantNumeric: 'tabular-nums' }}>
                {a.info_only ? fmtE(a.montant) : fmtE(a.montant)}
              </span>
              <button onClick={() => supprimerLigne(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9C8E7D', fontSize: '1em', padding: 0 }} title="Supprimer">×</button>
            </div>
          </div>
        ))}

        {/* Ajouter ajustement */}
        <div style={{ padding: '10px 16px', background: '#F7F3EC', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: '0.78em', color: '#9C8E7D', marginBottom: 6, fontWeight: 600 }}>+ Ajustement manuel</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="Label (ex: Arrosa bloqué)"
              style={{ flex: 2, minWidth: 160, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.85em' }} />
            <input value={newMontant} onChange={e => setNewMontant(e.target.value)} placeholder="-13547,14"
              style={{ width: 110, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.85em', textAlign: 'right' }} />
            <select value={newColor} onChange={e => setNewColor(e.target.value)}
              style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.85em' }}>
              <option value="normal">Normal</option>
              <option value="rouge">Rouge</option>
              <option value="orange">Orange</option>
              <option value="info">Info (hors calcul)</option>
            </select>
            <button onClick={ajouterLigne} className="btn btn-secondary" style={{ padding: '5px 10px', fontSize: '0.82em' }}>Ajouter</button>
          </div>
        </div>

        {/* Total calculé */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 16px', borderBottom: '1px solid var(--border)', background: '#F0EAD8' }}>
          <span style={{ fontSize: '0.9em', fontWeight: 700 }}>TOTAL CALCULÉ</span>
          <span style={{ fontSize: '1.05em', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtE(totalCalcule)}</span>
        </div>

        {/* Delta */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: deltaBg }}>
          <div>
            <div style={{ fontSize: '0.9em', fontWeight: 700, color: deltaColor }}>
              Delta (banque − calculé)
            </div>
            <div style={{ fontSize: '0.75em', color: '#9C8E7D', marginTop: 2 }}>
              {deltaAbs < 100 ? '✅ Équilibré' : deltaAbs < 1000 ? '⚠️ À vérifier' : '❌ Écart important'}
            </div>
          </div>
          <span style={{ fontSize: '1.15em', fontWeight: 700, color: deltaColor, fontVariantNumeric: 'tabular-nums' }}>
            {parseNum(soldeSaisie) != null ? fmtE(delta) : '—'}
          </span>
        </div>
      </div>

      {/* Bouton sauvegarder */}
      <button onClick={sauvegarder} disabled={saving} className="btn btn-primary" style={{ padding: '8px 20px' }}>
        {saving ? 'Enregistrement…' : 'Enregistrer le bilan'}
      </button>
      <div style={{ fontSize: '0.76em', color: '#9C8E7D', marginTop: 6 }}>
        Le solde bancaire et les ajustements sont sauvegardés dans la base de données.
      </div>

      {/* Mouvements bancaires SHINE mensuels */}
      {shineData.length > 0 && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginTop: 24 }}>
          <div style={{ background: '#F0EAD8', padding: '10px 16px', fontWeight: 700, fontSize: '0.85em', color: '#5C4B2A', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Mouvements bancaires réels — Shine 2025
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82em' }}>
              <thead>
                <tr style={{ background: '#F7F3EC' }}>
                  <th style={{ ...thS, textAlign: 'left', paddingLeft: 16 }}>Mois</th>
                  <th style={thS}>Entrées</th>
                  <th style={thS}>Sorties</th>
                  <th style={thS}>Solde fin</th>
                  <th style={{ ...thS, color: '#065F46' }}>Airbnb</th>
                  <th style={{ ...thS, color: '#6B21A8' }}>Stripe</th>
                  <th style={{ ...thS, color: '#1D4ED8' }}>Booking</th>
                  <th style={{ ...thS, color: '#B45309' }}>Direct</th>
                </tr>
              </thead>
              <tbody>
                {shineData.map((row, i) => (
                  <tr key={row.mois} style={{ background: i % 2 === 0 ? '#fff' : '#FDFAF4', borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '7px 16px', fontWeight: 600, whiteSpace: 'nowrap' }}>{MOIS_LABELS[row.mois] || row.mois}</td>
                    <td style={{ ...tdNumS, color: '#065F46' }}>+{fmtE(row.credits)}</td>
                    <td style={{ ...tdNumS, color: '#B91C1C' }}>−{fmtE(row.debits)}</td>
                    <td style={{ ...tdNumS, fontWeight: 700 }}>{fmtE(row.solde_fin)}</td>
                    <td style={{ ...tdNumS, color: '#065F46' }}>{row.src_airbnb ? fmtE(row.src_airbnb) : '—'}</td>
                    <td style={{ ...tdNumS, color: '#6B21A8' }}>{row.src_stripe ? fmtE(row.src_stripe) : '—'}</td>
                    <td style={{ ...tdNumS, color: '#1D4ED8' }}>{row.src_booking ? fmtE(row.src_booking) : '—'}</td>
                    <td style={{ ...tdNumS, color: '#B45309' }}>{row.src_direct ? fmtE(row.src_direct) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: '#F0EAD8', borderTop: '2px solid var(--border)' }}>
                  <td style={{ padding: '9px 16px', fontWeight: 700, fontSize: '0.92em' }}>TOTAL 2025</td>
                  <td style={{ ...tdNumS, fontWeight: 700, color: '#065F46' }}>+{fmtE(shineData.reduce((s, r) => s + (r.credits ?? 0), 0))}</td>
                  <td style={{ ...tdNumS, fontWeight: 700, color: '#B91C1C' }}>−{fmtE(shineData.reduce((s, r) => s + (r.debits ?? 0), 0))}</td>
                  <td style={{ ...tdNumS, fontWeight: 700 }}>{fmtE(shineData[shineData.length - 1]?.solde_fin)}</td>
                  <td style={{ ...tdNumS, fontWeight: 700, color: '#065F46' }}>{fmtE(shineData.reduce((s, r) => s + (r.src_airbnb ?? 0), 0))}</td>
                  <td style={{ ...tdNumS, fontWeight: 700, color: '#6B21A8' }}>{fmtE(shineData.reduce((s, r) => s + (r.src_stripe ?? 0), 0))}</td>
                  <td style={{ ...tdNumS, fontWeight: 700, color: '#1D4ED8' }}>{fmtE(shineData.reduce((s, r) => s + (r.src_booking ?? 0), 0))}</td>
                  <td style={{ ...tdNumS, fontWeight: 700, color: '#B45309' }}>{fmtE(shineData.reduce((s, r) => s + (r.src_direct ?? 0), 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
const thS = { padding: '10px 10px', fontWeight: 700, color: '#5C4B2A', textAlign: 'right', whiteSpace: 'nowrap' }
const tdNumS = { padding: '7px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }

function SequestreTempsReel() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [genAt, setGenAt]     = useState(null)
  const [showDetail, setShowDetail] = useState(false)
  const runId = useRef(0)

  const charger = useCallback(async () => {
    const thisRun = ++runId.current
    setLoading(true); setError(null)
    try {
      const today = new Date().toISOString().slice(0, 10)

      // 1. Biens de l'agence
      const { data: biens } = await supabase.from('bien').select('id, code').eq('agence', AGENCE)
      const bienIds = (biens || []).map(b => b.id)
      if (!bienIds.length) { setData({ futurs: [], residuelPasses: [], anomalies: [], totalFuturs: 0, totalResiduel: 0, totalFiable: 0, totalAnomalies: 0 }); return }

      // 2. Toutes les réservations valides de l'agence (avec encaissement > 0)
      const CANCELLED = ['not_accepted', 'not accepted', 'declined', 'expired', 'cancelled']
      let allResas = []
      for (let i = 0; i < bienIds.length; i += 400) {
        const batchBienIds = bienIds.slice(i, i + 400)
        let offset = 0
        while (true) {
          const { data: r, error: rErr } = await supabase
            .from('reservation')
            .select('id, code, platform, guest_name, arrival_date, departure_date, fin_revenue, ventilation_calculee, final_status, owner_stay, rapprochee, bien:bien_id(id, code)')
            .in('bien_id', batchBienIds)
            .gt('fin_revenue', 0)
            .order('id')
            .range(offset, offset + 999)
          if (rErr) throw new Error(`reservation p${offset/1000}: ${rErr.message}`)
          if (!r || r.length === 0) break
          allResas = allResas.concat(r.filter(r =>
            !CANCELLED.includes(r.final_status) &&
            !r.owner_stay &&
            !/^[eé]tudiante?/i.test(r.guest_name || '')
          ))
          if (r.length < 1000) break
          offset += 1000
        }
      }
      const resaIds = allResas.map(r => r.id)
      if (!resaIds.length) { setData({ futurs: [], residuelPasses: [], anomalies: [], totalFuturs: 0, totalResiduel: 0, totalFiable: 0, totalAnomalies: 0 }); return }

      // 3. PAYINs réels prouvés en banque = reservation_paiement avec mouvement_id IS NOT NULL
      // Join via reservation!inner pour filtrer par bienIds (~50 items) au lieu de resaIds (~4500+)
      // → URL courte, pas de troncature silencieuse PostgREST
      const resaIdSet = new Set(resaIds)
      const payinByResa = {}
      {
        let offset = 0
        while (true) {
          const { data: pmts, error: pmtsErr } = await supabase
            .from('reservation_paiement')
            .select('reservation_id, montant, reservation!inner(bien_id)')
            .filter('reservation.bien_id', 'in', `(${bienIds.join(',')})`)
            .not('mouvement_id', 'is', null)
            .order('id')
            .range(offset, offset + 999)
          if (pmtsErr) throw new Error(`reservation_paiement p${offset/1000}: ${pmtsErr.message}`)
          if (!pmts || pmts.length === 0) break
          for (const p of pmts) {
            if (resaIdSet.has(p.reservation_id)) {
              payinByResa[p.reservation_id] = (payinByResa[p.reservation_id] || 0) + (p.montant || 0)
            }
          }
          if (pmts.length < 1000) break
          offset += 1000
        }
      }

      // Plafonner le PAYIN à fin_revenue par resa
      // (certains reservation_paiement Stripe contiennent le batch total au lieu du montant par resa)
      for (const r of allResas) {
        if (payinByResa[r.id] != null && r.fin_revenue > 0) {
          payinByResa[r.id] = Math.min(payinByResa[r.id], r.fin_revenue)
        }
      }


      // Garder uniquement les resas avec au moins un PAYIN prouvé
      const resasAvecPayin = allResas.filter(r => (payinByResa[r.id] || 0) > 0)

      // 4. Tri en catégories
      const currentMonth = today.slice(0, 7) // "YYYY-MM"

      // Airbnb du mois à reverser : CI ce mois + CO déjà passé + PAYIN prouvé
      // Airbnb vire le jour du CI → argent en séquestre → DCB reverse fin de mois
      const airbnbDuMois    = resasAvecPayin.filter(r =>
        r.platform === 'airbnb' &&
        r.arrival_date.startsWith(currentMonth) &&
        r.departure_date <= today
      )
      const airbnbDuMoisIds = new Set(airbnbDuMois.map(r => r.id))

      const futurs          = resasAvecPayin.filter(r => r.departure_date > today)
      // passés et anomalies excluent les airbnbDuMois (déjà comptés dans séquestre fiable)
      const passesVentiles  = resasAvecPayin.filter(r => r.departure_date <= today && r.ventilation_calculee && !airbnbDuMoisIds.has(r.id))
      const anomalies       = resasAvecPayin.filter(r => r.departure_date <= today && !r.ventilation_calculee && !airbnbDuMoisIds.has(r.id))


      // Futurs direct/manual/stripe sans PAYIN prouvé → "À vérifier"
      const futursAVerifier = allResas.filter(r =>
        r.departure_date > today &&
        (r.platform === 'direct' || r.platform === 'manual' || r.platform === 'stripe') &&
        !(payinByResa[r.id] > 0) &&
        !r.rapprochee &&
        r.final_status !== 'request'
      )

      // 5. Ventilation des séjours passés ventilés (hors VIR = code résultat, hors PREST = mémo)
      // Join via reservation!inner pour filtrer par bienIds — même raison que reservation_paiement
      const passesVentilesSet = new Set(passesVentiles.map(r => r.id))
      const ventilByResa = {}
      {
        let offset = 0
        while (true) {
          const { data: ventils, error: ventilsErr } = await supabase
            .from('ventilation')
            .select('reservation_id, code, montant_ht, montant_reel, reservation!inner(bien_id)')
            .filter('reservation.bien_id', 'in', `(${bienIds.join(',')})`)
            .not('code', 'in', '(VIR,PREST,RGLM,SOLDE)')
            .order('id')
            .range(offset, offset + 999)
          if (ventilsErr) throw new Error(`ventilation p${offset/1000}: ${ventilsErr.message}`)
          if (!ventils || ventils.length === 0) break
          for (const v of ventils) {
            if (passesVentilesSet.has(v.reservation_id)) {
              const amt = v.montant_reel != null ? v.montant_reel : (v.montant_ht || 0)
              ventilByResa[v.reservation_id] = (ventilByResa[v.reservation_id] || 0) + amt
            }
          }
          if (ventils.length < 1000) break
          offset += 1000
        }
      }

      // 6. Calcul totaux
      const totalFuturs       = futurs.reduce((s, r) => s + (payinByResa[r.id] || 0), 0)
      const totalAirbnbDuMois = airbnbDuMois.reduce((s, r) => s + (payinByResa[r.id] || 0), 0)
      const totalAVerifier    = futursAVerifier.reduce((s, r) => s + (r.fin_revenue || 0), 0)


      const residuelPasses = passesVentiles.map(r => ({
        ...r,
        payin:    payinByResa[r.id] || 0,
        ventil:   ventilByResa[r.id] || 0,
        residuel: (payinByResa[r.id] || 0) - (ventilByResa[r.id] || 0),
      }))
      const totalResiduel   = residuelPasses.reduce((s, r) => s + r.residuel, 0)
      const totalFiable     = totalFuturs + totalAirbnbDuMois
      const totalAnomalies  = anomalies.reduce((s, r) => s + (payinByResa[r.id] || 0), 0)

      if (thisRun !== runId.current) return

      setData({
        futurs:          futurs.map(r => ({ ...r, payin: payinByResa[r.id] || 0 })),
        airbnbDuMois:    airbnbDuMois.map(r => ({ ...r, payin: payinByResa[r.id] || 0 })),
        residuelPasses,
        anomalies:       anomalies.map(r => ({ ...r, payin: payinByResa[r.id] || 0 })),
        futursAVerifier: futursAVerifier.map(r => ({ ...r, montantAttendu: r.fin_revenue || 0 })),
        totalFuturs, totalAirbnbDuMois, totalResiduel, totalFiable, totalAnomalies, totalAVerifier,
      })
      setGenAt(new Date())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { charger() }, [charger])

  const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('fr-FR') : '—'
  const CANAL_LABEL = { airbnb: 'Airbnb', booking: 'Booking', direct: 'Direct', manual: 'Manuel', stripe: 'Stripe' }

  return (
    <div style={{ maxWidth: 900 }}>
      {/* En-tête */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 700, fontSize: '1em', color: 'var(--text)' }}>
          Séquestre — état au {new Date().toLocaleDateString('fr-FR')}
        </div>
        {genAt && <div style={{ fontSize: '0.8em', color: '#9C8E7D' }}>calculé le <strong>{genAt.toLocaleString('fr-FR')}</strong></div>}
        <button className="btn btn-secondary" onClick={charger} disabled={loading} style={{ marginLeft: 'auto', padding: '6px 14px' }}>
          {loading ? '…' : '↺'}
        </button>
      </div>

      {error && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '12px 16px', color: '#DC2626', marginBottom: 20 }}>{error}</div>}
      {loading && !data && <div style={{ textAlign: 'center', padding: 40, color: '#9C8E7D' }}>Chargement…</div>}

      {data && (() => {
        const { futurs, airbnbDuMois, residuelPasses, anomalies, futursAVerifier, totalFuturs, totalAirbnbDuMois, totalResiduel, totalFiable, totalAnomalies, totalAVerifier } = data
        const residuelOk = Math.abs(totalResiduel) < 100_00 // < 1€ de résidu = propre
        const residuelColor = Math.abs(totalResiduel) < 100_00 ? '#065F46' : Math.abs(totalResiduel) < 500_00 ? '#92400E' : '#DC2626'

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* ── Card principale : séquestre fiable ── */}
            <div style={{ background: '#F0FDF4', border: '2px solid #6EE7B7', borderRadius: 12, padding: '20px 24px' }}>
              <div style={{ fontSize: '0.72em', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#065F46', marginBottom: 8 }}>
                Séquestre théorique fiable
              </div>
              <div style={{ fontSize: '2em', fontWeight: 700, color: '#065F46', fontVariantNumeric: 'tabular-nums', marginBottom: 16 }}>
                {fmt(totalFiable)}
              </div>

              {/* Breakdown */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {/* Acomptes futurs */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'white', borderRadius: 8, border: '1px solid #A7F3D0' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.85em', fontWeight: 600, color: 'var(--text)' }}>Acomptes séjours futurs</div>
                    <div style={{ fontSize: '0.75em', color: '#9C8E7D', marginTop: 2 }}>{futurs.length} résa{futurs.length > 1 ? 's' : ''} — arrivée après aujourd'hui</div>
                  </div>
                  <div style={{ fontSize: '1.1em', fontWeight: 700, color: '#065F46', fontVariantNumeric: 'tabular-nums' }}>{fmt(totalFuturs)}</div>
                </div>
                {airbnbDuMois.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'white', borderRadius: 8, border: '1px solid #FDE68A' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.85em', fontWeight: 600, color: 'var(--text)' }}>Airbnb du mois — à reverser fin de mois</div>
                      <div style={{ fontSize: '0.75em', color: '#9C8E7D', marginTop: 2 }}>{airbnbDuMois.length} résa{airbnbDuMois.length > 1 ? 's' : ''} — CI ce mois, CO passé, payout reçu</div>
                    </div>
                    <div style={{ fontSize: '1.1em', fontWeight: 700, color: '#92400E', fontVariantNumeric: 'tabular-nums' }}>{fmt(totalAirbnbDuMois)}</div>
                  </div>
                )}
              </div>

              {/* Lien détail */}
              <button
                onClick={() => setShowDetail(d => !d)}
                style={{ marginTop: 12, background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8em', color: '#065F46', textDecoration: 'underline', padding: 0 }}
              >
                {showDetail ? 'Masquer le détail' : `Voir le détail (${futurs.length + airbnbDuMois.length} resas)`}
              </button>
            </div>

            {/* ── Détail (expandable) ── */}
            {showDetail && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

                {/* Airbnb du mois à reverser */}
                {airbnbDuMois.length > 0 && (
                  <div style={{ background: 'var(--bg-card, white)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                    <div style={{ background: '#FFFBEB', padding: '8px 14px', fontSize: '0.78em', fontWeight: 700, color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Airbnb du mois — à reverser fin de mois · {airbnbDuMois.length} résa{airbnbDuMois.length > 1 ? 's' : ''}
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84em' }}>
                        <thead>
                          <tr style={{ background: '#F7F3EC' }}>
                            {['Bien', 'Code', 'Voyageur', 'Arrivée', 'Départ', 'PAYIN reçu'].map(h => (
                              <th key={h} style={{ padding: '7px 10px', textAlign: h === 'PAYIN reçu' ? 'right' : 'left', fontWeight: 700, color: '#5C4B2A', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {[...airbnbDuMois].sort((a, b) => a.arrival_date.localeCompare(b.arrival_date)).map((r, i) => (
                            <tr key={r.id} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'white' : '#FDFAF5' }}>
                              <td style={{ padding: '6px 10px', fontWeight: 600, whiteSpace: 'nowrap' }}>{r.bien?.code || '—'}</td>
                              <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: '0.85em', color: '#6B5843' }}>{r.code || '—'}</td>
                              <td style={{ padding: '6px 10px' }}>{r.guest_name || '—'}</td>
                              <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{fmtDate(r.arrival_date)}</td>
                              <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{fmtDate(r.departure_date)}</td>
                              <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: '#92400E' }}>{fmt(r.payin)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Acomptes futurs */}
                {futurs.length > 0 && (
                  <div style={{ background: 'var(--bg-card, white)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                    <div style={{ background: '#EFF6FF', padding: '8px 14px', fontSize: '0.78em', fontWeight: 700, color: '#1D4ED8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Acomptes futurs — {futurs.length} résa{futurs.length > 1 ? 's' : ''}
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84em' }}>
                        <thead>
                          <tr style={{ background: '#F7F3EC' }}>
                            {['Bien', 'Code', 'Canal', 'Voyageur', 'Arrivée', 'Départ', 'PAYIN reçu'].map(h => (
                              <th key={h} style={{ padding: '7px 10px', textAlign: h === 'PAYIN reçu' ? 'right' : 'left', fontWeight: 700, color: '#5C4B2A', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {[...futurs].sort((a, b) => a.arrival_date.localeCompare(b.arrival_date)).map((r, i) => (
                            <tr key={r.id} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'white' : '#FDFAF5' }}>
                              <td style={{ padding: '6px 10px', fontWeight: 600, whiteSpace: 'nowrap' }}>{r.bien?.code || '—'}</td>
                              <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: '0.85em', color: '#6B5843' }}>{r.code || '—'}</td>
                              <td style={{ padding: '6px 10px' }}>{CANAL_LABEL[r.platform] || r.platform || '—'}</td>
                              <td style={{ padding: '6px 10px' }}>{r.guest_name || '—'}</td>
                              <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{fmtDate(r.arrival_date)}</td>
                              <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{fmtDate(r.departure_date)}</td>
                              <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: '#065F46' }}>{fmt(r.payin)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

              </div>
            )}

            {/* ── Diagnostic — Séjours passés ventilés (hors séquestre) ── */}
            {residuelPasses.length > 0 && (
              <div style={{ background: '#F7F3EC', border: '1px solid #D9CEB8', borderRadius: 12, padding: '16px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: '#5C4B2A', fontSize: '0.88em', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Diagnostic — séjours passés ventilés
                    </div>
                    <div style={{ fontSize: '0.75em', color: '#9C8E7D', marginTop: 2 }}>
                      {residuelPasses.length} résa{residuelPasses.length > 1 ? 's' : ''} — contribution = 0 dans le séquestre fiable · PAYIN − ventilation affiché à titre de contrôle uniquement
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.72em', color: '#9C8E7D', marginBottom: 2 }}>Écart PAYIN − ventil.</div>
                    <div style={{ fontSize: '1em', fontWeight: 700, color: residuelColor, fontVariantNumeric: 'tabular-nums' }}>{fmt(totalResiduel)}</div>
                  </div>
                </div>
                <button
                  onClick={() => setShowDetail(d => !d)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.78em', color: '#9C8E7D', textDecoration: 'underline', padding: 0 }}
                >
                  {showDetail ? 'Masquer le détail' : 'Voir le détail ligne par ligne'}
                </button>
                {showDetail && residuelPasses.length > 0 && (
                  <div style={{ marginTop: 10, overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84em' }}>
                      <thead>
                        <tr style={{ background: '#EAE3D4' }}>
                          {['Bien', 'Code', 'Voyageur', 'Départ', 'PAYIN', 'Ventilation', 'Écart'].map(h => (
                            <th key={h} style={{ padding: '7px 10px', textAlign: ['PAYIN','Ventilation','Écart'].includes(h) ? 'right' : 'left', fontWeight: 700, color: '#5C4B2A', whiteSpace: 'nowrap', borderBottom: '1px solid #D9CEB8' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[...residuelPasses].sort((a, b) => b.departure_date.localeCompare(a.departure_date)).map((r, i) => {
                          const col = Math.abs(r.residuel) < 100_00 ? '#5C4B2A' : '#92400E'
                          return (
                            <tr key={r.id} style={{ borderBottom: '1px solid #EAE3D4', background: i % 2 === 0 ? 'white' : '#FDFAF5' }}>
                              <td style={{ padding: '6px 10px', fontWeight: 600, whiteSpace: 'nowrap' }}>{r.bien?.code || '—'}</td>
                              <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: '0.85em', color: '#6B5843' }}>{r.code || '—'}</td>
                              <td style={{ padding: '6px 10px' }}>{r.guest_name || '—'}</td>
                              <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{fmtDate(r.departure_date)}</td>
                              <td style={{ padding: '6px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(r.payin)}</td>
                              <td style={{ padding: '6px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#6B5843' }}>{fmt(r.ventil)}</td>
                              <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: col }}>{fmt(r.residuel)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ── À vérifier : direct/manual/stripe futurs sans PAYIN ── */}
            {futursAVerifier.length > 0 && (
              <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 12, padding: '16px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: '#92400E', fontSize: '0.92em' }}>
                      À vérifier — acompte à contrôler — {futursAVerifier.length} résa{futursAVerifier.length > 1 ? 's' : ''}
                    </div>
                    <div style={{ fontSize: '0.78em', color: '#6B7280', marginTop: 2 }}>
                      Direct / Manuel / Stripe futurs sans PAYIN prouvé en banque. Le paiement voyageur est attendu avant l'arrivée.
                    </div>
                  </div>
                  <div style={{ fontSize: '1.1em', fontWeight: 700, color: '#92400E', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                    {fmt(totalAVerifier)}
                  </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84em' }}>
                    <thead>
                      <tr style={{ background: '#FEF3C7' }}>
                        {['Bien', 'Code', 'Canal', 'Voyageur', 'Arrivée', 'Départ', 'Attendu (fin_revenue)'].map(h => (
                          <th key={h} style={{ padding: '7px 10px', textAlign: h === 'Attendu (fin_revenue)' ? 'right' : 'left', fontWeight: 700, color: '#78350F', whiteSpace: 'nowrap', borderBottom: '1px solid #FDE68A' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...futursAVerifier].sort((a, b) => a.arrival_date.localeCompare(b.arrival_date)).map((r, i) => (
                        <tr key={r.id} style={{ borderBottom: '1px solid #FDE68A', background: i % 2 === 0 ? 'white' : '#FFFDF0' }}>
                          <td style={{ padding: '6px 10px', fontWeight: 600, whiteSpace: 'nowrap' }}>{r.bien?.code || '—'}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: '0.85em', color: '#6B5843' }}>{r.code || '—'}</td>
                          <td style={{ padding: '6px 10px' }}>{CANAL_LABEL[r.platform] || r.platform || '—'}</td>
                          <td style={{ padding: '6px 10px' }}>{r.guest_name || '—'}</td>
                          <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{fmtDate(r.arrival_date)}</td>
                          <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{fmtDate(r.departure_date)}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#92400E' }}>{fmt(r.montantAttendu)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── Anomalies bloquantes ── */}
            {anomalies.length > 0 && (
              <div style={{ background: '#FEF2F2', border: '2px solid #FECACA', borderRadius: 12, padding: '16px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <span style={{ fontSize: '1.1em' }}>⛔</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: '#DC2626', fontSize: '0.92em' }}>
                      Anomalies bloquantes — {anomalies.length} résa{anomalies.length > 1 ? 's' : ''} hors total fiable
                    </div>
                    <div style={{ fontSize: '0.78em', color: '#9C8E7D', marginTop: 2 }}>
                      Séjours passés avec PAYIN prouvé mais ventilation non calculée. Ventiler ces resas pour les intégrer.
                    </div>
                  </div>
                  <div style={{ fontSize: '1.1em', fontWeight: 700, color: '#DC2626', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                    {fmt(totalAnomalies)}
                  </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84em' }}>
                    <thead>
                      <tr style={{ background: '#FEE2E2' }}>
                        {['Bien', 'Code', 'Canal', 'Voyageur', 'Arrivée', 'Départ', 'PAYIN reçu'].map(h => (
                          <th key={h} style={{ padding: '7px 10px', textAlign: h === 'PAYIN reçu' ? 'right' : 'left', fontWeight: 700, color: '#991B1B', whiteSpace: 'nowrap', borderBottom: '1px solid #FECACA' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...anomalies].sort((a, b) => b.departure_date.localeCompare(a.departure_date)).map((r, i) => (
                        <tr key={r.id} style={{ borderBottom: '1px solid #FECACA', background: i % 2 === 0 ? 'white' : '#FFF5F5' }}>
                          <td style={{ padding: '6px 10px', fontWeight: 600, whiteSpace: 'nowrap' }}>{r.bien?.code || '—'}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: '0.85em', color: '#6B5843' }}>{r.code || '—'}</td>
                          <td style={{ padding: '6px 10px' }}>{CANAL_LABEL[r.platform] || r.platform || '—'}</td>
                          <td style={{ padding: '6px 10px' }}>{r.guest_name || '—'}</td>
                          <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{fmtDate(r.arrival_date)}</td>
                          <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{fmtDate(r.departure_date)}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: '#DC2626' }}>{fmt(r.payin)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          </div>
        )
      })()}
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// Séquestre clôture — encaissements avant le 31/12 pour séjours N+1
// ─────────────────────────────────────────────────────────────────────────────

const STATUT_SEQ = {
  certain:              { label: 'Certain',                                color: '#065F46', bg: '#D1FAE5' },
  certain_manuel:       { label: 'Certain — manuel rapproché',             color: '#065F46', bg: '#D1FAE5' },
  booking_prevu:        { label: 'En attente de paiement par Booking',     color: '#1D4ED8', bg: '#DBEAFE' },
  a_verifier_acompte:   { label: 'Acompte à contrôler',                   color: '#7C3AED', bg: '#EDE9FE' },
  exclu_perimetre:      { label: 'Exclu — hors périmètre',                 color: '#6B5843', bg: '#FEF9F0' },
}
const CANAL_SEQ = { airbnb: 'Airbnb', booking: 'Booking', direct: 'Direct', manual: 'Manuel', stripe: 'Stripe' }


function SequestreCloture() {
  const [anneeCloture, setAnneeCloture]   = useState(2025)
  const [vue, setVue]                     = useState('calcul') // 'calcul' | 'perimetre'
  const [biensList, setBiensList]         = useState([])
  const [perimetre, setPerimetre]         = useState([])
  const [perimetreLoading, setPerimetreLoading] = useState(false)
  const [lignes, setLignes]               = useState([])
  const [loading, setLoading]             = useState(false)
  const [error, setError]                 = useState(null)
  const [filtreStatut, setFiltreStatut]   = useState('tous')
  const [syncingStripe, setSyncingStripe] = useState(false)
  const [syncLog, setSyncLog]             = useState(null)

  const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('fr-FR') : '—'

  // ── Charge tous les biens agence (une seule fois) ─────────────────────────
  useEffect(() => {
    supabase.from('bien').select('id, code, hospitable_name').eq('agence', AGENCE).order('code')
      .then(({ data }) => setBiensList(data || []))
  }, [])

  // ── Charge le périmètre mensuel DB pour l'année ───────────────────────────
  const chargerPerimetre = useCallback(async () => {
    if (!biensList.length) return
    setPerimetreLoading(true)
    const { data } = await supabase
      .from('sequestre_perimetre_mensuel')
      .select('bien_id, mois, perception_loyer_plateforme, source, note')
      .in('bien_id', biensList.map(b => b.id))
      .gte('mois', `${anneeCloture}-01`)
      .lte('mois', `${anneeCloture}-12`)
    setPerimetre(data || [])
    setPerimetreLoading(false)
  }, [anneeCloture, biensList])

  useEffect(() => { chargerPerimetre() }, [chargerPerimetre])

  // ── Map {bien_id|mois → boolean} pour lookup O(1) ────────────────────────
  const perimetreMap = useMemo(() => {
    const m = {}
    for (const p of perimetre) m[`${p.bien_id}|${p.mois}`] = p.perception_loyer_plateforme
    return m
  }, [perimetre])

  // ── Toggle une cellule (upsert DB + mise à jour locale optimiste) ─────────
  const togglePerimetre = async (bien_id, mois, currentValue) => {
    const newValue = !currentValue
    setPerimetre(prev => {
      const idx = prev.findIndex(p => p.bien_id === bien_id && p.mois === mois)
      if (idx >= 0) return prev.map((p, i) => i === idx ? { ...p, perception_loyer_plateforme: newValue } : p)
      return [...prev, { bien_id, mois, perception_loyer_plateforme: newValue, source: 'manuel' }]
    })
    await supabase.from('sequestre_perimetre_mensuel').upsert(
      { bien_id, mois, perception_loyer_plateforme: newValue, source: 'manuel', updated_at: new Date().toISOString() },
      { onConflict: 'bien_id,mois' }
    )
  }

  // ── Calcul séquestre ──────────────────────────────────────────────────────
  const charger = useCallback(async () => {
    if (!biensList.length) return
    setLoading(true); setError(null); setLignes([])
    const dateCloture      = `${anneeCloture}-12-31`
    const dateDebutSuivant = `${anneeCloture + 1}-01-01`
    const bienIds = biensList.map(b => b.id)

    // Helper : DCB percevait-il les loyers plateforme pour ce bien ce mois ?
    // Défaut true si aucune entrée en DB (comportement historique par défaut)
    const percevait = (bien_id, dateStr) => {
      if (!dateStr) return null
      const key = `${bien_id}|${dateStr.slice(0, 7)}`
      return key in perimetreMap ? perimetreMap[key] : true
    }

    try {
      // 1. Réservations arrivant en N+1
      const CANCELLED = ['not_accepted', 'not accepted', 'declined', 'expired', 'cancelled']
      let resasAll = []
      for (let i = 0; i < bienIds.length; i += 400) {
        const { data, error: e } = await supabase
          .from('reservation')
          .select('id, code, platform, arrival_date, departure_date, fin_revenue, rapprochee, guest_name, final_status, owner_stay, booking_date, bien:bien_id(id, code, hospitable_name)')
          .in('bien_id', bienIds.slice(i, i + 400))
          .gte('arrival_date', dateDebutSuivant)
        if (e) throw new Error(e.message)
        resasAll = resasAll.concat((data || []).filter(r =>
          !CANCELLED.includes(r.final_status) &&
          !r.owner_stay &&
          !/^[eé]tudiante?/i.test(r.guest_name || '')
        ))
      }
      if (!resasAll.length) { setLignes([]); setLoading(false); return }
      const resaIds = resasAll.map(r => r.id)

      // 2. VIR ventilations avec date mouvement (Airbnb & Booking)
      const virByResa = {}
      for (let i = 0; i < resaIds.length; i += 400) {
        const { data: virs } = await supabase
          .from('ventilation')
          .select('reservation_id, mouvement:mouvement_id(date_operation)')
          .in('reservation_id', resaIds.slice(i, i + 400))
          .eq('code', 'VIR').not('mouvement_id', 'is', null)
        for (const v of virs || []) {
          if (!virByResa[v.reservation_id]) virByResa[v.reservation_id] = []
          virByResa[v.reservation_id].push(v)
        }
      }

      // Airbnb sans VIRPayinProuvé = exclu. Booking sans VIRPayinProuvé = gardé si booking_payout_line connue
      resasAll = resasAll.filter(r => {
        if (r.platform === 'airbnb') {
          const virs = virByResa[r.id] || []
          return virs.some(v => v.mouvement?.date_operation && v.mouvement.date_operation <= dateCloture)
        }
        return true // Booking, direct, stripe, manual : on garde, on classifiera après
      })

      // Fetch booking_payout_line pour les resas Booking (payout prévu en N+1)
      const bookingCodes = resasAll.filter(r => r.platform === 'booking').map(r => r.code).filter(Boolean)
      const bplByCode = {}
      if (bookingCodes.length) {
        for (let i = 0; i < bookingCodes.length; i += 400) {
          const { data: bpls } = await supabase
            .from('booking_payout_line')
            .select('booking_ref, payout_date, amount_cents, checkin')
            .in('booking_ref', bookingCodes.slice(i, i + 400))
          for (const b of bpls || []) {
            if (!bplByCode[b.booking_ref]) bplByCode[b.booking_ref] = b
          }
        }
      }
      if (!resasAll.length) { setLignes([]); setLoading(false); return }

      // 3. Paiements réels (direct, stripe, manual)
      const pmtByResa = {}
      for (let i = 0; i < resaIds.length; i += 400) {
        const { data: pmts } = await supabase
          .from('reservation_paiement')
          .select('reservation_id, montant, date_paiement')
          .in('reservation_id', resaIds.slice(i, i + 400))
        for (const p of pmts || []) {
          if (!pmtByResa[p.reservation_id]) pmtByResa[p.reservation_id] = []
          pmtByResa[p.reservation_id].push(p)
        }
      }

      // 3b. Charges Stripe (stripe_payout_line) pour détecter resas payées après clôture
      // Si TOUTES les charges d'une résa sont > dateCloture → résa faite en N+1, exclure
      const splCodes = resasAll
        .filter(r => r.platform === 'direct' || r.platform === 'stripe')
        .map(r => r.code).filter(Boolean)
      const splByCode = {} // code → { avant: bool, apres: bool, minDate: string|null }
      if (splCodes.length) {
        for (let i = 0; i < splCodes.length; i += 400) {
          const { data: spls } = await supabase
            .from('stripe_payout_line')
            .select('reservation_code, created_at')
            .in('reservation_code', splCodes.slice(i, i + 400))
          for (const s of spls || []) {
            if (!splByCode[s.reservation_code]) splByCode[s.reservation_code] = { avant: false, apres: false, minDate: null }
            if (s.created_at <= dateCloture) splByCode[s.reservation_code].avant = true
            else splByCode[s.reservation_code].apres = true
            if (!splByCode[s.reservation_code].minDate || s.created_at < splByCode[s.reservation_code].minDate)
              splByCode[s.reservation_code].minDate = s.created_at
          }
        }
      }

      // 4. Classifier
      const result = resasAll.map(r => {
        const virs  = virByResa[r.id] || []
        const pmts  = pmtByResa[r.id] || []
        const virProuve   = virs.find(v => v.mouvement?.date_operation && v.mouvement.date_operation <= dateCloture)
        const pmtProuves  = pmts.filter(p => p.date_paiement && p.date_paiement <= dateCloture)
        const pmtSomme    = pmtProuves.reduce((s, p) => s + (p.montant || 0), 0)
        const hasPmtProuve = pmtProuves.length > 0
        const hasVirProuve = !!virProuve

        let statut, montant, dateEnc = null, inTotal = false
        const bienId = r.bien?.id

        if (r.platform === 'airbnb' || r.platform === 'booking') {
          montant = r.fin_revenue || 0
          if (hasVirProuve) {
            dateEnc = virProuve.mouvement.date_operation
            if (percevait(bienId, dateEnc) === false) {
              statut = 'exclu_perimetre'
            } else {
              statut = 'certain'; inTotal = true
            }
          } else if (r.platform === 'booking') {
            const bd = r.booking_date ? r.booking_date.slice(0, 10) : null
            if (bd && bd > dateCloture) {
              // Résa bookée après clôture → exclure
              statut = 'exclu_post_cloture'; montant = r.fin_revenue || 0
            } else {
              const bpl = bplByCode[r.code]
              if (bpl) {
                // Payout connu via booking_payout_line → informatif comptable
                statut = 'booking_prevu'
                dateEnc = bpl.payout_date
                montant = bpl.amount_cents || r.fin_revenue || 0
              } else {
                // Pas dans booking_payout_line → inconnu, masquer
                statut = 'absent'
              }
            }
          } else {
            statut = 'exclu_perimetre' // Airbnb VIR prouvé mais hors périmètre (ne devrait pas arriver ici)
          }
        } else if (r.platform === 'manual') {
          // Toujours analysé — pas de filtre périmètre
          if (hasPmtProuve) {
            statut = 'certain_manuel'; montant = pmtSomme
            dateEnc = [...pmtProuves].sort((a, b) => (b.date_paiement||'').localeCompare(a.date_paiement||''))[0]?.date_paiement
          } else {
            const bd = r.booking_date ? r.booking_date.slice(0, 10) : null
            if (bd && bd <= dateCloture) {
              statut = 'a_verifier_acompte'; montant = r.fin_revenue || 0
            } else {
              statut = 'exclu_post_cloture'; montant = r.fin_revenue || 0
            }
          }
        } else {
          // direct, stripe — source de vérité = reservation_paiement
          if (hasPmtProuve) {
            statut = 'certain'; montant = pmtSomme; inTotal = true
            dateEnc = [...pmtProuves].sort((a, b) => (b.date_paiement||'').localeCompare(a.date_paiement||''))[0]?.date_paiement
          } else {
            // Pas de paiement avant clôture
            // Priorité 1 : booking_date (source fiable Hospitable)
            const bd = r.booking_date ? r.booking_date.slice(0, 10) : null
            // Priorité 2 : stripe_payout_line (charge uniquement après clôture)
            const spl = splByCode[r.code]
            const splAvant = spl && spl.avant
            // exclu_post_cloture si : booking_date > clôture, OU booking_date null sans charge Stripe avant clôture
            // Seule une preuve d'antériorité (booking_date <= clôture OU splAvant) maintient à_verifier
            if (bd && bd <= dateCloture) {
              statut = 'a_verifier_acompte'; montant = r.fin_revenue || 0
            } else if (!bd && splAvant) {
              statut = 'a_verifier_acompte'; montant = r.fin_revenue || 0
            } else {
              // Pas de preuve que la résa date d'avant clôture → exclure
              statut = 'exclu_post_cloture'; montant = r.fin_revenue || 0
            }
          }
        }

        // Date de réservation : booking_date Hospitable en priorité, sinon 1ère charge Stripe
        const dateCharge = r.booking_date
          ? r.booking_date.slice(0, 10)
          : (splByCode[r.code]?.minDate ?? null)

        return { ...r, statut, montant, dateEnc, inTotal, dateCharge }
      }).filter(l => l.statut !== 'exclu_post_cloture' && l.statut !== 'absent' && l.statut !== 'exclu')

      setLignes(result)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [anneeCloture, perimetreMap, biensList])

  useEffect(() => {
    if (biensList.length > 0) charger()
  }, [charger, biensList.length])

  const lignesFiltrees = filtreStatut === 'tous' ? lignes : lignes.filter(l => l.statut === filtreStatut)
  const totalCertain   = lignes.filter(l => l.statut === 'certain' || l.statut === 'certain_manuel').reduce((s, l) => s + l.montant, 0)
  const totalAVerifier = lignes.filter(l => l.statut === 'booking_prevu' || l.statut === 'a_verifier_acompte').reduce((s, l) => s + l.montant, 0)
  const totalHorsBilan = lignes.filter(l => l.statut === 'exclu_perimetre').reduce((s, l) => s + l.montant, 0)

  const FILTRES = [
    { key: 'tous',               label: 'Tous' },
    { key: 'certain',            label: 'Certain' },
    { key: 'certain_manuel',     label: 'Certain — manuel' },
    { key: 'booking_prevu',      label: 'En attente Booking' },
    { key: 'a_verifier_acompte', label: 'Acompte à contrôler' },
    { key: 'exclu_perimetre',    label: 'Hors périmètre' },
  ]

  const dateCloture      = `${anneeCloture}-12-31`
  const dateDebutSuivant = `${anneeCloture + 1}-01-01`
  const moisAnnee = Array.from({ length: 12 }, (_, i) => `${anneeCloture}-${String(i + 1).padStart(2, '0')}`)

  const tabSStyle = k => ({
    padding: '5px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.88em',
    fontWeight: vue === k ? 700 : 400,
    color: vue === k ? 'var(--brand)' : '#9C8E7D',
    borderBottom: vue === k ? '2px solid var(--brand)' : '2px solid transparent',
    marginBottom: -1,
  })

  return (
    <div>
      {/* En-tête : sélecteur année + rafraîchir */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 0, flexWrap: 'wrap' }}>
        <span style={{ color: '#5C4B2A', fontWeight: 600, fontSize: '0.9em' }}>Clôture exercice</span>
        <select value={anneeCloture} onChange={e => setAnneeCloture(Number(e.target.value))}
          style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', background: 'white', fontSize: '0.9em' }}>
          {[2024, 2025, 2026].map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <span style={{ color: '#9C8E7D', fontSize: '0.82em' }}>
          Séjours arrivant à partir du {fmtDate(dateDebutSuivant)} · encaissés avant le {fmtDate(dateCloture)}
        </span>
        {HAS_STRIPE_SEQUESTRE && (
          <button
            disabled={syncingStripe || loading}
            onClick={async () => {
              setSyncingStripe(true); setSyncLog(null)
              try {
                const res = await syncStripeAcomptesSequestre(lignes, dateCloture)
                setSyncLog(res)
                if (res.found > 0 || res.inserted > 0) await charger()
              } finally { setSyncingStripe(false) }
            }}
            style={{ padding: '5px 14px', background: '#635BFF', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.85em', opacity: (syncingStripe || loading) ? 0.6 : 1 }}>
            {syncingStripe ? '⏳ Recherche…' : '⚡ Acomptes Stripe'}
          </button>
        )}
        <button onClick={charger}
          style={{ marginLeft: HAS_STRIPE_SEQUESTRE ? 0 : 'auto', padding: '5px 14px', background: 'var(--brand)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.85em' }}>
          ↺ Rafraîchir
        </button>
      </div>
      {syncLog && (
        <div style={{ fontSize: '0.82em', color: syncLog.errors ? '#DC2626' : '#065F46', marginTop: 6, marginBottom: -8 }}>
          Stripe : {syncLog.found} résa(s) trouvée(s), {syncLog.inserted} paiement(s) inséré(s)
          {syncLog.errors > 0 && `, ${syncLog.errors} erreur(s)`}
          {syncLog.inserted === 0 && syncLog.errors === 0 && ' — aucun nouveau paiement trouvé'}
        </div>
      )}

      {/* Sous-onglets Calcul / Périmètre mensuel */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 20, marginTop: 14 }}>
        <button onClick={() => setVue('calcul')}    style={tabSStyle('calcul')}>Calcul clôture</button>
        <button onClick={() => setVue('perimetre')} style={tabSStyle('perimetre')}>
          Périmètre mensuel {perimetreLoading ? '…' : ''}
        </button>
      </div>

      {error && (
        <div style={{ padding: 12, background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 6, color: '#DC2626', marginBottom: 16, fontSize: '0.88em' }}>
          {error}
        </div>
      )}

      {/* ── VUE CALCUL ─────────────────────────────────────────────────────── */}
      {vue === 'calcul' && (
        loading ? (
          <div style={{ textAlign: 'center', padding: 48, color: '#9C8E7D' }}>Chargement…</div>
        ) : (
          <>
            {/* Cartes récap */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
              <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 18px' }}>
                <div style={{ fontSize: '0.76em', color: '#6B5843', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Séquestre certain</div>
                <div style={{ fontSize: '1.4em', fontWeight: 700, color: '#065F46', fontVariantNumeric: 'tabular-nums' }}>{NF.format(totalCertain / 100)} €</div>
                <div style={{ fontSize: '0.75em', color: '#9C8E7D', marginTop: 3 }}>{lignes.filter(l => l.statut === 'certain' || l.statut === 'certain_manuel').length} résa(s) — Airbnb/Booking/manuel prouvés</div>
              </div>
              <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 18px' }}>
                <div style={{ fontSize: '0.76em', color: '#6B5843', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>À confirmer</div>
                <div style={{ fontSize: '1.4em', fontWeight: 700, color: '#92400E', fontVariantNumeric: 'tabular-nums' }}>{NF.format(totalAVerifier / 100)} €</div>
                <div style={{ fontSize: '0.75em', color: '#9C8E7D', marginTop: 3 }}>{lignes.filter(l => l.statut === 'booking_prevu' || l.statut === 'a_verifier_acompte').length} résa(s) — Booking prévu + acomptes</div>
              </div>
              <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 18px' }}>
                <div style={{ fontSize: '0.76em', color: '#6B5843', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Hors périmètre</div>
                <div style={{ fontSize: '1.4em', fontWeight: 700, color: '#9C8E7D', fontVariantNumeric: 'tabular-nums' }}>{NF.format(totalHorsBilan / 100)} €</div>
                <div style={{ fontSize: '0.75em', color: '#9C8E7D', marginTop: 3 }}>{lignes.filter(l => l.statut === 'exclu_perimetre').length} résa(s) — hors bilan</div>
              </div>
            </div>

            {/* Filtres */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
              {FILTRES.map(f => {
                const count = f.key === 'tous' ? lignes.length : lignes.filter(l => l.statut === f.key).length
                return (
                  <button key={f.key} onClick={() => setFiltreStatut(f.key)}
                    style={{ padding: '4px 12px', borderRadius: 20, border: '1px solid var(--border)', background: filtreStatut === f.key ? 'var(--brand)' : 'white', color: filtreStatut === f.key ? 'white' : '#5C4B2A', cursor: 'pointer', fontSize: '0.82em', fontWeight: filtreStatut === f.key ? 700 : 400 }}>
                    {f.label} ({count})
                  </button>
                )
              })}
            </div>

            {/* Tableau */}
            {lignesFiltrees.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#9C8E7D' }}>Aucune réservation pour ce filtre.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.87em' }}>
                  <thead>
                    <tr style={{ background: '#F7F3EC' }}>
                      {['Bien', 'Résa', 'Date résa', 'Canal', 'Voyageur', 'Arrivée', 'Départ', 'Date enc.', 'Montant', 'Statut'].map(h => (
                        <th key={h} style={{ padding: '8px 10px', textAlign: h === 'Montant' ? 'right' : 'left', fontWeight: 700, color: '#5C4B2A', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lignesFiltrees.map((l, i) => {
                      const sl = STATUT_SEQ[l.statut] || { label: l.statut, color: '#5C4B2A', bg: '#F7F3EC' }
                      return (
                        <tr key={l.id} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'white' : '#FDFAF5' }}>
                          <td style={{ padding: '7px 10px', whiteSpace: 'nowrap', fontWeight: 600 }}>{l.bien?.code || '—'}</td>
                          <td style={{ padding: '7px 10px', color: '#6B5843', fontSize: '0.85em', fontFamily: 'monospace' }}>{l.code || '—'}</td>
                          <td style={{ padding: '7px 10px', whiteSpace: 'nowrap', color: l.dateCharge ? '#6B5843' : '#C4B49C', fontSize: '0.85em' }}>{l.dateCharge ? fmtDate(l.dateCharge) : '—'}</td>
                          <td style={{ padding: '7px 10px' }}>{CANAL_SEQ[l.platform] || l.platform || '—'}</td>
                          <td style={{ padding: '7px 10px' }}>{l.guest_name || '—'}</td>
                          <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>{fmtDate(l.arrival_date)}</td>
                          <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>{fmtDate(l.departure_date)}</td>
                          <td style={{ padding: '7px 10px', whiteSpace: 'nowrap', color: l.dateEnc ? '#065F46' : '#9C8E7D' }}>{fmtDate(l.dateEnc)}</td>
                          <td style={{ padding: '7px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontWeight: l.statut === 'certain' ? 700 : 400, color: l.statut === 'certain' ? '#065F46' : '#5C4B2A' }}>{NF.format(l.montant / 100)} €</td>
                          <td style={{ padding: '7px 10px' }}>
                            <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 12, background: sl.bg, color: sl.color, fontSize: '0.82em', fontWeight: 600, whiteSpace: 'nowrap' }}>{sl.label}</span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )
      )}

      {/* ── VUE PÉRIMÈTRE MENSUEL ──────────────────────────────────────────── */}
      {vue === 'perimetre' && (
        <div>
          <div style={{ fontSize: '0.82em', color: '#9C8E7D', marginBottom: 14, lineHeight: 1.5 }}>
            <strong style={{ color: '#5C4B2A' }}>Périmètre historique de perception des loyers — exercice {anneeCloture}.</strong>{` `}
            Coché = DCB percevait les loyers plateforme (Airbnb/Booking) ce mois-là.
            Ce filtre s'applique uniquement aux canaux Airbnb et Booking.
            Les réservations direct/stripe/manual sont toujours analysées.
            Les modifications sont sauvegardées immédiatement en base.
          </div>
          {perimetreLoading ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#9C8E7D' }}>Chargement…</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: '0.84em' }}>
                <thead>
                  <tr style={{ background: '#F7F3EC' }}>
                    <th style={{ padding: '8px 14px', textAlign: 'left', borderBottom: '1px solid var(--border)', fontWeight: 700, color: '#5C4B2A', position: 'sticky', left: 0, background: '#F7F3EC', zIndex: 1, minWidth: 110 }}>Bien</th>
                    {moisAnnee.map((m, i) => (
                      <th key={m} style={{ padding: '6px 0', textAlign: 'center', borderBottom: '1px solid var(--border)', borderLeft: '1px solid var(--border)', fontWeight: 600, color: '#5C4B2A', minWidth: 48 }}>
                        {MOIS_FR[i]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {biensList.map((b, bi) => {
                    const rowBg = bi % 2 === 0 ? 'white' : '#FDFAF5'
                    return (
                      <tr key={b.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '5px 14px', fontWeight: 600, whiteSpace: 'nowrap', position: 'sticky', left: 0, background: rowBg, zIndex: 1, color: '#2C2416' }}>
                          {b.code || b.hospitable_name || '—'}
                        </td>
                        {moisAnnee.map(m => {
                          const key = `${b.id}|${m}`
                          const checked = key in perimetreMap ? perimetreMap[key] : true
                          return (
                            <td key={m} style={{ padding: '4px 0', textAlign: 'center', borderLeft: '1px solid var(--border)', background: checked ? rowBg : '#FEF9F0' }}>
                              <input type="checkbox" checked={checked} onChange={() => togglePerimetre(b.id, m, checked)}
                                style={{ accentColor: 'var(--brand)', width: 15, height: 15, cursor: 'pointer' }} />
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Wrapper OngletSequestre — sous-onglets Temps réel / Clôture
// ─────────────────────────────────────────────────────────────────────────────

function OngletSequestre() {
  const [vue, setVue] = useState(() => localStorage.getItem('seq_vue') || 'realtime')
  const switchVue = v => { setVue(v); localStorage.setItem('seq_vue', v) }

  const tabStyle = k => ({
    padding: '7px 18px', border: 'none', background: 'none', cursor: 'pointer',
    fontWeight: vue === k ? 700 : 400,
    color: vue === k ? 'var(--brand)' : '#9C8E7D',
    borderBottom: vue === k ? '2px solid var(--brand)' : '2px solid transparent',
    marginBottom: -1, fontSize: '0.93em', transition: 'color 0.15s',
  })

  return (
    <div>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 24 }}>
        <button onClick={() => switchVue('realtime')} style={tabStyle('realtime')}>Temps réel</button>
        <button onClick={() => switchVue('cloture')}  style={tabStyle('cloture')}>Clôture</button>
      </div>
      {vue === 'realtime' && <SequestreTempsReel />}
      {vue === 'cloture'  && <SequestreCloture />}
    </div>
  )
}
