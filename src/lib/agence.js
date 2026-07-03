/**
 * Agence active — source de vérité multi-tenant
 *
 * Lit VITE_AGENCE depuis les variables d'environnement.
 * Chaque déploiement (DCB, Lauian, Bordeaux) a sa propre valeur.
 *
 * Isomorphe : côté client (Vite) via import.meta.env, côté serveur (fonctions
 * Vercel — ex. api/matching-auto.js) via process.env (Vercel expose aussi
 * VITE_AGENCE au runtime des fonctions).
 *
 * Valeurs attendues : 'dcb' | 'lauian' | 'bordeaux'
 * Fallback : 'dcb' pour la rétrocompatibilité
 */
const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : process.env
export const AGENCE = env.VITE_AGENCE || 'dcb'

/**
 * Branding par agence pour les documents generes (rapports, statements, mails).
 * Reflete les valeurs de la table `agency_config` (label, resend_from_email).
 */
const BRANDS = {
  dcb: {
    label: 'Destination Côte Basque',
    short: 'DCB',
    email: 'oihan@destinationcotebasque.com',
    tagline: 'Conciergerie de prestige, Biarritz',
  },
  lauian: {
    label: 'Lauian Immo',
    short: 'Lauian',
    email: 'contact@lauianimmo.com',
    tagline: 'Lauian Immo, Biarritz',
  },
  bordeaux: {
    label: 'Destination Bordeaux',
    short: 'Destination Bordeaux',
    email: 'contact@destinationbordeaux.fr',
    tagline: 'Conciergerie de prestige, Bordeaux',
  },
}

export const AGENCE_BRAND = BRANDS[AGENCE] || BRANDS.dcb
