-- Migration 116 : Recalcul RGLM + SOLDE pour la réservation UIFN1P (Maison Maïté)
-- Le SOLDE stale (10 420,35 €) doit être recalculé depuis reservation_paiement.

DO $$
DECLARE
  v_resa_id     uuid;
  v_bien_id     uuid;
  v_prop_id     uuid;
  v_mois        text;
  v_fin_rev     integer;
  v_total_recu  integer;
  v_solde       integer;
  v_i           integer := 0;
  rec           record;
BEGIN
  -- Récupérer la réservation UIFN1P
  SELECT r.id, r.fin_revenue, vir.bien_id, vir.proprietaire_id, vir.mois_comptable
  INTO v_resa_id, v_fin_rev, v_bien_id, v_prop_id, v_mois
  FROM reservation r
  JOIN bien b ON b.id = r.bien_id
  LEFT JOIN ventilation vir ON vir.reservation_id = r.id AND vir.code = 'VIR'
  WHERE b.code = 'UIFN1P'
    AND r.arrival_date >= '2026-04-01' AND r.arrival_date < '2026-05-01'
  LIMIT 1;

  IF v_resa_id IS NULL THEN RETURN; END IF;

  -- Supprimer RGLM + SOLDE existants
  DELETE FROM ventilation WHERE reservation_id = v_resa_id AND code IN ('RGLM', 'SOLDE');

  -- Recréer RGLM pour chaque paiement reçu
  v_total_recu := 0;
  FOR rec IN
    SELECT montant, date_paiement
    FROM reservation_paiement
    WHERE reservation_id = v_resa_id
    ORDER BY date_paiement ASC
  LOOP
    v_i := v_i + 1;
    v_total_recu := v_total_recu + rec.montant;
    INSERT INTO ventilation (reservation_id, bien_id, proprietaire_id, mois_comptable, code, libelle, montant_ttc, montant_ht, taux_tva, montant_tva, calcul_source)
    VALUES (v_resa_id, v_bien_id, v_prop_id, v_mois, 'RGLM', 'Règlement ' || v_i, rec.montant, rec.montant, 0, 0, 'rapprochement');
  END LOOP;

  -- Créer SOLDE si reste > 1€
  v_solde := v_fin_rev - v_total_recu;
  IF v_solde > 100 THEN
    INSERT INTO ventilation (reservation_id, bien_id, proprietaire_id, mois_comptable, code, libelle, montant_ttc, montant_ht, taux_tva, montant_tva, calcul_source)
    VALUES (v_resa_id, v_bien_id, v_prop_id, v_mois, 'SOLDE', 'Solde à recevoir', v_solde, v_solde, 0, 0, 'rapprochement');
  END IF;
END $$;
