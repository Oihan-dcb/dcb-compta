-- Migration 261 : un ajustement Hospitable qualifié APRÈS génération de la facture du mois est lui
-- aussi tracé dans reservation_changement_post_facture (I-145, 24/09/2026).
--
-- Le trigger de la migration 260 ne voit que fin_revenue / final_status. Or qualifier un ajustement
-- (api/qualifier-ajustement.js) ne touche ni l'un ni l'autre : il change seulement la base de
-- commission (hébergement) ou le FMEN (ménage). Cas réels : GASQ/HOST-GAWGVI (-590€ qualifié le
-- 06/09 à 13h18, facture d'août poussée à Evoliz vers 13h00) et MARNEKO/HMCHKSQZTH (-395€, qualifié
-- 10/09 12h43, facture générée 13h08 sur une ventilation jamais recalculée) — HON surfacturé dans
-- les deux cas, sans aucune trace.

ALTER TABLE public.reservation_changement_post_facture ADD COLUMN IF NOT EXISTS motif text;
COMMENT ON COLUMN public.reservation_changement_post_facture.motif IS
  'NULL = changement fin_revenue/final_status (trigger reservation) ; sinon ex. "ajustement hebergement -590,00 €" (trigger reservation_ajustement).';

CREATE OR REPLACE FUNCTION public.trace_ajustement_post_facture()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resa    record;
  v_bien    record;
  v_facture record;
BEGIN
  SELECT id, bien_id, mois_comptable, fin_revenue, final_status INTO v_resa FROM reservation WHERE id = NEW.reservation_id;
  IF v_resa.id IS NULL OR v_resa.mois_comptable IS NULL THEN RETURN NEW; END IF;
  SELECT id, proprietaire_id, agence INTO v_bien FROM bien WHERE id = v_resa.bien_id;
  IF v_bien.proprietaire_id IS NULL THEN RETURN NEW; END IF;

  SELECT id, statut INTO v_facture
  FROM facture_evoliz
  WHERE proprietaire_id = v_bien.proprietaire_id
    AND mois = v_resa.mois_comptable
    AND type_facture = 'honoraires'
    AND statut <> 'calcul_en_cours'
  ORDER BY (bien_id = v_resa.bien_id) DESC NULLS LAST, updated_at DESC
  LIMIT 1;
  IF v_facture.id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO reservation_changement_post_facture (
    reservation_id, bien_id, proprietaire_id, agence, mois_comptable, facture_id, facture_statut,
    ancien_fin_revenue, nouveau_fin_revenue, ancien_statut, nouveau_statut, motif
  ) VALUES (
    v_resa.id, v_resa.bien_id, v_bien.proprietaire_id, v_bien.agence, v_resa.mois_comptable, v_facture.id, v_facture.statut,
    v_resa.fin_revenue, v_resa.fin_revenue, v_resa.final_status, v_resa.final_status,
    'ajustement ' || coalesce(NEW.type, '?') || ' ' || to_char(coalesce(NEW.montant, 0) / 100.0, 'FM999G990D00') || ' €'
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trace_ajustement_post_facture: %', SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trace_ajustement_post_facture() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_trace_ajustement_post_facture ON public.reservation_ajustement;
CREATE TRIGGER trg_trace_ajustement_post_facture
  AFTER UPDATE OF statut, type, montant_fmen ON public.reservation_ajustement
  FOR EACH ROW
  WHEN (NEW.statut = 'traite' AND (OLD.statut IS DISTINCT FROM NEW.statut OR OLD.type IS DISTINCT FROM NEW.type OR OLD.montant_fmen IS DISTINCT FROM NEW.montant_fmen))
  EXECUTE FUNCTION public.trace_ajustement_post_facture();
