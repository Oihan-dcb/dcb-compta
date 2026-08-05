-- Nouveau besoin (distinct de `reversement_fait`, migr. 126/237) : certains propriétaires
-- ayant plusieurs réservations dans le mois demandent leur part dès qu'UNE résa encaisse,
-- avant la clôture mensuelle. `reversement_fait` est verrouillé à 1 ligne par (bien_id, mois,
-- agence) — il sert au cas "tout le mois a été réglé d'un coup" (souvent bien à résa unique).
-- Ici il faut pouvoir enregistrer un virement anticipé PAR RÉSA (une résa = un virement,
-- ex: acompte reçu -> viré aussitôt au propriétaire), plusieurs par bien/mois.
--
-- Pattern repris de `reservation_ajustement` (migr. 222) : table fille par résa, bien_id et
-- mois_comptable dénormalisés pour l'agrégation en Vue mensuelle sans jointure.
--
-- Rappel terminologie (docs/domain-rules.md §17) : ceci concerne VIRProprio (montant
-- calculé, ventilation.code='VIR'), viré en avance sur UNE résa précise. Purement déclaratif,
-- comme `reversement_fait` : ne déclenche/ne bloque ni ventilation, ni facturation Evoliz,
-- ni rapprochement bancaire (le virement, hors circuit bancaire DCB entrant, n'a pas de
-- `mouvement_bancaire` associé — à ne pas confondre avec VIRPayinProuvé).

CREATE TABLE IF NOT EXISTS public.reversement_resa (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid        NOT NULL REFERENCES public.reservation(id) ON DELETE CASCADE,
  bien_id        uuid        NOT NULL REFERENCES public.bien(id) ON DELETE CASCADE,
  mois_comptable text        NOT NULL, -- YYYY-MM, dénormalisé depuis reservation.mois_comptable
  montant_cts    integer     NOT NULL CHECK (montant_cts > 0),
  date_virement  date        NOT NULL,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reservation_id)
);

CREATE INDEX IF NOT EXISTS reversement_resa_bien_mois_idx ON public.reversement_resa (bien_id, mois_comptable);

ALTER TABLE public.reversement_resa ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reversement_resa_open" ON public.reversement_resa FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE public.reversement_resa IS
  'Virement propriétaire anticipé, enregistré au niveau d''UNE réservation précise (avant la clôture mensuelle du bien) — ex: propriétaire multi-résa qui veut sa part dès qu''une résa encaisse. Distinct de `reversement_fait` (case "Fait" bien+mois, pour un règlement global du mois). Purement déclaratif — ne déclenche/ne bloque rien (ventilation, facturation Evoliz, rapprochement bancaire restent indépendants). Un seul virement par réservation (UNIQUE reservation_id) — pour un acompte + solde sur la même résa, utiliser la note et mettre à jour le montant total lors du solde.';

COMMENT ON COLUMN public.reversement_resa.montant_cts IS
  'Montant net (centimes) effectivement viré au propriétaire pour cette résa, hors circuit bancaire DCB.';

COMMENT ON COLUMN public.reversement_resa.date_virement IS
  'Date réelle du virement bancaire (saisie manuelle) — distincte de created_at (horodatage de la saisie dans l''app, peut être postérieure).';
