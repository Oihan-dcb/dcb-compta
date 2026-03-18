import { useState, useEffect } from 'react'
import MoisSelector from '../components/MoisSelector'
import {
  getFacturesAE, initialiserFacturesAE, updateFactureAE,
  validerFactureAE, getStatsFacturesAE, getMontantEffectifAE
} from '../services/facturesAE'
import { formatMontant } from '../lib/hospitable'

const moisCourant = new Date().toISOString().substring(0, 7)

export default function PageFacturesAuto() {
  const [mois, setMois] = useState(moisCourant)
  const [moisDispos, setMoisDispos] = useState([moisCourant])
  const [factures, setFactures] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(null) // id de la facture en cours d'édition
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [importing, setImporting] = useState(false)

  useEffect(() => { charger() }, [mois])
  useEffect(() => {
    import('../lib/supabase').then(function(mod) {
      mod.supabase.from('facture_ae').select('mois').then(function(res) {
        if (res.data) {
          var uniq = [...new Set(res.data.map(function(d) { return d.mois }).filter(Boolean))].sort(function(a,b) { return b.localeCompare(a) })
          if (uniq.length) setMoisDispos(function(p) { return [...new Set([...p, ...uniq])] })
        }
      })
    })
  }, [])

  async function charger() {
    setLoading(true)
    setError(null)
    try {
      const [f, s] = await Promise.all([getFacturesAE(mois), getStatsFacturesAE(mois)])
      setFactures(f)
      setStats(s)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function initialiser() {
    setLoading(true)
    setError(null)
    try {
      const result = await initialiserFacturesAE(mois)
      setSuccess(`${result.created} fiches AE créées pour ${mois}`)
      await charger()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function ouvrir(facture) {
    setEditing(facture.id)
    setForm({
      ae_nom: facture.ae_nom || '',
      ae_initiales: facture.ae_initiales || '',
      montant_reel: facture.montant_reel !== null ? (facture.montant_reel / 100).toFixed(2) : '',
      note: facture.note || '',
    })
    setError(null)
    setSuccess(null)
  }

  async function sauvegarder(factureId) {
    setSaving(true)
    setError(null)
    try {
      const montantReel = form.montant_reel ? Math.round(parseFloat(form.montant_reel) * 100) : null
      const result = await updateFactureAE(factureId, {
        ae_nom: form.ae_nom,
        ae_initiales: form.ae_initiales,
        montant_reel: montantReel,
        note: form.note,
      })
      setSuccess(`Facture sauvegardée${result.alerteEcart ? ' — ⚠ Écart > 20% détecté' : ''}`)
      setEditing(null)
      await charger()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function valider(factureId) {
    try {
      await validerFactureAE(factureId)
      setSuccess('Facture AE validée')
      await charger()
    } catch (err) {
      setError(err.message)
    }
  }

  const totalEffectif = factures.reduce((s, f) => s + getMontantEffectifAE(f), 0)

  function telechargerTemplate() {
    if (!factures.length) return
    const moisLabel = new Date(mois + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })

    // Une page HTML interactive par fiche, avec champ de saisie + bouton PDF + export CSV
    const pagesHtml = factures.map((f, idx) => {
      const bienNom = (f.bien?.hospitable_name || f.bien?.code || '—').replace(/'/g, "\'")
      const bienCode = f.bien?.code || '—'
      const aeNom = (f.ae_nom || '').replace(/'/g, "\'")
      const numFacture = `AE-${mois.replace('-','')}-${bienCode}`
      const factureId = f.id
      return `<div class="page" id="page-${idx}" data-id="${factureId}" data-bien="${bienCode}" data-nom="${bienNom}">
  <div class="no-print action-bar">
    <div class="action-title">📄 Facture ${bienCode} — ${moisLabel}</div>
    <div class="action-btns">
      <button class="btn-pdf" onclick="imprimerPage(${idx})">🖨️ Imprimer / Enregistrer PDF</button>
    </div>
  </div>
  <div class="facture-content">
    <div class="header">
      <div class="logo-bloc"><div class="logo">DCB</div><div class="logo-sub">Destination Côte Basque</div></div>
      <div class="facture-titre">
        <div class="titre-label">FACTURE</div>
        <div class="titre-num">N° ${numFacture}</div>
        <div class="titre-date">Date : <span class="date-emission" id="date-${idx}"></span><script>document.getElementById('date-${idx}').textContent=new Date().toLocaleDateString('fr-FR')<\/script></div>
      </div>
    </div>
    <div class="parties">
      <div class="partie">
        <div class="partie-label">ÉMETTEUR</div>
        <div class="partie-nom no-print"><input class="input-nom" id="nom-${idx}" placeholder="Votre nom prénom" value="${aeNom}" style="font-size:14px;font-weight:700;border:none;border-bottom:2px solid #1a3a6e;width:100%;padding:2px 0;background:transparent;outline:none;color:#222;" /></div>
        <div class="partie-nom print-only" id="nom-print-${idx}" style="display:none">${aeNom}</div>
        <div class="partie-info">Auto-entrepreneur ménage</div>
        <div class="partie-info">TVA non applicable — art. 293B CGI</div>
      </div>
      <div class="partie">
        <div class="partie-label">DESTINATAIRE</div>
        <div class="partie-nom">Destination Côte Basque</div>
        <div class="partie-info">Gestion locative saisonnière</div>
        <div class="partie-info">Biarritz, France</div>
      </div>
    </div>
    <div class="objet-bloc">
      <span class="objet-label">Objet :</span> Prestations ménage — <strong>${bienNom}</strong> — ${moisLabel}
    </div>
    <table class="table-prestations">
      <thead><tr><th>Désignation</th><th>Bien</th><th>Période</th><th class="montant-col">Montant HT</th></tr></thead>
      <tbody>
        <tr>
          <td>Prestations de ménage</td>
          <td>${bienNom}</td>
          <td>${moisLabel}</td>
          <td class="montant-col">
            <span class="no-print"><input type="number" step="0.01" min="0" id="montant-${idx}" placeholder="0,00" style="width:90px;text-align:right;font-size:15px;font-weight:700;color:#1a3a6e;border:none;border-bottom:2px solid #1a3a6e;background:transparent;outline:none;" /> €</span>
            <span class="print-only" id="montant-print-${idx}" style="display:none;font-weight:700;color:#1a3a6e;font-size:15px;"></span>
          </td>
        </tr>
      </tbody>
      <tfoot>
        <tr><td colspan="3" class="total-label">Total HT</td><td class="montant-col" id="total-ht-${idx}">—</td></tr>
        <tr><td colspan="3" class="total-label">TVA (non applicable — art. 293B CGI)</td><td class="montant-col">0,00 €</td></tr>
        <tr class="total-ttc"><td colspan="3" class="total-label">TOTAL TTC</td><td class="montant-col" id="total-ttc-${idx}">—</td></tr>
      </tfoot>
    </table>
    <div class="mentions">
      <div>TVA non applicable en vertu de l'article 293B du CGI</div>
      <div>Règlement par virement — à réception de facture</div>
    </div>
    <div class="signature-bloc">
      <div class="signature-label">Signature :</div>
      <div class="signature-ligne"></div>
    </div>
  </div>
</div>`
    }).join('<div class="page-sep"></div>')

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Factures AE ${mois}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;font-family:Arial,sans-serif}
body{background:#f0f2f5;padding:20px}
.action-bar{background:#1a3a6e;color:white;padding:12px 20px;border-radius:8px 8px 0 0;display:flex;justify-content:space-between;align-items:center;gap:12px}
.action-title{font-size:14px;font-weight:600}
.action-btns{display:flex;gap:8px}
.btn-pdf{background:white;color:#1a3a6e;border:none;border-radius:6px;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer}
.btn-pdf:hover{background:#e8f0fe}
.page{background:white;width:210mm;margin:0 auto 40px;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.12)}
.page-sep{height:0}
.facture-content{padding:20mm}
.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1a3a6e;padding-bottom:16px;margin-bottom:20px}
.logo{font-size:36px;font-weight:900;color:#1a3a6e;letter-spacing:2px}
.logo-sub{font-size:11px;color:#666;margin-top:4px}
.facture-titre{text-align:right}
.titre-label{font-size:28px;font-weight:700;color:#1a3a6e}
.titre-num{font-size:14px;color:#444;margin-top:4px}
.titre-date{font-size:12px;color:#888;margin-top:2px}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px}
.partie{background:#f8f9fa;border-radius:6px;padding:14px 16px;border-left:4px solid #1a3a6e}
.partie-label{font-size:10px;font-weight:700;color:#1a3a6e;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px}
.partie-nom{font-size:14px;font-weight:700;color:#222;margin-bottom:4px}
.partie-info{font-size:12px;color:#666}
.objet-bloc{background:#eef2ff;border-radius:6px;padding:12px 16px;font-size:13px;color:#333;margin-bottom:20px}
.objet-label{font-weight:700;color:#1a3a6e}
.table-prestations{width:100%;border-collapse:collapse;margin-bottom:16px}
.table-prestations th{background:#1a3a6e;color:white;padding:10px 12px;font-size:12px;text-align:left}
.table-prestations td{padding:12px;font-size:13px;border-bottom:1px solid #e5e7eb}
.montant-col{text-align:right;min-width:130px}
.total-label{text-align:right;font-weight:600;color:#444;padding-right:12px}
.total-ttc{background:#1a3a6e}
.total-ttc td{color:white;font-weight:700;font-size:14px;padding:12px}
.mentions{font-size:10px;color:#888;padding:8px 0;border-top:1px solid #e5e7eb;line-height:1.8;margin-bottom:20px}
.signature-bloc{margin-bottom:20px}
.signature-label{font-size:12px;color:#555;margin-bottom:6px}
.signature-ligne{border-bottom:1px solid #333;width:200px;height:40px}
.global-csv{position:fixed;bottom:20px;right:20px;background:#2E7D32;color:white;border:none;border-radius:12px;padding:14px 24px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.2);z-index:999}
.global-csv:hover{background:#1b5e20}
@media print{
  body{background:white;padding:0}
  .no-print{display:none!important}
  .print-only{display:block!important}
  .page{box-shadow:none;border-radius:0;margin:0;width:100%}
  .page-sep{page-break-after:always}
  .global-csv{display:none}
}
</style>
</head>
<body>
${pagesHtml}
<button class="global-csv no-print" onclick="exporterCSV()">📥 Télécharger CSV pour DCB</button>
<script>
function fmt(v){return v?v.toFixed(2).replace('.',',')+' €':'—'}
function majTotaux(idx){
  const v=parseFloat(document.getElementById('montant-'+idx)?.value)||0
  document.getElementById('total-ht-'+idx).textContent=fmt(v)
  document.getElementById('total-ttc-'+idx).textContent=fmt(v)
}
document.querySelectorAll('input[type=number]').forEach(inp=>{
  const idx=inp.id.replace('montant-','')
  inp.addEventListener('input',()=>majTotaux(idx))
})
function imprimerPage(idx){
  const nom=document.getElementById('nom-'+idx)?.value||''
  const montant=parseFloat(document.getElementById('montant-'+idx)?.value)||0
  // Copier valeurs vers éléments print
  const nomPrint=document.getElementById('nom-print-'+idx)
  if(nomPrint){nomPrint.textContent=nom;nomPrint.style.display='block'}
  const nomInput=document.getElementById('nom-'+idx)
  if(nomInput)nomInput.style.display='none'
  const montantPrint=document.getElementById('montant-print-'+idx)
  if(montantPrint){montantPrint.textContent=fmt(montant);montantPrint.style.display='inline'}
  const montantInput=document.getElementById('montant-'+idx)
  if(montantInput)montantInput.style.display='none'
  document.getElementById('total-ht-'+idx).textContent=fmt(montant)
  document.getElementById('total-ttc-'+idx).textContent=fmt(montant)
  window.print()
  // Restaurer
  setTimeout(()=>{
    if(nomPrint)nomPrint.style.display='none'
    if(nomInput)nomInput.style.display=''
    if(montantPrint)montantPrint.style.display='none'
    if(montantInput)montantInput.style.display=''
  },1000)
}
function exporterCSV(){
  const pages=document.querySelectorAll('.page[data-id]')
  const rows=['facture_id,bien_code,bien_nom,ae_nom,montant_reel_eur']
  pages.forEach((p,i)=>{
    const id=p.dataset.id
    const bien=p.dataset.bien
    const nom=(p.querySelector('#nom-'+i)?.value||'').replace(/,/g,' ')
    const bienNom=(p.dataset.nom||'').replace(/,/g,' ')
    const v=parseFloat(p.querySelector('#montant-'+i)?.value)||0
    rows.push([id,bien,bienNom,nom,v.toFixed(2)].join(','))
  })
  const csv='\uFEFF'+rows.join('\n')
  const a=document.createElement('a')
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}))
  a.download='import-ae-${mois}.csv'
  a.click()
}
<\/script>
</body></html>`

    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
    a.download = `factures-ae-${mois}.html`
    a.click()
  }

    async function importerCSV(e) {
    const file = e.target.files[0]
    if (!file) return
    setImporting(true)
    setError(null)
    try {
      const text = await file.text()
      const lines = text.replace(/\r/g, '').split('\n').filter(Boolean)
      const headers = lines[0].split(',')
      const idIdx = headers.indexOf('facture_id')
      const reelIdx = headers.indexOf('montant_reel_eur')
      const aeIdx = headers.indexOf('ae_nom')
      if (idIdx < 0 || reelIdx < 0) throw new Error('Colonnes manquantes: facture_id et montant_reel_eur requis')
      let updated = 0
      for (const line of lines.slice(1)) {
        const cols = line.split(',')
        const id = cols[idIdx]?.trim()
        const reelStr = cols[reelIdx]?.trim()
        const aeNom = aeIdx >= 0 ? cols[aeIdx]?.trim() : undefined
        if (!id || reelStr === '') continue
        const montant_reel = Math.round(parseFloat(reelStr) * 100)
        if (isNaN(montant_reel)) continue
        await updateFactureAE(id, { montant_reel, ...(aeNom ? { ae_nom: aeNom } : {}), statut: 'valide' })
        updated++
      }
      setSuccess(`${updated} fiche(s) AE mise(s) à jour`)
      await charger()
    } catch (err) {
      setError(err.message)
    } finally {
      setImporting(false)
      e.target.value = ''
    }
  }


  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Factures auto-entrepreneurs</h1>
          <p className="page-subtitle">
            Provision main d'œuvre ménage — {factures.length} biens avec AE
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <MoisSelector mois={mois} setMois={setMois} moisDispos={moisDispos} />
          <button className="btn btn-secondary" onClick={charger} disabled={loading}>↺</button>
          <label style={{ cursor: importing ? 'not-allowed' : 'pointer', background: '#fff', color: '#374151', border: '1.5px solid #e5e7eb', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, opacity: importing ? 0.6 : 1 }}>
            {importing ? '⏳ Import...' : '📤 Importer CSV'}
            <input type="file" accept=".csv" style={{ display: 'none' }} onChange={importerCSV} disabled={importing} />
          </label>
          {factures.length > 0 && (
            <button onClick={telechargerTemplate} style={{ background: '#fff', color: '#374151', border: '1.5px solid #e5e7eb', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              📥 Template CSV
            </button>
          )}
          <button className="btn btn-primary" onClick={initialiser} disabled={loading}>
            + Initialiser le mois
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-label">Total biens AE</div>
            <div className="stat-value">{stats.total}</div>
            <div className="stat-sub">biens avec auto-entrepreneur</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Théoriques</div>
            <div className="stat-value" style={{ color: stats.theoriques > 0 ? 'var(--text-muted)' : 'var(--success)' }}>
              {stats.theoriques}
            </div>
            <div className="stat-sub">valeur par défaut utilisée</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Saisis / Validés</div>
            <div className="stat-value" style={{ color: 'var(--success)' }}>
              {stats.saisis + stats.valides}
            </div>
            <div className="stat-sub">montant réel renseigné</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Alertes écart</div>
            <div className="stat-value" style={{ color: stats.alertes > 0 ? 'var(--warning)' : 'var(--success)' }}>
              {stats.alertes}
            </div>
            <div className="stat-sub">écart &gt; 20% vs théorique</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total effectif</div>
            <div className="stat-value" style={{ fontSize: 18 }}>{formatMontant(totalEffectif)}</div>
            <div className="stat-sub">débours AE à reverser</div>
          </div>
        </div>
      )}

      {/* Alertes */}
      {error && <div className="alert alert-error">✕ {error}</div>}
      {success && <div className="alert alert-success">✓ {success}</div>}

      {loading ? (
        <div className="loading-state"><span className="spinner" /> Chargement…</div>
      ) : factures.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">Aucune fiche AE pour ce mois</div>
          <p>Clique sur "Initialiser le mois" pour créer les fiches à partir des biens avec AE configurés.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {factures.map(f => (
            <FactureAECard
              key={f.id}
              facture={f}
              editing={editing === f.id}
              form={form}
              saving={saving}
              onEdit={() => ouvrir(f)}
              onFormChange={changes => setForm(prev => ({ ...prev, ...changes }))}
              onSave={() => sauvegarder(f.id)}
              onCancel={() => setEditing(null)}
              onValider={() => valider(f.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FactureAECard({ facture, editing, form, saving, onEdit, onFormChange, onSave, onCancel, onValider }) {
  const bien = facture.bien
  const montantEffectif = getMontantEffectifAE(facture)
  const hasReel = facture.montant_reel !== null
  const ecartPct = facture.ecart && facture.montant_theorique
    ? Math.round(Math.abs(facture.ecart) / facture.montant_theorique * 100)
    : null

  const statutColor = {
    theorique: 'var(--text-muted)',
    saisi: 'var(--warning)',
    valide: 'var(--success)',
  }

  return (
    <div style={{
      background: 'var(--white)',
      border: `1px solid ${facture.alerte_ecart ? '#FBBF24' : 'var(--border)'}`,
      borderRadius: 'var(--radius)',
      padding: '14px 18px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {/* Infos bien */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flex: 1 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>
              {bien?.code || bien?.hospitable_name}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {bien?.proprietaire?.nom}
              {facture.ae_nom && <span> · AE : {facture.ae_nom}</span>}
            </div>
          </div>
        </div>

        {/* Montants */}
        <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Théorique</div>
            <div style={{ fontWeight: 500 }}>{formatMontant(facture.montant_theorique)}</div>
          </div>
          {hasReel && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Réel</div>
              <div style={{ fontWeight: 700, color: facture.alerte_ecart ? 'var(--warning)' : 'var(--success)' }}>
                {formatMontant(facture.montant_reel)}
                {ecartPct !== null && (
                  <span style={{ fontSize: 11, marginLeft: 6 }}>
                    ({facture.ecart > 0 ? '+' : ''}{formatMontant(facture.ecart)}, {ecartPct}%)
                  </span>
                )}
              </div>
            </div>
          )}
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Effectif</div>
            <div style={{ fontWeight: 700, color: 'var(--brand)', fontSize: 16 }}>{formatMontant(montantEffectif)}</div>
          </div>

          {/* Statut */}
          <span style={{
            padding: '3px 10px', borderRadius: 100, fontSize: 12, fontWeight: 600,
            background: facture.statut === 'valide' ? 'var(--success-bg)'
              : facture.statut === 'saisi' ? 'var(--warning-bg)' : '#F3F4F6',
            color: statutColor[facture.statut] || 'var(--text-muted)',
          }}>
            {facture.statut === 'theorique' ? 'Théorique'
              : facture.statut === 'saisi' ? 'Saisi'
              : 'Validé'}
          </span>

          {/* Actions */}
          {facture.statut !== 'valide' && !editing && (
            <button className="btn btn-secondary btn-sm" onClick={onEdit}>Saisir</button>
          )}
          {facture.statut === 'saisi' && !editing && (
            <button className="btn btn-primary btn-sm" onClick={onValider}>✓ Valider</button>
          )}
        </div>
      </div>

      {/* Formulaire de saisie */}
      {editing && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Nom AE</label>
              <input
                className="form-input"
                value={form.ae_nom}
                onChange={e => onFormChange({ ae_nom: e.target.value })}
                placeholder="ex: Cécile Alaux"
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Initiales</label>
              <input
                className="form-input"
                value={form.ae_initiales}
                onChange={e => onFormChange({ ae_initiales: e.target.value })}
                placeholder="ex: CA"
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Montant réel (€)</label>
              <input
                className="form-input"
                type="number"
                step="0.01"
                value={form.montant_reel}
                onChange={e => onFormChange({ montant_reel: e.target.value })}
                placeholder={`${(facture.montant_theorique / 100).toFixed(2)} (théorique)`}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Note</label>
              <input
                className="form-input"
                value={form.note}
                onChange={e => onFormChange({ note: e.target.value })}
                placeholder="Facultatif"
              />
            </div>
          </div>

          {/* Référence facture suggérée */}
          {form.ae_initiales && bien?.code && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
              Référence facture suggérée :{' '}
              <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                DCB-{bien.code}-{mois.replace('-', '')}-{form.ae_initiales}
              </span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={onSave} disabled={saving}>
              {saving ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Sauvegarde…</> : '✓ Sauvegarder'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={onCancel}>Annuler</button>
          </div>
        </div>
      )}
    </div>
  )
}
