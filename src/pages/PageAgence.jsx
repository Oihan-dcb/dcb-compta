import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { AGENCE } from '../lib/agence'

const CHARGES_OPTIONS = [
  { value: 'forfaitaires', label: 'Charges forfaitaires (pas de régularisation)' },
  { value: 'provisions',   label: 'Provisions sur charges (régularisation annuelle)' },
]

export default function PageAgence() {
  const [config, setConfig]     = useState(null)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [logoUrl, setLogoUrl]   = useState(null)
  const [logoLoading, setLogoLoading] = useState(false)
  const [success, setSuccess]   = useState('')
  const [error, setError]       = useState('')
  const fileRef = useRef(null)

  // ── Chargement ────────────────────────────────────────────────────────────
  useEffect(() => {
    charger()
  }, [])

  async function charger() {
    setLoading(true)
    const { data, error } = await supabase
      .from('agency_config')
      .select('*')
      .eq('agence', AGENCE)
      .single()
    if (error) { setError(error.message); setLoading(false); return }
    setConfig(data)
    if (data.logo_storage_path) chargerLogoUrl(data.logo_storage_path)
    setLoading(false)
  }

  async function chargerLogoUrl(path) {
    const { data } = await supabase.storage
      .from('agency-assets')
      .createSignedUrl(path, 3600)
    if (data?.signedUrl) setLogoUrl(data.signedUrl)
  }

  // ── Sauvegarde ────────────────────────────────────────────────────────────
  async function sauvegarder(e) {
    e.preventDefault()
    setSaving(true)
    setSuccess('')
    setError('')
    const { error } = await supabase
      .from('agency_config')
      .update({
        label:          config.label,
        adresse_ligne1: config.adresse_ligne1 || null,
        adresse_ligne2: config.adresse_ligne2 || null,
        siret:          config.siret || null,
        telephone:      config.telephone || null,
        charges_nature: config.charges_nature || 'forfaitaires',
        email_comptable: config.email_comptable || null,
        resend_from_email: config.resend_from_email || null,
        updated_at: new Date().toISOString(),
      })
      .eq('agence', AGENCE)
    setSaving(false)
    if (error) setError(error.message)
    else setSuccess('Informations sauvegardées.')
  }

  // ── Upload logo ────────────────────────────────────────────────────────────
  async function uploaderLogo(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/svg+xml'].includes(file.type)) {
      setError('Format accepté : PNG, JPG, SVG')
      return
    }
    setLogoLoading(true)
    setError('')
    const ext  = file.name.split('.').pop().toLowerCase()
    const path = `${AGENCE}/logo.${ext}`
    const { error: upErr } = await supabase.storage
      .from('agency-assets')
      .upload(path, file, { contentType: file.type, upsert: true })
    if (upErr) { setError(upErr.message); setLogoLoading(false); return }

    const { error: dbErr } = await supabase
      .from('agency_config')
      .update({ logo_storage_path: path, updated_at: new Date().toISOString() })
      .eq('agence', AGENCE)
    if (dbErr) { setError(dbErr.message); setLogoLoading(false); return }

    setConfig(c => ({ ...c, logo_storage_path: path }))
    chargerLogoUrl(path)
    setLogoLoading(false)
    setSuccess('Logo mis à jour.')
  }

  async function supprimerLogo() {
    if (!config.logo_storage_path) return
    await supabase.storage.from('agency-assets').remove([config.logo_storage_path])
    await supabase.from('agency_config')
      .update({ logo_storage_path: null, updated_at: new Date().toISOString() })
      .eq('agence', AGENCE)
    setConfig(c => ({ ...c, logo_storage_path: null }))
    setLogoUrl(null)
  }

  const set = (field) => (e) => setConfig(c => ({ ...c, [field]: e.target.value }))

  if (loading) return <div className="page-loading">Chargement…</div>
  if (!config) return <div className="page-error">Configuration introuvable pour l'agence {AGENCE}</div>

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '32px 16px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: 'var(--text)' }}>
        Configuration de l'agence
      </h1>
      <p style={{ color: '#8C7B65', fontSize: 13, marginBottom: 32 }}>
        Ces informations apparaissent sur les quittances de loyer et les documents légaux.
      </p>

      {success && (
        <div style={{ background: '#D1FAE5', border: '1px solid #6EE7B7', borderRadius: 6, padding: '10px 14px', marginBottom: 20, color: '#065F46', fontSize: 13 }}>
          {success}
        </div>
      )}
      {error && (
        <div style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 6, padding: '10px 14px', marginBottom: 20, color: '#991B1B', fontSize: 13 }}>
          {error}
        </div>
      )}

      <form onSubmit={sauvegarder}>

        {/* ── Identité ─────────────────────────────────────────────────── */}
        <section style={{ marginBottom: 32 }}>
          <h2 style={sectionStyle}>Identité</h2>

          <div style={fieldStyle}>
            <label style={labelStyle}>Nom de l'agence</label>
            <input style={inputStyle} value={config.label || ''} onChange={set('label')} required />
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle}>Adresse — ligne 1</label>
            <input style={inputStyle} value={config.adresse_ligne1 || ''} onChange={set('adresse_ligne1')}
              placeholder="ex : 12 avenue de l'Impératrice" />
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle}>Adresse — ligne 2</label>
            <input style={inputStyle} value={config.adresse_ligne2 || ''} onChange={set('adresse_ligne2')}
              placeholder="ex : 64200 Biarritz" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>SIRET</label>
              <input style={inputStyle} value={config.siret || ''} onChange={set('siret')}
                placeholder="xxx xxx xxx xxxxx" />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Téléphone</label>
              <input style={inputStyle} value={config.telephone || ''} onChange={set('telephone')}
                placeholder="06 xx xx xx xx" />
            </div>
          </div>
        </section>

        {/* ── Logo ─────────────────────────────────────────────────────── */}
        <section style={{ marginBottom: 32 }}>
          <h2 style={sectionStyle}>Logo</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            {logoUrl ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <img src={logoUrl} alt="Logo agence"
                  style={{ height: 60, maxWidth: 180, objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 6, padding: 8, background: '#fff' }} />
                <button type="button" onClick={supprimerLogo}
                  style={{ fontSize: 11, color: '#991B1B', background: 'none', border: 'none', cursor: 'pointer' }}>
                  Supprimer
                </button>
              </div>
            ) : (
              <div style={{ width: 120, height: 60, border: '2px dashed var(--border)', borderRadius: 6,
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8C7B65', fontSize: 12 }}>
                Aucun logo
              </div>
            )}
            <div>
              <button type="button" onClick={() => fileRef.current?.click()}
                style={{ ...btnSecondary, opacity: logoLoading ? 0.6 : 1 }}
                disabled={logoLoading}>
                {logoLoading ? 'Envoi…' : 'Changer le logo'}
              </button>
              <p style={{ fontSize: 11, color: '#8C7B65', marginTop: 6 }}>PNG, JPG ou SVG — utilisé sur les documents PDF</p>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml"
                style={{ display: 'none' }} onChange={uploaderLogo} />
            </div>
          </div>
        </section>

        {/* ── Documents légaux ─────────────────────────────────────────── */}
        <section style={{ marginBottom: 32 }}>
          <h2 style={sectionStyle}>Quittances de loyer</h2>

          <div style={fieldStyle}>
            <label style={labelStyle}>Nature des charges locatives</label>
            <select style={inputStyle} value={config.charges_nature || 'forfaitaires'} onChange={set('charges_nature')}>
              {CHARGES_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <p style={{ fontSize: 11, color: '#8C7B65', marginTop: 4 }}>
              Mention obligatoire sur chaque quittance (loi 89-462, art. 21)
            </p>
          </div>
        </section>

        {/* ── Comptabilité ─────────────────────────────────────────────── */}
        <section style={{ marginBottom: 32 }}>
          <h2 style={sectionStyle}>Comptabilité</h2>

          <div style={fieldStyle}>
            <label style={labelStyle}>Email comptable (bilan mensuel LLD)</label>
            <input style={inputStyle} value={config.email_comptable || ''} onChange={set('email_comptable')}
              placeholder="comptable@cabinet.fr, autre@cabinet.fr" type="text" />
            <p style={{ fontSize: 11, color: '#8C7B65', marginTop: 4 }}>Séparer plusieurs adresses par une virgule</p>
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle}>Email expéditeur (Resend)</label>
            <input style={inputStyle} value={config.resend_from_email || ''} onChange={set('resend_from_email')}
              placeholder="contact@votreagence.fr" type="email" />
          </div>
        </section>

        <button type="submit" disabled={saving}
          style={{ ...btnPrimary, opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Sauvegarde…' : 'Sauvegarder'}
        </button>

      </form>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
const sectionStyle = {
  fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
  color: '#8C7B65', marginBottom: 16, paddingBottom: 8, borderBottom: '1px solid var(--border)',
}
const fieldStyle = { marginBottom: 16 }
const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 5 }
const inputStyle = {
  width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid var(--border)',
  borderRadius: 6, background: '#fff', color: 'var(--text)', boxSizing: 'border-box',
}
const btnPrimary = {
  background: 'var(--brand)', color: '#fff', border: 'none', borderRadius: 6,
  padding: '10px 24px', fontWeight: 600, fontSize: 14, cursor: 'pointer',
}
const btnSecondary = {
  background: '#F7F3EC', color: 'var(--text)', border: '1px solid var(--border)',
  borderRadius: 6, padding: '8px 16px', fontWeight: 600, fontSize: 13, cursor: 'pointer',
}
