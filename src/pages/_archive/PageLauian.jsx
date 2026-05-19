import { useState, useEffect } from 'react'
import MoisSelector from '../components/MoisSelector'
import { useMoisPersisted } from '../hooks/useMoisPersisted'
import { supabase } from '../lib/supabase'

const fmt = v => (v / 100).toFixed(2).replace('.', ',') + ' €'
const NF  = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtE = v => NF.format((v || 0) / 100) + ' €'

export default function PageLauian() {
  const [mois, setMois] = useMoisPersisted()
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState(null)

  useEffect(() => { charger() }, [mois])

  async function charger() {
    setLoading(true)
    setError(null)
    try {
      // 1. Biens Lauian actifs
      const { data: biensData } = await supabase
        .from('bien')
        .select('id, code, hospitable_name, proprietaire:proprietaire_id(id, nom, prenom)')
        .eq('agence', 'lauian')
        .eq('listed', true)

      const bienIds = (biensData || []).map(b => b.id)
      if (!bienIds.length) { setData({ biens: [], resas: [], fmenFacts: [], comLines: [], honLines: [] }); return }

      // 2. Réservations du mois
      const { data: resasData } = await supabase
        .from('reservation')
        .select('id, bien_id, platform, fin_revenue, final_status, guest_name, arrival_date, departure_date')
        .in('bien_id', bienIds)
        .eq('mois_comptable', mois)
        .neq('final_status', 'cancelled')

      // 3. Ventilation FMEN + HON + COM pour ces biens ce mois
      const { data: ventilData } = await supabase
        .from('ventilation')
        .select('bien_id, code, montant_ht, montant_tva, montant_ttc')
        .in('bien_id', bienIds)
        .eq('mois_comptable', mois)
        .in('code', ['FMEN', 'HON', 'COM', 'LOY'])

      // 4. Factures FMEN Lauian générées par DCB ce mois
      const { data: fmenFacts } = await supabase
        .from('facture_evoliz')
        .select('id, bien_id, total_ht, total_ttc, statut, proprietaire:proprietaire_id(nom, prenom)')
        .eq('mois', mois)
        .eq('agence', 'dcb')
        .eq('type_facture', 'lauian_fmen')

      // 5. Factures honoraires Lauian (HON) générées par Lauian ce mois
      const { data: honFacts } = await supabase
        .from('facture_evoliz')
        .select('id, bien_id, total_ht, total_ttc, statut, montant_reversement, proprietaire:proprietaire_id(nom, prenom)')
        .eq('mois', mois)
        .eq('agence', 'lauian')
        .eq('type_facture', 'honoraires')

      const bienMap = {}
      ;(biensData || []).forEach(b => { bienMap[b.id] = b })

      const ventilByBien = {}
      ;(ventilData || []).forEach(v => {
        if (!ventilByBien[v.bien_id]) ventilByBien[v.bien_id] = {}
        if (!ventilByBien[v.bien_id][v.code]) ventilByBien[v.bien_id][v.code] = { ht: 0, tva: 0, ttc: 0 }
        ventilByBien[v.bien_id][v.code].ht  += v.montant_ht  || 0
        ventilByBien[v.bien_id][v.code].tva += v.montant_tva || 0
        ventilByBien[v.bien_id][v.code].ttc += v.montant_ttc || 0
      })

      const resasByBien = {}
      ;(resasData || []).forEach(r => {
        if (!resasByBien[r.bien_id]) resasByBien[r.bien_id] = []
        resasByBien[r.bien_id].push(r)
      })

      const fmenByBien = {}
      ;(fmenFacts || []).forEach(f => { fmenByBien[f.bien_id] = f })

      const honByBien = {}
      ;(honFacts || []).forEach(f => { honByBien[f.bien_id] = f })

      // Totaux globaux
      const totFmen = (fmenFacts || []).reduce((s, f) => s + (f.total_ht || 0), 0)
      const totHon  = (honFacts  || []).reduce((s, f) => s + (f.total_ht || 0), 0)
      const totLoy  = (ventilData || []).filter(v => v.code === 'LOY').reduce((s, v) => s + (v.montant_ht || 0), 0)
      const totCom  = (ventilData || []).filter(v => v.code === 'COM').reduce((s, v) => s + (v.montant_ht || 0), 0)
      const totResas = (resasData || []).length

      setData({ biens: biensData || [], bienMap, ventilByBien, resasByBien, fmenByBien, honByBien, totFmen, totHon, totLoy, totCom, totResas })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const cardStyle = { background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px 20px', minWidth: 140 }
  const labelStyle = { fontSize: '0.72em', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }
  const valueStyle = { fontSize: '1.3em', fontWeight: 700, color: 'var(--text)' }
  const subStyle   = { fontSize: '0.72em', color: 'var(--text-muted)', marginTop: 2 }

  return (
    <div className="page-container" style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: '1.4em', fontWeight: 700 }}>Rapport Lauian</h1>
        <MoisSelector value={mois} onChange={setMois} />
      </div>

      {error && <div className="alert alert-error">✗ {error}</div>}
      {loading && <div style={{ color: 'var(--text-muted)', padding: 32, textAlign: 'center' }}>Chargement…</div>}

      {data && !loading && (
        <>
          {/* Cartes résumé */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
            <div style={cardStyle}>
              <div style={labelStyle}>Réservations</div>
              <div style={valueStyle}>{data.totResas}</div>
              <div style={subStyle}>biens Lauian · {mois}</div>
            </div>
            <div style={{ ...cardStyle, borderColor: '#fcd34d' }}>
              <div style={{ ...labelStyle, color: '#854d0e' }}>FMEN DCB facturé</div>
              <div style={{ ...valueStyle, color: '#854d0e' }}>{fmtE(data.totFmen)}</div>
              <div style={subStyle}>HT · factures DCB aux proprios</div>
            </div>
            <div style={cardStyle}>
              <div style={labelStyle}>HON Lauian</div>
              <div style={valueStyle}>{fmtE(data.totHon)}</div>
              <div style={subStyle}>HT · honoraires Lauian</div>
            </div>
            <div style={cardStyle}>
              <div style={labelStyle}>LOY reversé</div>
              <div style={valueStyle}>{fmtE(data.totLoy)}</div>
              <div style={subStyle}>HT · aux propriétaires</div>
            </div>
            {data.totCom > 0 && (
              <div style={{ ...cardStyle, borderColor: '#bbf7d0' }}>
                <div style={{ ...labelStyle, color: '#166534' }}>COM directes DCB</div>
                <div style={{ ...valueStyle, color: '#166534' }}>{fmtE(data.totCom)}</div>
                <div style={subStyle}>HT · resas direct/manual</div>
              </div>
            )}
          </div>

          {/* Tableau par bien */}
          {data.biens.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 48 }}>Aucun bien Lauian actif.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--bg)', borderBottom: '2px solid var(--border)' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>Bien</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>Propriétaire</th>
                    <th style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 600 }}>Resas</th>
                    <th style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 600, color: '#854d0e' }}>FMEN DCB HT</th>
                    <th style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 600 }}>Statut FMEN</th>
                    <th style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 600 }}>HON Lauian HT</th>
                    <th style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 600 }}>LOY HT</th>
                    {data.totCom > 0 && <th style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 600, color: '#166534' }}>COM HT</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.biens.map(bien => {
                    const v     = data.ventilByBien[bien.id] || {}
                    const resas = (data.resasByBien[bien.id] || []).length
                    const fmen  = data.fmenByBien[bien.id]
                    const hon   = data.honByBien[bien.id]
                    const STATUTS_FR = { brouillon: 'Brouillon', valide: 'Validée', envoye_evoliz: 'Evoliz ✓', payee: 'Payée', calcul_en_cours: '—' }
                    return (
                      <tr key={bien.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: 'var(--brand)', fontWeight: 600 }}>{bien.code}</td>
                        <td style={{ padding: '8px 12px' }}>{bien.proprietaire?.nom} {bien.proprietaire?.prenom || ''}</td>
                        <td style={{ padding: '8px 8px', textAlign: 'right' }}>{resas}</td>
                        <td style={{ padding: '8px 8px', textAlign: 'right', color: '#854d0e', fontWeight: 600 }}>
                          {fmen ? fmtE(fmen.total_ht) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </td>
                        <td style={{ padding: '8px 8px', textAlign: 'right' }}>
                          {fmen
                            ? <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: fmen.statut === 'envoye_evoliz' || fmen.statut === 'payee' ? '#dcfce7' : '#fef9c3', color: fmen.statut === 'envoye_evoliz' || fmen.statut === 'payee' ? '#166534' : '#854d0e' }}>
                                {STATUTS_FR[fmen.statut] || fmen.statut}
                              </span>
                            : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Non générée</span>
                          }
                        </td>
                        <td style={{ padding: '8px 8px', textAlign: 'right' }}>
                          {hon ? fmtE(hon.total_ht) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </td>
                        <td style={{ padding: '8px 8px', textAlign: 'right' }}>
                          {v.LOY ? fmtE(v.LOY.ht) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </td>
                        {data.totCom > 0 && (
                          <td style={{ padding: '8px 8px', textAlign: 'right', color: '#166534' }}>
                            {v.COM ? fmtE(v.COM.ht) : '—'}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                    <td colSpan={2} style={{ padding: '8px 12px' }}>TOTAL</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right' }}>{data.totResas}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', color: '#854d0e' }}>{fmtE(data.totFmen)}</td>
                    <td />
                    <td style={{ padding: '8px 8px', textAlign: 'right' }}>{fmtE(data.totHon)}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right' }}>{fmtE(data.totLoy)}</td>
                    {data.totCom > 0 && <td style={{ padding: '8px 8px', textAlign: 'right', color: '#166534' }}>{fmtE(data.totCom)}</td>}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
