import { useState, useRef } from 'react'
import { analyseCSV, importHospitableCSV, fusionnerDoublons } from '../services/importCSV'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

const PLATFORM_COLORS = { airbnb: '#FF5A5F', booking: '#003580', direct: '#2563EB' }

export default function PageImport() {
  const [step, setStep] = useState('upload') // upload | select | importing | done
  const [rows, setRows] = useState([])
  const [parMois, setParMois] = useState([])
  const [selected, setSelected] = useState([]) // mois sélectionnés
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [fusionResult, setFusionResult] = useState(null)
  const [progress, setProgress] = useState(null) // { step, pct }
  const fileRef = useRef()

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    setError(null)
    try {
      const { rows: r, parMois: m, total } = await analyseCSV(file)
      setRows(r)
      setParMois(m)
      setSelected(m.map(x => x.mois)) // tout sélectionner par défaut
      setStep('select')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function toggleMois(mois) {
    setSelected(s => s.includes(mois) ? s.filter(x => x !== mois) : [...s, mois])
  }

  function toggleAll() {
    setSelected(s => s.length === parMois.length ? [] : parMois.map(x => x.mois))
  }

  async function lancerImport() {
    if (selected.length === 0) return
    setStep('importing')
    setLoading(true)
    setError(null)
    try {
      const r = await importHospitableCSV(rows, selected, (p) => setProgress(p))
      setResult(r)
      setStep('done')
    } catch (err) {
      setError(err.message)
      setStep('select')
    } finally {
      setLoading(false)
    }
  }

  function reset() {
    setStep('upload')
    setRows([])
    setParMois([])
    setSelected([])
    setResult(null)
    setError(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const totalSelected = parMois.filter(m => selected.includes(m.mois)).reduce((s, m) => s + m.total, 0)

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Import CSV Hospitable</h1>
          <p className="page-subtitle">Nourrir la base de données depuis un export Hospitable</p>
        </div>
      </div>

      {error && <div className="alert alert-error" style={{marginBottom:16}}>✕ {error}</div>}

      {step === 'upload' && (
        <div style={{maxWidth:600}}>
          <div style={{
            border: '2px dashed var(--border)', borderRadius: 12, padding: 48,
            textAlign: 'center', background: 'var(--bg-card)', cursor: 'pointer'
          }} onClick={() => fileRef.current?.click()}>
            <div style={{fontSize: '3rem', marginBottom: 16}}>📥</div>
            <div style={{fontWeight: 600, fontSize: '1.1rem', marginBottom: 8}}>
              Glisse ton CSV Hospitable ici
            </div>
            <div style={{color: 'var(--text-muted)', fontSize: '0.9em', marginBottom: 20}}>
              Exporte depuis Hospitable → Metrics → Reservations → Export CSV<br/>
              Sélectionne "All time" pour nourrir toute la base
            </div>
            <button className="btn btn-primary" disabled={loading}>
              {loading ? '⏳ Analyse…' : '📂 Choisir le fichier'}
            </button>
            <input ref={fileRef} type="file" accept=".csv" style={{display:'none'}} onChange={handleFile} />
          </div>

          <div style={{marginTop: 24, padding: 16, background: 'var(--bg-card)', borderRadius: 8, fontSize: '0.9em'}}>
            <strong>Comment exporter depuis Hospitable :</strong>
            <ol style={{marginTop: 8, paddingLeft: 20, lineHeight: '2em'}}>
              <li>Metrics → Reservations</li>
              <li>Période : "All time" (ou la période souhaitée)</li>
              <li>Bouton "Export" → CSV</li>
            </ol>
          </div>
        </div>
      )}

      {step === 'select' && (
        <div>
          <div style={{marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12}}>
            <strong>{rows.length} réservations trouvées dans le CSV</strong>
            <span style={{color: 'var(--text-muted)'}}>·</span>
            <span style={{color: 'var(--text-muted)'}}>{parMois.length} mois disponibles</span>
          </div>

          <div style={{display: 'flex', gap: 8, marginBottom: 16}}>
            <button className="btn btn-secondary btn-sm" onClick={toggleAll}>
              {selected.length === parMois.length ? 'Tout désélectionner' : 'Tout sélectionner'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => {
              const now = new Date()
              const recent = parMois.filter(m => m.mois >= '2026-01').map(x => x.mois)
              setSelected(recent)
            }}>
              2026 seulement
            </button>
            <button className="btn btn-secondary btn-sm" onClick={reset}>
              ↩ Changer de fichier
            </button>
          </div>

          <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10, marginBottom: 24}}>
            {parMois.map(m => {
              const isSelected = selected.includes(m.mois)
              const [year, month] = m.mois.split('-')
              const label = format(new Date(parseInt(year), parseInt(month) - 1, 1), 'MMMM yyyy', {locale: fr})
              return (
                <div
                  key={m.mois}
                  onClick={() => toggleMois(m.mois)}
                  style={{
                    padding: '12px 16px', borderRadius: 8, cursor: 'pointer',
                    border: `2px solid ${isSelected ? 'var(--brand)' : 'var(--border)'}`,
                    background: isSelected ? 'var(--brand-pale)' : 'var(--bg-card)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    transition: 'all 0.15s',
                  }}>
                  <div>
                    <div style={{fontWeight: 600, textTransform: 'capitalize'}}>{label}</div>
                    <div style={{fontSize: '0.8em', color: 'var(--text-muted)', marginTop: 2}}>
                      {m.platforms.map(p => (
                        <span key={p} style={{
                          marginRight: 4, color: PLATFORM_COLORS[p] || '#888',
                          fontWeight: 500
                        }}>{p}</span>
                      ))}
                    </div>
                  </div>
                  <div style={{textAlign: 'right'}}>
                    <div style={{fontWeight: 700, fontSize: '1.1em'}}>{m.total}</div>
                    <div style={{fontSize: '0.75em', color: 'var(--text-muted)'}}>resas</div>
                  </div>
                </div>
              )
            })}
          </div>

          <div style={{
            position: 'sticky', bottom: 0, background: 'var(--bg)', padding: '16px 0',
            borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 16
          }}>
            <div>
              <strong>{selected.length} mois sélectionnés</strong>
              <span style={{color: 'var(--text-muted)', marginLeft: 8}}>· {totalSelected} réservations à importer</span>
            </div>
            <button
              className="btn btn-primary"
              onClick={lancerImport}
              disabled={selected.length === 0}>
              ⚡ Importer {totalSelected} réservations
            </button>
          </div>
        </div>
      )}

      {step === 'importing' && (
        <div style={{maxWidth: 500, margin: '64px auto', textAlign: 'center'}}>
          <div style={{fontSize: '3rem', marginBottom: 16}}>⚡</div>
          <div style={{fontWeight: 600, fontSize: '1.1rem', marginBottom: 8}}>Import en cours…</div>
          <div style={{color: 'var(--text-muted)', marginBottom: 24, fontSize: '0.9em'}}>
            {{
              prepare: '📋 Chargement des données…',
              upsert: '💾 Mise à jour des réservations…',
              insert: '➕ Création des nouvelles réservations…',
              fees: '🧾 Préparation des frais…',
              clean_fees: '🗑 Nettoyage des anciens frais…',
              insert_fees: '💾 Enregistrement des frais…',
              dedup: '🔍 Fusion des doublons…',
              done: '✓ Finalisation…',
            }[progress?.step] || 'Initialisation…'}
          </div>
          <div style={{background: 'var(--border)', borderRadius: 8, height: 12, overflow: 'hidden'}}>
            <div style={{
              height: '100%', borderRadius: 8,
              background: 'var(--brand)',
              width: `${progress?.pct || 0}%`,
              transition: 'width 0.3s ease'
            }} />
          </div>
          <div style={{marginTop: 8, color: 'var(--text-muted)', fontSize: '0.85em'}}>
            {progress?.pct || 0}%
          </div>
        </div>
      )}

      {step === 'done' && result && (
        <div>
          <div className="alert alert-success" style={{marginBottom: 24}}>
            ✓ Import terminé avec succès
          </div>
          <div style={{display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, maxWidth: 700, marginBottom: 24}}>
            {[
              { label: 'Mises à jour', value: result.updated, color: 'var(--success)' },
              { label: 'Créées', value: result.created, color: 'var(--brand)' },
              { label: 'Doublons fusionnés', value: result.fusion?.fusions || 0, color: 'var(--warning)' },
              { label: 'Erreurs', value: result.errors + (result.fusion?.errors || 0), color: (result.errors + (result.fusion?.errors || 0)) > 0 ? 'var(--error)' : 'var(--text-muted)' },
            ].map(s => (
              <div key={s.label} style={{padding: 20, background: 'var(--bg-card)', borderRadius: 8, textAlign: 'center'}}>
                <div style={{fontSize: '2rem', fontWeight: 700, color: s.color}}>{s.value}</div>
                <div style={{fontSize: '0.85em', color: 'var(--text-muted)', marginTop: 4}}>{s.label}</div>
              </div>
            ))}
          </div>
          {fusionResult && (
            <div className="alert alert-info" style={{marginBottom: 16}}>
              🔍 Analyse doublons : {fusionResult.doublons} doublon(s) trouvé(s), {fusionResult.fusions} fusionné(s)
            </div>
          )}
          <div style={{display: 'flex', gap: 12}}>
            <button className="btn btn-primary" onClick={reset}>📥 Nouvel import</button>
            <button className="btn btn-secondary" onClick={async () => {
              setLoading(true)
              const f = await fusionnerDoublons()
              setFusionResult(f)
              setLoading(false)
            }} disabled={loading}>🔍 Re-détecter doublons</button>
            <a href="/reservations" className="btn btn-secondary">→ Voir les réservations</a>
          </div>
        </div>
      )}
    </div>
  )
}
