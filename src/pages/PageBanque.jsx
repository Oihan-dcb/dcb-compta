import { useState, useEffect, useRef } from 'react'
import { getMouvementsMois, getMoisDispos } from '../services/banque'
import { parserFichierBancaire, importerMouvementsBancaires } from '../services/importBanque'
import MoisSelector from '../components/MoisSelector'
import { formatMontant } from '../lib/hospitable'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

const moisCourant = new Date().toISOString().substring(0, 7)

const CANAUX = {
  airbnb:            { label: 'Airbnb',      cls: 'badge-airbnb' },
  booking:           { label: 'Booking',     cls: 'badge-booking' },
  stripe:            { label: 'Stripe',      cls: 'badge-stripe' },
  sepa_manuel:       { label: 'SEPA',        cls: 'badge-sepa' },
  interne:           { label: 'Interne',     cls: 'badge-neutral' },
  sortant_proprio:   { label: 'Proprio',     cls: 'badge-proprio' },
  sortant_honoraires:{ label: 'Honoraires',  cls: 'badge-neutral' },
  sortant_ae:        { label: 'AE',          cls: 'badge-neutral' },
  frais_bancaires:   { label: 'Frais',       cls: 'badge-neutral' },
}

export default function PageBanque() {
  const [mois, setMois] = useState(moisCourant)
  const [mouvements, setMouvements] = useState([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState(null)
  const [filtre, setFiltre] = useState('tous')
  const [moisDispos, setMoisDispos] = useState([moisCourant])
  const [preview, setPreview] = useState(null)
  const [formatDetecte, setFormatDetecte] = useState(null)
  const [importResult, setImportResult] = useState(null)
  const fileRef = useRef()

  useEffect(() => { charger() }, [mois])

  async function charger() {
    setLoading(true)
    setError(null)
    try {
      const [m, d] = await Promise.all([getMouvementsMois(mois), getMoisDispos()])
      setMouvements(m || [])
      setMoisDispos(d?.length ? d : [moisCourant])
    } catch(e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setPreview(null)
    setImportResult(null)
    setFormatDetecte(null)
    try {
      const result = await parserFichierBancaire(file)
      setFormatDetecte(result.format)
      setPreview(result)
    } catch(e) {
      setError('Erreur parsing CSV : ' + e.message)
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  async function confirmerImport() {
    if (!preview) return
    setImporting(true)
    try {
      const result = await importerMouvementsBancaires(preview.rows)
      setImportResult(result)
      setPreview(null)
      setFormatDetecte(null)
      await charger()
    } catch(e) {
      setError(e.message)
    } finally {
      setImporting(false)
    }
  }

  const liste = mouvements.filter(m => {
    if (filtre === 'entrees') return (m.credit || 0) > 0
    if (filtre === 'rapprocher') return m.statut_matching === 'en_attente' && (m.credit || 0) > 0
    return true
  })

  const entrees  = mouvements.filter(m => (m.credit||0) > 0)
  const sorties  = mouvements.filter(m => (m.debit||0) > 0)
  const aRapprocher = mouvements.filter(m => m.statut_matching === 'en_attente' && (m.credit||0) > 0)
  const rapproches  = mouvements.filter(m => m.statut_matching === 'rapproche')

  const formatBadge = formatDetecte === 'budgetbakers'
    ? { bg: '#FFF3E0', border: '1px solid #FFB74D', label: String.fromCodePoint(0x1F7E0) + ' BudgetBakers (ancienne banque)' }
    : { bg: '#E3F2FD', border: '1px solid #64B5F6', label: String.fromCodePoint(0x1F535) + ' Caisse Epargne' }

  return (
    <div className='page-container'>
      <div className='page-header'>
        <div>
          <h1 className='page-title'>Compte de gestion</h1>
          <p className='page-subtitle'>Caisse Epargne -- {mouvements.length} operations</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <MoisSelector mois={mois} setMois={setMois} moisDispos={moisDispos} />
          <button onClick={charger} className='btn btn-secondary btn-sm' disabled={loading}>
            {loading ? '...' : String.fromCodePoint(0x21BB)}
          </button>
          <label className='btn btn-primary' style={{ cursor: 'pointer' }}>
            {String.fromCodePoint(0x2191)} Import CSV
            <input ref={fileRef} type='file' accept='.csv' style={{ display: 'none' }} onChange={handleFile} />
          </label>
        </div>
      </div>

      {error && <div className='alert alert-error'>{error}</div>}

      {importResult && (
        <div className='alert alert-success'>
          Import termine -- {importResult.inseres} mouvements importes
        </div>
      )}

      {formatDetecte && (
        <div style={{ marginBottom: 12, padding: '8px 14px', borderRadius: 8,
          background: formatBadge.bg, border: formatBadge.border,
          fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <strong>Format :</strong> {formatBadge.label}
        </div>
      )}

      {preview && (
        <div className='card' style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <strong>{preview.total} mouvements</strong> detectes
              {preview.mois_disponibles?.length > 0 && (
                <span style={{ marginLeft: 8, color: '#666', fontSize: 13 }}>
                  {preview.mois_disponibles.length} mois
                  {' '}({preview.mois_disponibles[0].mois} a {preview.mois_disponibles[preview.mois_disponibles.length-1].mois})
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className='btn btn-secondary btn-sm' onClick={() => { setPreview(null); setFormatDetecte(null) }}>Annuler</button>
              <button className='btn btn-primary' onClick={confirmerImport} disabled={importing}>
                {importing ? 'Import...' : 'Confirmer import'}
              </button>
            </div>
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            <table className='table'>
              <thead><tr><th>Date</th><th>Libelle</th><th>Canal</th><th className='right'>Credit</th><th className='right'>Debit</th></tr></thead>
              <tbody>
                {preview.rows.slice(0, 20).map((m, i) => (
                  <tr key={i}>
                    <td>{m.date_operation}</td>
                    <td>{m.libelle}</td>
                    <td><span className={'badge ' + (CANAUX[m.canal]?.cls || 'badge-neutral')}>{CANAUX[m.canal]?.label || m.canal}</span></td>
                    <td className='right montant montant-positif'>{m.credit ? formatMontant(m.credit) : '--'}</td>
                    <td className='right montant montant-negatif'>{m.debit ? formatMontant(m.debit) : '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.rows.length > 20 && <p style={{ textAlign: 'center', color: '#888', fontSize: 13, margin: '8px 0' }}>... et {preview.rows.length - 20} autres</p>}
          </div>
        </div>
      )}

      <div className='stats-row'>
        <div className='stat-card'><div className='stat-label'>ENTREES</div><div className='stat-value stat-positive'>{formatMontant(entrees.reduce((s,m)=>s+(m.credit||0),0))}</div><div className='stat-sub'>{entrees.length} operations</div></div>
        <div className='stat-card'><div className='stat-label'>SORTIES</div><div className='stat-value stat-negative'>{formatMontant(sorties.reduce((s,m)=>s+(m.debit||0),0))}</div><div className='stat-sub'>{sorties.length} operations</div></div>
        <div className='stat-card'><div className='stat-label'>A RAPPROCHER</div><div className='stat-value' style={{ color: aRapprocher.length > 0 ? 'var(--warning)' : 'var(--success)' }}>{aRapprocher.length}</div><div className='stat-sub'>virements en attente</div></div>
        <div className='stat-card'><div className='stat-label'>RAPPROCHES</div><div className='stat-value'>{rapproches.length}</div><div className='stat-sub'>sur {entrees.length} entrees</div></div>
      </div>

      <div className='filter-tabs' style={{ marginBottom: 16 }}>
        {[['tous','Tous'],['entrees','Entrees'],['rapprocher','A rapprocher']].map(([k,l]) => (
          <button key={k} className={'filter-tab' + (filtre===k?' active':'')} onClick={() => setFiltre(k)}>{l} ({k==='tous'?mouvements.length:k==='entrees'?entrees.length:aRapprocher.length})</button>
        ))}
      </div>

      {!loading && liste.length === 0 && (
        <div className='empty-state'>
          <p>Aucun mouvement</p>
          <p>Importe un releve CSV pour ce mois.</p>
        </div>
      )}

      {liste.length > 0 && (
        <div className='table-container'>
          <table className='table'>
            <thead><tr><th>Date</th><th>Libelle</th><th>Canal</th><th className='right'>Credit</th><th className='right'>Debit</th><th>Statut</th></tr></thead>
            <tbody>
              {liste.map(m => {
                const canal = CANAUX[m.canal]
                const d = m.date_operation ? format(new Date(m.date_operation), 'd MMM', { locale: fr }) : ''
                return (
                  <tr key={m.id}>
                    <td>{d}</td>
                    <td><div>{m.libelle}</div>{m.detail && <div style={{ fontSize: 12, color: '#888' }}>{m.detail}</div>}</td>
                    <td>{canal ? <span className={'badge ' + canal.cls}>{canal.label}</span> : <span className='badge badge-neutral'>{m.canal}</span>}</td>
                    <td className='right montant montant-positif'>{m.credit ? formatMontant(m.credit) : '--'}</td>
                    <td className='right montant montant-negatif'>{m.debit ? formatMontant(m.debit) : '--'}</td>
                    <td><span className={m.statut_matching === 'rapproche' ? 'badge badge-success' : 'badge badge-neutral'}>{m.statut_matching === 'rapproche' ? 'Rapproche' : 'En attente'}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
