-- Migration 189 : ajouter booking_payout_line dans check_rapprochement_links
-- Le trigger ghost_match bloquait le passage à 'rapproche' quand le seul lien FK
-- était dans booking_payout_line (nouveau format CSV Booking par payout).

CREATE OR REPLACE FUNCTION check_rapprochement_links()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE has_link BOOLEAN;
BEGIN
  IF NEW.statut_matching = 'rapproche' AND (OLD.statut_matching IS DISTINCT FROM 'rapproche') THEN
    SELECT (
      EXISTS (SELECT 1 FROM reservation_paiement  WHERE mouvement_id = NEW.id LIMIT 1)
      OR EXISTS (SELECT 1 FROM payout_hospitable   WHERE mouvement_id = NEW.id LIMIT 1)
      OR EXISTS (SELECT 1 FROM ventilation         WHERE mouvement_id = NEW.id LIMIT 1)
      OR EXISTS (SELECT 1 FROM booking_payout_line WHERE mouvement_id = NEW.id LIMIT 1)
    ) INTO has_link;
    IF NOT has_link THEN
      RAISE EXCEPTION 'Ghost match : mouvement % sans lien FK', NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
