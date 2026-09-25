-- Migration 276 : justificatif quotidien du séquestre location saisonnière (I-161, 25/09/2026)
-- « On doit être capable à tout moment de justifier chaque euro du séquestre. » Une photo par jour
-- (api/sequestre-justificatif, 05:20) : solde bancaire réel (Pennylane), poches (propriétaires,
-- DCB, AE, mois non facturés…), détail par mois et écart. L'historique permet de voir quand un
-- écart apparaît (virement en double, encaissement manquant…).
CREATE TABLE IF NOT EXISTS public.sequestre_justificatif (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agence         text NOT NULL,
  date           date NOT NULL,
  solde_banque   integer NOT NULL,       -- centimes, solde réel du compte (Pennylane)
  solde_maj      timestamptz,            -- date de synchro du solde chez Pennylane
  total_justifie integer NOT NULL,
  ecart          integer NOT NULL,       -- solde − justifié
  poches         jsonb NOT NULL,
  par_mois       jsonb NOT NULL,
  detail         jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agence, date)
);
ALTER TABLE public.sequestre_justificatif ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_all_sequestre_justificatif ON public.sequestre_justificatif;
CREATE POLICY staff_all_sequestre_justificatif ON public.sequestre_justificatif FOR ALL TO authenticated
  USING (public.auth_user_is_staff()) WITH CHECK (public.auth_user_is_staff());
