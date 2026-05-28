-- Migration 164 : RPC lier_ventilation_auto_mission
-- Lie la ligne ventilation AUTO d'une réservation à la mission_menage correspondante.
-- Appelé par ventilation.js (frontend) et ventilation-auto (Edge Function) après calcul.
-- Silencieusement ignorée si aucune mission_menage ne correspond (reservation_id null ou absent).

CREATE OR REPLACE FUNCTION lier_ventilation_auto_mission(
  p_reservation_id uuid,
  p_ventilation_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE mission_menage
  SET ventilation_auto_id = p_ventilation_id
  WHERE reservation_id = p_reservation_id
    AND ventilation_auto_id IS DISTINCT FROM p_ventilation_id;
END;
$$;

-- Edge Functions (service_role) et frontend authentifié peuvent appeler la RPC
GRANT EXECUTE ON FUNCTION lier_ventilation_auto_mission(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION lier_ventilation_auto_mission(uuid, uuid) TO authenticated;
