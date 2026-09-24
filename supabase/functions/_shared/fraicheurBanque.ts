/**
 * Fraîcheur des relevés bancaires — partagé par alerte-fraicheur-banque (alerte quotidienne) et
 * les relances (relance-facture-impayee, relance-debours), audit I-152/I-153.
 *
 * Tant qu'un compte n'est plus alimenté, un paiement reçu n'est jamais rapproché : relancer à ce
 * moment-là, c'est relancer des propriétaires qui ont payé (408P, 506P, B16, PATXI relancés du
 * 13 au 17/09/2026 pendant la panne du flux compte courant, dernière opération le 10/07).
 */
// deno-lint-ignore no-explicit-any
type Supa = any

export type CompteSuivi = { source: string; agence: string; label: string; jours: number; action: string }

// Seuil en jours calendaires (week-end compris : 4 j absorbe un pont).
export const COMPTES_SUIVIS: CompteSuivi[] = [
  { source: 'Pennylane_LOCATION_SAISONNIERE', agence: 'dcb',    label: 'Séquestre location saisonnière (Pennylane)', jours: 4,
    action: 'Pennylane → Banque → CAISSE EPARGNE LOCATIONS SAISONNIERES : reconnecter la banque si la synchronisation est interrompue.' },
  { source: 'Powens_courant',                agence: 'dcb',    label: 'Compte courant DCB (Pennylane)',            jours: 5,
    action: 'Pennylane → Banque → CAISSE EPARGNE COURANT : reconnecter la banque (consentement DSP2 expiré, à renouveler tous les 180 jours).' },
  { source: 'CaisseEpargne',                 agence: 'lauian', label: 'Lauïan — Caisse d\'Épargne (import CSV manuel)', jours: 10,
    action: 'dcb-compta Lauïan → Banque : importer le dernier relevé CSV Caisse d\'Épargne.' },
]

function joursDepuis(iso: string) {
  return Math.floor((Date.now() - new Date(iso + 'T12:00:00Z').getTime()) / 86400000)
}

/** État d'un compte suivi : dernière opération importée, âge en jours, muet ou non. */
export async function etatCompte(supabase: Supa, c: CompteSuivi) {
  const { data, error } = await supabase.from('mouvement_bancaire')
    .select('date_operation').eq('source', c.source).eq('agence', c.agence)
    .order('date_operation', { ascending: false }).limit(1)
  if (error) throw new Error(error.message)
  const derniere: string | null = data?.[0]?.date_operation ?? null
  const age = derniere ? joursDepuis(derniere) : null
  return { ...c, derniere, age, muet: age == null || age > c.jours }
}

/** Compte sur lequel arrivent les paiements d'un type de facture, par agence. */
export function compteDesPaiements(agence: string, typeFacture: 'honoraires' | 'debours'): CompteSuivi | null {
  // Honoraires : compte courant de l'agence. Débours : séquestre (DCB) ; Lauïan n'a qu'un compte suivi.
  const source = agence === 'lauian' ? 'CaisseEpargne'
    : typeFacture === 'honoraires' ? 'Powens_courant' : 'Pennylane_LOCATION_SAISONNIERE'
  return COMPTES_SUIVIS.find(c => c.source === source && c.agence === agence) ?? null
}
