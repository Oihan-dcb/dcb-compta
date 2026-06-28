import { useState, useEffect, useCallback } from 'react'
import { chargerRepartitionManon, appliquerImputationManon } from '../services/repartitionManon'

// Suivi mensuel de la répartition hybride de Manon (CDI 15h + AE + SAP).
// Lecture : chargerRepartitionManon. Action : appliquerImputationManon (fige impute_salaire → compta).

const fmtH = h => (h == null ? '—' : `${Number(h).toFixed(1).replace('.0', '')}h`)

function Stat({ label, value, sub, color }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: '12px 14px', minWidth: 120 }}>
      <div style={{ fontSize: 11, color: '#6B7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: .4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || '#111827', marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

export default function RepartitionManon() {
  const [mois, setMois] = useState(() => new Date().toISOString().slice(0, 7))
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [msg, setMsg] = useState(null)

  const charger = useCallback(async () => {
    setLoading(true); setMsg(null)
    const r = await chargerRepartitionManon(mois).catch(e => ({ error: e.message }))
    setData(r); setLoading(false)
  }, [mois])
  useEffect(() => { charger() }, [charger])

  async function appliquer() {
    if (!window.confirm(`Figer l'imputation salaire des ménages couverts de ${mois} ? (impacte le débours AUTO en compta)`)) return
    setApplying(true)
    try {
      const r = await appliquerImputationManon(mois)
      setMsg(`✓ Imputation appliquée : ${r.couverts} ménage(s) couvert(s), ${r.retires} retiré(s).`)
      await charger()
    } catch (e) { setMsg('✕ ' + e.message) }
    setApplying(false)
  }

  return (
    <div style={{ background: '#FAFAF7', border: '1px solid #E5E7EB', borderRadius: 12, padding: 18, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>🔀 Répartition Manon (hybride)</h3>
        <input type="month" value={mois} onChange={e => setMois(e.target.value)}
          style={{ border: '1px solid #D1D5DB', borderRadius: 7, padding: '5px 9px', fontSize: 13 }} />
        <button onClick={appliquer} disabled={applying || loading || !data || data.error}
          style={{ marginLeft: 'auto', background: '#1a3a6e', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: applying ? 'default' : 'pointer', opacity: applying ? .7 : 1 }}>
          {applying ? '…' : 'Appliquer l\'imputation'}
        </button>
      </div>

      {msg && <div style={{ fontSize: 13, color: msg.startsWith('✓') ? '#15803D' : '#B91C1C', marginBottom: 12 }}>{msg}</div>}
      {loading && <div style={{ fontSize: 13, color: '#6B7280' }}>Chargement…</div>}
      {data?.error && <div style={{ fontSize: 13, color: '#B91C1C' }}>✕ {data.error}</div>}

      {data && !data.error && !loading && (() => {
        const c = data.couvert, ae = data.ae
        const couvertTotalH = (c.oihan.h + c.sap.h + c.dcb.h)
        return <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <Stat label="Pointé salarié" value={fmtH(data.heures_salarie)} sub={`cible ${fmtH(data.poolH)} · ${data.jours_pointes}j${data.ecart_pool >= 0 ? ' · +' + fmtH(data.ecart_pool) : ' · ' + fmtH(data.ecart_pool)}`} color={data.heures_salarie >= data.poolH ? '#15803D' : '#B45309'} />
            <Stat label="Couvert (salaire)" value={fmtH(couvertTotalH)} sub={`${c.total_nb} ménage(s) · 0 débours`} color="#15803D" />
            <Stat label="Facturé en AE" value={fmtH(ae.total_h)} sub={`${ae.total_nb} ménage(s)`} color="#B45309" />
            <Stat label="Dont SAP" value={fmtH(data.sap_total_h)} sub="facturation crédit d'impôt" color="#7C3AED" />
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              {[
                ['🏢 Bureau + DCB couvert', c.dcb, '#15803D'],
                ['🏠 Biens Oïhan (couvert)', c.oihan, '#15803D'],
                ['🧽 SAP rés. principale (couvert)', c.sap, '#7C3AED'],
                ['🏨 Lauian → AE', ae.lauian, '#B45309'],
                ['🧹 Hors pointage → AE', ae.hors_pointage, '#B45309'],
              ].map(([label, b, col]) => (
                <tr key={label} style={{ borderBottom: '1px solid #EEE' }}>
                  <td style={{ padding: '7px 4px' }}>{label}</td>
                  <td style={{ padding: '7px 4px', textAlign: 'right', color: '#6B7280' }}>{b.nb} ménage(s)</td>
                  <td style={{ padding: '7px 4px', textAlign: 'right', fontWeight: 700, color: col, minWidth: 60 }}>{fmtH(b.h)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 10 }}>
            Couvert = ménages DCB faits un jour pointé salarié (0 débours AE). « Appliquer » fige l'imputation pour la compta du mois.
          </div>
        </>
      })()}
    </div>
  )
}
