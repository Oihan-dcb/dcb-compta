import { useState, useEffect, useRef } from 'react'
import { useMoisCloture, BanniereCloture } from '../hooks/useMoisCloture'
import { getMouvementsMois, getMoisDispos } from '../services/banque'
import { useMoisPersisted } from '../hooks/useMoisPersisted'
import { supabase } from '../lib/supabase'
import { importBookingCSV } from '../services/importBooking'
import { annulerRapprochement, estMouvementReference, lancerMatchingAuto } from '../services/rapprochement'
import { parserFichierBancaire, importerMouvementsBancaires } from '../services/importBanque'
import { syncPayoutsServer } from '../services/syncPayouts'
import { filtrerTransactionsDupliquees } from '../services/pennylaneDedup'
import { AGENCE } from '../lib/agence'

import MoisSelector from '../components/MoisSelector'
import LastSyncBadge from '../components/LastSyncBadge'
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
  const [mois, setMois] = useMoisPersisted()
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
  const [suppression, setSuppression] = useState(null) // { source, mois, count }
  const [supprimant, setSupprimant] = useState(false)
  const [supprimantId, setSupprimantId] = useState(null)
  const [bookingLog, setBookingLog] = useState(null)
  const [syncPayoutsLog, setSyncPayoutsLog] = useState(null)
  const [confirmModal, setConfirmModal] = useState(null)
  const [importingBooking, setImportingBooking] = useState(false)
  const [syncingPayouts, setSyncingPayouts] = useState(false)
  const bookingRef = useRef()

  const { bloque: moisBloque } = useMoisCloture(mois, 'rappro')

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

  async function handleBookingFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setImportingBooking(true)
    setBookingLog(null)
    try {
      const text = await file.text()
      const log = await importBookingCSV(text)
      setBookingLog(log)
      await charger()
    } catch(err) {
      setBookingLog({ errors: 1, details: [err.message] })
    } finally {
      setImportingBooking(false)
      if (bookingRef.current) bookingRef.current.value = ''
    }
  }

  async function handleSyncPayouts() {
    if (moisBloque) { setError('🔒 Mois clôturé (Rapprochement) — sync impossible.'); return }
    setSyncingPayouts(true)
    setSyncPayoutsLog(null)
    try {
      const log = await syncPayoutsServer(3)
      setSyncPayoutsLog(log)
    } catch (err) {
      setSyncPayoutsLog({ errors: 1, details: [err.message] })
    } finally {
      setSyncingPayouts(false)
    }
  }

  async function supprimerMouvement(id) {
    if (moisBloque) { setError('🔒 Mois clôturé (Rapprochement) — modification impossible.'); return }
    setConfirmModal({
      message: 'Supprimer ce mouvement bancaire ?\nCette action est irréversible.',
      onConfirm: async () => {
        setConfirmModal(null)
        setSupprimantId(id)
        try {
          // CF-BQ1 : nettoyer les tables liées dès que le mouvement est RÉFÉRENCÉ
          // (pas seulement statut 'rapproche' — un lien peut exister sous matche_auto,
          // en_attente, non_identifie… cf. 11 cas trouvés). Sinon orphelins garantis.
        if (await estMouvementReference(id)) {
          await annulerRapprochement(id)
        }
        const { error } = await supabase.from('mouvement_bancaire').delete().eq('id', id)
          if (error) throw error
          await charger()
        } catch(e) { setError('Erreur : ' + e.message) }
        finally { setSupprimantId(null) }
      }
    })
  }

  async function supprimerMois() {
    if (!suppression) return
    if (moisBloque) { setError('🔒 Mois clôturé (Rapprochement) — suppression impossible.'); return }
    setSupprimant(true)
    try {
      // CF-BQ2 : nettoyer les tables liées pour TOUT mouvement référencé avant suppression
      // (pas seulement 'rapproche'). Précalcul de l'ensemble référencé du mois (3 requêtes).
      const { data: mvtsMois } = await supabase
        .from('mouvement_bancaire')
        .select('id, statut_matching')
        .eq('source', suppression.source)
        .eq('mois_releve', suppression.mois)
      const mvtIds = (mvtsMois || []).map(m => m.id)
      const referencedSet = new Set()
      if (mvtIds.length) {
        const [v, p, rp] = await Promise.all([
          supabase.from('ventilation').select('mouvement_id').in('mouvement_id', mvtIds),
          supabase.from('payout_hospitable').select('mouvement_id').in('mouvement_id', mvtIds),
          supabase.from('reservation_paiement').select('mouvement_id').in('mouvement_id', mvtIds),
        ])
        for (const row of [...(v.data || []), ...(p.data || []), ...(rp.data || [])]) referencedSet.add(row.mouvement_id)
      }
      for (const m of (mvtsMois || [])) {
        if (m.statut_matching === 'rapproche' || referencedSet.has(m.id)) {
          await annulerRapprochement(m.id)
        }
      }
      // Supprimer tous les mouvements du mois sélectionné pour cette source
      const { error } = await supabase
        .from('mouvement_bancaire')
        .delete()
        .eq('source', suppression.source)
        .eq('mois_releve', suppression.mois)
      if (error) throw error
      setSuppression(null)
      await charger()
    } catch(e) {
      setError('Erreur suppression : ' + e.message)
    } finally {
      setSupprimant(false)
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
    if (moisBloque) { setError('🔒 Mois clôturé (Rapprochement) — import impossible.'); return }
    setImporting(true)
    let rows = preview.rows
    try {
      // Garde-fou anti-doublon inter-sources : si Pennylane a déjà synchronisé ces jours
      // (cron nightly), ne pas réimporter les mêmes mouvements via le CSV manuel (incident
      // du 09/07/2026 — 11 mouvements dupliqués dont un double paiement résa Skelton).
      const asTx = rows.map(r => ({
        date: r.date_operation,
        amount: r.debit ? -(r.debit / 100) : (r.credit || 0) / 100,
        label: r.libelle,
        _row: r,
      }))
      const { transactions: restants, doublonsEvites } = await filtrerTransactionsDupliquees(supabase, {
        table: 'mouvement_bancaire', agence: AGENCE, transactions: asTx, direction: 'pennylane',
      })
      rows = restants.map(t => t._row)
      const result = await importerMouvementsBancaires(rows)
      if (doublonsEvites > 0) result.doublonsEvitesPennylane = doublonsEvites
      setImportResult(result)
      setPreview(null)
      setFormatDetecte(null)
      await charger()
      // Lancer le matching automatique sur les mois importés (best-effort) — évite d'avoir
      // à aller cliquer "Lancer auto" dans Rapprochement après chaque import de relevé.
      try {
        const moisImportes = [...new Set((rows || []).map(r => r.mois_releve).filter(Boolean))]
        let autoMatched = 0
        for (const mi of moisImportes) {
          const r = await lancerMatchingAuto(mi)
          autoMatched += (r?.matched || 0)
        }
        if (autoMatched > 0) {
          setImportResult(prev => ({ ...(prev || result), autoMatched }))
          await charger()
        }
      } catch (mErr) {
        console.warn('Auto-matching post-import:', mErr?.message || mErr)
      }
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
          {/* Import CSV manuel masqué : ce compte (CAISSE EPARGNE LOCATION SAISONNIERE) est
              alimenté automatiquement par api/pennylane-mouvement-sync (cron nightly 3h50)
              depuis le 07/07/2026. Réactiver ferait doublonner (voir pennylaneDedup.js). */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <span style={{ fontSize: 12, color: '#8C7B65', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              🔗 Pennylane
            </span>
            <LastSyncBadge type="pennylane_sequestre_saisonniere" />
          </div>
          <label style={{ cursor:'pointer', background:'#0071C2', color:'#fff', border:'none', borderRadius:8, padding:'8px 14px', fontWeight:600, fontSize:14, display:'inline-flex', alignItems:'center', gap:6 }}>
            {importingBooking ? '⏳' : '📋'} CSV Booking
            <input ref={bookingRef} type='file' accept='.csv' style={{ display:'none' }} onChange={handleBookingFile} />
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <button
              onClick={handleSyncPayouts}
              disabled={syncingPayouts || moisBloque}
              style={{ cursor: (syncingPayouts || moisBloque) ? 'not-allowed' : 'pointer', background: moisBloque ? '#aaa' : '#FF385C', color:'#fff', border:'none', borderRadius:8, padding:'8px 14px', fontWeight:600, fontSize:14, display:'inline-flex', alignItems:'center', gap:6 }}>
              {syncingPayouts ? '⏳ Sync...' : moisBloque ? '🔒 Sync Airbnb' : '🔄 Sync Airbnb'}
            </button>
            <LastSyncBadge type="airbnb_payouts" refreshKey={syncPayoutsLog} />
          </div>
          <button
            onClick={() => setSuppression(suppression ? null : { source: 'CaisseEpargne', mois, count: mouvements.length })}
            style={{ background: '#FEF2F2', color: '#B91C1C', border: '1px solid #FCA5A5', borderRadius: 8, padding: '8px 14px', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
            Supprimer
          </button>
        </div>
      </div>

      {moisBloque && <BanniereCloture etape="rappro" />}
      {error && <div className='alert alert-error'>{error}</div>}

      {importResult && (
        <div className='alert alert-success'>
          Import termine -- {importResult.inseres} mouvements importes
          {importResult.autoMatched > 0 && ' · ' + importResult.autoMatched + ' rapproché' + (importResult.autoMatched > 1 ? 's' : '') + ' automatiquement'}
        </div>
      )}

      {suppression && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '12px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, color: '#B91C1C', fontWeight: 600 }}>Supprimer les mouvements de ce mois ?</span>
          <select
            value={suppression.source}
            onChange={e => setSuppression({ ...suppression, source: e.target.value })}
            style={{ border: '1px solid #FCA5A5', borderRadius: 6, padding: '4px 8px', fontSize: 13 }}>
            <option value='CaisseEpargne'>Caisse Epargne</option>
            <option value='BudgetBakers'>BudgetBakers</option>
          </select>
          <select
            value={suppression.mois}
            onChange={e => setSuppression({ ...suppression, mois: e.target.value })}
            style={{ border: '1px solid #FCA5A5', borderRadius: 6, padding: '4px 8px', fontSize: 13 }}>
            {moisDispos.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <button onClick={supprimerMois} disabled={supprimant}
            style={{ background: '#B91C1C', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
            {supprimant ? 'Suppression...' : 'Confirmer suppression'}
          </button>
          <button onClick={() => setSuppression(null)}
            style={{ background: '#fff', color: '#888', border: '1px solid #ddd', borderRadius: 6, padding: '5px 10px', fontSize: 13, cursor: 'pointer' }}>
            Annuler
          </button>
        </div>
      )}

      {syncPayoutsLog && (
        <div style={{ background: syncPayoutsLog.errors > 0 ? '#FEF2F2' : '#F0FDF4', border: '1px solid ' + (syncPayoutsLog.errors > 0 ? '#FCA5A5' : '#86EFAC'), borderRadius:8, padding:'10px 16px', marginBottom:12, fontSize:13 }}>
          <strong>Sync Airbnb :</strong>{' '}
          <span style={{ color:'#16A34A' }}>{syncPayoutsLog.updated || 0} date(s) corrigée(s)</span>
          {(syncPayoutsLog.created || 0) > 0 && <span style={{ color:'#16A34A' }}>{' · '}{syncPayoutsLog.created} entrée(s) créée(s)</span>}
          {(syncPayoutsLog.processed || 0) > 0 && <span style={{ color:'#888' }}>{' · '}{syncPayoutsLog.processed} résa(s) traitées</span>}
          {(syncPayoutsLog.not_found || 0) > 0 && <span style={{ color:'#2563EB' }}>{' · '}{syncPayoutsLog.not_found} code(s) non trouvés</span>}
          {(syncPayoutsLog.skipped || 0) > 0 && <span style={{ color:'#888' }}>{' · '}{syncPayoutsLog.skipped} déjà rapprochés</span>}
          {syncPayoutsLog.errors > 0 && <span style={{ color:'#B91C1C' }}>{' · '}{syncPayoutsLog.errors} erreur(s)</span>}
          {syncPayoutsLog.details?.length > 0 && <div style={{ color:'#666', marginTop:4 }}>{syncPayoutsLog.details.slice(0, 10).join(' | ')}</div>}
        </div>
      )}
      {bookingLog && (
        <div style={{ background: bookingLog.errors > 0 ? '#FEF2F2' : '#F0FDF4', border: '1px solid ' + (bookingLog.errors > 0 ? '#FCA5A5' : '#86EFAC'), borderRadius:8, padding:'10px 16px', marginBottom:12, fontSize:13 }}>
          <strong>Import Booking :</strong>{' '}
          <span style={{ color:'#2E7D32' }}>{bookingLog.matched || 0} virements matchés</span>{' · '}
          <span>{bookingLog.inserted || 0} nouvelles lignes</span>
          {(bookingLog.already_existing || 0) > 0 && <span style={{ color:'#888' }}>{' · '}{bookingLog.already_existing} déjà présentes (ignorées)</span>}
          {bookingLog.errors > 0 && <span style={{ color:'#B91C1C' }}>{' · '}{bookingLog.errors} erreur(s)</span>}
          {bookingLog.details?.length > 0 && <div style={{ color:'#666', marginTop:4 }}>{bookingLog.details.join(' | ')}</div>}
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
            <thead><tr><th>Date</th><th>Libelle</th><th>Canal</th><th className='right'>Credit</th><th className='right'>Debit</th><th>Statut</th><th style={{width:32}}></th></tr></thead>
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
                     <td style={{textAlign:'center',width:32}}>
                       <button onClick={() => supprimerMouvement(m.id)} disabled={supprimantId === m.id}
                         title='Supprimer' style={{background:'none',border:'none',cursor:'pointer',color:'#ccc',fontSize:18,lineHeight:1,padding:'0 4px'}}
                         onMouseEnter={e=>e.currentTarget.style.color='#B91C1C'} onMouseLeave={e=>e.currentTarget.style.color='#ccc'}>
                         {supprimantId === m.id ? '⏳' : '×'}
                       </button>
                     </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
          {confirmModal && (
        <div style={{ position:'fixed',inset:0,background:'rgba(44,36,22,0.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000 }}>
          <div style={{ background:'var(--bg,#F7F3EC)',border:'2px solid var(--brand,#CC9933)',borderRadius:16,padding:'28px 32px',maxWidth:400,width:'90%',boxShadow:'0 8px 32px rgba(44,36,22,0.18)' }}>
            <p style={{ margin:'0 0 24px',color:'var(--text,#2C2416)',fontSize:14,lineHeight:1.6,whiteSpace:'pre-line' }}>{confirmModal.message}</p>
            <div style={{ display:'flex',gap:10,justifyContent:'flex-end' }}>
              <button onClick={() => setConfirmModal(null)}
                style={{ padding:'9px 18px',borderRadius:8,border:'1.5px solid var(--border,#D9CEB8)',background:'white',color:'var(--text,#2C2416)',cursor:'pointer',fontWeight:600,fontSize:13 }}>
                Annuler
              </button>
              <button onClick={confirmModal.onConfirm}
                style={{ padding:'9px 18px',borderRadius:8,border:'none',background:'#DC2626',color:'white',cursor:'pointer',fontWeight:700,fontSize:13 }}>
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}
</div>
  )
}
