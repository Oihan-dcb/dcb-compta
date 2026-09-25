-- Migration 277 : réaffectation manuelle d'un mouvement du séquestre (I-161, 25/09/2026)
-- Le classement automatique (sequestreCore.classerSortie/classerEntree) se base sur les libellés.
-- Quand le libellé ment (COM juillet viré deux fois le 06/08 : « COM WEB - JUILLET » +
-- « COMMISIONS DIRECTES - JUILLET », 2 × 7 559,19 €), on réaffecte le mouvement ici au lieu de
-- modifier la banque : type / sous-type / mois forcés, avec la raison. Lu par justifierSequestre.
CREATE TABLE IF NOT EXISTS public.sequestre_affectation (
  mouvement_id uuid PRIMARY KEY REFERENCES public.mouvement_bancaire(id) ON DELETE CASCADE,
  type         text NOT NULL,          -- type de classerSortie / classerEntree (ex. transfert_dcb, retour_dcb)
  sous         text,                   -- hon | fmen | com pour transfert_dcb / retour_dcb
  mois         text,                   -- 'YYYY-MM' imputé
  note         text NOT NULL,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sequestre_affectation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_all_sequestre_affectation ON public.sequestre_affectation;
CREATE POLICY staff_all_sequestre_affectation ON public.sequestre_affectation FOR ALL TO authenticated
  USING (public.auth_user_is_staff()) WITH CHECK (public.auth_user_is_staff());

-- COM juillet viré deux fois : le 2e virement est une avance sur la COM d'août
INSERT INTO public.sequestre_affectation (mouvement_id, type, sous, mois, note, created_by) VALUES
  ('fc9bcd80-7c99-4a7c-aee9-01a51d18ee60', 'transfert_dcb', 'com', '2026-08',
   'COM juillet virée deux fois le 06/08 (COM WEB + COMMISIONS DIRECTES, 7 559,19 € chacun) : le 2e vaut avance sur la COM d''août', 'claude')
ON CONFLICT (mouvement_id) DO NOTHING;
