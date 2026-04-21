import { supabase } from '../lib/supabase'
import { AGENCE } from '../lib/agence'
import { exportRapprochementBancaire } from './exportRapprochementBancaire'
import { exportAutoDebours } from './exportAutoDebours'
import { exportFacturesEvoliz } from './exportFacturesEvoliz'
import { buildComptaMensuelle, exportComptaCSV } from './buildComptaMensuelle'

const AGENCE_LABELS = {
  dcb:     { nom: 'Destination Côte Basque', prefix: 'DCB',    brand: '#CC9933' },
  lauian:  { nom: 'Lauian Immo',             prefix: 'LAUIAN', brand: '#6B7A2E' },
  bordeaux:{ nom: 'Destination Bordeaux',    prefix: 'DBX',    brand: '#8B3A3A' },
}
const agenceInfo = AGENCE_LABELS[AGENCE] || AGENCE_LABELS.dcb

function encodeBase64UTF8(str) {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 3072) {
    binary += String.fromCharCode(...bytes.slice(i, i + 3072))
  }
  return btoa(binary)
}

async function blobToBase64(blob) {
  const ab = await blob.arrayBuffer()
  const u8 = new Uint8Array(ab)
  let b64 = ''
  for (let i = 0; i < u8.length; i += 3072) b64 += btoa(String.fromCharCode(...u8.slice(i, i + 3072)))
  return b64
}

function achatsToCSV(factures) {
  const header = 'Date;Fournisseur;Montant TTC;Montant HT;TVA;Catégorie;Type paiement;Numéro facture;Statut;Notes'
  const rows = factures.map(f => [
    f.date_facture || '',
    f.fournisseur,
    f.montant_ttc?.toString().replace('.', ',') || '',
    f.montant_ht?.toString().replace('.', ',') || '',
    f.tva?.toString().replace('.', ',') || '',
    f.categorie || '',
    f.type_paiement || '',
    f.numero_facture || '',
    f.statut || '',
    (f.notes || '').replace(/;/g, ','),
  ].join(';'))
  return [header, ...rows].join('\n')
}

export async function envoyerExportsComptable(mois, destinataire, cc, exports, message) {
  const { prefix } = agenceInfo
  const attachments = []

  if (exports.includes('rapprochement')) {
    const csv = await exportRapprochementBancaire(mois)
    attachments.push({ filename: `${prefix}_Rapprochement_${mois}.csv`, content: encodeBase64UTF8(csv) })
  }

  if (exports.includes('auto')) {
    const csv = await exportAutoDebours(mois)
    attachments.push({ filename: `${prefix}_AUTO_Debours_${mois}.csv`, content: encodeBase64UTF8(csv) })
  }

  if (exports.includes('factures')) {
    const csv = await exportFacturesEvoliz(mois)
    attachments.push({ filename: `${prefix}_Factures_Evoliz_${mois}.csv`, content: encodeBase64UTF8(csv) })
  }

  if (exports.includes('compta')) {
    const data = await buildComptaMensuelle(mois)
    const csv = exportComptaCSV(data)
    attachments.push({ filename: `${prefix}_Comptabilite_${mois}.csv`, content: encodeBase64UTF8(csv) })
  }

  if (exports.includes('achats')) {
    const { data: factures, error } = await supabase
      .from('facture_achat')
      .select('*')
      .eq('agence', AGENCE)
      .eq('mois', mois)
      .order('date_facture', { ascending: true })
    if (error) throw new Error('Achats : ' + error.message)
    const csv = achatsToCSV(factures || [])
    attachments.push({ filename: `${prefix}_Achats_${mois}.csv`, content: encodeBase64UTF8(csv) })
  }

  if (exports.includes('bilan_lld')) {
    const path = `bilans/${AGENCE}-${mois}.pdf`
    const { data: blob, error } = await supabase.storage.from('bilans').download(path)
    if (error) throw new Error(`Bilan LLD introuvable (${path}) — générez-le d'abord depuis la page Étudiants`)
    const b64 = await blobToBase64(blob)
    attachments.push({ filename: `${prefix}_Bilan_LLD_${mois}.pdf`, content: b64, content_type: 'application/pdf' })
  }

  const moisLabel = new Date(mois + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
  const moisLabelCap = moisLabel.charAt(0).toUpperCase() + moisLabel.slice(1)
  const { nom: agenceNom, brand: agenceBrand } = agenceInfo

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: ${agenceBrand}; color: white; padding: 20px; text-align: center;">
        <h1 style="margin: 0; font-size: 24px;">${agenceNom.toUpperCase()}</h1>
        <p style="margin: 8px 0 0 0; font-size: 14px; opacity: 0.9;">Exports comptables · ${moisLabelCap}</p>
      </div>
      <div style="padding: 24px; background: #F7F3EC;">
        <p style="margin: 0 0 16px 0; color: #2C2416;">Bonjour,</p>
        ${message ? `<p style="margin: 0 0 16px 0; color: #2C2416; white-space: pre-line;">${message}</p>` : ''}
        <p style="margin: 0 0 16px 0; color: #2C2416;">Vous trouverez ci-joint les exports comptables du mois de ${moisLabelCap} :</p>
        <ul style="color: #2C2416; line-height: 1.6;">
          ${exports.includes('rapprochement') ? '<li>Rapprochement bancaire</li>' : ''}
          ${exports.includes('auto')          ? '<li>AUTO &amp; D&eacute;bours</li>' : ''}
          ${exports.includes('factures')      ? '<li>Factures Evoliz</li>' : ''}
          ${exports.includes('compta')        ? '<li>Comptabilit&eacute; mensuelle</li>' : ''}
          ${exports.includes('achats')        ? '<li>Factures d\'achat</li>' : ''}
          ${exports.includes('bilan_lld')     ? '<li>Bilan &eacute;tudiants (LLD)</li>' : ''}
        </ul>
        <p style="margin: 16px 0 0 0; color: #2C2416;">Cordialement,<br/>L'&eacute;quipe ${agenceNom}</p>
      </div>
      <div style="padding: 16px; text-align: center; font-size: 12px; color: #6B5843;">
        <p style="margin: 0;">${agenceNom}</p>
      </div>
    </div>
  `

  const { data, error: sendError } = await supabase.functions.invoke('smtp-send', {
    body: {
      to: destinataire,
      cc: cc || undefined,
      subject: `[${prefix}] Exports comptables ${moisLabelCap}`,
      html: htmlBody,
      attachments: attachments.map(a => ({
        filename: a.filename,
        content: a.content,
        ...(a.content_type ? { content_type: a.content_type } : {}),
      }))
    }
  })

  if (sendError) throw new Error(sendError.message)
  if (!data?.ok) throw new Error(data?.error || 'Erreur envoi email')

  return data
}
