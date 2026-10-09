-- Migration 373 : trace post-facture — un passage annulée ↔ supprimée/expirée sans revenu n'a aucun effet
-- financier (ARREBA : 4 résas « cancelled 0 € → deleted » signalées comme modifiées après facture,
-- audit des alertes 09/10/2026). Seuls comptent : un écart de revenu ≥ 1 €, ou une entrée/sortie de
-- l'état 'accepted'. Même règle que alerte-changement-post-facture (sansEffet).
CREATE OR REPLACE FUNCTION public.trace_changement_post_facture()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bien    record;
  v_facture record;
BEGIN
  IF NEW.mois_comptable IS NULL THEN RETURN NEW; END IF;
  IF abs(coalesce(NEW.fin_revenue, 0) - coalesce(OLD.fin_revenue, 0)) < 100
     AND (famille_statut_resa(OLD.final_status) = famille_statut_resa(NEW.final_status)
          OR (famille_statut_resa(OLD.final_status) <> 'accepted' AND famille_statut_resa(NEW.final_status) <> 'accepted')) THEN
    RETURN NEW;
  END IF;
  IF famille_statut_resa(OLD.final_status) = 'nul' AND famille_statut_resa(NEW.final_status) = 'nul' THEN
    RETURN NEW;
  END IF;

  SELECT id, proprietaire_id, agence INTO v_bien FROM bien WHERE id = NEW.bien_id;
  IF v_bien.proprietaire_id IS NULL THEN RETURN NEW; END IF;

  SELECT id, statut INTO v_facture
  FROM facture_evoliz
  WHERE proprietaire_id = v_bien.proprietaire_id
    AND mois = NEW.mois_comptable
    AND type_facture = 'honoraires'
    AND statut <> 'calcul_en_cours'
  ORDER BY (bien_id = NEW.bien_id) DESC NULLS LAST, updated_at DESC
  LIMIT 1;
  IF v_facture.id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO reservation_changement_post_facture (
    reservation_id, bien_id, proprietaire_id, agence, mois_comptable, facture_id, facture_statut,
    ancien_fin_revenue, nouveau_fin_revenue, ancien_statut, nouveau_statut
  ) VALUES (
    NEW.id, NEW.bien_id, v_bien.proprietaire_id, v_bien.agence, NEW.mois_comptable, v_facture.id, v_facture.statut,
    OLD.fin_revenue, NEW.fin_revenue, OLD.final_status, NEW.final_status
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trace_changement_post_facture: %', SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.trace_changement_post_facture() FROM PUBLIC, anon, authenticated;
