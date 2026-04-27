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
      const encaisse         = resasValides.reduce((s, r) => s + (r.fin_revenue || 0), 0)
      const nbResas          = resasValides.length
      const nbNonVentilees   = resasValides.filter(r => !r.ventilation_calculee).length
      const encaisseNonVentile = resasValides.filter(r => !r.ventilation_calculee).reduce((s, r) => s + (r.fin_revenue || 0), 0)
      const resasFutures     = resasValides.filter(r => r.departure_date && r.departure_date >= today).reduce((s, r) => s + (r.fin_revenue || 0), 0)
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

      setData({ encaisse, nbResas, nbNonVentilees, encaisseNonVentile, resasFutures, ventil, tvaDCB, ratioTVA, ecartResiduel, evoliz, diag: { nbHtNull, nbResasSansLignes, nbDoublons } })
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
