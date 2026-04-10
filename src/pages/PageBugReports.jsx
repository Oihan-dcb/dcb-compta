import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const STATUTS = {
  nouveau:    { label: 'Nouveau',    color: '#DC2626', bg: '#FEE2E2' },
  en_cours:   { label: 'En cours',   color: '#D97706', bg: '#FEF3C7' },
  resolu:     { label: 'Résolu',     color: '#059669', bg: '#D1FAE5' },
  ignore:     { label: 'Ignoré',     color: '#8C7B65', bg: '#F7F3EC' },
}

const SOURCES = {
  compta:  { label: 'Compta',  color: '#5B4FCF', bg: '#EDE9FE' },
  portail: { label: 'Portail', color: '#0369A1', bg: '#E0F2FE' },
}

export default function PageBugReports() {
  const [bugs, setBugs] = useState([])
  const [loading, setLoading] = useState(false)
  const [filtreStatut, setFiltreStatut] = useState('nouveau')
  const [filtreSource, setFiltreSource] = useState('')
  const [error, setError] = useState(null)

  useEffect(() => { charger() }, [])

  async function charger() {
    setLoading(true)
    setError(null)
    try {
      const { data, error: err } = await supabase
        .from('bug_report')
        .select('*')
        .order('created_at', { ascending: false })
      if (err) throw err
      setBugs(data || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function changerStatut(id, statut) {
    const { error: err } = await supabase
      .from('bug_report')
      .update({ statut })
      .eq('id', id)
    if (err) { setError(err.message); return }
    setBugs(b => b.map(x => x.id === id ? { ...x, statut } : x))
  }

  const bugsFiltrés = bugs.filter(b => {
    if (filtreStatut && b.statut !== filtreStatut) return false
    if (filtreSource && b.source !== filtreSource) return false
    return true
  })

  const counts = Object.fromEntries(
    Object.keys(STATUTS).map(s => [s, bugs.filter(b => b.statut === s).length])
  )

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Signalements bugs</h1>
          <p className="page-subtitle">{bugs.length} signalement(s) au total</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            className="form-select"
            style={{ fontSize: 13, padding: '5px 10px' }}
            value={filtreSource}
            onChange={e => setFiltreSource(e.target.value)}
          >
            <option value="">Toutes les sources</option>
            <option value="compta">Compta</option>
            <option value="portail">Portail</option>
          </select>
          <button className="btn btn-secondary" onClick={charger} disabled={loading}>↺</button>
        </div>
      </div>

      {/* Filtres statut */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[['', 'Tous'], ...Object.entries(STATUTS).map(([k, v]) => [k, v.label])].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFiltreStatut(k)}
            style={{
              padding: '5px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600,
              border: '1.5px solid',
              borderColor: filtreStatut === k ? 'var(--brand)' : 'var(--border)',
              background: filtreStatut === k ? 'var(--brand)' : 'transparent',
              color: filtreStatut === k ? '#fff' : 'var(--text)',
              cursor: 'pointer',
            }}
          >
            {label}{k && counts[k] > 0 ? ` (${counts[k]})` : ''}
          </button>
        ))}
      </div>

      {error && <div className="alert alert-error">✗ {error}</div>}

      {loading ? (
        <div className="loading-state"><span className="spinner" /> Chargement…</div>
      ) : bugsFiltrés.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">Aucun signalement{filtreStatut ? ` "${STATUTS[filtreStatut]?.label}"` : ''}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {bugsFiltrés.map(b => {
            const st = STATUTS[b.statut] || STATUTS.nouveau
            const src = SOURCES[b.source] || SOURCES.compta
            return (
              <div key={b.id} style={{
                background: 'var(--white)',
                border: `1px solid ${b.statut === 'nouveau' ? '#FCA5A5' : 'var(--border)'}`,
                borderRadius: 'var(--radius)',
                padding: '14px 18px',
                display: 'flex', gap: 16, alignItems: 'flex-start',
              }}>
                {/* Badges */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 80 }}>
                  <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700, background: src.bg, color: src.color, textAlign: 'center' }}>
                    {src.label}
                  </span>
                  <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700, background: st.bg, color: st.color, textAlign: 'center' }}>
                    {st.label}
                  </span>
                </div>

                {/* Contenu */}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, whiteSpace: 'pre-wrap' }}>
                    {b.message}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {b.page_url && <span style={{ fontFamily: 'monospace', marginRight: 12 }}>{b.page_url}</span>}
                    {new Date(b.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>

                {/* Actions statut */}
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {b.statut !== 'en_cours' && b.statut !== 'resolu' && (
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: 12, padding: '3px 8px', color: '#D97706' }}
                      onClick={() => changerStatut(b.id, 'en_cours')}
                    >
                      En cours
                    </button>
                  )}
                  {b.statut !== 'resolu' && (
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: 12, padding: '3px 8px', color: '#059669' }}
                      onClick={() => changerStatut(b.id, 'resolu')}
                    >
                      ✓ Résolu
                    </button>
                  )}
                  {b.statut !== 'ignore' && b.statut !== 'resolu' && (
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: 12, padding: '3px 8px', color: 'var(--text-muted)' }}
                      onClick={() => changerStatut(b.id, 'ignore')}
                    >
                      Ignorer
                    </button>
                  )}
                  {(b.statut === 'resolu' || b.statut === 'ignore') && (
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: 12, padding: '3px 8px' }}
                      onClick={() => changerStatut(b.id, 'nouveau')}
                    >
                      ↺ Rouvrir
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
