-- Migration 266 : mémoriser la composition de chaque fichier SCT (virements propriétaires) généré
-- (audit segment Banque, 24/09/2026 — I-152).
--
-- Un fichier SCT transmis à la banque est débité en UNE seule ligne (« REM VIR SEPA DU jj/mm/aa »,
-- ex. 99 638,65 € le 07/09/2026) : impossible, depuis le relevé seul, de savoir quels propriétaires
-- y figuraient. verify-virements-sortants laissait donc tous les propriétaires payés par fichier
-- « non liés » (RICHOU/ONTZI 15 904,41 € compris), ce qui rendait le contrôle inutilisable.
-- Désormais PageExports enregistre, à chaque génération, la liste (facture, montant) du fichier ;
-- verify-virements-sortants rapproche la remise bancaire du fichier de même total.

CREATE TABLE IF NOT EXISTS public.sct_export (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agence      text        NOT NULL,
  mois        text        NOT NULL,          -- mois comptable des factures (YYYY-MM)
  type_export text        NOT NULL,          -- 'proprios_lc' (séquestre location saisonnière)
  msg_id      text,                          -- MsgId du fichier pain.001
  total_cts   integer     NOT NULL,
  nb          integer     NOT NULL,
  lignes      jsonb       NOT NULL,          -- [{cle: facture_evoliz.id, montant_cts, nom}]
  cree_par    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sct_export_agence_created_idx ON public.sct_export (agence, created_at);

ALTER TABLE public.sct_export ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sct_export_staff ON public.sct_export;
CREATE POLICY sct_export_staff ON public.sct_export FOR ALL TO authenticated
  USING (public.auth_user_is_staff()) WITH CHECK (public.auth_user_is_staff());

COMMENT ON TABLE public.sct_export IS
  'Composition des fichiers SCT propriétaires générés (PageExports). Permet à verify-virements-sortants de rapprocher une remise bancaire groupée (« REM VIR SEPA ») des factures qu''elle règle.';
