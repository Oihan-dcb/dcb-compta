import { useState, useEffect } from 'react'

export const MOIS_FR = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc']

export default function MoisSelector({ mois, setMois, moisDispos }) {
  const [open, setOpen] = useState(false)
  // Toujours inclure le mois actif même s'il n'a pas de données
  const moisEffectifs = moisDispos.includes(mois) ? [...moisDispos] : [...moisDispos, mois]
  const parAnnee = {}
  for (const m of moisEffectifs) {
    const [y] = m.split('-')
    if (!parAnnee[y]) parAnnee[y] = []
    parAnnee[y].push(m)
  }
  // Trier les mois de chaque année croissant (Jan→Déc, naturel en grille)
  for (const y of Object.keys(parAnnee)) parAnnee[y].sort((a, b) => a.localeCompare(b))
  // Années les plus récentes en premier
  const annees = Object.keys(parAnnee).sort((a, b) => b - a)
  const [anneeActive, setAnneeActive] = useState(() => mois.split('-')[0])
  useEffect(() => { setAnneeActive(mois.split('-')[0]) }, [mois])
  const [year, monthIdx] = mois.split('-')

  function naviguer(delta) {
    const [y, m] = mois.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setMois(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 0 }}>
      <button className="btn btn-secondary" onClick={() => naviguer(-1)}
        style={{ padding: '6px 10px', borderRadius: '8px 0 0 8px', borderRight: 'none' }} title="Mois précédent">
        ‹
      </button>
      <button className="btn btn-secondary" onClick={() => setOpen(o => !o)}
        style={{ minWidth: 110, display: 'flex', alignItems: 'center', gap: 6, borderRadius: 0, borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)' }}>
        <span style={{ fontWeight: 600 }}>{MOIS_FR[parseInt(monthIdx) - 1]} {year}</span>
        <span style={{ fontSize: 10, opacity: 0.6 }}>▼</span>
      </button>
      <button className="btn btn-secondary" onClick={() => naviguer(1)}
        style={{ padding: '6px 10px', borderRadius: '0 8px 8px 0', borderLeft: 'none' }} title="Mois suivant">
        ›
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '110%', left: 0, zIndex: 100, background: '#EAE3D4', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', minWidth: 280, padding: 12 }}
          onMouseLeave={() => setOpen(false)}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            {annees.map(y => (
              <button key={y} onClick={() => setAnneeActive(y)}
                style={{ padding: '3px 10px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: '0.85em', fontWeight: 600, background: anneeActive === y ? 'var(--brand)' : 'var(--border)', color: anneeActive === y ? '#fff' : 'var(--text)' }}>
                {y}
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5 }}>
            {(parAnnee[anneeActive] || []).map(m => {
              const mi = parseInt(m.split('-')[1]) - 1
              const isActive = m === mois
              return (
                <button key={m} onClick={() => { setMois(m); setOpen(false) }}
                  style={{ padding: '6px 4px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: '0.85em', fontWeight: isActive ? 700 : 400, background: isActive ? 'var(--brand)' : 'var(--bg)', color: isActive ? '#fff' : 'var(--text)', textAlign: 'center' }}>
                  {MOIS_FR[mi]}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
