// api/_cronGuard.js — crons "?agence=…" exécutés par le seul projet dcb-compta.
//
// dcb-compta et lauian-compta sont deux projets Vercel branchés sur le même repo : ils
// déploient le même vercel.json. Les crons dont le chemin porte déjà l'agence
// (sync-proprietaires, sync-biens, sync-reservations : "?agence=dcb" ET "?agence=lauian")
// tournaient donc DEUX fois chacun, en parallèle (import_log : paires d'entrées à ~25s d'écart,
// audit 24/09/2026) — charge Hospitable/Evoliz doublée, écritures concurrentes.
//
// Ne concerne PAS les crons qui traitent l'agence du projet (matching-auto, sync-stripe : chaque
// projet traite la sienne, ce n'est pas un doublon) ni ceux qui ont déjà leur propre garde
// (sync-payouts, pennylane-*). Même convention que sync-payouts : VITE_AGENCE du projet.
// Les appels manuels (UI) ne sont jamais bloqués — seulement le planificateur Vercel.

export function isVercelCron(req) {
  return /vercel-cron/i.test(req.headers?.['user-agent'] || '')
}

export function skipDuplicateCron(req, res) {
  if (!isVercelCron(req)) return false
  const agenceProjet = process.env.VITE_AGENCE || 'dcb'
  if (agenceProjet === 'dcb') return false
  res.status(200).json({ ok: true, skipped: 'cron ?agence= exécuté par le projet dcb-compta (couvre les 2 agences)', agence_projet: agenceProjet })
  return true
}
