import { useState, useEffect } from 'react'
import { AGENCE } from '../lib/agence'
import { getCloture, isEtapeCloturee } from '../services/cloture'

/**
 * Charge l'état de clôture pour le mois sélectionné.
 * @param {string} mois  — format YYYY-MM
 * @param {string} etape — 'ventil' | 'rappro' | 'facturat'
 * @returns {{ bloque: boolean, cloture: object|null, loading: boolean }}
 */
export function useMoisCloture(mois, etape) {
  const [cloture, setCloture]   = useState(null)
  const [loading, setLoading]   = useState(false)

  useEffect(() => {
    if (!mois) return
    let cancelled = false
    setLoading(true)
    getCloture(mois, AGENCE).then(c => {
      if (!cancelled) { setCloture(c); setLoading(false) }
    }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [mois])

  return { cloture, loading, bloque: isEtapeCloturee(cloture, etape) }
}

/** Bannière affichée dans les pages quand le mois est clôturé */
export function BanniereCloture({ etape }) {
  const LABELS = { ventil: 'Ventilation', rappro: 'Rapprochement', facturat: 'Facturation' }
  return (
    <div style={{
      background: '#FEF3C7', border: '1.5px solid #F59E0B', borderRadius: 8,
      padding: '10px 14px', marginBottom: 16,
      display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#92400E',
    }}>
      🔒 <span><strong>Mois clôturé</strong> — Étape « {LABELS[etape]} » verrouillée. Les modifications sont bloquées pour ce mois.</span>
    </div>
  )
}
