import { useState, useEffect, useCallback, useMemo } from 'react'
import MoisSelector, { MOIS_FR } from '../components/MoisSelector'
import { useMoisPersisted } from '../hooks/useMoisPersisted'
import { supabase } from '../lib/supabase'
import { buildComptaMensuelle } from '../services/buildComptaMensuelle'
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
    { key: 'reversement_calcule',  label: 'Reversement',   def: true },
    { key: 'taxe',                 label: 'TAXE',          def: true },
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
      const result = await buildComptaMensuelle(mois)
      setData(result)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
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
          { key: 'rapport2025', label: 'Rapport 2025' },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => switchTab(key)}
            style={{ padding: '8px 20px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.9em', fontWeight: tab === key ? 700 : 400, color: tab === key ? 'var(--brand)' : '#9C8E7D', borderBottom: tab === key ? '2px solid var(--brand)' : '2px solid transparent', marginBottom: -2, transition: 'color 0.15s' }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'sequestre' && <OngletSequestre />}
      {tab === 'rapport2025' && <OngletRapport2025 />}

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
                {col('reversement_calcule') && <th style={{ ...th, textAlign: 'right' }}>Reversement</th>}
                {col('taxe')                && <th style={{ ...th, textAlign: 'right' }}>TAXE</th>}
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
                  {col('reversement_calcule') && <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: r.reversement_calcule ? 600 : 400 }}>{r.reversement_calcule ? fmtN(r.reversement_calcule) : '—'}</td>}
                  {col('taxe')                && <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.taxe_ht ? fmtN(r.taxe_ht) : '—'}</td>}
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
                  {col('reversement_calcule') && <td style={{ ...td, textAlign: 'right' }}>{fmtN(rowsFiltrees.reduce((s, r) => s + r.reversement_calcule, 0))}</td>}
                  {col('taxe')                && <td style={{ ...td, textAlign: 'right' }}>{fmtN(rowsFiltrees.reduce((s, r) => s + r.taxe_ht,             0))}</td>}
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

function OngletRapport2025() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [moisFiltre, setMoisFiltre] = useState('all')
  const [vue, setVue] = useState('bilan') // 'bilan' | 'synthese' | 'detail'

  useEffect(() => {
    supabase.from('sequestre_rapport_item')
      .select('*')
      .eq('agence', AGENCE)
      .eq('annee', 2025)
      .order('mois')
      .order('bien_name')
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else setItems(data || [])
        setLoading(false)
      })
  }, [])

  const moisDispos = [...new Set(items.map(i => i.mois))].sort()
  const itemsFiltres = moisFiltre === 'all' ? items : items.filter(i => i.mois === moisFiltre)

  // Totaux globaux
  const totVir = sumE(itemsFiltres, 'vir_montant')
  const totHonHt = sumE(itemsFiltres, 'hon_ht')
  const totHonTtc = sumE(itemsFiltres, 'hon_ttc')
  const totMen = sumE(itemsFiltres, 'menages')
  const totDeb = sumE(itemsFiltres, 'debours')
  const totTaxe = sumE(itemsFiltres, 'taxe_sejour')
  const totCom = sumE(itemsFiltres, 'com_distrib')

  // Synthèse par mois
  const parMois = moisDispos.map(m => {
    const rows = items.filter(i => i.mois === m)
    return {
      mois: m,
      label: MOIS_LABELS[m] || m,
      nbBiens: rows.filter(r => !r.facture_chaos).length,
      vir: sumE(rows, 'vir_montant'),
      honTtc: sumE(rows, 'hon_ttc'),
      honHt: sumE(rows, 'hon_ht'),
      menages: sumE(rows, 'menages'),
      debours: sumE(rows, 'debours'),
      taxe: sumE(rows, 'taxe_sejour'),
      com: sumE(rows, 'com_distrib'),
    }
  })

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: '#9C8E7D' }}>Chargement…</div>
  if (error) return <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '12px 16px', color: '#DC2626' }}>{error}</div>
  if (!items.length) return (
    <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '16px 20px', color: '#92400E' }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Données 2025 non chargées</div>
      <div style={{ fontSize: '0.85em' }}>Exécutez la migration <code>102_sequestre_rapport_2025.sql</code> dans Supabase pour importer les données.</div>
    </div>
  )

  return (
    <div style={{ maxWidth: 1200 }}>
      {/* En-tête + onglets */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 700, fontSize: '1em', color: 'var(--text)' }}>Rapport séquestre 2025</div>
        <div style={{ fontSize: '0.78em', color: '#9C8E7D' }}>Source : rapports Hospitable (PDFs) — {items.length} lignes</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {[
            { key: 'bilan',    label: 'Bilan comptable' },
            { key: 'synthese', label: 'Synthèse mensuelle' },
            { key: 'detail',   label: 'Détail par bien' },
          ].map(({ key, label }) => (
            <button key={key} onClick={() => setVue(key)}
              className={vue === key ? 'btn btn-primary' : 'btn btn-secondary'}
              style={{ padding: '5px 12px', fontSize: '0.82em' }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Stats globales (hors bilan) */}
      {vue !== 'bilan' && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        <StatCardE label="VIR proprios" value={fmtE(totVir)} sub={moisFiltre === 'all' ? 'Année 2025' : MOIS_LABELS[moisFiltre]} color="#065F46" />
        <StatCardE label="HON TTC" value={fmtE(totHonTtc)} sub={`HT : ${fmtE(totHonHt)}`} />
        <StatCardE label="Ménages" value={fmtE(totMen)} />
        <StatCardE label="Débours" value={fmtE(totDeb)} />
        {totTaxe > 0 && <StatCardE label="Taxe de séjour" value={fmtE(totTaxe)} />}
        {totCom > 0 && <StatCardE label="COM distrib" value={fmtE(totCom)} />}
        <StatCardE
          label="Total sorties séquestre"
          value={fmtE(totVir + totHonTtc + totMen + totDeb + totTaxe + totCom)}
          color="#92400E"
        />
      </div>}

      {/* ── Vue Bilan comptable ── */}
      {vue === 'bilan' && <BilanSequestre items={items} />}

      {/* ── Vue Synthèse par mois ── */}
      {vue === 'synthese' && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84em' }}>
            <thead>
              <tr style={{ background: '#F0EAD8', borderBottom: '2px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '10px 14px', fontWeight: 700, color: '#5C4B2A' }}>Mois</th>
                <th style={{ textAlign: 'right', padding: '10px 14px', fontWeight: 700, color: '#5C4B2A' }}>Biens</th>
                <th style={{ textAlign: 'right', padding: '10px 14px', fontWeight: 700, color: '#5C4B2A' }}>VIR proprios</th>
                <th style={{ textAlign: 'right', padding: '10px 14px', fontWeight: 700, color: '#5C4B2A' }}>HON TTC</th>
                <th style={{ textAlign: 'right', padding: '10px 14px', fontWeight: 700, color: '#5C4B2A' }}>HON HT</th>
                <th style={{ textAlign: 'right', padding: '10px 14px', fontWeight: 700, color: '#5C4B2A' }}>Ménages</th>
                <th style={{ textAlign: 'right', padding: '10px 14px', fontWeight: 700, color: '#5C4B2A' }}>Débours</th>
                <th style={{ textAlign: 'right', padding: '10px 14px', fontWeight: 700, color: '#5C4B2A' }}>Taxe</th>
                <th style={{ textAlign: 'right', padding: '10px 14px', fontWeight: 700, color: '#5C4B2A' }}>Total sorti</th>
              </tr>
            </thead>
            <tbody>
              {parMois.map((m, idx) => (
                <tr key={m.mois} style={{ borderBottom: '1px solid var(--border)', background: idx % 2 === 0 ? 'transparent' : '#FAF7F1' }}
                  onClick={() => { setMoisFiltre(m.mois); setVue('detail') }}
                  style={{ borderBottom: '1px solid var(--border)', background: idx % 2 === 0 ? 'transparent' : '#FAF7F1', cursor: 'pointer' }}
                  title="Cliquer pour voir le détail">
                  <td style={{ padding: '9px 14px', fontWeight: 600, color: 'var(--text)' }}>{m.label}</td>
                  <td style={{ padding: '9px 14px', textAlign: 'right', color: '#9C8E7D' }}>{m.nbBiens}</td>
                  <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: 600, color: '#065F46', fontVariantNumeric: 'tabular-nums' }}>{fmtE(m.vir)}</td>
                  <td style={{ padding: '9px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtE(m.honTtc)}</td>
                  <td style={{ padding: '9px 14px', textAlign: 'right', color: '#9C8E7D', fontVariantNumeric: 'tabular-nums' }}>{fmtE(m.honHt)}</td>
                  <td style={{ padding: '9px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtE(m.menages)}</td>
                  <td style={{ padding: '9px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtE(m.debours)}</td>
                  <td style={{ padding: '9px 14px', textAlign: 'right', color: '#9C8E7D', fontVariantNumeric: 'tabular-nums' }}>{m.taxe > 0 ? fmtE(m.taxe) : '—'}</td>
                  <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: 600, color: '#92400E', fontVariantNumeric: 'tabular-nums' }}>{fmtE(m.vir + m.honTtc + m.menages + m.debours + m.taxe + m.com)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: '#F0EAD8', borderTop: '2px solid var(--border)' }}>
                <td style={{ padding: '10px 14px', fontWeight: 700 }}>TOTAL 2025</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700 }}>{items.filter(i => !i.facture_chaos).length}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#065F46', fontVariantNumeric: 'tabular-nums' }}>{fmtE(totVir)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtE(totHonTtc)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#9C8E7D', fontVariantNumeric: 'tabular-nums' }}>{fmtE(totHonHt)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtE(totMen)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtE(totDeb)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtE(totTaxe)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#92400E', fontVariantNumeric: 'tabular-nums' }}>{fmtE(totVir + totHonTtc + totMen + totDeb + totTaxe + totCom)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* ── Vue Détail par bien ── */}
      {vue === 'detail' && (
        <>
          {/* Sélecteur mois + export */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
            <button onClick={() => setMoisFiltre('all')}
              style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', background: moisFiltre === 'all' ? 'var(--brand)' : 'transparent', color: moisFiltre === 'all' ? '#fff' : 'var(--text)', cursor: 'pointer', fontSize: '0.82em', fontWeight: moisFiltre === 'all' ? 700 : 400 }}>
              Tout 2025
            </button>
            {moisDispos.map(m => (
              <button key={m} onClick={() => setMoisFiltre(m)}
                style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', background: moisFiltre === m ? 'var(--brand)' : 'transparent', color: moisFiltre === m ? '#fff' : 'var(--text)', cursor: 'pointer', fontSize: '0.82em', fontWeight: moisFiltre === m ? 700 : 400 }}>
                {(MOIS_LABELS[m] || m).split(' ')[0]}
              </button>
            ))}
            <button onClick={() => exportCSV(itemsFiltres, moisFiltre)} className="btn btn-secondary"
              style={{ marginLeft: 'auto', padding: '5px 12px', fontSize: '0.82em' }}>
              ⬇ Export CSV
            </button>
          </div>

          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82em', minWidth: 900 }}>
              <thead>
                <tr style={{ background: '#F0EAD8', borderBottom: '2px solid var(--border)' }}>
                  {moisFiltre === 'all' && <th style={thS}>Mois</th>}
                  <th style={{ ...thS, textAlign: 'left' }}>Bien</th>
                  <th style={thS}>VIR proprio</th>
                  <th style={thS}>HON TTC</th>
                  <th style={thS}>HON HT</th>
                  <th style={thS}>Ménages</th>
                  <th style={thS}>Débours</th>
                  <th style={thS}>Taxe</th>
                  <th style={thS}>COM</th>
                  <th style={{ ...thS, textAlign: 'left' }}>Note</th>
                </tr>
              </thead>
              <tbody>
                {itemsFiltres.map((item, idx) => {
                  const isChaos = item.facture_chaos
                  const isNullVir = item.vir_montant == null && !isChaos
                  return (
                    <tr key={item.id || idx} style={{ borderBottom: '1px solid var(--border)', background: isChaos ? '#FFFBEB' : isNullVir ? '#FEF2F2' : idx % 2 === 0 ? 'transparent' : '#FAF7F1', opacity: isChaos ? 0.7 : 1 }}>
                      {moisFiltre === 'all' && <td style={{ padding: '7px 10px', color: '#9C8E7D', whiteSpace: 'nowrap', fontSize: '0.9em' }}>{(MOIS_LABELS[item.mois] || item.mois).split(' ')[0].slice(0, 3)}</td>}
                      <td style={{ padding: '7px 10px' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text)' }}>{item.bien_name}</div>
                        {item.owner_name && <div style={{ fontSize: '0.82em', color: '#9C8E7D' }}>{item.owner_name}</div>}
                        {isChaos && <div style={{ fontSize: '0.75em', color: '#92400E', fontWeight: 600 }}>FACTURE DIRECTE</div>}
                      </td>
                      <td style={{ ...tdNumS, color: item.vir_montant < 0 ? '#DC2626' : '#065F46', fontWeight: 600 }}>{fmtE(item.vir_montant)}</td>
                      <td style={tdNumS}>{fmtE(item.hon_ttc)}</td>
                      <td style={{ ...tdNumS, color: '#9C8E7D' }}>{fmtE(item.hon_ht)}</td>
                      <td style={tdNumS}>{fmtE(item.menages)}</td>
                      <td style={tdNumS}>{fmtE(item.debours)}</td>
                      <td style={{ ...tdNumS, color: '#9C8E7D' }}>{item.taxe_sejour > 0 ? fmtE(item.taxe_sejour) : '—'}</td>
                      <td style={{ ...tdNumS, color: '#9C8E7D' }}>{item.com_distrib > 0 ? fmtE(item.com_distrib) : '—'}</td>
                      <td style={{ padding: '7px 10px', fontSize: '0.8em', color: '#9C8E7D', maxWidth: 200 }}>{item.vir_note || ''}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: '#F0EAD8', borderTop: '2px solid var(--border)' }}>
                  {moisFiltre === 'all' && <td style={{ padding: '9px 10px' }} />}
                  <td style={{ padding: '9px 10px', fontWeight: 700, color: 'var(--text)' }}>
                    TOTAL {moisFiltre === 'all' ? '2025' : MOIS_LABELS[moisFiltre] || moisFiltre}
                    <span style={{ fontSize: '0.8em', fontWeight: 400, color: '#9C8E7D', marginLeft: 6 }}>{itemsFiltres.length} biens</span>
                  </td>
                  <td style={{ ...tdNumS, fontWeight: 700, color: '#065F46' }}>{fmtE(totVir)}</td>
                  <td style={{ ...tdNumS, fontWeight: 700 }}>{fmtE(totHonTtc)}</td>
                  <td style={{ ...tdNumS, fontWeight: 700, color: '#9C8E7D' }}>{fmtE(totHonHt)}</td>
                  <td style={{ ...tdNumS, fontWeight: 700 }}>{fmtE(totMen)}</td>
                  <td style={{ ...tdNumS, fontWeight: 700 }}>{fmtE(totDeb)}</td>
                  <td style={{ ...tdNumS, fontWeight: 700, color: '#9C8E7D' }}>{fmtE(totTaxe)}</td>
                  <td style={{ ...tdNumS, fontWeight: 700, color: '#9C8E7D' }}>{fmtE(totCom)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

const thS = { padding: '10px 10px', fontWeight: 700, color: '#5C4B2A', textAlign: 'right', whiteSpace: 'nowrap' }
const tdNumS = { padding: '7px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }

function OngletSequestre() {
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)
  const [genAt, setGenAt]   = useState(null)

  const charger = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const today = new Date().toISOString().slice(0, 10)

      // ── 1. Biens de l'agence ─────────────────────────────────────────────
      const { data: biens } = await supabase
        .from('bien').select('id').eq('agence', AGENCE)
      const bienIds = (biens || []).map(b => b.id)
      if (!bienIds.length) {
        setData({ encaisse: 0, nbResas: 0, nbNonVentilees: 0, encaisseNonVentile: 0, resasFutures: 0, ventil: { loy:0,hon:0,com:0,fmen:0,auto:0,taxe:0,autres:0,totalVentile:0 }, evoliz: { stats: { brouillon:{nb:0,totalTtc:0,totalRev:0}, valide:{nb:0,totalTtc:0,totalRev:0}, envoye:{nb:0,totalTtc:0,totalRev:0} } }, ecart: 0 })
        setGenAt(new Date()); return
      }

      // ── 2. Toutes les réservations rapprochées (sans filtre mois) ────────
      const { data: resas } = await supabase
        .from('reservation')
        .select('id, fin_revenue, ventilation_calculee, final_status, departure_date')
        .in('bien_id', bienIds)
        .eq('rapprochee', true)
        .gt('fin_revenue', 0)
      const resasValides = (resas || []).filter(r =>
        !['not_accepted', 'not accepted', 'declined', 'expired'].includes(r.final_status)
      )
      const allResaIds = resasValides.map(r => r.id)

      // ── 3. Paiements réels reçus (Stripe acompte/solde, Manuel) ──────────
      // Pour Airbnb/Booking : reservation_paiement n'est pas peuplé → fallback fin_revenue
      const paiementsByResa = {}
      for (let i = 0; i < allResaIds.length; i += 400) {
        const { data: pmts } = await supabase
          .from('reservation_paiement')
          .select('reservation_id, montant')
          .in('reservation_id', allResaIds.slice(i, i + 400))
        for (const p of pmts || []) {
          paiementsByResa[p.reservation_id] = (paiementsByResa[p.reservation_id] || 0) + (p.montant || 0)
        }
      }
      // Montant réellement reçu : paiements tracés si dispo, sinon fin_revenue (Airbnb/Booking)
      const montantRecu = r => paiementsByResa[r.id] != null ? paiementsByResa[r.id] : (r.fin_revenue || 0)

      const encaisse         = resasValides.reduce((s, r) => s + montantRecu(r), 0)
      const nbResas          = resasValides.length
      const nbNonVentilees   = resasValides.filter(r => !r.ventilation_calculee).length
      const encaisseNonVentile = resasValides.filter(r => !r.ventilation_calculee).reduce((s, r) => s + montantRecu(r), 0)
      const resasFutures     = resasValides.filter(r => r.departure_date && r.departure_date >= today).reduce((s, r) => s + montantRecu(r), 0)
      // Paiements partiels = resas où montant reçu < 99% du fin_revenue (acompte en attente de solde)
      const nbPaiementsPartiels = resasValides.filter(r => paiementsByResa[r.id] != null && paiementsByResa[r.id] < (r.fin_revenue || 0) * 0.99).length
      const resaIds          = resasValides.filter(r => r.ventilation_calculee).map(r => r.id)

      // ── C. Ventilation par code ──────────────────────────────────────────
      const ventilRows = []
      for (let i = 0; i < resaIds.length; i += 400) {
        const { data: v } = await supabase
          .from('ventilation')
          .select('code, montant_ht, montant_ttc, montant_reel')
          .in('reservation_id', resaIds.slice(i, i + 400))
        if (v) ventilRows.push(...v)
      }
      // Base HT : montant_reel si renseigné, sinon montant_ht
      const sumHT = code => ventilRows.filter(v => v.code === code)
        .reduce((s, v) => s + (v.montant_reel != null ? v.montant_reel : (v.montant_ht || 0)), 0)
      const sumTtc = code => ventilRows.filter(v => v.code === code)
        .reduce((s, v) => s + (v.montant_ttc || 0), 0)

      // Ventilation HT — cohérente avec fin_revenue, tous codes en base HT
      const ventil = {
        loy:    sumHT('LOY'),
        hon:    sumHT('HON'),
        com:    sumHT('COM'),
        fmen:   sumHT('FMEN'),
        auto:   sumHT('AUTO'),
        taxe:   sumHT('TAXE'),
        autres: ventilRows.filter(v => !['LOY','HON','COM','FMEN','AUTO','TAXE','VIR'].includes(v.code))
          .reduce((s, v) => s + (v.montant_reel != null ? v.montant_reel : (v.montant_ht || 0)), 0),
      }
      ventil.totalVentile = ventil.loy + ventil.hon + ventil.com + ventil.fmen + ventil.auto + ventil.taxe + ventil.autres

      // TVA DCB — calcul direct : SUM(montant_ttc − montant_ht) sur HON + COM + FMEN
      const tvaDCB = ventilRows
        .filter(v => ['HON', 'COM', 'FMEN'].includes(v.code))
        .reduce((s, v) => s + ((v.montant_ttc || 0) - (v.montant_ht || 0)), 0)
      // Base taxable TTC pour calcul du ratio
      const baseTaxableTtc = sumTtc('HON') + sumTtc('COM') + sumTtc('FMEN')
      const ratioTVA = baseTaxableTtc > 0 ? tvaDCB / baseTaxableTtc : null

      // Écart résiduel = fin_revenue ventilées − ventilTotalHT
      const encaisseVentilees = encaisse - encaisseNonVentile
      const ecartResiduel = encaisseVentilees - ventil.totalVentile

      // ── Diagnostic qualité données ────────────────────────────────────────
      // 1. Lignes HON/COM/FMEN avec montant_ht null → TVA mal calculée
      const nbHtNull = ventilRows
        .filter(v => ['HON','COM','FMEN'].includes(v.code) && v.montant_ht == null).length
      // 2. Resas ventilation_calculee=true mais sans aucune ligne ventilation
      const resaIdsAvecLignes = new Set(ventilRows.map(v => v.reservation_id).filter(Boolean))
      const nbResasSansLignes = resaIds.filter(id => !resaIdsAvecLignes.has(id)).length
      // 3. Doublons : même (reservation_id, code) apparaît > 1 fois
      const pairCounts = {}
      for (const v of ventilRows) {
        const k = `${v.reservation_id}|${v.code}`
        pairCounts[k] = (pairCounts[k] || 0) + 1
      }
      const nbDoublons = Object.values(pairCounts).filter(c => c > 1).length

      // ── D. Evoliz — toutes factures (pas de filtre mois) ────────────────
      const { data: fAll } = await supabase
        .from('facture_evoliz')
        .select('statut, montant_reversement, total_ttc')
        .eq('type_facture', 'honoraires')
        .in('statut', ['brouillon', 'calcul_en_cours', 'valide', 'envoye_evoliz'])
      const evoliz = {
        brouillon: (fAll || []).filter(f => ['brouillon', 'calcul_en_cours'].includes(f.statut)),
        valide:    (fAll || []).filter(f => f.statut === 'valide'),
        envoye:    (fAll || []).filter(f => f.statut === 'envoye_evoliz'),
      }
      const evolizSum = arr => ({ nb: arr.length, totalTtc: arr.reduce((s, f) => s + (f.total_ttc || 0), 0), totalRev: arr.reduce((s, f) => s + (f.montant_reversement || 0), 0) })
      evoliz.stats = { brouillon: evolizSum(evoliz.brouillon), valide: evolizSum(evoliz.valide), envoye: evolizSum(evoliz.envoye) }

      setData({ encaisse, nbResas, nbNonVentilees, encaisseNonVentile, resasFutures, ventil, tvaDCB, ratioTVA, ecartResiduel, evoliz, diag: { nbHtNull, nbResasSansLignes, nbDoublons, nbPaiementsPartiels } })
      setGenAt(new Date())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { charger() }, [charger])

  return (
    <div style={{ maxWidth: 1000 }}>
      {/* En-tête */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 700, fontSize: '1em', color: 'var(--text)' }}>
          Séquestre — {new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' })}
        </div>
        <div style={{ fontSize: '0.8em', color: '#9C8E7D' }}>
          {genAt
            ? <>Calculé le <strong style={{ color: 'var(--text)' }}>{genAt.toLocaleString('fr-FR')}</strong></>
            : null}
        </div>
        <button className="btn btn-secondary" onClick={charger} disabled={loading} style={{ marginLeft: 'auto', padding: '6px 14px' }}>
          {loading ? '…' : '↺'}
        </button>
      </div>

      {error && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '12px 16px', color: '#DC2626', marginBottom: 20 }}>{error}</div>}
      {loading && !data && <div style={{ textAlign: 'center', padding: 40, color: '#9C8E7D' }}>Chargement…</div>}

      {data && (() => {
        const { encaisse, nbResas, nbNonVentilees, encaisseNonVentile, resasFutures, ventil, tvaDCB, ratioTVA, ecartResiduel, evoliz, diag } = data
        const absEcart = Math.abs(ecartResiduel)
        const ecartColor = absEcart < 5000 ? '#065F46' : absEcart < 50000 ? '#92400E' : '#DC2626'
        const ecartBg    = absEcart < 5000 ? '#D1FAE5' : absEcart < 50000 ? '#FEF3C7' : '#FEE2E2'
        const ecartLabel = absEcart < 5000 ? '✓ Normal (< 50 €)' : absEcart < 50000 ? '⚠ À surveiller (50–500 €)' : '✗ À investiguer (> 500 €)'
        const ratioOk = ratioTVA != null && ratioTVA >= 0.14 && ratioTVA <= 0.20

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* ── Résumé ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ background: '#F0FDF4', border: '1px solid #A7F3D0', borderRadius: 10, padding: '12px 16px' }}>
                <div style={{ fontSize: '0.72em', color: '#065F46', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>À redistribuer (séjours passés)</div>
                <div style={{ fontSize: '1.4em', fontWeight: 700, color: '#065F46', fontVariantNumeric: 'tabular-nums' }}>{fmt(encaisse - resasFutures)}</div>
                <div style={{ fontSize: '0.75em', color: '#9C8E7D', marginTop: 4 }}>Séjours effectués — dû aux proprios, AEs, DCB</div>
              </div>
              <div style={{ background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 10, padding: '12px 16px' }}>
                <div style={{ fontSize: '0.72em', color: '#0369a1', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Encaissé futur (séjours à venir)</div>
                <div style={{ fontSize: '1.4em', fontWeight: 700, color: '#0369a1', fontVariantNumeric: 'tabular-nums' }}>{fmt(resasFutures)}</div>
                <div style={{ fontSize: '0.75em', color: '#9C8E7D', marginTop: 4 }}>Payé en avance — appartient encore aux voyageurs</div>
              </div>
            </div>

            {/* ── Logique multi-canal ── */}
            <div style={{ background: '#FDFAF4', border: '1px solid #D9CEB8', borderRadius: 10, padding: '12px 16px', fontSize: '0.78em', color: '#5C4B2A', lineHeight: 1.7 }}>
              <div style={{ fontWeight: 700, marginBottom: 8, color: '#2C2416', fontSize: '0.85em', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Logique de pilotage par canal</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <div style={{ background: '#FFF7E6', border: '1px solid #F0D88A', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ fontWeight: 700, marginBottom: 4, color: '#92400E' }}>Airbnb / Booking</div>
                  <div>Référence : <strong>date de check-in</strong></div>
                  <div style={{ marginTop: 4, color: '#78716C' }}>Le payout arrive après le séjour — on pilote sur la date d'arrivée</div>
                </div>
                <div style={{ background: '#F0FDF4', border: '1px solid #A7F3D0', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ fontWeight: 700, marginBottom: 4, color: '#065F46' }}>Direct / Stripe</div>
                  <div>Référence : <strong>encaissement réel</strong> + date du séjour</div>
                  <div style={{ marginTop: 4, color: '#78716C' }}>Entrée dès paiement confirmé, classé selon la date du séjour</div>
                </div>
                <div style={{ background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ fontWeight: 700, marginBottom: 4, color: '#0369A1' }}>Manuel</div>
                  <div>Référence : <strong>rapprochement bancaire</strong></div>
                  <div style={{ marginTop: 4, color: '#78716C' }}>Entrée uniquement sur preuve bancaire — pas de date de séjour imposée</div>
                </div>
              </div>
              <div style={{ marginTop: 8, color: '#9C8E7D', fontStyle: 'italic' }}>Ce n'est pas une incohérence — c'est une logique métier multi-canal. Chaque canal suit son horloge réelle.</div>
            </div>

            {/* ── Détail séquestre ── */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>

              <SeqSeparateur label="1 — Base cash (encaissements prouvés)" />
              <SeqLigne label="Total encaissé rapproché" montant={encaisse} fiabilite="fiable" detail={`${nbResas} résa${nbResas > 1 ? 's' : ''}`} highlight />
              <div style={{ padding: '2px 14px 8px 32px', fontSize: '0.74em', color: '#9C8E7D', borderLeft: '2px solid var(--border)', marginLeft: 14 }}>
                <code>reservation.rapprochee = true</code> × <code>fin_revenue</code> — annulations sans frais exclues
              </div>

              <SeqSeparateur label="2 — Ventilation HT expliquée" />
              <SeqLigne label="Propriétaires (LOY HT)" montant={ventil.loy} fiabilite="calcule" indent />
              <SeqLigne label="DCB honoraires (HON + COM HT)" montant={ventil.hon + ventil.com} fiabilite="calcule" indent />
              <SeqLigne label="Ménage / AEs (FMEN + AUTO HT)" montant={ventil.fmen + ventil.auto} fiabilite="calcule" indent />
              <SeqLigne label="Taxes de séjour (TAXE HT)" montant={ventil.taxe} fiabilite="calcule" indent />
              {ventil.autres > 0 && <SeqLigne label="Autres (DEB_AE, HAOWNER…)" montant={ventil.autres} fiabilite="calcule" indent />}
              {nbNonVentilees > 0
                ? <div style={{ margin: '4px 14px', padding: '8px 12px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span>⚠️</span>
                    <span style={{ flex: 1, fontSize: '0.82em', color: '#92400E', fontWeight: 600 }}>{nbNonVentilees} résa(s) sans ventilation</span>
                    <span style={{ fontSize: '0.82em', fontWeight: 700, color: '#92400E', fontVariantNumeric: 'tabular-nums' }}>{fmt(encaisseNonVentile)}</span>
                  </div>
                : <SeqLigne label="Non ventilé" montant={0} fiabilite="calcule" indent dimmed />
              }
              <SeqLigne label="Total ventilé HT + non ventilé" montant={ventil.totalVentile + encaisseNonVentile} fiabilite="calcule" highlight />

              <SeqSeparateur label="3 — Facturation propriétaires (Evoliz) — informatif uniquement" />
              <div style={{ margin: '4px 14px 8px', padding: '8px 12px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, fontSize: '0.77em', color: '#92400E', lineHeight: 1.5 }}>
                Une facture Evoliz n'est pas un paiement bancaire. Ce bloc n'influence aucun chiffre ci-dessus.
              </div>
              {[
                { label: 'Brouillons / en cours', s: evoliz.stats.brouillon, dimmed: true },
                { label: 'Validées (prêtes à envoyer)', s: evoliz.stats.valide, dimmed: false },
                { label: 'Envoyées dans Evoliz',        s: evoliz.stats.envoye, dimmed: false },
              ].map(({ label, s, dimmed }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '7px 14px 7px 32px', borderLeft: '2px solid var(--border)', marginLeft: 14, opacity: dimmed ? 0.55 : 1 }}>
                  <span style={{ flex: 1, fontSize: '0.88em', color: 'var(--text)' }}>{label}</span>
                  {s.nb > 0 && <span style={{ fontSize: '0.76em', color: '#9C8E7D' }}>{s.nb} fact.</span>}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1, minWidth: 160 }}>
                    <span style={{ fontSize: '0.82em', color: '#9C8E7D', fontVariantNumeric: 'tabular-nums' }}>TTC {s.nb ? fmt(s.totalTtc) : '—'}</span>
                    <span style={{ fontSize: '0.78em', color: '#9C8E7D', fontVariantNumeric: 'tabular-nums' }}>dont revers. {s.nb ? fmt(s.totalRev) : '—'}</span>
                  </div>
                  <span style={{ fontSize: '0.72em', fontWeight: 600, padding: '1px 6px', borderRadius: 6, background: BADGE.proxy.bg, color: BADGE.proxy.color }}>{BADGE.proxy.label}</span>
                </div>
              ))}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '8px 14px 10px', borderTop: '1px solid var(--border)', marginTop: 4 }}>
                <span style={{ flex: 1, fontSize: '0.85em', color: '#9C8E7D' }}>Total reversements administrativement traités</span>
                <span style={{ fontSize: '0.95em', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#9C8E7D' }}>
                  {fmt(evoliz.stats.brouillon.totalRev + evoliz.stats.valide.totalRev + evoliz.stats.envoye.totalRev)}
                </span>
              </div>

              <SeqSeparateur label="4 — Sorties bancaires prouvées (non disponible)" />
              <SeqLigne label="Propriétaires — virements débités" montant={null} fiabilite="absent" indent />
              <SeqLigne label="AEs — paiements débités" montant={null} fiabilite="absent" indent />
              <SeqLigne label="DCB — transferts honoraires débités" montant={null} fiabilite="absent" indent />
              <div style={{ padding: '2px 14px 10px 32px', fontSize: '0.74em', color: '#9C8E7D', borderLeft: '2px solid var(--border)', marginLeft: 14 }}>
                Prochaine étape : rapprocher les débits CE aux factures sortantes.
              </div>

              <SeqSeparateur label="5 — Bilan" />
              <SeqLigne label="Base cash" montant={encaisse} fiabilite="fiable" highlight />
              <SeqLigne label="TVA collectée DCB (HON + COM + FMEN)" montant={tvaDCB} fiabilite="calcule"
                detail={ratioTVA != null ? `Ratio : ${(ratioTVA * 100).toFixed(1)} % base taxable TTC${ratioOk ? '' : ' ⚠'}` : undefined} />
              <div style={{ margin: '4px 14px 8px', padding: '8px 12px', borderRadius: 8, background: ecartBg, border: `1px solid ${ecartColor}44`, display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span style={{ flex: 1, fontSize: '0.88em', color: 'var(--text)', fontWeight: 600 }}>Écart résiduel</span>
                <span style={{ fontSize: '0.82em', color: ecartColor, fontWeight: 600 }}>{ecartLabel}</span>
                <span style={{ fontSize: '0.95em', fontWeight: 700, color: ecartColor, fontVariantNumeric: 'tabular-nums' }}>{fmt(ecartResiduel)}</span>
              </div>
              <div style={{ padding: '2px 14px 10px', fontSize: '0.74em', color: '#9C8E7D' }}>
                Écart = fin_revenue ventilées − ventilTotalHT. TVA = SUM(montant_ttc − montant_ht) sur HON+COM+FMEN.
              </div>
            </div>

            {/* ── Diagnostic qualité données ── */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <SeqSeparateur label="Diagnostic qualité données" />
              {[
                {
                  label: 'Resas rapprochées sans ventilation',
                  val: nbNonVentilees,
                  sub: nbNonVentilees > 0 ? `${fmt(encaisseNonVentile)} non attribué` : null,
                  ok: nbNonVentilees === 0,
                  msg: nbNonVentilees === 0 ? 'OK' : `${nbNonVentilees} résa(s) — lancer recalcul ventilation`,
                },
                {
                  label: 'Resas ventilation_calculee=true sans lignes',
                  val: diag.nbResasSansLignes,
                  sub: null,
                  ok: diag.nbResasSansLignes === 0,
                  msg: diag.nbResasSansLignes === 0 ? 'OK' : `${diag.nbResasSansLignes} résa(s) — flag incohérent`,
                },
                {
                  label: 'Lignes HON/COM/FMEN avec montant_ht null',
                  val: diag.nbHtNull,
                  sub: diag.nbHtNull > 0 ? 'TVA mal calculée sur ces lignes' : null,
                  ok: diag.nbHtNull === 0,
                  msg: diag.nbHtNull === 0 ? 'OK' : `${diag.nbHtNull} ligne(s) — montant_ht manquant`,
                },
                {
                  label: 'Doublons (reservation_id + code) dans ventilation',
                  val: diag.nbDoublons,
                  sub: diag.nbDoublons > 0 ? 'Ventilation possiblement surestimée' : null,
                  ok: diag.nbDoublons === 0,
                  msg: diag.nbDoublons === 0 ? 'OK' : `${diag.nbDoublons} paire(s) en double`,
                },
                {
                  label: 'Paiements partiels (acompte Stripe non soldé)',
                  val: diag.nbPaiementsPartiels,
                  sub: diag.nbPaiementsPartiels > 0 ? 'Montant séquestre = réel reçu (pas le total résa)' : 'Montants = réel reçu pour toutes les resas',
                  ok: diag.nbPaiementsPartiels === 0,
                  msg: diag.nbPaiementsPartiels === 0 ? 'OK' : `${diag.nbPaiementsPartiels} résa(s) — solde à venir`,
                },
                {
                  label: 'Ratio TVA / base taxable TTC',
                  val: ratioTVA != null ? `${(ratioTVA * 100).toFixed(1)} %` : '—',
                  sub: 'Attendu entre 14 % et 20 % (TVA 20 %)',
                  ok: ratioOk,
                  msg: ratioOk ? 'OK' : ratioTVA == null ? 'Pas de base taxable' : 'Hors norme — vérifier montant_ht',
                },
              ].map(({ label, val, sub, ok, msg }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '1em' }}>{ok ? '✅' : '⚠️'}</span>
                  <span style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.85em', color: 'var(--text)' }}>{label}</div>
                    {sub && <div style={{ fontSize: '0.76em', color: '#9C8E7D', marginTop: 1 }}>{sub}</div>}
                  </span>
                  <span style={{ fontSize: '0.85em', fontWeight: 700, color: ok ? '#065F46' : '#92400E', whiteSpace: 'nowrap' }}>{msg}</span>
                </div>
              ))}
            </div>

          </div>
        )
      })()}
    </div>
  )
}
