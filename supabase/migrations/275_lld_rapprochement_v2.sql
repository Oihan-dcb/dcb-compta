-- Migration 275 : LLD — rapprochement v2, mémoire des payeurs, cautions reçues, historique protégé
-- (audit segment LLD, 24/09/2026 — I-159). Voir src/services/lldCore.js.

-- 1. Mouvements bancaires LLD : type, loyer affecté, confiance du rapprochement, suggestion
ALTER TABLE public.lld_mouvement_bancaire
  ADD COLUMN IF NOT EXISTS type_mouvement  text,     -- loyer | caution | frais | inconnu
  ADD COLUMN IF NOT EXISTS loyer_suivi_id  uuid REFERENCES public.loyer_suivi(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS match_confiance text,     -- certain | probable | manuel
  ADD COLUMN IF NOT EXISTS match_raison    text,
  ADD COLUMN IF NOT EXISTS suggestion_etudiant_id uuid REFERENCES public.etudiant(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS lld_mvt_loyer_idx ON public.lld_mouvement_bancaire (loyer_suivi_id);

-- 2. Payeurs mémorisés (parents, plateformes, employeur…) : appris quand Laura rattache un
--    virement à la main → reconnu automatiquement les mois suivants.
CREATE TABLE IF NOT EXISTS public.etudiant_payeur (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agence      text NOT NULL,
  etudiant_id uuid NOT NULL REFERENCES public.etudiant(id) ON DELETE CASCADE,
  motif       text NOT NULL,          -- texte normalisé recherché dans le libellé (ex. « simone khazizian »)
  source      text,                   -- manuel | appris
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (etudiant_id, motif)
);
ALTER TABLE public.etudiant_payeur ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_all_etudiant_payeur ON public.etudiant_payeur;
CREATE POLICY staff_all_etudiant_payeur ON public.etudiant_payeur FOR ALL TO authenticated
  USING (public.auth_user_is_staff()) WITH CHECK (public.auth_user_is_staff());

-- 3. Cautions : réception (jusqu'ici seule la restitution était suivie)
ALTER TABLE public.caution_suivi
  ADD COLUMN IF NOT EXISTS montant_recu   integer,
  ADD COLUMN IF NOT EXISTS date_reception date,
  ADD COLUMN IF NOT EXISTS mouvement_id   uuid REFERENCES public.lld_mouvement_bancaire(id) ON DELETE SET NULL;

-- 4. Historique protégé : supprimer un étudiant (portail AE / dcb-compta) effaçait en cascade
--    loyers encaissés, virements propriétaires, cautions et journal. On refuse désormais la
--    suppression de ce qui a une valeur comptable ou légale (l'archivage reste possible).
CREATE OR REPLACE FUNCTION public.lld_garde_historique() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'loyer_suivi' AND (OLD.statut = 'recu' OR OLD.quittance_envoyee_at IS NOT NULL OR COALESCE(OLD.montant_recu, 0) > 0) THEN
    RAISE EXCEPTION 'Loyer % encaissé : suppression interdite (archiver l''étudiant à la place)', OLD.mois;
  ELSIF TG_TABLE_NAME = 'virement_proprio_suivi' AND OLD.statut = 'vire' THEN
    RAISE EXCEPTION 'Virement propriétaire % effectué : suppression interdite', OLD.mois;
  ELSIF TG_TABLE_NAME = 'caution_suivi' AND (OLD.statut = 'rendue' OR COALESCE(OLD.montant_recu, 0) > 0) THEN
    RAISE EXCEPTION 'Caution reçue ou rendue : suppression interdite';
  ELSIF TG_TABLE_NAME = 'lld_log' THEN
    RAISE EXCEPTION 'Journal LLD : suppression interdite';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_lld_garde_historique ON public.loyer_suivi;
CREATE TRIGGER trg_lld_garde_historique BEFORE DELETE ON public.loyer_suivi FOR EACH ROW EXECUTE FUNCTION public.lld_garde_historique();
DROP TRIGGER IF EXISTS trg_lld_garde_historique ON public.virement_proprio_suivi;
CREATE TRIGGER trg_lld_garde_historique BEFORE DELETE ON public.virement_proprio_suivi FOR EACH ROW EXECUTE FUNCTION public.lld_garde_historique();
DROP TRIGGER IF EXISTS trg_lld_garde_historique ON public.caution_suivi;
CREATE TRIGGER trg_lld_garde_historique BEFORE DELETE ON public.caution_suivi FOR EACH ROW EXECUTE FUNCTION public.lld_garde_historique();
DROP TRIGGER IF EXISTS trg_lld_garde_historique ON public.lld_log;
CREATE TRIGGER trg_lld_garde_historique BEFORE DELETE ON public.lld_log FOR EACH ROW EXECUTE FUNCTION public.lld_garde_historique();
