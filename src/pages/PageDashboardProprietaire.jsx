import { useState, useEffect, useMemo } from 'react'
import { getProprietairesComplets } from '../services/mandats'
import { agregerProprietaireAnnuel } from '../services/dashboardProprietaire'

const fmt = (c) => ((c || 0) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const fmt0 = (c) => Math.round((c || 0) / 100).toLocaleString('fr-FR') + ' €'
const MOIS_COURT = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc']

export default function PageDashboardProprietaire() {
  const [proprios, setProprios] = useState([])
  const [propId, setPropId] = useState('')
  const [annee, setAnnee] = useState(new Date().getFullYear())
  const [agg, setAgg] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    getProprietairesComplets()
      .then(d => setProprios((d || []).filter(p => (p.bien || []).length > 0)))
      .catch(e => setErr(e.message))
  }, [])

  const proprio = useMemo(() => proprios.find(p => p.id === propId), [proprios, propId])

  useEffect(() => {
    if (!proprio) { setAgg(null); return }
    setLoading(true); setErr(null)
    agregerProprietaireAnnuel(proprio, annee)
      .then(setAgg)
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }, [proprio, annee])

  const annees = Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - i)
  const maxCaMois = agg ? Math.max(1, ...agg.parMois.map(m => m.caHeb)) : 1

  const card = (label, val, color, sub) => (
    <div style={{ background: '#fff', border: '1px solid var(--border,#D9CEB8)', borderRadius: 12, padding: '14px 18px', minWidth: 150, flex: 1 }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted,#8C7B65)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color, marginTop: 4 }}>{val}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted,#8C7B65)', marginTop: 2 }}>{sub}</div>}
    </div>
  )

  const th = { textAlign: 'right', padding: '7px 10px', fontSize: 11, color: 'var(--text-muted,#8C7B65)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', whiteSpace: 'nowrap' }
  const td = { textAlign: 'right', padding: '7px 10px', fontSize: 13, whiteSpace: 'nowrap' }

  return (
    <div style={{ padding: 16, maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text,#2C2416)', margin: '0 0 4px' }}>📊 Synthèse financière propriétaire</h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted,#8C7B65)', margin: '0 0 16px' }}>Consolidation annuelle (revenus, honoraires, reversements) — usage interne.</p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 18 }}>
        <select value={propId} onChange={e => setPropId(e.target.value)}
          style={{ flex: 1, minWidth: 240, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border,#D9CEB8)', background: '#fff', fontSize: 14 }}>
          <option value="">— Choisir un propriétaire —</option>
          {proprios.map(p => (
            <option key={p.id} value={p.id}>{[p.prenom, p.nom].filter(Boolean).join(' ')} ({(p.bien || []).length} bien{(p.bien || []).length > 1 ? 's' : ''})</option>
          ))}
        </select>
        <select value={annee} onChange={e => setAnnee(Number(e.target.value))}
          style={{ padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border,#D9CEB8)', background: '#fff', fontSize: 14, fontWeight: 600 }}>
          {annees.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {err && <div style={{ background: '#FEE2E2', color: '#B91C1C', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 14 }}>✗ {err}</div>}
      {!propId && <div style={{ color: 'var(--text-muted,#8C7B65)', fontSize: 14, padding: 24, textAlign: 'center' }}>Sélectionnez un propriétaire pour afficher sa synthèse {annee}.</div>}
      {propId && loading && <div style={{ color: 'var(--text-muted,#8C7B65)', fontSize: 14, padding: 24, textAlign: 'center' }}>Calcul en cours…</div>}

      {propId && !loading && agg && (() => {
        const t = agg.total
        return (
          <>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
              {card('CA hébergement', fmt0(t.caHeb), 'var(--text,#2C2416)', `${t.nbResas} réservation${t.nbResas > 1 ? 's' : ''} · ${t.nuitsOccupees} nuits`)}
              {card('Honoraires DCB', fmt0(t.honTotal), '#CC9933', 'commission TTC')}
              {card('Forfait ménage', fmt0(t.fmenTotal), '#8C7B65', t.autoTotal ? `dont débours AE ${fmt0(t.autoTotal)}` : null)}
              {card('Reversé propriétaire', fmt0(t.netReverse), '#15803D', 'net après retenues')}
              {t.taxe > 0 && card('Taxe de séjour', fmt0(t.taxe), '#8C7B65', 'collectée')}
            </div>

            {/* Détail mensuel */}
            <div style={{ background: '#fff', border: '1px solid var(--border,#D9CEB8)', borderRadius: 12, padding: 16, marginBottom: 18 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 10px', color: 'var(--text,#2C2416)' }}>Détail mensuel {annee}</h2>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: '1px solid var(--border,#D9CEB8)' }}>
                  <th style={{ ...th, textAlign: 'left' }}>Mois</th>
                  <th style={{ ...th, width: '34%', textAlign: 'left' }}>CA hébergement</th>
                  <th style={th}>Résas</th><th style={th}>Honoraires</th><th style={th}>Reversé</th>
                </tr></thead>
                <tbody>
                  {agg.parMois.map((m, i) => (
                    <tr key={m.mois} style={{ borderBottom: '1px solid #F0EDE5' }}>
                      <td style={{ padding: '7px 10px', fontSize: 13, fontWeight: 600 }}>{MOIS_COURT[i]}</td>
                      <td style={{ padding: '7px 10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, height: 8, background: '#F0EDE5', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ width: (m.caHeb / maxCaMois * 100) + '%', height: '100%', background: '#E4A853' }} />
                          </div>
                          <span style={{ fontSize: 12, color: 'var(--text-muted,#8C7B65)', minWidth: 64, textAlign: 'right' }}>{m.caHeb ? fmt0(m.caHeb) : '—'}</span>
                        </div>
                      </td>
                      <td style={td}>{m.nbResas || '—'}</td>
                      <td style={{ ...td, color: '#CC9933' }}>{m.honTotal ? fmt0(m.honTotal) : '—'}</td>
                      <td style={{ ...td, color: '#15803D', fontWeight: 600 }}>{m.netReverse ? fmt0(m.netReverse) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr style={{ borderTop: '2px solid var(--border,#D9CEB8)' }}>
                  <td style={{ padding: '8px 10px', fontWeight: 800 }}>Total</td>
                  <td style={{ padding: '8px 10px', fontWeight: 800 }}>{fmt(t.caHeb)}</td>
                  <td style={{ ...td, fontWeight: 800 }}>{t.nbResas}</td>
                  <td style={{ ...td, fontWeight: 800, color: '#CC9933' }}>{fmt0(t.honTotal)}</td>
                  <td style={{ ...td, fontWeight: 800, color: '#15803D' }}>{fmt0(t.netReverse)}</td>
                </tr></tfoot>
              </table>
            </div>

            {/* Détail par bien */}
            {agg.parBien.length > 1 && (
              <div style={{ background: '#fff', border: '1px solid var(--border,#D9CEB8)', borderRadius: 12, padding: 16 }}>
                <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 10px', color: 'var(--text,#2C2416)' }}>Par bien</h2>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr style={{ borderBottom: '1px solid var(--border,#D9CEB8)' }}>
                    <th style={{ ...th, textAlign: 'left' }}>Bien</th>
                    <th style={th}>Résas</th><th style={th}>CA héberg.</th><th style={th}>Honoraires</th><th style={th}>Reversé</th>
                  </tr></thead>
                  <tbody>
                    {agg.parBien.map(b => (
                      <tr key={b.bienId} style={{ borderBottom: '1px solid #F0EDE5' }}>
                        <td style={{ padding: '7px 10px', fontSize: 13 }}><span style={{ fontWeight: 600 }}>{b.code}</span>{b.nom && b.nom !== b.code && <span style={{ color: 'var(--text-muted,#8C7B65)', marginLeft: 6, fontSize: 12 }}>{b.nom}</span>}</td>
                        <td style={td}>{b.nbResas || '—'}</td>
                        <td style={td}>{b.caHeb ? fmt0(b.caHeb) : '—'}</td>
                        <td style={{ ...td, color: '#CC9933' }}>{b.honTotal ? fmt0(b.honTotal) : '—'}</td>
                        <td style={{ ...td, color: '#15803D', fontWeight: 600 }}>{b.netReverse ? fmt0(b.netReverse) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p style={{ fontSize: 11, color: 'var(--text-muted,#8C7B65)', marginTop: 14 }}>
              Chiffres issus des rapports mensuels (source de vérité). « Reversé » = facture confirmée si présente, sinon LOY net après débours/retenues. Le détail du séquestre reste dans Exports.
            </p>
          </>
        )
      })()}
    </div>
  )
}
