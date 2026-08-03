-- Étend `reversement_fait` (déjà existant — case "Fait" de la matrice de contrôle,
-- PageComptabilite.jsx) pour couvrir le cas des propriétaires à réservation unique
-- dont Laura a déjà reversé le VIRProprio à la main (hors circuit bancaire DCB,
-- ex: Lauian). Avant, la case ne captait qu'un booléen + horodatage, aucune trace
-- du montant réel ni du contexte (acompte/solde, ménage réglé au black, etc.).
--
-- Rappel terminologie (docs/domain-rules.md §17) : ceci concerne VIRProprio
-- (montant calculé, ventilation.code='VIR') — PAS VIRPayinProuvé (rapprochement
-- du payout plateforme entrant, mouvement_bancaire). Toujours purement déclaratif :
-- ne déclenche ni ne bloque la génération des factures Evoliz (HON/FMEN/management
-- fee), qui reste indépendante (cf. genererFacturesMois).

ALTER TABLE public.reversement_fait
  ADD COLUMN IF NOT EXISTS montant_reverse_cts integer,
  ADD COLUMN IF NOT EXISTS note text;

COMMENT ON TABLE public.reversement_fait IS
  'Marque qu''un VIRProprio (montant calculé, ventilation.code=''VIR'') a été effectivement payé au propriétaire pour ce bien/mois. Purement déclaratif — ne déclenche/ne bloque rien ailleurs (ventilation, facturation Evoliz, rapprochement bancaire restent indépendants). Distinct de VIRPayinProuvé (rapprochement du payout plateforme entrant sur le compte DCB, cf. mouvement_bancaire) — voir docs/domain-rules.md §17.';

COMMENT ON COLUMN public.reversement_fait.montant_reverse_cts IS
  'Montant net (centimes) du VIRProprio effectivement reversé, quand le virement a été fait manuellement hors circuit DCB (ex: Laura pour Lauian, propriétaire à réservation unique sans rapport mensuel). Peut différer légèrement du reversement_calcule affiché (ex: ajustements ménage/taxe de séjour). Optionnel — laissé null pour les cases "Fait" cochées avant cet ajout.';

COMMENT ON COLUMN public.reversement_fait.note IS
  'Note libre associée au reversement manuel (ex: détail acompte+solde, particularités ménage/forfait).';
