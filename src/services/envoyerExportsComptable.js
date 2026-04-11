import { supabase } from '../lib/supabase'
import { exportRapprochementBancaire } from './exportRapprochementBancaire'
import { exportAutoDebours } from './exportAutoDebours'
import { exportFacturesEvoliz } from './exportFacturesEvoliz'
import { buildComptaMensuelle, exportComptaCSV } from './buildComptaMensuelle'

/**
 * Encode une chaîne UTF-8 en base64 sans btoa() natif (supporte les accents)
 */
function encodeBase64UTF8(str) {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 3072) {
    binary += String.fromCharCode(...bytes.slice(i, i + 3072))
  }
  return btoa(binary)
}

/**
 * Envoie les exports sélectionnés au comptable par email
 * @param {string} mois         - Format YYYY-MM
 * @param {string} destinataire - Email principal
 * @param {string} cc           - Email CC optionnel
 * @param {Array<string>} exports - Codes : ['rapprochement', 'auto', 'factures', 'compta']
 * @param {string} message      - Message personnalisé optionnel
 */
export async function envoyerExportsComptable(mois, destinataire, cc, exports, message) {
  const attachments = []

  if (exports.includes('rapprochement')) {
    const csv = await exportRapprochementBancaire(mois)
    attachments.push({ filename: `DCB_Rapprochement_${mois}.csv`, content: csv })
  }

  if (exports.includes('auto')) {
    const csv = await exportAutoDebours(mois)
    attachments.push({ filename: `DCB_AUTO_Debours_${mois}.csv`, content: csv })
  }

  if (exports.includes('factures')) {
    const csv = await exportFacturesEvoliz(mois)
    attachments.push({ filename: `DCB_Factures_Evoliz_${mois}.csv`, content: csv })
  }

  if (exports.includes('compta')) {
    const data = await buildComptaMensuelle(mois)
    const csv = exportComptaCSV(data)
    attachments.push({ filename: `DCB_Comptabilite_${mois}.csv`, content: csv })
  }

  const moisLabel = new Date(mois + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
  const moisLabelCap = moisLabel.charAt(0).toUpperCase() + moisLabel.slice(1)

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #CC9933; color: white; padding: 20px; text-align: center;">
        <h1 style="margin: 0; font-size: 24px;">DESTINATION COTE BASQUE</h1>
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
        </ul>
        <p style="margin: 16px 0 0 0; color: #2C2416;">Cordialement,<br/>L'&eacute;quipe DCB</p>
      </div>
      <div style="padding: 16px; text-align: center; font-size: 12px; color: #6B5843;">
        <p style="margin: 0;">Destination C&ocirc;te Basque</p>
      </div>
    </div>
  `

  const { data, error } = await supabase.functions.invoke('smtp-send', {
    body: {
      to: destinataire,
      cc: cc || undefined,
      subject: `[DCB] Exports comptables ${moisLabelCap}`,
      html: htmlBody,
      attachments: attachments.map(a => ({
        filename: a.filename,
        content: encodeBase64UTF8(a.content)
      }))
    }
  })

  if (error) throw new Error(error.message)
  if (!data?.ok) throw new Error(data?.error || 'Erreur envoi email')

  return data
}
