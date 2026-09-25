-- Migration 279 : séquestre multi-agence — solde saisi à la main + alias de libellés par tiers
-- (25/09/2026, retour d'expérience Lauïan : docs/sequestre-lauian-retour-experience.md).
--
-- · Lauïan n'a qu'un relevé CSV importé à la main, sans ligne de solde : le solde bancaire se saisit
--   (date + montant + pièce). S'il est saisi, il prime sur « ouverture + mouvements » et l'écart entre
--   les deux est un contrôle d'import (ligne manquante / doublon).
-- · Les noms bancaires diffèrent des fiches (« EVE DIOR SECK » = AE Eve Vincent, « M OU MME
--   JEAN-JACQUES C » = Cirauqui…) : chaque affectation faite dans la boîte « À affecter » mémorise un
--   alias (motif → ayant droit / tiers), réappliqué automatiquement aux mouvements suivants.

ALTER TABLE public.sequestre_compte
  ADD COLUMN IF NOT EXISTS solde_manuel       integer,
  ADD COLUMN IF NOT EXISTS solde_manuel_date  date,
  ADD COLUMN IF NOT EXISTS solde_manuel_piece text,
  ADD COLUMN IF NOT EXISTS ouverture_piece    text;

UPDATE public.sequestre_compte SET solde_manuel = 6585732, solde_manuel_date = '2026-09-25',
  solde_manuel_piece = 'Relevé Caisse d''Épargne séquestre Lauïan au 25/09/2026 (vérifié au centime, session Lauïan)'
WHERE agence = 'lauian' AND solde_manuel IS NULL;

CREATE TABLE IF NOT EXISTS public.sequestre_alias (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agence      text NOT NULL,
  sens        text NOT NULL CHECK (sens IN ('entree', 'sortie', 'les_deux')),
  motif       text NOT NULL,          -- texte normalisé (minuscules sans accents) contenu dans libellé + détail
  type        text NOT NULL,          -- type de classement (reversement, paiement_ae, transfert_dcb, inter_agence, remboursement_debours…)
  sous        text,                   -- hon | fmen | com pour transfert_dcb
  tiers_type  text,                   -- proprietaire | ae | agence
  tiers_id    uuid,
  note        text,
  cree_par    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agence, sens, motif)
);
ALTER TABLE public.sequestre_alias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_all_sequestre_alias ON public.sequestre_alias;
CREATE POLICY staff_all_sequestre_alias ON public.sequestre_alias FOR ALL TO authenticated
  USING (public.auth_user_is_staff()) WITH CHECK (public.auth_user_is_staff());
