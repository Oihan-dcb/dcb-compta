import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { AGENCE } from '../lib/agence'
import { STATUTS_NON_VENTILABLES } from '../lib/constants'
import { CLASSEMENTS, CLASSEMENT_LABEL, communeTaxe, classementEffectif, choisirBareme, calculTaxeResa, collecteurResa } from '../lib/taxeSejour'

// Catégories du barème (taxe_sejour_config) : « autre » n'a pas de ligne de barème (tarif saisi sur le bien).
const CLASSIFICATIONS = CLASSEMENTS.filter(c => c.value !== 'autre')
const CLASS_LABEL = CLASSEMENT_LABEL

function getQuarterRange(year, quarter) {
  const starts = { 1: '01', 2: '04', 3: '07', 4: '10' }
  const ends   = { 1: '03', 2: '06', 3: '09', 4: '12' }
  return {
    debut: `${year}-${starts[quarter]}-01`,
    fin:   `${year}-${ends[quarter]}-31`,
    label: `T${quarter} ${year}`,
  }
}

// Taxe théorique d'une résa : réglage PAR BIEN (commune, classement, régime — migration 401) + barème de la
// commune, règle commune avec PowerHouse : src/lib/taxeSejour.js (classé : tarif TTC × adultes × nuits ; non
// classé : taux × coût HT de la nuitée par occupant, plafonné, × coefficient additionnel, × adultes × nuits).

function fmt(n) {
  return n == null ? '—' : n.toFixed(2) + ' €'
}

export default function PageTaxeSejour() {
  const now = new Date()
  const [onglet, setOnglet] = useState(() => localStorage.getItem('tab_taxe') || 'declaration')
  useEffect(() => localStorage.setItem('tab_taxe', onglet), [onglet])
  const [annee, setAnnee] = useState(now.getFullYear())
  const [trimestre, setTrimestre] = useState(Math.ceil((now.getMonth() + 1) / 3))
  const [biens, setBiens] = useState([])
  const [reservations, setReservations] = useState([])
  const [taxeEncaissee, setTaxeEncaissee] = useState({}) // reservation_id → euros (ventilation TAXE)
  const [exclues, setExclues] = useState([]) // résas dont la PLATEFORME collecte et reverse la taxe (404)
  const [voirExclues, setVoirExclues] = useState(false)
  // Service pas encore lancé : aucun bien n'a gestion_taxe_sejour → aperçu sur tous les biens
  const [apercu, setApercu] = useState(true)
  const [configs, setConfigs] = useState([]) // taxe_sejour_config rows de l'agence (onglet Tarifs)
  const [configsToutes, setConfigsToutes] = useState([]) // toutes agences : le barème est celui de la commune
  const [loading, setLoading] = useState(false)
  const [editingConfig, setEditingConfig] = useState(null)
  const [formConfig, setFormConfig] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  useEffect(() => { charger() }, [annee, trimestre])
  useEffect(() => { chargerConfigs() }, [])

  async function charger() {
    setLoading(true)
    setError(null)
    const { debut, fin } = getQuarterRange(annee, trimestre)

    // reservation n'a PAS de colonne agence : filtre par l'agence du bien (jointure). Avant le 11/10/2026 la page filtrait
    // reservation.agence → erreur 400 silencieuse → la déclaration n'affichait AUCUNE résa.
    const SELECT_RESA = 'bien!inner(agence), id, bien_id, code, guest_name, guest_count, adultes:hospitable_raw->guests->>adult_count, taxes_voyageur:hospitable_raw->financials->guest->taxes, arrival_date, departure_date, nights, fin_accommodation, platform, final_status, owner_stay'
    const [{ data: biensData }, { data: resaData, error: resaErr }] = await Promise.all([
      supabase.from('bien')
        .select('id, code, hospitable_name, ville, classification, classification_date, classification_fin, agence, listed, gestion_taxe_sejour, taxe_commune, taxe_regime, taxe_collecte, taxe_tarif_saisi')
        .eq('agence', AGENCE)
        .eq('listed', true)
        .order('code'),
      // Direct, manuel, Booking (Airbnb : voir plus bas). Le canal ne suffit pas : qui collecte se décide PAR RÉSA
      // (collecteurResa, 404) — Booking « Withheld » = Booking reverse lui-même → exclu de notre déclaration.
      supabase.from('reservation')
        .select(SELECT_RESA)
        .eq('bien.agence', AGENCE)
        .neq('platform', 'airbnb')
        .gte('arrival_date', debut)
        .lte('arrival_date', fin)
        .order('arrival_date'),
    ])
    if (resaErr) setError(resaErr.message)
    // Airbnb collecte et reverse elle-même (réglage par défaut) : chargé seulement pour les biens réglés « nous ».
    const biensAirbnbNous = (biensData || []).filter(b => (b.taxe_collecte?.airbnb || 'plateforme') === 'nous').map(b => b.id)
    let resaAirbnb = []
    if (biensAirbnbNous.length) {
      const { data } = await supabase.from('reservation').select(SELECT_RESA).eq('bien.agence', AGENCE).eq('platform', 'airbnb')
        .in('bien_id', biensAirbnbNous).gte('arrival_date', debut).lte('arrival_date', fin)
      resaAirbnb = data || []
    }

    const bienParId = Object.fromEntries((biensData || []).map(b => [b.id, b]))
    const actives = [...(resaData || []), ...resaAirbnb].filter(r => !STATUTS_NON_VENTILABLES.includes(r.final_status) && !r.owner_stay)
    const resas = [], horsDeclaration = []
    for (const r of actives) {
      const c = collecteurResa(r, bienParId[r.bien_id])
      if (c.collecteur === 'nous') resas.push({ ...r, _collecte: c })
      else horsDeclaration.push({ ...r, _collecte: c })
    }
    // Taxe réellement encaissée auprès du voyageur = lignes TAXE de la ventilation
    const encaisse = {}
    for (let i = 0; i < resas.length; i += 200) {
      const ids = resas.slice(i, i + 200).map(r => r.id)
      const { data: tx, error: txErr } = await supabase.from('ventilation')
        .select('reservation_id, libelle, montant_ttc').eq('code', 'TAXE').in('reservation_id', ids)
      if (txErr) { setError(txErr.message); break }
      // « TVA (10%) » de Booking est aussi une ligne TAXE de la ventilation : ce n'est pas de la taxe de séjour.
      for (const t of tx || []) if (!/^tva\b/i.test(t.libelle || '')) encaisse[t.reservation_id] = (encaisse[t.reservation_id] || 0) + (t.montant_ttc || 0) / 100
    }

    setBiens(biensData || [])
    setReservations(resas)
    setExclues(horsDeclaration.filter(r => r.platform !== 'airbnb' || r._collecte.source === 'resa'))
    setTaxeEncaissee(encaisse)
    setLoading(false)
  }

  async function chargerConfigs() {
    const { data } = await supabase.from('taxe_sejour_config')
      .select('*')
      .order('commune').order('classification')
    setConfigsToutes(data || [])
    setConfigs((data || []).filter(c => c.agence === AGENCE))
  }

  // Barème du bien pour l'année déclarée (classement en vigueur au début du trimestre).
  function getConfig(bien) {
    return choisirBareme(configsToutes, bien, annee, getQuarterRange(annee, trimestre).debut)
  }
  const calculTaxe = (r, config, bien) => calculTaxeResa(r, config, bien)

  async function sauvegarderConfig(id, champ, valeur) {
    setSaving(true)
    const val = valeur === '' ? null : parseFloat(valeur)
    const { error: e } = await supabase.from('taxe_sejour_config')
      .update({ [champ]: val })
      .eq('id', id)
    if (e) setError(e.message)
    else { await chargerConfigs(); setSuccess('Tarif mis à jour') }
    setSaving(false)
  }

  async function ajouterConfig() {
    if (!formConfig.commune || !formConfig.classification) return
    setSaving(true)
    const { error: e } = await supabase.from('taxe_sejour_config').insert({
      agence: AGENCE,
      commune: formConfig.commune,
      classification: formConfig.classification,
      type_calcul: formConfig.type_calcul || 'forfait',
      taux_pct: formConfig.taux_pct ? parseFloat(formConfig.taux_pct) : null,
      plafond_ht: formConfig.plafond_ht ? parseFloat(formConfig.plafond_ht) : null,
      tarif_pers_nuit: formConfig.tarif_pers_nuit ? parseFloat(formConfig.tarif_pers_nuit) : null,
      coeff_additionnel: formConfig.coeff_additionnel ? parseFloat(formConfig.coeff_additionnel) : 1.44,
      annee: formConfig.annee ? parseInt(formConfig.annee) : annee,
    })
    if (e) setError(e.message)
    else { setFormConfig({}); setEditingConfig(null); await chargerConfigs(); setSuccess('Tarif ajouté') }
    setSaving(false)
  }

  // Calcul par bien
  const resaParBien = {}
  for (const r of reservations) {
    if (!resaParBien[r.bien_id]) resaParBien[r.bien_id] = []
    resaParBien[r.bien_id].push(r)
  }

  const { label: trimLabel } = getQuarterRange(annee, trimestre)
  const biensAffiches = biens.filter(b => (apercu || b.gestion_taxe_sejour) && resaParBien[b.id]?.length > 0)
  let totalGlobal = 0, totalEncaisse = 0
  const tarifsManquants = new Set()
  for (const b of biensAffiches) {
    const config = getConfig(b)
    const eff = classementEffectif(b, getQuarterRange(annee, trimestre).debut)
    if (!config && b.taxe_regime !== 'forfait' && !(eff === 'autre' && b.taxe_tarif_saisi != null)) tarifsManquants.add(`${communeTaxe(b) || '(commune vide)'} — ${CLASS_LABEL[eff]}`)
    for (const r of resaParBien[b.id]) {
      totalGlobal += calculTaxe(r, config, b) || 0
      totalEncaisse += taxeEncaissee[r.id] || 0
    }
  }

  const DEADLINES = {
    dcb:     { 1: '15 avril', 2: '15 juillet', 3: '15 octobre', 4: '15 janvier' },
    lauian:  { 1: '15 avril', 2: '15 juillet', 3: '15 octobre', 4: '15 janvier' },
    bordeaux:{ 1: '20 avril', 2: '20 juillet', 3: '20 octobre', 4: '20 janvier' },
  }
  const deadline = (DEADLINES[AGENCE] || DEADLINES.dcb)[trimestre]

  const td = { padding: '8px 10px', borderBottom: '1px solid #f3f4f6', fontSize: 13 }
  const th = { padding: '8px 10px', background: 'var(--header-bg)', borderBottom: '2px solid var(--brand)', fontSize: 12, fontWeight: 600, textAlign: 'left', whiteSpace: 'nowrap' }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, color: 'var(--dark)' }}>Taxe de séjour</h1>
        {AGENCE === 'bordeaux' ? (
          <a href="https://taxedesejour.bordeaux-metropole.fr" target="_blank" rel="noreferrer"
            style={{ fontSize: 12, color: 'var(--brand)', textDecoration: 'none', border: '1px solid var(--brand)', borderRadius: 6, padding: '5px 12px', fontWeight: 600 }}>
            🌐 Déclarer sur Bordeaux Métropole
          </a>
        ) : (
          <a href="https://taxe.3douest.com/biarritz.php" target="_blank" rel="noreferrer"
            style={{ fontSize: 12, color: 'var(--brand)', textDecoration: 'none', border: '1px solid var(--brand)', borderRadius: 6, padding: '5px 12px', fontWeight: 600 }}>
            🌐 Déclarer sur 3douest
          </a>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, borderBottom: '2px solid var(--brand)', paddingBottom: 8 }}>
        {[['declaration', '📋 Déclaration'], ['tarifs', '⚙️ Tarifs']].map(([t, label]) => (
          <button key={t} onClick={() => setOnglet(t)}
            style={{ padding: '7px 18px', borderRadius: '8px 8px 0 0', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, background: onglet === t ? 'var(--brand)' : 'var(--header-bg)', color: onglet === t ? '#fff' : 'var(--text)' }}>
            {label}
          </button>
        ))}
      </div>

      {error && <div style={{ background: '#FEE2E2', borderRadius: 8, padding: '10px 16px', marginBottom: 14, fontSize: 13, color: '#B91C1C' }}>✕ {error}</div>}
      {success && <div style={{ background: '#DCFCE7', borderRadius: 8, padding: '10px 16px', marginBottom: 14, fontSize: 13, color: '#15803D' }} onClick={() => setSuccess(null)}>✓ {success}</div>}

      {/* ─── DÉCLARATION ─── */}
      {onglet === 'declaration' && (
        <>
          {/* Sélecteur trimestre */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={() => { const t = trimestre === 1 ? 4 : trimestre - 1; const a = trimestre === 1 ? annee - 1 : annee; setTrimestre(t); setAnnee(a) }}
                style={{ background: 'var(--white)', border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 16 }}>‹</button>
              <span style={{ fontWeight: 700, fontSize: 15, minWidth: 90, textAlign: 'center' }}>{trimLabel}</span>
              <button onClick={() => { const t = trimestre === 4 ? 1 : trimestre + 1; const a = trimestre === 4 ? annee + 1 : annee; setTrimestre(t); setAnnee(a) }}
                style={{ background: 'var(--white)', border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 16 }}>›</button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', background: 'var(--brand-pale)', border: '1px solid #E4A853', borderRadius: 6, padding: '5px 12px' }}>
              📅 Reversement avant le <strong>{deadline}</strong>
            </div>
            {loading && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Chargement…</span>}
            <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={apercu} onChange={e => setApercu(e.target.checked)} />
              Aperçu tous les biens <span style={{ color: 'var(--text-muted)' }}>(sinon : biens « gestion taxe de séjour » seulement)</span>
            </label>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
              <div style={{ background: 'var(--header-bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Encaissée voyageurs</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{fmt(totalEncaisse)}</div>
              </div>
              <div style={{ background: 'var(--header-bg)', border: '2px solid var(--brand)', borderRadius: 10, padding: '8px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Due (calcul tarif)</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--brand)' }}>{fmt(totalGlobal)}</div>
              </div>
              <div style={{ background: Math.abs(totalEncaisse - totalGlobal) > 1 ? '#FEF3C7' : '#DCFCE7', borderRadius: 10, padding: '8px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Écart</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{fmt(totalEncaisse - totalGlobal)}</div>
              </div>
            </div>
          </div>

          <div style={{ background: 'var(--brand-pale)', border: '1px solid #E4A853', borderRadius: 8, padding: '10px 16px', marginBottom: 12, fontSize: 12, color: '#92400E' }}>
            ℹ️ Service <strong>pas encore lancé</strong> : aujourd'hui la taxe encaissée est reversée au propriétaire avec son loyer, qui la déclare lui-même.
            Résas prises en compte : celles dont NOUS collectons la taxe — directes, manuelles, et Booking quand Booking ne la retient pas. Airbnb la collecte et la reverse seul ; Booking aussi quand la résa porte « CITY_TAX (Withheld Tax) » (retenue par Booking → exclue ici, sinon elle serait déclarée deux fois). Réglage par bien et par canal : fiche du bien › Taxe de séjour (PowerHouse). Annulations et séjours propriétaires exclus.
            « Encaissée » = taxe réellement facturée au voyageur ; « Due » = calcul selon le réglage taxe de séjour du bien (commune, classement, régime — fiche du bien dans PowerHouse) et le barème de la commune ; adultes seulement (mineurs exonérés, nombre d'adultes donné par Hospitable).
          </div>
          {tarifsManquants.size > 0 && (
            <div style={{ background: '#FEE2E2', borderRadius: 8, padding: '10px 16px', marginBottom: 20, fontSize: 12, color: '#B91C1C' }}>
              ⚠ Tarif manquant (onglet Tarifs) : {[...tarifsManquants].join(' · ')}
            </div>
          )}

          {exclues.length > 0 && (() => {
            const total = exclues.reduce((t, r) => t + (r._collecte.montantRetenu || 0), 0)
            const divergents = exclues.filter(r => r._collecte.divergeReglage)
            return (
              <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span>🧾 <strong>{exclues.length} résa{exclues.length > 1 ? 's' : ''} hors déclaration</strong> : taxe collectée et reversée par la plateforme (Booking « Withheld » : {fmt(total)} retenus par Booking).</span>
                  <button onClick={() => setVoirExclues(v => !v)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 10px', fontSize: 12, cursor: 'pointer' }}>{voirExclues ? 'Masquer' : 'Voir'}</button>
                </div>
                {divergents.length > 0 && <div style={{ marginTop: 6, color: '#92400E' }}>⚠ {divergents.length} résa(s) où le constat Booking contredit le réglage du bien (le constat de la résa prime) : vérifier la fiche du bien.</div>}
                {voirExclues && (
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
                    <thead><tr><th style={th}>Bien</th><th style={th}>Voyageur</th><th style={th}>Résa</th><th style={th}>Canal</th><th style={th}>Arrivée</th><th style={{ ...th, textAlign: 'center' }}>Nuits</th><th style={{ ...th, textAlign: 'right' }}>Retenue par la plateforme</th></tr></thead>
                    <tbody>{exclues.map(r => (
                      <tr key={r.id}>
                        <td style={td}>{biens.find(b => b.id === r.bien_id)?.code || '—'}</td>
                        <td style={td}>{r.guest_name || '—'}</td>
                        <td style={{ ...td, fontSize: 11, color: 'var(--text-muted)' }}>{r.code || '—'}</td>
                        <td style={{ ...td, fontSize: 11 }}>{r.platform}{r._collecte.source === 'resa' ? ' · « Withheld »' : ' · réglage du bien'}</td>
                        <td style={td}>{r.arrival_date ? new Date(r.arrival_date + 'T12:00:00').toLocaleDateString('fr-FR') : '—'}</td>
                        <td style={{ ...td, textAlign: 'center' }}>{r.nights || '—'}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{r._collecte.montantRetenu ? fmt(r._collecte.montantRetenu) : '—'}</td>
                      </tr>))}
                    </tbody>
                  </table>
                )}
              </div>
            )
          })()}

          {reservations.length === 0 && !loading && (
            <div style={{ textAlign: 'center', padding: 60, background: 'var(--white)', borderRadius: 12, color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🏖️</div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Aucune réservation concernée sur {trimLabel}</div>
              <div style={{ fontSize: 13 }}>Réservations dont nous collectons la taxe : directes, manuelles, Booking non retenues par Booking (hors annulations)</div>
            </div>
          )}

          {biensAffiches.map(b => {
            const config = getConfig(b)
            const eff = classementEffectif(b, getQuarterRange(annee, trimestre).debut)
            const resas = resaParBien[b.id] || []
            const totalBien = resas.reduce((s, r) => s + (calculTaxe(r, config, b) || 0), 0)
            const regle = b.taxe_regime === 'forfait' || config || (eff === 'autre' && b.taxe_tarif_saisi != null)
            const encaisseBien = resas.reduce((s, r) => s + (taxeEncaissee[r.id] || 0), 0)

            return (
              <div key={b.id} style={{ background: 'var(--white)', borderRadius: 12, marginBottom: 16, overflow: 'hidden', boxShadow: '0 1px 6px rgba(0,0,0,.06)' }}>
                <div style={{ background: 'var(--header-bg)', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '2px solid var(--brand)' }}>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>🏠 {b.code}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 10 }}>{communeTaxe(b)}</span>
                    <span style={{ fontSize: 11, background: regle ? '#DCFCE7' : '#FEE2E2', color: regle ? '#15803D' : '#B91C1C', borderRadius: 4, padding: '2px 7px', marginLeft: 8, fontWeight: 600 }}>
                      {CLASS_LABEL[eff]}{eff !== (b.classification || 'non_classe') ? ' (classement expiré)' : ''}
                      {b.taxe_regime === 'forfait' && ' · régime au forfait'}
                      {!regle && ' ⚠ tarif manquant'}
                    </span>
                  </div>
                  <div style={{ fontSize: 13 }}>
                    <span style={{ color: 'var(--text-muted)' }}>encaissée {fmt(encaisseBien)} · </span>
                    <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--brand)' }}>due {fmt(totalBien)}</span>
                  </div>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>Voyageur</th>
                      <th style={th}>Canal</th>
                      <th style={th}>Arrivée</th>
                      <th style={{ ...th, textAlign: 'center' }}>Nuits</th>
                      <th style={{ ...th, textAlign: 'center' }}>Pers.</th>
                      <th style={{ ...th, textAlign: 'right' }}>Loyer HT</th>
                      <th style={{ ...th, textAlign: 'right' }}>Encaissée</th>
                      <th style={{ ...th, textAlign: 'right' }}>Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resas.map(r => {
                      const taxe = calculTaxe(r, config, b)
                      return (
                        <tr key={r.id}>
                          <td style={td}>{r.guest_name || '—'}</td>
                          <td style={{ ...td, fontSize: 11, color: 'var(--text-muted)' }}>{r.platform}</td>
                          <td style={td}>{r.arrival_date ? new Date(r.arrival_date + 'T12:00:00').toLocaleDateString('fr-FR') : '—'}</td>
                          <td style={{ ...td, textAlign: 'center' }}>{r.nights || '—'}</td>
                          <td style={{ ...td, textAlign: 'center' }} title="adultes / voyageurs (mineurs exonérés)">{r.adultes != null && Number(r.adultes) !== r.guest_count ? `${r.adultes} / ${r.guest_count}` : (r.guest_count || '—')}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{r.fin_accommodation != null ? fmt(r.fin_accommodation / 100) : '—'}</td>
                          <td style={{ ...td, textAlign: 'right', color: taxeEncaissee[r.id] ? 'var(--text)' : '#B91C1C' }}>{taxeEncaissee[r.id] ? fmt(taxeEncaissee[r.id]) : '0,00 € ⚠'}</td>
                          <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: taxe != null ? 'var(--brand)' : '#B91C1C' }}>{taxe != null ? fmt(taxe) : '⚠ tarif'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--bg)' }}>
                      <td colSpan={6} style={{ ...td, fontWeight: 700 }}>Total {b.code}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmt(encaisseBien)}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: 'var(--brand)' }}>{fmt(totalBien)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )
          })}
        </>
      )}

      {/* ─── TARIFS ─── */}
      {onglet === 'tarifs' && (
        <>
          <div style={{ background: 'var(--white)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 6px rgba(0,0,0,.06)', marginBottom: 24 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Commune</th>
                  <th style={th}>Classification</th>
                  <th style={th}>Type</th>
                  <th style={{ ...th, textAlign: 'center' }}>Taux %</th>
                  <th style={{ ...th, textAlign: 'center' }}>Plafond HT</th>
                  <th style={{ ...th, textAlign: 'center' }}>€/pers/nuit TTC</th>
                  <th style={{ ...th, textAlign: 'center' }}>Coeff +</th>
                  <th style={{ ...th, textAlign: 'center' }}>Année</th>
                </tr>
              </thead>
              <tbody>
                {configs.map(c => (
                  <tr key={c.id}>
                    <td style={td}>{c.commune}</td>
                    <td style={td}>{CLASS_LABEL[c.classification] || c.classification}</td>
                    <td style={td}>
                      <span style={{ fontSize: 11, background: c.type_calcul === 'pourcentage' ? '#FEF3C7' : '#DCFCE7', color: c.type_calcul === 'pourcentage' ? '#92400E' : '#15803D', borderRadius: 4, padding: '2px 7px', fontWeight: 600 }}>
                        {c.type_calcul}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      {c.type_calcul === 'pourcentage'
                        ? <input type="number" step="0.1" defaultValue={c.taux_pct || ''} onBlur={e => sauvegarderConfig(c.id, 'taux_pct', e.target.value)}
                            style={{ width: 60, padding: '3px 6px', borderRadius: 5, border: '1px solid #e5e7eb', fontSize: 12, textAlign: 'center' }} />
                        : <span style={{ color: '#9ca3af' }}>—</span>}
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      {c.type_calcul === 'pourcentage'
                        ? <input type="number" step="0.01" defaultValue={c.plafond_ht || ''} onBlur={e => sauvegarderConfig(c.id, 'plafond_ht', e.target.value)}
                            style={{ width: 70, padding: '3px 6px', borderRadius: 5, border: '1px solid #e5e7eb', fontSize: 12, textAlign: 'center' }} />
                        : <span style={{ color: '#9ca3af' }}>—</span>}
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      {c.type_calcul === 'forfait'
                        ? <input type="number" step="0.01" defaultValue={c.tarif_pers_nuit || ''} onBlur={e => sauvegarderConfig(c.id, 'tarif_pers_nuit', e.target.value)}
                            style={{ width: 70, padding: '3px 6px', borderRadius: 5, border: '1px solid #e5e7eb', fontSize: 12, textAlign: 'center' }} />
                        : <span style={{ color: '#9ca3af' }}>—</span>}
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      <input type="number" step="0.01" defaultValue={c.coeff_additionnel || ''} onBlur={e => sauvegarderConfig(c.id, 'coeff_additionnel', e.target.value)}
                        style={{ width: 60, padding: '3px 6px', borderRadius: 5, border: '1px solid #e5e7eb', fontSize: 12, textAlign: 'center' }} />
                    </td>
                    <td style={{ ...td, textAlign: 'center', color: 'var(--text-muted)' }}>{c.annee}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Ajouter un tarif */}
          <div style={{ background: 'var(--white)', borderRadius: 12, padding: 20, boxShadow: '0 1px 6px rgba(0,0,0,.06)' }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Ajouter un tarif</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginBottom: 14 }}>
              {[
                { key: 'commune', label: 'Commune', placeholder: 'ex: Bordeaux' },
                { key: 'annee', label: 'Année', placeholder: '2026' },
              ].map(({ key, label, placeholder }) => (
                <div key={key}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>{label}</label>
                  <input value={formConfig[key] || ''} onChange={e => setFormConfig(f => ({ ...f, [key]: e.target.value }))} placeholder={placeholder}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1.5px solid var(--border)', fontSize: 13, boxSizing: 'border-box' }} />
                </div>
              ))}
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Classification</label>
                <select value={formConfig.classification || ''} onChange={e => setFormConfig(f => ({ ...f, classification: e.target.value }))}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1.5px solid var(--border)', fontSize: 13 }}>
                  <option value="">Choisir…</option>
                  {CLASSIFICATIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Type calcul</label>
                <select value={formConfig.type_calcul || 'forfait'} onChange={e => setFormConfig(f => ({ ...f, type_calcul: e.target.value }))}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1.5px solid var(--border)', fontSize: 13 }}>
                  <option value="forfait">Forfait (€/pers/nuit)</option>
                  <option value="pourcentage">Pourcentage du loyer</option>
                </select>
              </div>
              {formConfig.type_calcul === 'pourcentage' ? (
                <>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Taux %</label>
                    <input type="number" step="0.1" value={formConfig.taux_pct || ''} onChange={e => setFormConfig(f => ({ ...f, taux_pct: e.target.value }))} placeholder="5"
                      style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1.5px solid var(--border)', fontSize: 13, boxSizing: 'border-box' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Plafond HT (€)</label>
                    <input type="number" step="0.01" value={formConfig.plafond_ht || ''} onChange={e => setFormConfig(f => ({ ...f, plafond_ht: e.target.value }))} placeholder="4.90"
                      style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1.5px solid var(--border)', fontSize: 13, boxSizing: 'border-box' }} />
                  </div>
                </>
              ) : (
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>€/pers/nuit TTC</label>
                  <input type="number" step="0.01" value={formConfig.tarif_pers_nuit || ''} onChange={e => setFormConfig(f => ({ ...f, tarif_pers_nuit: e.target.value }))} placeholder="2.45"
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1.5px solid var(--border)', fontSize: 13, boxSizing: 'border-box' }} />
                </div>
              )}
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Coeff additionnel</label>
                <input type="number" step="0.01" value={formConfig.coeff_additionnel || '1.44'} onChange={e => setFormConfig(f => ({ ...f, coeff_additionnel: e.target.value }))} placeholder="1.44"
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1.5px solid var(--border)', fontSize: 13, boxSizing: 'border-box' }} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={ajouterConfig} disabled={saving || !formConfig.commune || !formConfig.classification}
                style={{ background: 'var(--brand)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: !formConfig.commune || !formConfig.classification ? 0.5 : 1 }}>
                {saving ? '…' : 'Ajouter le tarif'}
              </button>
            </div>
          </div>

          <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg)', borderRadius: 8, padding: '10px 14px' }}>
            {AGENCE === 'bordeaux'
              ? '💡 Bordeaux Métropole — délai de reversement au 20 du mois suivant la fin du trimestre. Tarifs à saisir manuellement (portail : taxedesejour.bordeaux-metropole.fr). Le coefficient 1.44 = +10% département Gironde + +34% région (Grand Projet ferroviaire Sud-Ouest).'
              : '💡 Les tarifs Biarritz 2026 sont pré-remplis (délibération jan 2026, taxe.3douest.com). Le coefficient 1.44 = +10% département + +34% région (Grand Projet ferroviaire Sud-Ouest).'
            }
          </div>
        </>
      )}
    </div>
  )
}
