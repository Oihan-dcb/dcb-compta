import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  getMouvementsMois, getVirNonRapproches, getStatsRapprochement,
  lancerMatchingAuto, matcherManuellement, marquerNonIdentifie, annulerRapprochement
} from '../services/rapprochement'
import { syncStripe } from '../services/syncStripe'
import { setToken } from '../lib/hospitable'
import { exportCSVComptable } from '../services/exportCSVComptable'

import MoisSelector from '../components/MoisSelector'
import ModalResa from '../components/ModalResa'
import { useMoisPersisted } from '../hooks/useMoisPersisted'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
const HOSP_TOKEN = import.meta.env.VITE_HOSPITABLE_TOKEN

const moisCourant = new Date().toISOString().substring(0, 7)

const CANAL_LABEL = {
  airbnb: 'Airbnb', booking: 'Booking', stripe: 'Stripe',
  sepa_manuel: 'SEPA', interne: 'Interne', sortant_proprio: 'Proprio',
  sortant_ae: 'AE', sortant_honoraires: 'Honoraires', frais_bancaires: 'Frais'
}
const CANAL_COLOR = {
  airbnb: '#FF5A5F', booking: '#003580', stripe: '#635BFF',
  sepa_manuel: '#2E7D32', interne: '#546E7A', sortant_proprio: '#E65100',
  sortant_ae: '#6D4C41', sortant_honoraires: '#37474F', frais_bancaires: '#90A4AE'
}
const STATUT_COLOR = { rapproche: '#2E7D32', en_attente: '#E65100', non_identifie: '#B71C1C', debit_en_attente: '#78909C', non_gere: '#9CA3AF' }
const STATUT_LABEL = { rapproche: '✓ Rapproché', en_attente: '⏳ En attente', non_identifie: '✗ Non identifié', debit_en_attente: 'Débit', non_gere: '— Non géré' }

function fmt(centimes) {

  return (centimes / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}
function fmtDate(d) {
  if (!d) return '—'
  return format(new Date(d), 'd MMM', { locale: fr })
}

export default function PageRapprochement() {
  const navigate = useNavigate()
  const [mois, setMois] = useMoisPersisted()
  const [selectedResa, setSelectedResa] = useState(null)
  const [moisDispos, setMoisDispos] = useState([moisCourant])
  const [mouvements, setMouvements] = useState([])
  const [virs, setVirs] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)
  const [matching, setMatching] = useState(false)
  const [matchLog, setMatchLog] = useState(null)
  const [error, setError] = useState(null)
  const [filtre, setFiltre] = useState('tous')
  const [mouvSelId, setMouvSelId] = useState(null)   // mouvement sélectionné pour matching manuel
  const [virsSel, setVirsSel] = useState([])           // VIR sélectionnés pour matching manuel
  const [soldeInfo, setSoldeInfo] = useState(null)
  const [saving, setSaving] = useState(false)
  const [alertes, setAlertes] = useState({ virOrphelins: 0, resasNonRapprochees: 0 })
  const [filtreCanal, setFiltreCanal] = useState('tous')
  const [virSearch, setVirSearch] = useState('')
  const [virMoisFiltre, setVirMoisFiltre] = useState(mois) // filtre mois dans panneau Lier
  const [syncing, setSyncing] = useState(false)
  const [syncLog, setSyncLog] = useState(null)


  // Ouvrir le modal de détail d'une réservation depuis le rapprochement
  function ouvrirResa(resaCode) {
    if (!resaCode) return
    // Naviguer vers l'onglet Réservations avec le code pour ouvrir le modal
    navigate('/reservations?code=' + resaCode)
  }

  const charger = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [m, v, s] = await Promise.all([
        getMouvementsMois(mois),
        getVirNonRapproches(mois),
        getStatsRapprochement(mois),
      ])
      setMouvements(m)
      setVirs(v)
      setStats(s)
      const cutoff = new Date(Date.now() - 7*86400000).toISOString().slice(0,10)
      const [{ count: virCount }, { count: resaCount }] = await Promise.all([
        supabase.from('mouvement_bancaire').select('*', { count: 'exact', head: true }).eq('statut_matching', 'en_attente').gt('credit', 0).lt('date_operation', cutoff),
        supabase.from('reservation').select('*', { count: 'exact', head: true }).eq('mois_comptable', mois).eq('ventilation_calculee', true).eq('rapprochee', false).eq('owner_stay', false).neq('final_status', 'cancelled').gt('fin_revenue', 0)
      ])
      setAlertes({ virOrphelins: virCount || 0, resasNonRapprochees: resaCount || 0 })
      // Mois dispos
    const { data: md } = await supabase.from('mouvement_bancaire').select('mois_releve').not('mois_releve','is',null).not('mois_releve','is',null)
      if (md) {
      const uniq = [...new Set(md.map(x => x.mois_releve))]
        setMoisDispos([...new Set([...uniq, moisCourant])])
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [mois])

  useEffect(() => {
    charger()
    const channel = supabase.channel('rapproch-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mouvement_bancaire' }, () => charger())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservation' }, () => charger())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [charger])

  
  async function exportCSV() {
    const csv  = await exportCSVComptable(mouvements, mois)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = 'Rapprochement_Comptable_' + mois + '.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function lancerSync() {
    setSyncing(true)
    setSyncLog(null)
    setError(null)
    try {
      if (!HOSP_TOKEN) throw new Error('Token Hospitable non configuré (VITE_HOSPITABLE_TOKEN)')
      setToken(HOSP_TOKEN)
      const stripeLog = await syncStripe()
      setSyncLog({ stripe_matched: stripeLog.matched, stripe_frais: stripeLog.updated })
      await charger()
    } catch (err) {
      setError('Erreur sync: ' + err.message)
    } finally {
      setSyncing(false)
    }
  }

  async function lancerAuto() {
    setMatching(true)
    setMatchLog(null)
    setError(null)
    try {
      const log = await lancerMatchingAuto(mois)
      setMatchLog(log)
      await charger()
    } catch (err) {
      setError(err.message)
    } finally {
      setMatching(false)
    }
  }

  async function confirmerMatchManuel() {
    if (!mouvSelId || virsSel.length === 0) return
    setSaving(true)
    setSoldeInfo(null)
    try {
      // Récupérer les infos du virement et des VIR sélectionnés
      const mvt = mouvements.find(m => m.id === mouvSelId)
      const virSelData = virs.filter(v => virsSel.includes(v.id))
      const virTTC = virSelData.reduce((s, v) => s + (v.montant_ttc || 0), 0)

      // Vérifier les paiements déjà reçus pour cette résa
      const resaIds = [...new Set(virSelData.map(v => v.reservation?.id).filter(Boolean))]
      let dejaRecu = 0
      let typePaiement = 'total'

      if (resaIds.length > 0 && mvt) {
        const [{ data: existing }, { data: resaData }] = await Promise.all([
          supabase.from('reservation_paiement').select('montant, type_paiement').in('reservation_id', resaIds),
          supabase.from('reservation').select('fin_revenue').in('id', resaIds),
        ])
        dejaRecu = (existing || []).reduce((s, p) => s + (p.montant || 0), 0)
        // Base = fin_revenue (total voyageur à DCB), pas VIR (loyer proprio)
        const finRevTotal = (resaData || []).reduce((s, r) => s + (r.fin_revenue || 0), 0)
        const base = finRevTotal || virTTC
        const soldeRestant = base - dejaRecu
        const credit = mvt.credit || 0

        if (dejaRecu > 0) {
          if (credit > soldeRestant + 100) {
            setError(`Montant trop élevé : solde restant est ${(soldeRestant/100).toFixed(2)} €, virement reçu : ${(credit/100).toFixed(2)} €`)
            setSaving(false)
            return
          }
          typePaiement = credit >= soldeRestant - 100 ? 'solde' : 'acompte'
        } else {
          typePaiement = credit >= base - 100 ? 'total' : 'acompte'
        }

        setSoldeInfo({
          virTTC: base, dejaRecu, credit,
          soldeRestant: base - dejaRecu - credit,
          type: typePaiement
        })
      }

      await matcherManuellement(mouvSelId, virsSel, typePaiement)
      setMouvSelId(null)
      setVirsSel([])
      await charger()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function marquerInconnu(id) {
    try {
      await marquerNonIdentifie(id)
      await charger()
    } catch (err) {
      setError(err.message)
    }
  }

  async function annuler(id) {
    try {
      await annulerRapprochement(id)
      await charger()
    } catch (err) {
      setError(err.message)
    }
  }

  const canaux = [...new Set(mouvements.filter(m => m.statut_matching === 'en_attente').map(m => m.canal).filter(Boolean))]
  const mouvFiltres = mouvements.filter(m => {
    if (filtre === 'tous') return true
    if (filtre === 'attente') return m.statut_matching === 'en_attente'
    if (filtre === 'debit') return m.statut_matching === 'debit_en_attente'
    if (filtre === 'rapproche') return m.statut_matching === 'rapproche'
    if (filtre === 'inconnu') return m.statut_matching === 'non_identifie'
    return true
  }).filter(m => filtreCanal === 'tous' || m.canal === filtreCanal)

  const mouvSel = mouvements.find(m => m.id === mouvSelId)

  function handleFiltreChange(k) { setFiltre(k); setFiltreCanal('tous') }

  return (
    <div className="page-rapprochement" style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>

      {/* HEADER */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Rapprochement bancaire</h1>
          <p style={{ margin: '4px 0 0', color: '#666', fontSize: 14 }}>Caisse d'Épargne — Associer les virements aux réservations</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <MoisSelector mois={mois} setMois={setMois} moisDispos={moisDispos} />
          <button onClick={lancerSync} disabled={syncing || loading}
            style={{ background: syncing ? '#aaa' : '#059669', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontWeight: 600, cursor: syncing ? 'not-allowed' : 'pointer', fontSize: 14 }}>
            {syncing ? '⏳ Sync...' : '↻ Sync payouts'}
          </button>
          <button onClick={lancerAuto} disabled={matching || loading}
            style={{ background: matching ? '#aaa' : '#CC9933', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontWeight: 600, cursor: matching ? 'not-allowed' : 'pointer', fontSize: 14 }}>
            {matching ? '⏳ Matching...' : '⚡ Matching auto'}
          </button>
          <button onClick={charger} disabled={loading}
            style={{ background: '#f0f4ff', color: '#CC9933', border: '1.5px solid #CC9933', borderRadius: 8, padding: '8px 14px', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
            ↻ Actualiser
          </button>
          <button onClick={exportCSV} disabled={loading || mouvements.length === 0}
            style={{ padding: '8px 14px', borderRadius: 8, border: '1.5px solid var(--brand,#CC9933)', background: 'var(--bg,#F7F3EC)', color: 'var(--brand,#CC9933)', cursor: 'pointer', fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
            &#8595; Export CSV
          </button>
        </div>
      </div>

      {/* ERREUR */}
      {error && (
        <div style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '12px 16px', marginBottom: 16, color: '#DC2626', fontSize: 14 }}>
          ⚠️ {error}
        </div>
      )}

      {/* LOG MATCHING */}
      {syncLog && (
        <div style={{ background: '#ECFDF5', border: '1px solid #6EE7B7', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: 14 }}>
          <strong>Sync payouts :</strong> {syncLog.created || 0} créés, {syncLog.updated || 0} mis à jour{syncLog.errors > 0 ? <span style={{ color: '#B71C1C', marginLeft: 8 }}>{syncLog.errors} erreurs</span> : null}
        </div>
      )}
      {matchLog && (
        <div style={{ background: matchLog.errors > 0 ? '#FEF3C7' : '#ECFDF5', border: `1px solid ${matchLog.errors > 0 ? '#FCD34D' : '#6EE7B7'}`, borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: 14 }}>
          <strong>Résultat matching auto :</strong>{' '}
          <span style={{ color: '#2E7D32' }}>{matchLog.matched} rapprochés</span>
          {matchLog.skipped > 0 && <span style={{ color: '#E65100', marginLeft: 12 }}>{matchLog.skipped} ignorés</span>}
          {matchLog.errors > 0 && <span style={{ color: '#B71C1C', marginLeft: 12 }}>{matchLog.errors} erreurs</span>}
          {matchLog.details?.length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
              {matchLog.details.map((d, i) => (
                <li key={i}>{d.type} — {d.montant?.toFixed(2)} €{d.resa ? ` (${d.resa})` : d.nb ? ` (${d.nb} rés.)` : ''}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* STATS */}
      {(alertes.virOrphelins > 0 || alertes.resasNonRapprochees > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {alertes.virOrphelins > 0 && (
            <div style={{ background: '#FEF3C7', border: '1px solid #F59E0B', borderRadius: 8, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
              <span>⚠️</span>
              <span><strong>{alertes.virOrphelins} virement(s) sans réservation depuis +7j</strong> — en attente de rapprochement.</span>
              <button onClick={() => handleFiltreChange('attente')} style={{ marginLeft: 'auto', background: '#F59E0B', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Voir</button>
            </div>
          )}
          {alertes.resasNonRapprochees > 0 && (
            <div style={{ background: '#FEE2E2', border: '1px solid #EF4444', borderRadius: 8, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
              <span>🔴</span>
              <span><strong>{alertes.resasNonRapprochees} réservation(s) ventilée(s) sans virement identifié</strong> pour ce mois.</span>
            </div>
          )}
        </div>
      )}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Mouvements', value: stats.total_mouvements, color: '#CC9933' },
            { label: 'Rapprochés', value: stats.rapproches, color: '#2E7D32' },
            { label: 'En attente', value: stats.en_attente, color: '#E65100' },
            { label: 'Non géré', value: mouvements.filter(m => m._resa?.gestion_loyer === false).length, color: '#9CA3AF' },
            { label: 'Non identifiés', value: stats.non_identifie, color: '#B71C1C' },
            { label: 'VIR ventilés', value: `${stats.vir_rapproches}/${stats.vir_total}`, color: '#7C3AED' },
            { label: 'Entrées', value: fmt(stats.total_entrees), color: '#2E7D32', small: true },
          ].map(s => (
            <div key={s.label} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: s.small ? 16 : 22, fontWeight: 700, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: mouvSelId ? '1fr 380px' : '1fr', gap: 20 }}>

        {/* LISTE MOUVEMENTS */}
        <div>
          {/* FILTRES */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            {[['tous', 'Tous'], ['attente', 'En attente'], ['rapproche', 'Rapprochés'], ['inconnu', 'Non identifiés']].map(([k, l]) => (
              <button key={k} onClick={() => handleFiltreChange(k)}
                style={{ padding: '5px 14px', borderRadius: 20, border: '1.5px solid', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  background: filtre === k ? '#CC9933' : '#fff', color: filtre === k ? '#fff' : '#555', borderColor: filtre === k ? '#CC9933' : '#ddd' }}>
                {l}
              </button>
            ))}
          </div>

          {filtre === 'attente' && canaux.length > 1 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#888', fontWeight: 600 }}>Canal :</span>
          {['tous', ...canaux].map(c => (
            <button key={c} onClick={() => setFiltreCanal(c)}
              style={{ padding: '3px 10px', borderRadius: 20, border: '1.5px solid', fontSize: 11, cursor: 'pointer',
                background: filtreCanal === c ? '#374151' : '#fff', color: filtreCanal === c ? '#fff' : '#555', borderColor: filtreCanal === c ? '#374151' : '#e5e7eb' }}>
              {c === 'tous' ? 'Tous' : c.charAt(0).toUpperCase() + c.slice(1)}
            </button>
          ))}
        </div>
      )}
      {loading && mouvements.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>Chargement...</div>
          ) : (
            <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
                    {['Date', 'Libellé', 'Canal', 'Crédit', 'Débit', 'Statut', 'Actions'].map(h => (
                      <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#555', fontSize: 12 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mouvFiltres.length === 0 ? (
                    <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: '#aaa' }}>Aucun mouvement</td></tr>
                  ) : mouvFiltres.map(m => (
                    <tr key={m.id}
                      style={{ borderBottom: '1px solid #f0f0f0', background: mouvSelId === m.id ? '#FFF8EC' : 'transparent', cursor: 'default' }}>
                      <td style={{ padding: '9px 12px', fontWeight: 500, whiteSpace: 'nowrap' }}>{fmtDate(m.date_operation)}</td>
                       <td style={{ padding: '9px 12px', maxWidth: 280 }}>
                         <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.libelle}</div>
                         {m._resa ? (
            <div style={{ fontSize: 11, color: '#2E7D32', marginTop: 3, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {m._resa.bien_name && <span style={{fontWeight:600,color:'#CC9933'}}>{m._resa.bien_name}</span>}
              {m._resa.agence === 'lauian' && <span style={{background:'#FEF3C7',color:'#B45309',fontSize:10,padding:'1px 4px',borderRadius:3,fontWeight:700}}>Lauian</span>}
              {m._resa.guest_name && <span style={{color:'#555'}}>· {m._resa.guest_name}</span>}
              {m._resa.arrival_date && <span style={{color:'#888'}}>· {m._resa.arrival_date?.slice(5,10).replace('-','/')}</span>}
              {m._resa.platform && <span style={{background:'#F3F4F6',color:'#374151',fontSize:10,padding:'1px 5px',borderRadius:3,fontWeight:600,textTransform:'uppercase'}}>{m._resa.platform}</span>}
              {m._resa.fin_revenue > 0 && <span style={{color:'#2E7D32',fontWeight:700}}>· {(m._resa.fin_revenue/100).toLocaleString('fr-FR',{minimumFractionDigits:2})} €</span>}
            </div>
                         ) : m.detail ? (
                           <div style={{ fontSize: 11, marginTop: 2, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                             {(() => { const parts = m.detail.split('|').map(s => s.trim()).filter(Boolean); const fraisPart = parts.find(p => p.startsWith('frais:')); const mainParts = parts.filter(p => !p.startsWith('frais:')); return <>{mainParts.length > 0 && <span style={{ color: m.statut_matching === 'rapproche' ? '#2E7D32' : '#888' }}>{mainParts.join(' · ')}</span>}{fraisPart && <span style={{ background: '#FEF2F2', color: '#B91C1C', border: '1px solid #FCA5A5', borderRadius: 4, padding: '1px 5px', fontWeight: 700, whiteSpace: 'nowrap', marginLeft: 4 }}>⚡ {fraisPart}</span>}</> })()} 
                           </div>
                         ) : null}
                      </td>
                      <td style={{ padding: '9px 12px' }}>
                        <span style={{ background: CANAL_COLOR[m.canal] + '22', color: CANAL_COLOR[m.canal] || '#555', borderRadius: 12, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                          {CANAL_LABEL[m.canal] || m.canal}
                        </span>
                      </td>
                      <td style={{ padding: '9px 12px', color: '#2E7D32', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {m.credit > 0 ? '+' + fmt(m.credit) : '—'}
                      </td>
                      <td style={{ padding: '9px 12px', color: '#B71C1C', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {m.debit > 0 ? '−' + fmt(m.debit) : '—'}
                      </td>
                      <td style={{ padding: '9px 12px' }}>
                        {m.statut_matching === 'rapproche' && m._resa?.codes?.[0] ? (
                          <span
                            onClick={() => { const rc = m._resa?.codes?.[0]; if (rc) ouvrirResa(rc) }}
                            title={'Aller à la réservation ' + (m._resa?.codes?.[0] || '')}
                            style={{ cursor: 'pointer', textDecoration: 'none' }}
                          ><span style={{ padding: '3px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                              background: '#E8F5E9', color: '#2E7D32', border: '1px solid #A5D6A7' }}>
                            {STATUT_LABEL[m.statut_matching] || m.statut_matching}
                          </span></span>
                        ) : (
                          <span style={{ padding: '3px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                            background: m.statut_matching === 'rapproche' ? '#E8F5E9' : m.statut_matching === 'en_attente' ? '#FFF8EC' : '#F5F5F5',
                            color: m.statut_matching === 'rapproche' ? '#2E7D32' : m.statut_matching === 'en_attente' ? '#CC9933' : '#666',
                            border: m.statut_matching === 'rapproche' ? '1px solid #A5D6A7' : m.statut_matching === 'en_attente' ? '1px solid #E4A853' : '1px solid #DDD' }}>
                            {STATUT_LABEL[m.statut_matching] || m.statut_matching}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>
                        {m.statut_matching === 'en_attente' && (m.credit || 0) > 0 && (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => { setMouvSelId(m.id); setVirsSel([]) }}
                              style={{ background: '#FFF8EC', color: '#CC9933', border: '1px solid #E4A853', borderRadius: 6, padding: '3px 8px', fontSize: 12, cursor: 'pointer' }}>
                              Lier
                            </button>
                            <button onClick={() => marquerInconnu(m.id)}
                              style={{ background: '#FEF2F2', color: '#B71C1C', border: '1px solid #FCA5A5', borderRadius: 6, padding: '3px 8px', fontSize: 12, cursor: 'pointer' }}>
                              Inconnu
                            </button>
                          </div>
                        )}
                        {m.statut_matching === 'rapproche' && (
                          <button onClick={() => annuler(m.id)}
                            style={{ background: '#FFF7ED', color: '#C2410C', border: '1px solid #FED7AA', borderRadius: 6, padding: '3px 8px', fontSize: 12, cursor: 'pointer' }}>
                            Annuler
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* PANNEAU MATCHING MANUEL */}
        {mouvSelId && mouvSel && (
          <div style={{ background: '#fff', border: '1.5px solid #CC9933', borderRadius: 12, padding: 20, height: 'fit-content', position: 'sticky', top: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Lier manuellement</h3>
              <button onClick={() => { setMouvSelId(null); setVirsSel([]) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#888' }}>✕</button>
            </div>

            {/* Mouvement sélectionné */}
            <div style={{ background: '#F0F9FF', borderRadius: 8, padding: '10px 12px', marginBottom: 16, fontSize: 13 }}>
              <div style={{ fontWeight: 600 }}>{mouvSel.libelle}</div>
              <div style={{ color: '#666', marginTop: 2 }}>{fmtDate(mouvSel.date_operation)} — <span style={{ color: '#2E7D32', fontWeight: 700 }}>{fmt(mouvSel.credit || mouvSel.debit || 0)}</span></div>
            </div>

            {/* Liste des VIR à sélectionner */}
            <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 600, color: '#555' }}>
              VIR disponibles ({virs.length})
              {virsSel.length > 0 && (
                <span style={{ marginLeft: 8, color: '#CC9933' }}>
                  — sélection : {fmt(virs.filter(v => virsSel.includes(v.id)).reduce((s, v) => s + (v.reservation?.fin_revenue || 0), 0))}
                </span>
              )}
            </div>

            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
              <span style={{ fontSize:11, fontWeight:600, color:'var(--text-muted,#8C7B65)', textTransform:'uppercase', letterSpacing:'0.5px' }}>
                Séjour
              </span>
              <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                <button onClick={() => {
                  const [y,m] = virMoisFiltre === 'tous' ? [new Date().getFullYear(), new Date().getMonth()+1] : virMoisFiltre.split('-').map(Number)
                  const p = m===1 ? `${y-1}-12` : `${y}-${String(m-1).padStart(2,'0')}`
                  setVirMoisFiltre(p)
                }} style={{ border:'1px solid var(--border,#D9CEB8)', borderRadius:5, background:'var(--bg,#F7F3EC)', width:22, height:22, cursor:'pointer', fontSize:13, lineHeight:1 }}>&#8249;</button>
                <span style={{ fontSize:12, fontWeight:600, minWidth:60, textAlign:'center' }}>{virMoisFiltre === 'tous' ? 'Tous' : virMoisFiltre}</span>
                <button onClick={() => {
                  const [y,m] = virMoisFiltre === 'tous' ? [new Date().getFullYear(), new Date().getMonth()+1] : virMoisFiltre.split('-').map(Number)
                  const n = m===12 ? `${y+1}-01` : `${y}-${String(m+1).padStart(2,'0')}`
                  setVirMoisFiltre(n)
                }} style={{ border:'1px solid var(--border,#D9CEB8)', borderRadius:5, background:'var(--bg,#F7F3EC)', width:22, height:22, cursor:'pointer', fontSize:13, lineHeight:1 }}>&#8250;</button>
                <button onClick={() => setVirMoisFiltre('tous')}
                  style={{ fontSize:10, border:'1px solid var(--border,#D9CEB8)', borderRadius:5, background: virMoisFiltre==='tous' ? 'var(--brand,#CC9933)' : 'var(--bg,#F7F3EC)', color: virMoisFiltre==='tous' ? 'white' : 'var(--text,#2C2416)', padding:'2px 6px', cursor:'pointer', fontWeight:600 }}>
                  Tous
                </button>
              </div>
            </div>
            <input placeholder="Rechercher..." value={virSearch} onChange={e => setVirSearch(e.target.value)} style={{ width:'100%', padding:'7px 10px', borderRadius:8, border:'1px solid #e5e7eb', fontSize:12, marginBottom:10, boxSizing:'border-box' }} />            <div style={{ maxHeight: 380, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
              {virs.length === 0 ? (
                <div style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: 16 }}>Tous les VIR sont déjà rapprochés</div>
              ) : (() => {
                const soldeRestant = (resa) => {
                  const dejaLie = (resa?.ventilation || [])
                    .filter(v => v.mouvement_id && v.code === 'VIR')
                    .reduce((s, v) => s + (v.mouvement_bancaire?.credit || 0), 0)
                  return Math.max(0, (resa?.fin_revenue || 0) - dejaLie)
                }
                return virs.filter(v => virMoisFiltre === 'tous' || v.mois_comptable === virMoisFiltre).filter(v => !virSearch || v.reservation?.guest_name?.toLowerCase().includes(virSearch.toLowerCase()) || v.reservation?.bien?.hospitable_name?.toLowerCase().includes(virSearch.toLowerCase()) || v.reservation?.code?.toLowerCase().includes(virSearch.toLowerCase()) || v.reservation?.platform?.toLowerCase().includes(virSearch.toLowerCase())).map(v => {
                const checked = virsSel.includes(v.id)
                return (
                  <label key={v.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', borderRadius: 8, border: `1.5px solid ${checked ? '#E4A853' : '#e5e7eb'}`, background: checked ? '#FFF8EC' : '#fff', cursor: 'pointer', fontSize: 12 }}>
                    <input type="checkbox" checked={checked} onChange={e => {
                      setVirsSel(prev => e.target.checked ? [...prev, v.id] : prev.filter(x => x !== v.id))
                    }} style={{ marginTop: 2, accentColor: '#CC9933' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{v.reservation?.guest_name || '—'}</div>
                      <div style={{ color: '#666', marginTop: 1 }}>
                        {v.reservation?.bien?.code} · {fmtDate(v.reservation?.arrival_date)} → {fmtDate(v.reservation?.departure_date)}
                      </div>
                      <div style={{ color: '#666', marginTop: 1 }}>{v.reservation?.code}</div>
                      {v.mois_comptable !== mois && (
                        <div style={{ marginTop: 3 }}>
                          <span style={{ fontSize: 10, background: '#FEF3C7', color: '#D97706', borderRadius: 4, padding: '1px 6px', fontWeight: 700 }}>
                            Séjour {v.mois_comptable}
                          </span>
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign:'right' }}>
                  <div style={{ fontWeight: 700, color: '#CC9933', whiteSpace: 'nowrap' }}>{fmt(v.reservation?.fin_revenue)}</div>
                  {v.reservation?.fin_revenue > 0 && (() => {
                    const solde = soldeRestant(v.reservation)
                    const partiel = solde < (v.reservation.fin_revenue || 0)
                    return partiel ? <div style={{fontSize:10,color:'#D97706',fontWeight:700}}>Reste {fmt(solde)}</div> : null
                  })()}
                </div>
                  </label>
                )
              })
              })()}
            </div>

            <button onClick={confirmerMatchManuel} disabled={virsSel.length === 0 || saving}
              style={{ width: '100%', background: virsSel.length === 0 ? '#aaa' : '#CC9933', color: '#fff', border: 'none', borderRadius: 8, padding: '10px', fontWeight: 700, cursor: virsSel.length === 0 ? 'not-allowed' : 'pointer', fontSize: 14 }}>
              {saving ? 'Enregistrement...' : `Confirmer (${virsSel.length} VIR)`}
            </button>
            {/* Indicateur acompte/solde */}
            {!saving && virsSel.length > 0 && mouvSel && (() => {
              const virSelData = virs.filter(v => virsSel.includes(v.id))
              const virTTC = virSelData.reduce((s,v) => s + (v.montant_ttc||0), 0)
              const credit = mouvSel.credit || 0
              const diff = virTTC - credit
              if (diff <= 100) return null // total ou quasi-total
              return (
                <div style={{ marginTop:8, padding:'8px 12px', borderRadius:8, background:'#FFFBEB', border:'1px solid #FCD34D', fontSize:12 }}>
                  <strong>⚠️ Acompte</strong> — Solde restant après ce virement :
                  <strong style={{color:'#D97706'}}> {((diff)/100).toFixed(2)} €</strong>
                </div>
              )
            })()}
          </div>
        )}
      {selectedResa && (
        <ModalResa
          resa={selectedResa}
          onClose={() => setSelectedResa(null)}
          onSaved={() => setSelectedResa(null)}
        />
      )}
      </div>
    </div>
  )
}
// v2
