import { useState, useEffect } from 'react'
import MoisSelector from '../components/MoisSelector'
import { useMoisPersisted } from '../hooks/useMoisPersisted'
import { supabase } from '../lib/supabase'
import { exportRapprochementBancaire } from '../services/exportRapprochementBancaire'
import { exportAutoDebours } from '../services/exportAutoDebours'
import { exportFacturesEvoliz } from '../services/exportFacturesEvoliz'
import { exportReservationsDetaillees } from '../services/exportReservationsDetaillees'
import { exportDeboursPrestations } from '../services/exportDeboursPrestations'
import { buildComptaMensuelle, downloadComptaCSV } from '../services/buildComptaMensuelle'
import { envoyerExportsComptable } from '../services/envoyerExportsComptable'

const moisCourant = new Date().toISOString().slice(0, 7)

export default function PageExports() {
  const [mois, setMois] = useMoisPersisted()
  const [moisDispos, setMoisDispos] = useState([moisCourant])
  const [loading, setLoading] = useState({})
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  useEffect(() => {
    supabase.from('reservation').select('mois_comptable').then(({ data: res }) => {
      const [cy, cm] = moisCourant.split('-').map(Number)
      const thisYearMonths = Array.from({ length: cm }, (_, i) =>
        `${cy}-${String(i + 1).padStart(2, '0')}`)
      const uniq = [...new Set([...thisYearMonths, ...(res || []).map(d => d.mois_comptable).filter(Boolean)])]
        .sort((a, b) => b.localeCompare(a))
      setMoisDispos(uniq)
    })
  }, [])

  const [showEmailForm, setShowEmailForm] = useState(false)
  const [emailDest, setEmailDest] = useState('')
  const [emailCC, setEmailCC] = useState('')
  const [emailMessage, setEmailMessage] = useState('')
  const [emailExports, setEmailExports] = useState({
    rapprochement: true, auto: true, factures: true, compta: true
  })
  const [sendingEmail, setSendingEmail] = useState(false)

  async function telechargerCSV(type, filename, generator) {
    setLoading(prev => ({ ...prev, [type]: true }))
    setError(null)
    try {
      const csv = await generator(mois)
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename.replace('{mois}', mois)
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(prev => ({ ...prev, [type]: false }))
    }
  }

  async function telechargerXLSX() {
    setLoading(prev => ({ ...prev, debours: true }))
    setError(null)
    try {
      const blob = await exportDeboursPrestations(mois)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `DCB_Debours_Prestations_${mois}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(prev => ({ ...prev, debours: false }))
    }
  }

  async function telechargerCompta() {
    setLoading(prev => ({ ...prev, compta: true }))
    setError(null)
    try {
      const data = await buildComptaMensuelle(mois)
      downloadComptaCSV(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(prev => ({ ...prev, compta: false }))
    }
  }

  async function envoyerEmail() {
    if (!emailDest.trim()) { setError('Email destinataire requis'); return }
    const exportsSelectionnes = Object.entries(emailExports)
      .filter(([, checked]) => checked).map(([key]) => key)
    if (exportsSelectionnes.length === 0) { setError('Sélectionnez au moins un export'); return }

    setSendingEmail(true)
    setError(null)
    setSuccess(null)
    try {
      await envoyerExportsComptable(mois, emailDest, emailCC, exportsSelectionnes, emailMessage)
      setSuccess('Email envoyé avec succès')
      setShowEmailForm(false)
      setEmailDest(''); setEmailCC(''); setEmailMessage('')
    } catch (err) {
      setError('Erreur envoi : ' + err.message)
    } finally {
      setSendingEmail(false)
    }
  }

  return (
    <div style={{ padding: '24px', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.4em', fontWeight: 700, color: 'var(--text)' }}>Exports</h1>
          <div style={{ fontSize: '0.82em', color: '#9C8E7D', marginTop: 2 }}>Téléchargements et envoi comptable</div>
        </div>
        <MoisSelector mois={mois} setMois={setMois} moisDispos={moisDispos} />
      </div>

      {error && (
        <div style={{ padding: 12, background: '#FEF2F2', border: '1px solid #EF5350', borderRadius: 6, marginBottom: 16, color: '#C62828', fontSize: '0.9em' }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ padding: 12, background: '#E8F5E9', border: '1px solid #66BB6A', borderRadius: 6, marginBottom: 16, color: '#2E7D32', fontSize: '0.9em' }}>
          {success}
        </div>
      )}

      {/* COMPTABLE */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: '1em', fontWeight: 700, color: '#9C8E7D', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 14px 0' }}>
          Comptable
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <ExportCard
            titre="Rapprochement bancaire"
            description="Mouvements bancaires + ventilation — audit mensuel complet"
            loading={loading.rapprochement}
            onClick={() => telechargerCSV('rapprochement', `DCB_Rapprochement_{mois}.csv`, exportRapprochementBancaire)}
          />
          <ExportCard
            titre="AUTO & Débours"
            description="Détail provision/réel + prestations extras + frais propriétaire"
            loading={loading.auto}
            onClick={() => telechargerCSV('auto', `DCB_AUTO_Debours_{mois}.csv`, exportAutoDebours)}
          />
          <ExportCard
            titre="Factures Evoliz"
            description="Honoraires + débours — statuts et montants"
            loading={loading.factures}
            onClick={() => telechargerCSV('factures', `DCB_Factures_Evoliz_{mois}.csv`, exportFacturesEvoliz)}
          />
          <ExportCard
            titre="Comptabilité mensuelle"
            description="Vue agrégée par bien — HON/FMEN/AUTO/LOY/VIR/TAXE/COM + alertes"
            loading={loading.compta}
            onClick={telechargerCompta}
          />
        </div>

        <div style={{ marginTop: 14 }}>
          {!showEmailForm ? (
            <button className="btn btn-primary" onClick={() => setShowEmailForm(true)} style={{ width: '100%' }}>
              Envoyer au comptable par email
            </button>
          ) : (
            <div style={{ padding: 16, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8 }}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 4, fontSize: '0.85em', fontWeight: 600 }}>Destinataire *</label>
                <input type="email" value={emailDest} onChange={e => setEmailDest(e.target.value)}
                  placeholder="comptable@cabinet.fr"
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, boxSizing: 'border-box' }} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 4, fontSize: '0.85em', fontWeight: 600 }}>CC (optionnel)</label>
                <input type="email" value={emailCC} onChange={e => setEmailCC(e.target.value)}
                  placeholder="assistante@cabinet.fr"
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, boxSizing: 'border-box' }} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85em', fontWeight: 600 }}>Exports à joindre</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[
                    { key: 'rapprochement', label: 'Rapprochement bancaire' },
                    { key: 'auto', label: 'AUTO & Débours' },
                    { key: 'factures', label: 'Factures Evoliz' },
                    { key: 'compta', label: 'Comptabilité mensuelle' }
                  ].map(({ key, label }) => (
                    <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.9em' }}>
                      <input type="checkbox" checked={emailExports[key]}
                        onChange={e => setEmailExports(prev => ({ ...prev, [key]: e.target.checked }))} />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 4, fontSize: '0.85em', fontWeight: 600 }}>Message (optionnel)</label>
                <textarea value={emailMessage} onChange={e => setEmailMessage(e.target.value)}
                  placeholder="Bonjour,&#10;Vous trouverez ci-joint..."
                  rows={4}
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={envoyerEmail} disabled={sendingEmail} style={{ flex: 1 }}>
                  {sendingEmail ? 'Envoi...' : 'Envoyer'}
                </button>
                <button className="btn btn-secondary" onClick={() => setShowEmailForm(false)} disabled={sendingEmail}>
                  Annuler
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* GESTION INTERNE */}
      <section>
        <h2 style={{ fontSize: '1em', fontWeight: 700, color: '#9C8E7D', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 14px 0' }}>
          Gestion interne
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <ExportCard
            titre="Réservations détaillées"
            description="Toutes les resas + ventilation — vue opérationnelle"
            loading={loading.resas}
            onClick={() => telechargerCSV('resas', `DCB_Reservations_{mois}.csv`, exportReservationsDetaillees)}
          />
          <ExportCard
            titre="Débours & Prestations"
            description="Prestations hors forfait + frais propriétaire (2 onglets)"
            loading={loading.debours}
            onClick={telechargerXLSX}
            format="XLSX"
          />
        </div>
      </section>
    </div>
  )
}

function ExportCard({ titre, description, loading, onClick, format = 'CSV' }) {
  return (
    <div style={{
      padding: '14px 16px',
      background: 'var(--bg-card, white)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 16
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: '0.92em', color: 'var(--text)', marginBottom: 3 }}>{titre}</div>
        <div style={{ fontSize: '0.82em', color: '#9C8E7D' }}>{description}</div>
      </div>
      <button className="btn btn-secondary" onClick={onClick} disabled={loading} style={{ minWidth: 120, fontSize: '0.85em' }}>
        {loading ? 'Génération...' : `Télécharger ${format}`}
      </button>
    </div>
  )
}
