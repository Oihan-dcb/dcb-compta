-- Récupération SMS manqués — avis 5⭐ des 7 derniers jours non encore traités
-- Coller dans Supabase SQL Editor et exécuter

-- Étape 1 : Voir ce qui va être mis en queue (aperçu sans insérer)
SELECT
  rr.id                          AS review_id,
  rr.submitted_at,
  rr.rating,
  rr.comment,
  r.guest_name,
  r.guest_phone,
  r.guest_country,
  b.hospitable_name              AS property_name,
  rr.hospitable_reservation_id
FROM reservation_review rr
LEFT JOIN reservation r ON r.id = rr.reservation_id
LEFT JOIN bien b        ON b.id = rr.bien_id
WHERE rr.rating >= 5
  AND rr.submitted_at >= now() - interval '7 days'
  -- Pas déjà dans sms_queue
  AND NOT EXISTS (
    SELECT 1 FROM sms_queue sq
    WHERE sq.hospitable_reservation_id = rr.hospitable_reservation_id
  )
  -- Pas déjà envoyé dans sms_logs
  AND NOT EXISTS (
    SELECT 1 FROM sms_logs sl
    WHERE sl.hospitable_reservation_id = rr.hospitable_reservation_id
    AND sl.status = 'sent'
  )
ORDER BY rr.submitted_at DESC;


-- Étape 2 : Insérer dans sms_queue (décommenter pour exécuter)
/*
INSERT INTO sms_queue (
  hospitable_reservation_id,
  guest_name,
  guest_phone,
  guest_country,
  property_name,
  comment,
  rating,
  send_at
)
SELECT
  rr.hospitable_reservation_id,
  r.guest_name,
  r.guest_phone,
  r.guest_country,
  b.hospitable_name,
  rr.comment,
  rr.rating,
  now()   -- envoi immédiat (pas de délai 28 min, ce sont de vieux avis)
FROM reservation_review rr
LEFT JOIN reservation r ON r.id = rr.reservation_id
LEFT JOIN bien b        ON b.id = rr.bien_id
WHERE rr.rating >= 5
  AND rr.submitted_at >= now() - interval '7 days'
  AND r.guest_phone IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sms_queue sq
    WHERE sq.hospitable_reservation_id = rr.hospitable_reservation_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM sms_logs sl
    WHERE sl.hospitable_reservation_id = rr.hospitable_reservation_id
    AND sl.status = 'sent'
  );
*/
