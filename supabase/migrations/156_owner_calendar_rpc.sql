-- Migration 156 : RPC owner_calendar()
-- Calendrier enrichi pour le portail owner.
-- JOIN : bien → property_calendar → reservation (arrival_date match) → ventilation (VIR)

CREATE OR REPLACE FUNCTION owner_calendar(
  p_proprio_id uuid,
  p_from       date DEFAULT current_date - 7,
  p_to         date DEFAULT current_date + 365
)
RETURNS TABLE (
  bien_id       uuid,
  bien_code     text,
  bien_nom      text,
  bien_photo    text,
  event_id      uuid,
  date_debut    date,
  date_fin      date,
  source        text,
  statut        text,
  prenom_client text,
  canal         text,
  nb_nuits      int,
  nb_personnes  int,
  net_proprio   bigint,
  ventile       bool
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    b.id                                            AS bien_id,
    b.code                                          AS bien_code,
    b.hospitable_name                               AS bien_nom,
    b.photo_url                                     AS bien_photo,
    pc.id                                           AS event_id,
    pc.date_debut,
    pc.date_fin,
    pc.source,
    pc.statut,
    split_part(COALESCE(r.guest_name, ''), ' ', 1)  AS prenom_client,
    COALESCE(r.platform, pc.source)                 AS canal,
    r.nights                                        AS nb_nuits,
    r.guest_count                                   AS nb_personnes,
    v.montant_ht                                    AS net_proprio,
    (v.id IS NOT NULL)                              AS ventile
  FROM bien b
  JOIN property_calendar pc
    ON pc.bien_id = b.id
  LEFT JOIN reservation r
    ON  r.bien_id      = pc.bien_id
    AND r.arrival_date = pc.date_debut
    AND r.final_status = 'accepted'
  LEFT JOIN ventilation v
    ON  v.reservation_id = r.id
    AND v.code           = 'VIR'
  WHERE b.proprietaire_id = p_proprio_id
    AND pc.date_fin  >= p_from
    AND pc.date_debut <= p_to
  ORDER BY b.hospitable_name, pc.date_debut;
$$;
