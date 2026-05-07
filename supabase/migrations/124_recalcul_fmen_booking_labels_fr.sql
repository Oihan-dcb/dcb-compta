-- Migration 124 : Recalcul FMEN pour les réservations Booking avec labels en français
-- Problème : Booking renvoie les labels de fees en français ("frais de ménage")
--            Le code attendait des labels anglais ("cleaning fee" / "community fee")
--            → fmenBase = 0 → FMEN absent sur 102 réservations Booking
-- Fix code : normalisation des labels dans _calculerLignes (ventilation.js)
-- Fix data  : cette migration recalcule et insère les lignes FMEN manquantes
--             et ajuste LOY/VIR en conséquence (delta)

BEGIN;

-- ── 1. Calculer le nouveau FMEN pour chaque réservation Booking affectée ──────
WITH booking_fmen AS (
  SELECT
    r.id              AS reservation_id,
    r.mois_comptable,
    b.id              AS bien_id,
    b.proprietaire_id,
    COALESCE(r.fin_accommodation, 0)                AS fin_accom,
    COALESCE(b.provision_ae_ref, 0)                 AS ae_amount,
    COALESCE(
      b.taux_commission_override,
      p.taux_commission / 100.0,
      0.25
    )                                               AS taux_com,
    -- fmenBase = "frais de ménage" + "frais de service" (labels FR normalisés)
    COALESCE((
      SELECT SUM((elem->>'amount')::int)
      FROM jsonb_array_elements(
             r.hospitable_raw->'financials'->'host'->'guest_fees'
           ) elem
      WHERE lower(elem->>'label') IN (
        'frais de ménage', 'cleaning fee',
        'frais de service (5%)', 'community fee'
      )
    ), 0)                                           AS fmen_base,
    -- total guest fees pour ratio dueToOwner
    COALESCE((
      SELECT SUM((elem->>'amount')::int)
      FROM jsonb_array_elements(
             r.hospitable_raw->'financials'->'host'->'guest_fees'
           ) elem
    ), 0)                                           AS total_guest_fees,
    -- host service fee (négatif)
    COALESCE((
      SELECT SUM((elem->>'amount')::int)
      FROM jsonb_array_elements(
             r.hospitable_raw->'financials'->'host'->'host_fees'
           ) elem
    ), 0)                                           AS host_service_fee
  FROM reservation r
  JOIN bien b ON b.id = r.bien_id
  LEFT JOIN proprietaire p ON p.id = b.proprietaire_id
  WHERE r.platform = 'booking'
    AND r.hospitable_raw->'financials'->'host'->'guest_fees' IS NOT NULL
    AND r.fin_revenue > 0
    AND r.final_status NOT IN ('cancelled','not_accepted','not accepted','declined','expired')
),
calc AS (
  SELECT *,
    CASE
      WHEN (fin_accom + total_guest_fees) > 0
      THEN ROUND(
             ABS(host_service_fee) * fmen_base::numeric
             / (fin_accom + total_guest_fees)
             * (1 - taux_com)
           )::int
      ELSE 0
    END AS due_to_owner
  FROM booking_fmen
),
final_fmen AS (
  SELECT
    reservation_id, mois_comptable, bien_id, proprietaire_id,
    GREATEST(0, fmen_base - due_to_owner - ae_amount)             AS fmen_ttc,
    ROUND(GREATEST(0, fmen_base - due_to_owner - ae_amount) / 1.20)::int AS fmen_ht
  FROM calc
),
-- ── 2. Ne traiter que les réservations où FMEN change ─────────────────────────
delta AS (
  SELECT
    f.reservation_id, f.mois_comptable, f.bien_id, f.proprietaire_id,
    f.fmen_ttc  AS new_fmen_ttc,
    f.fmen_ht   AS new_fmen_ht,
    COALESCE(v.montant_ttc, 0) AS old_fmen_ttc
  FROM final_fmen f
  LEFT JOIN ventilation v
         ON v.reservation_id = f.reservation_id AND v.code = 'FMEN'
  WHERE f.fmen_ttc <> COALESCE(v.montant_ttc, 0)
    AND f.fmen_ttc > 0
)

-- ── 3. Supprimer les anciennes lignes FMEN ────────────────────────────────────
, del AS (
  DELETE FROM ventilation
  WHERE reservation_id IN (SELECT reservation_id FROM delta)
    AND code = 'FMEN'
  RETURNING reservation_id
)

-- ── 4. Insérer les nouvelles lignes FMEN ──────────────────────────────────────
INSERT INTO ventilation (
  reservation_id, bien_id, proprietaire_id,
  code, libelle,
  montant_ht, taux_tva, montant_tva, montant_ttc,
  mois_comptable, calcul_source
)
SELECT
  d.reservation_id, d.bien_id, d.proprietaire_id,
  'FMEN', 'Forfait ménage',
  d.new_fmen_ht, 20, d.new_fmen_ttc - d.new_fmen_ht, d.new_fmen_ttc,
  d.mois_comptable, 'auto'
FROM delta d;

-- ── 5. Ajuster LOY et VIR (delta = new_fmen - old_fmen) ──────────────────────
-- LOY Booking = revenue - HON - FMEN - AUTO - TAXES
-- Si FMEN augmente, LOY diminue d'autant
WITH booking_fmen2 AS (
  SELECT
    r.id              AS reservation_id,
    COALESCE(r.fin_accommodation, 0)                AS fin_accom,
    COALESCE(b.provision_ae_ref, 0)                 AS ae_amount,
    COALESCE(b.taux_commission_override, p.taux_commission / 100.0, 0.25) AS taux_com,
    COALESCE((
      SELECT SUM((elem->>'amount')::int)
      FROM jsonb_array_elements(r.hospitable_raw->'financials'->'host'->'guest_fees') elem
      WHERE lower(elem->>'label') IN ('frais de ménage','cleaning fee','frais de service (5%)','community fee')
    ), 0) AS fmen_base,
    COALESCE((
      SELECT SUM((elem->>'amount')::int)
      FROM jsonb_array_elements(r.hospitable_raw->'financials'->'host'->'guest_fees') elem
    ), 0) AS total_guest_fees,
    COALESCE((
      SELECT SUM((elem->>'amount')::int)
      FROM jsonb_array_elements(r.hospitable_raw->'financials'->'host'->'host_fees') elem
    ), 0) AS host_service_fee
  FROM reservation r
  JOIN bien b ON b.id = r.bien_id
  LEFT JOIN proprietaire p ON p.id = b.proprietaire_id
  WHERE r.platform = 'booking'
    AND r.hospitable_raw->'financials'->'host'->'guest_fees' IS NOT NULL
    AND r.fin_revenue > 0
    AND r.final_status NOT IN ('cancelled','not_accepted','not accepted','declined','expired')
),
calc2 AS (
  SELECT reservation_id,
    GREATEST(0,
      fmen_base
      - CASE WHEN (fin_accom + total_guest_fees) > 0
          THEN ROUND(ABS(host_service_fee) * fmen_base::numeric / (fin_accom + total_guest_fees) * (1 - taux_com))::int
          ELSE 0 END
      - ae_amount
    ) AS new_fmen_ttc
  FROM booking_fmen2
),
loy_delta AS (
  SELECT
    c.reservation_id,
    c.new_fmen_ttc                       AS new_fmen,
    COALESCE(v_fmen.montant_ttc, 0)      AS old_fmen,
    c.new_fmen_ttc - COALESCE(v_fmen.montant_ttc, 0) AS diff
  FROM calc2 c
  LEFT JOIN ventilation v_fmen
         ON v_fmen.reservation_id = c.reservation_id AND v_fmen.code = 'FMEN'
  WHERE c.new_fmen_ttc <> COALESCE(v_fmen.montant_ttc, 0)
)
UPDATE ventilation v
SET
  montant_ht  = GREATEST(0, v.montant_ht  - ld.diff),
  montant_ttc = GREATEST(0, v.montant_ttc - ld.diff)
FROM loy_delta ld
WHERE v.reservation_id = ld.reservation_id
  AND v.code IN ('LOY', 'VIR')
  AND ld.diff <> 0;

-- ── 6. Marquer les réservations comme re-ventilées ───────────────────────────
UPDATE reservation SET ventilation_calculee = true
WHERE platform = 'booking'
  AND hospitable_raw->'financials'->'host'->'guest_fees' IS NOT NULL
  AND fin_revenue > 0;

COMMIT;
