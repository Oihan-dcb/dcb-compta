-- Migration 281 : montant dû au propriétaire tel qu'il figure sur son relevé mensuel, pour les mois
-- sans facture d'honoraires dans l'app (janvier-avril 2026 : factures faites à la main dans Evoliz,
-- relevés Hospitable « Total due to owner » dans iCloud 03 RAPPORTS). Le justificatif séquestre
-- l'utilise en priorité sur le recalcul live (qui s'écartait de quelques euros : séjours proprio,
-- régularisations saisies à la main…). 25/09/2026.
CREATE TABLE IF NOT EXISTS public.sequestre_releve_proprio (
  agence      text NOT NULL,
  mois        text NOT NULL,
  bien_id     uuid NOT NULL REFERENCES public.bien(id),
  montant     integer NOT NULL,   -- centimes, « Total due to owner » (négatif = dû par le propriétaire)
  source      text NOT NULL,      -- fichier du relevé
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agence, mois, bien_id)
);
ALTER TABLE public.sequestre_releve_proprio ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_all_sequestre_releve_proprio ON public.sequestre_releve_proprio;
CREATE POLICY staff_all_sequestre_releve_proprio ON public.sequestre_releve_proprio FOR ALL TO authenticated
  USING (public.auth_user_is_staff()) WITH CHECK (public.auth_user_is_staff());
