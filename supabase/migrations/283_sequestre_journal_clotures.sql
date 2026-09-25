-- Migration 283 : suivi en temps réel et clôtures du séquestre (25/09/2026, demande Oïhan).
--
-- · sequestre_journal : trace de tout ce qui fait bouger le justificatif — calcul de nuit (écart, variation),
--   anomalies apparues / résolues, affectations et alias posés à la main, clôtures et réouvertures,
--   dérive d'un mois déjà clôturé. Alimenté par le cron (api/sequestre-justificatif), par la page
--   Séquestre et par les triggers ci-dessous.
-- · sequestre_cloture_mensuelle (migration 278) : complétée pour stocker la photo figée du mois
--   (poches, dû/payé par ayant droit, écart) ; verrouille = mois clôturé.
-- · sequestre_exercice : exercices comptables du séquestre (DCB au 31/12, Lauïan au 30/09) — clôture =
--   photo figée à la date de fin + ouverture de l'exercice suivant.
-- · Verrou : une affectation manuelle sur un mouvement d'un mois clôturé est refusée (rouvrir d'abord).

CREATE TABLE IF NOT EXISTS public.sequestre_journal (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agence     text NOT NULL,
  cree_le    timestamptz NOT NULL DEFAULT now(),
  type       text NOT NULL,   -- calcul | variation_ecart | anomalie_nouvelle | anomalie_resolue | affectation | alias |
                              -- cloture_mois | reouverture_mois | cloture_exercice | derive_mois_cloture | note
  mois       text,            -- mois concerné (YYYY-MM) si applicable
  montant    integer,         -- centimes (écart, variation, montant du mouvement…)
  message    text NOT NULL,
  detail     jsonb,
  auteur     text             -- email staff, 'cron' ou 'trigger'
);
CREATE INDEX IF NOT EXISTS sequestre_journal_agence_idx ON public.sequestre_journal (agence, cree_le DESC);

ALTER TABLE public.sequestre_cloture_mensuelle
  ADD COLUMN IF NOT EXISTS date_arrete     date,
  ADD COLUMN IF NOT EXISTS total_justifie  integer,
  ADD COLUMN IF NOT EXISTS poches          jsonb,
  ADD COLUMN IF NOT EXISTS mois_detail     jsonb,     -- ligne par_mois du justificatif pour ce mois
  ADD COLUMN IF NOT EXISTS note            text;

CREATE TABLE IF NOT EXISTS public.sequestre_exercice (
  agence          text NOT NULL,
  debut           date NOT NULL,
  fin             date NOT NULL,
  statut          text NOT NULL DEFAULT 'ouvert' CHECK (statut IN ('ouvert', 'cloture')),
  solde_ouverture integer,
  solde_cloture   integer,
  ecart_cloture   integer,
  poches_cloture  jsonb,
  cloture_le      timestamptz,
  cloture_par     text,
  note            text,
  PRIMARY KEY (agence, debut)
);
ALTER TABLE public.sequestre_compte ADD COLUMN IF NOT EXISTS exercice_fin_mois integer NOT NULL DEFAULT 12;  -- 12 = 31/12, 9 = 30/09
UPDATE public.sequestre_compte SET exercice_fin_mois = 9 WHERE agence = 'lauian';
INSERT INTO public.sequestre_exercice (agence, debut, fin, statut, solde_ouverture, note) VALUES
 ('dcb', '2026-01-01', '2026-12-31', 'ouvert', 0, 'Nouveau compte Caisse d''Épargne ouvert à 0 le 24/12/2025 ; exercice 2025 (ancien compte Shine …727) clôturé hors app — analyse : Bilan_sequestre_DCB_2025.html'),
 ('lauian', '2025-10-01', '2026-09-30', 'ouvert', 3205235, 'Solde d''ouverture au 30/09/2025 (plaquette cabinet) : Shine 14 210,59 + CE 18 841,76 = 32 052,35 €')
ON CONFLICT (agence, debut) DO NOTHING;

ALTER TABLE public.sequestre_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sequestre_exercice ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_all_sequestre_journal ON public.sequestre_journal;
CREATE POLICY staff_all_sequestre_journal ON public.sequestre_journal FOR ALL TO authenticated USING (public.auth_user_is_staff()) WITH CHECK (public.auth_user_is_staff());
DROP POLICY IF EXISTS staff_all_sequestre_exercice ON public.sequestre_exercice;
CREATE POLICY staff_all_sequestre_exercice ON public.sequestre_exercice FOR ALL TO authenticated USING (public.auth_user_is_staff()) WITH CHECK (public.auth_user_is_staff());

-- Journal des affectations / alias posés à la main + verrou des mois clôturés
CREATE OR REPLACE FUNCTION public.sequestre_affectation_journal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m record; v_agence text; v_mois text;
BEGIN
  SELECT mb.agence, mb.date_operation, coalesce(mb.credit, 0) - coalesce(mb.debit, 0) AS montant, mb.libelle INTO m
    FROM mouvement_bancaire mb WHERE mb.id = NEW.mouvement_id;
  v_agence := coalesce(m.agence, 'dcb');
  v_mois := to_char(m.date_operation, 'YYYY-MM');
  IF EXISTS (SELECT 1 FROM sequestre_cloture_mensuelle c WHERE c.agence = v_agence AND c.verrouille
             AND (c.mois = v_mois OR c.mois = NEW.mois)) THEN
    RAISE EXCEPTION 'Mois % clôturé pour le séquestre % : rouvrir le mois avant de modifier une affectation', coalesce(NEW.mois, v_mois), v_agence;
  END IF;
  INSERT INTO sequestre_journal (agence, type, mois, montant, message, detail, auteur)
  VALUES (v_agence, 'affectation', coalesce(NEW.mois, v_mois), m.montant,
          format('Affectation « %s%s » : %s du %s', NEW.type, coalesce(':' || NEW.sous, ''), left(coalesce(m.libelle, ''), 80), to_char(m.date_operation, 'DD/MM/YYYY')),
          jsonb_build_object('mouvement_id', NEW.mouvement_id, 'type', NEW.type, 'sous', NEW.sous, 'tiers_id', NEW.tiers_id, 'note', NEW.note),
          coalesce(NEW.created_by, 'trigger'));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sequestre_affectation_journal ON public.sequestre_affectation;
CREATE TRIGGER trg_sequestre_affectation_journal BEFORE INSERT OR UPDATE ON public.sequestre_affectation
  FOR EACH ROW EXECUTE FUNCTION public.sequestre_affectation_journal();

CREATE OR REPLACE FUNCTION public.sequestre_alias_journal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO sequestre_journal (agence, type, message, detail, auteur)
  VALUES (NEW.agence, 'alias', format('Libellé mémorisé : « %s » → %s%s (%s)', NEW.motif, NEW.type, coalesce(':' || NEW.sous, ''), NEW.sens),
          jsonb_build_object('motif', NEW.motif, 'type', NEW.type, 'sous', NEW.sous, 'tiers_id', NEW.tiers_id), coalesce(NEW.cree_par, 'trigger'));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sequestre_alias_journal ON public.sequestre_alias;
CREATE TRIGGER trg_sequestre_alias_journal AFTER INSERT OR UPDATE ON public.sequestre_alias
  FOR EACH ROW EXECUTE FUNCTION public.sequestre_alias_journal();
