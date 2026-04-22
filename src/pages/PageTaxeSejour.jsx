import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { AGENCE } from '../lib/agence'

const CLASSIFICATIONS = [
  { value: 'non_classe', label: 'Non classé' },
  { value: '1_etoile',   label: '1 ★' },
  { value: '2_etoiles',  label: '2 ★' },
  { value: '3_etoiles',  label: '3 ★' },
  { value: '4_etoiles',  label: '4 ★' },
  { value: '5_etoiles',  label: '5 ★' },
]

const CLASS_LABEL = Object.fromEntries(CLASSIFICATIONS.map(c => [c.value, c.label]))

function getQuarterRange(year, quarter) {
  const starts = { 1: '01', 2: '04', 3: '07', 4: '10' }
  const ends   = { 1: '03', 2: '06', 3: '09', 4: '12' }
  return {
    debut: `${year}-${starts[quarter]}-01`,
    fin:   `${year}-${ends[quarter]}-31`,
    label: `T${quarter} ${year}`,
  }
}

function calculTaxe(resa, config) {
  if (!config) return null
  const nbPersonnes = resa.guest_count || 1
  const nbNuits = resa.nights || 1
  if (config.type_calcul === 'forfait') {
    return config.tarif_pers_nuit * nbPersonnes * nbNuits
  }
  // pourcentage (non classé) — fin_accommodation stocké en centimes
  const prixNuitHT = nbNuits > 0 ? (resa.fin_accommodation || 0) / 100 / nbNuits : 0
  const taxeParPersParNuit = Math.min(prixNuitHT * (config.taux_pct / 100), config.plafond_ht)
  return taxeParPersParNuit * config.coeff_additionnel * nbPersonnes * nbNuits
}

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
  const [configs, setConfigs] = useState([]) // taxe_sejour_config rows
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

    const [{ data: biensData }, { data: resaData }] = await Promise.all([
      supabase.from('bien')
        .select('id, code, hospitable_name, ville, classification, agence, listed')
        .eq('agence', AGENCE)
        .eq('listed', true)
        .eq('gestion_taxe_sejour', true)
        .order('code'),
      supabase.from('reservation')
        .select('id, bien_id, guest_name, guest_count, arrival_date, departure_date, nights, fin_accommodation, platform')
        .eq('agence', AGENCE)
        .eq('platform', 'direct')
        .gte('arrival_date', debut)
        .lte('arrival_date', fin)
        .order('arrival_date'),
    ])

    setBiens(biensData || [])
    setReservations(resaData || [])
    setLoading(false)
  }

  async function chargerConfigs() {
    const { data } = await supabase.from('taxe_sejour_config')
      .select('*')
      .eq('agence', AGENCE)
      .order('commune').order('classification')
    setConfigs(data || [])
  }

  function getConfig(ville, classification) {
    const anneeConfig = annee
    return configs.find(c =>
      c.commune?.toLowerCase() === (ville || '').toLowerCase() &&
      c.classification === classification &&
      c.annee === anneeConfig
    ) || configs.find(c =>
      c.commune?.toLowerCase() === (ville || '').toLowerCase() &&
      c.classification === classification
    )
  }

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
  const totalGlobal = biens.reduce((sum, b) => {
    const config = getConfig(b.ville, b.classification || 'non_classe')
    return sum + (resaParBien[b.id] || []).reduce((s, r) => s + (calculTaxe(r, config) || 0), 0)
  }, 0)

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
            <div style={{ marginLeft: 'auto', background: 'var(--header-bg)', border: '2px solid var(--brand)', borderRadius: 10, padding: '8px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total à déclarer</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--brand)' }}>{fmt(totalGlobal)}</div>
            </div>
          </div>

          <div style={{ background: 'var(--brand-pale)', border: '1px solid #E4A853', borderRadius: 8, padding: '10px 16px', marginBottom: 20, fontSize: 12, color: '#92400E' }}>
            ℹ️ Seules les <strong>réservations directes</strong> sont concernées — Airbnb et Booking collectent la taxe eux-mêmes. Le nombre de voyageurs utilisé est <code>nb_guests</code> total (mineurs non déduits, à ajuster manuellement si besoin).
          </div>

          {reservations.length === 0 && !loading && (
            <div style={{ textAlign: 'center', padding: 60, background: 'var(--white)', borderRadius: 12, color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🏖️</div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Aucune réservation directe sur {trimLabel}</div>
              <div style={{ fontSize: 13 }}>Les réservations avec platform = 'direct' apparaîtront ici</div>
            </div>
          )}

          {biens.filter(b => resaParBien[b.id]?.length > 0).map(b => {
            const config = getConfig(b.ville, b.classification || 'non_classe')
            const resas = resaParBien[b.id] || []
            const totalBien = resas.reduce((s, r) => s + (calculTaxe(r, config) || 0), 0)

            return (
              <div key={b.id} style={{ background: 'var(--white)', borderRadius: 12, marginBottom: 16, overflow: 'hidden', boxShadow: '0 1px 6px rgba(0,0,0,.06)' }}>
                <div style={{ background: 'var(--header-bg)', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '2px solid var(--brand)' }}>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>🏠 {b.code}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 10 }}>{b.ville}</span>
                    <span style={{ fontSize: 11, background: config ? '#DCFCE7' : '#FEE2E2', color: config ? '#15803D' : '#B91C1C', borderRadius: 4, padding: '2px 7px', marginLeft: 8, fontWeight: 600 }}>
                      {CLASS_LABEL[b.classification || 'non_classe']}
                      {!config && ' ⚠ tarif manquant'}
                    </span>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--brand)' }}>{fmt(totalBien)}</div>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>Voyageur</th>
                      <th style={th}>Arrivée</th>
                      <th style={{ ...th, textAlign: 'center' }}>Nuits</th>
                      <th style={{ ...th, textAlign: 'center' }}>Pers.</th>
                      <th style={{ ...th, textAlign: 'right' }}>Loyer HT</th>
                      <th style={{ ...th, textAlign: 'right' }}>Taxe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resas.map(r => {
                      const taxe = calculTaxe(r, config)
                      return (
                        <tr key={r.id}>
                          <td style={td}>{r.guest_name || '—'}</td>
                          <td style={td}>{r.arrival_date ? new Date(r.arrival_date + 'T12:00:00').toLocaleDateString('fr-FR') : '—'}</td>
                          <td style={{ ...td, textAlign: 'center' }}>{r.nights || '—'}</td>
                          <td style={{ ...td, textAlign: 'center' }}>{r.guest_count || '—'}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{r.fin_accommodation != null ? fmt(r.fin_accommodation / 100) : '—'}</td>
                          <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: taxe != null ? 'var(--brand)' : '#B91C1C' }}>{taxe != null ? fmt(taxe) : '⚠ config'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--bg)' }}>
                      <td colSpan={5} style={{ ...td, fontWeight: 700 }}>Total {b.code}</td>
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
