import { useState, useEffect, useCallback } from 'react'
import { getJournal, getJournalStats } from '../services/journal'

const CATEGORIES = [
  { value: '', label: 'Toutes' },
  { value: 'ventilation', label: 'Ventilation' },
  { value: 'rapprochement', label: 'Rapprochement' },
  { value: 'import', label: 'Import' },
  { value: 'webhook', label: 'Webhook' },
  { value: 'facture', label: 'Facture' },
  { value: 'correction', label: 'Correction' },
]

const STATUT_COLORS = {
  ok:      { bg: '#dcfce7', color: '#16a34a' },
  warning: { bg: '#fef9c3', color: '#ca8a04' },
  error:   { bg: '#fee2e2', color: '#dc2626' },
}

const ACTION_ICONS = {
  create: '➕', update: '✏️', delete: '🗑️',
  validate: '✅', cancel: '❌', link: '🔗',
  unlink: '🔓', compute: '⚡',
}

function Badge({ statut }) {
  const s = STATUT_COLORS[statut] || STATUT_COLORS.ok
  return (
    <span style={{ background: s.bg, color: s.color, borderRadius: 4,
      padding: '2px 7px', fontSize: '0.72em', fontWeight: 700 }}>
      {statut}
    </span>
  )
}

function StatCard({ label, data }) {
  if (!data) return null
  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '12px 16px', minWidth: 130 }}>
      <div style={{ fontSize: '0.72em', color: 'var(--text-muted)', textTransform: 'uppercase',
        letterSpacing: '0.05em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: '1.4em', fontWeight: 700, color: 'var(--brand)' }}>{data.total}</div>
      <div style={{ fontSize: '0.72em', marginTop: 4, display: 'flex', gap: 6 }}>
        {data.ok > 0 && <span style={{ color: '#16a34a' }}>✓ {data.ok}</span>}
        {data.warning > 0 && <span style={{ color: '#ca8a04' }}>⚠ {data.warning}</span>}
        {data.error > 0 && <span style={{ color: '#dc2626' }}>✗ {data.error}</span>}
      </div>
    </div>
  )
}

export default function PageJournal() {
  const [mois, setMois] = useState(() => new Date().toISOString().substring(0, 7))
  const [categorie, setCategorie] = useState('')
  const [logs, setLogs] = useState([])
  const [stats, setStats] = useState({})
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [logsData, statsData] = await Promise.all([
        getJournal({ mois: mois || undefined, categorie: categorie || undefined, limit: 200 }),
        mois ? getJournalStats(mois) : Promise.resolve({}),
      ])
      setLogs(logsData)
      setStats(statsData)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [mois, categorie])

  useEffect(() => { load() }, [load])

  function fmt(ts) {
    if (!ts) return '—'
    const d = new Date(ts)
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' +
           d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Journal des opérations</h1>
        <p className="page-subtitle">Traçabilité complète des opérations métier</p>
      </div>

      {/* Filtres */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
        <input type="month" value={mois} onChange={e => setMois(e.target.value)}
          style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)',
            background: 'var(--bg)', color: 'var(--text)', fontSize: '0.9em' }} />
        <select value={categorie} onChange={e => setCategorie(e.target.value)}
          style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)',
            background: 'var(--bg)', color: 'var(--text)', fontSize: '0.9em' }}>
          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <button onClick={load} className="btn btn-secondary" style={{ padding: '6px 14px' }}>
          ↺ Actualiser
        </button>
        <span style={{ marginLeft: 'auto', fontSize: '0.85em', color: 'var(--text-muted)' }}>
          {logs.length} entrée{logs.length > 1 ? 's' : ''}
        </span>
      </div>

      {/* Stats du mois */}
      {mois && Object.keys(stats).length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
          {Object.entries(stats).map(([cat, data]) => (
            <StatCard key={cat} label={cat} data={data} />
          ))}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="empty-state"><div className="empty-state-title">Chargement…</div></div>
      ) : logs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">Aucune entrée</div>
          <p>Les opérations apparaîtront ici dès qu'elles seront effectuées.</p>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 130 }}>Horodatage</th>
                <th>Catégorie</th>
                <th>Action</th>
                <th>Statut</th>
                <th>Source</th>
                <th>Message</th>
                <th>Résa</th>
                <th>Bien</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <>
                  <tr key={log.id}
                    onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                    style={{ cursor: (log.avant || log.apres) ? 'pointer' : 'default',
                      background: expanded === log.id ? 'var(--bg)' : undefined }}>
                    <td style={{ fontSize: '0.78em', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {fmt(log.created_at)}
                    </td>
                    <td>
                      <span style={{ fontSize: '0.78em', fontWeight: 600,
                        color: 'var(--brand)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        {log.categorie}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.85em' }}>
                      {ACTION_ICONS[log.action] || '•'} {log.action}
                    </td>
                    <td><Badge statut={log.statut} /></td>
                    <td style={{ fontSize: '0.78em', color: 'var(--text-muted)' }}>{log.source}</td>
                    <td style={{ fontSize: '0.85em', maxWidth: 320,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={log.message}>
                      {log.message}
                    </td>
                    <td style={{ fontSize: '0.78em' }}>
                      {log.reservation ? (
                        <span className="mono">{log.reservation.code}</span>
                      ) : '—'}
                    </td>
                    <td style={{ fontSize: '0.78em', color: 'var(--text-muted)' }}>
                      {log.bien?.code || '—'}
                    </td>
                  </tr>
                  {expanded === log.id && (log.avant || log.apres || log.meta) && (
                    <tr key={log.id + '-detail'}>
                      <td colSpan={8} style={{ background: '#f8f5ef', padding: '8px 16px' }}>
                        <div style={{ display: 'flex', gap: 24, fontSize: '0.8em' }}>
                          {log.avant && (
                            <div>
                              <div style={{ color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600 }}>AVANT</div>
                              <pre style={{ margin: 0, color: '#dc2626', background: '#fee2e2',
                                padding: '6px 10px', borderRadius: 4 }}>
                                {JSON.stringify(log.avant, null, 2)}
                              </pre>
                            </div>
                          )}
                          {log.apres && (
                            <div>
                              <div style={{ color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600 }}>APRÈS</div>
                              <pre style={{ margin: 0, color: '#16a34a', background: '#dcfce7',
                                padding: '6px 10px', borderRadius: 4 }}>
                                {JSON.stringify(log.apres, null, 2)}
                              </pre>
                            </div>
                          )}
                          {log.meta && (
                            <div>
                              <div style={{ color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600 }}>META</div>
                              <pre style={{ margin: 0, padding: '6px 10px', borderRadius: 4,
                                background: 'var(--bg)' }}>
                                {JSON.stringify(log.meta, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
