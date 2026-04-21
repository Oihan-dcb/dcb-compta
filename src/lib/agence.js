/**
 * Agence active — source de vérité multi-tenant
 *
 * Lit VITE_AGENCE depuis les variables d'environnement.
 * Chaque déploiement (DCB, Lauian, Bordeaux) a sa propre valeur.
 *
 * Valeurs attendues : 'dcb' | 'lauian' | 'bordeaux'
 * Fallback : 'dcb' pour la rétrocompatibilité
 */
export const AGENCE = import.meta.env.VITE_AGENCE || 'dcb'
