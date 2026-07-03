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
