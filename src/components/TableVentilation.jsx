import { useState } from 'react'
import { formatMontant } from '../lib/hospitable'
import { agregerSejoursProrio } from '../services/ventilation'

const CODE_ORDER = ['HON', 'FMEN', 'AUTO', 'LOY', 'DIV', 'TAXE', 'VIR']

export default function TableVentilation({ recap, parProprio, reservations }) {
  const [vue, setVue] = useState('codes')

  if (!recap || recap.length === 0) return (
    <div className="empty-state">
      <div className="empty-state-title">Aucune ventilation calculée</div>
      <p>Clique sur "Ventiler" pour calculer la ventilation du mois.</p>
    </div>
  )

  const sorted = [...recap].sort((a, b) => CODE_ORDER.indexOf(a.code) - CODE_ORDER.indexOf(b.code))
  const totalHT  = recap.reduce((s, r) => s + r.ht, 0)
  const totalTVA = recap.reduce((s, r) => s + r.tva, 0)
  const totalTTC = recap.reduce((s, r) => s + r.ttc, 0)
  const sejoursProrio = reservations ? agregerSejoursProrio(reservations) : []

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={`btn btn-sm ${vue === 'codes' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setVue('codes')}>
          Par code
        </button>
        <button className={`btn btn-sm ${vue === 'proprios' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setVue('proprios')}>
          Par propriétaire ({parProprio.length})
        </button>
      </div>

      {vue === 'codes' ? (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Code</th><th>Libellé</th>
                <th className="right">Lignes</th>
                <th className="right">Montant HT</th>
                <th className="right">TVA</th>
                <th className="right">TTC</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => (
                <tr key={r.code}>
                  <td><span className={`code-${r.code}`}>{r.code}</span></td>
                  <td>{r.libelle}</td>
                  <td className="right">{r.nb}</td>
                  <td className="right montant">{formatMontant(r.ht)}</td>
                  <td className="right montant" style={{ color: 'var(--text-muted)' }}>{r.tva > 0 ? formatMontant(r.tva) : '—'}</td>
                  <td className="right montant">{formatMontant(r.ttc)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--brand-pale)' }}>
                <td colSpan={3} style={{ fontWeight: 600 }}>Total</td>
                <td className="right montant" style={{ fontWeight: 700 }}>{formatMontant(totalHT)}</td>
                <td className="right montant" style={{ fontWeight: 700, color: 'var(--text-muted)' }}>{formatMontant(totalTVA)}</td>
                <td className="right montant" style={{ fontWeight: 700 }}>{formatMontant(totalTTC)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Propriétaire</th>
                <th className="right">HON HT</th><th className="right">FMEN HT</th>
                <th className="right">AUTO</th><th className="right">LOY</th>
                <th className="right" style={{ color: 'var(--brand)' }}>VIR</th>
                <th className="right">Total DCB</th>
              </tr>
            </thead>
            <tbody>
              {parProprio.map(p => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 500 }}>{p.nom}</td>
                  <td className="right montant">{p.total_com > 0 ? formatMontant(p.total_com) : '—'}</td>
                  <td className="right montant">{p.total_men > 0 ? formatMontant(p.total_men) : '—'}</td>
                  <td className="right montant">{p.total_auto > 0 ? formatMontant(p.total_auto) : '—'}</td>
                  <td className="right montant">{p.total_loy > 0 ? formatMontant(p.total_loy) : '—'}</td>
                  <td className="right montant" style={{ fontWeight: 600, color: 'var(--brand)' }}>{p.total_vir > 0 ? formatMontant(p.total_vir) : '—'}</td>
                  <td className="right montant" style={{ fontWeight: 700 }}>{formatMontant(p.total_com + p.total_men + p.total_auto)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--brand-pale)' }}>
                <td style={{ fontWeight: 600 }}>Total</td>
                {['total_com','total_men','total_auto','total_loy'].map(k => (
                  <td key={k} className="right montant" style={{ fontWeight: 700 }}>{formatMontant(parProprio.reduce((s, p) => s + (p[k]||0), 0))}</td>
                ))}
                <td className="right montant" style={{ fontWeight: 700, color: 'var(--brand)' }}>{formatMontant(parProprio.reduce((s, p) => s + (p.total_vir||0), 0))}</td>
                <td className="right montant" style={{ fontWeight: 700 }}>{formatMontant(parProprio.reduce((s, p) => s + p.total_com + p.total_men + p.total_auto, 0))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {sejoursProrio.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontWeight: 700, fontSize: '0.8em', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            Séjours propriétaire — frais ménage facturés
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr><th>Propriétaire</th><th className="right">Séjours</th><th className="right">FMEN TTC</th></tr>
              </thead>
              <tbody>
                {sejoursProrio.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 500 }}>{p.nom}</td>
                    <td className="right">{p.nb_resas}</td>
                    <td className="right montant" style={{ fontWeight: 600 }}>{formatMontant(p.total_fmen)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--brand-pale)' }}>
                  <td style={{ fontWeight: 600 }}>Total</td>
                  <td className="right" style={{ fontWeight: 700 }}>{sejoursProrio.reduce((s, p) => s + p.nb_resas, 0)}</td>
                  <td className="right montant" style={{ fontWeight: 700 }}>{formatMontant(sejoursProrio.reduce((s, p) => s + p.total_fmen, 0))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
