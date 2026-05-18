-- Migration 151 : Trigger de verrouillage prestations après envoi facture
--
-- Bloque tout INSERT / UPDATE / DELETE sur prestation_hors_forfait
-- si une facture_evoliz de type 'honoraires' avec statut 'envoye_evoliz' ou 'payee'
-- existe pour le même proprietaire_id + mois.
--
-- Logique : la jointure passe par bien.proprietaire_id (pas bien_id)
-- pour couvrir les factures per-proprio (bien_id IS NULL, ex. Maison Maïté).
--
-- Complément à la clôture UI (moisBloque) — défense en profondeur côté DB.

-- Index pour les performances du trigger
CREATE INDEX IF NOT EXISTS idx_facture_evoliz_lock_check
  ON facture_evoliz (proprietaire_id, mois, type_facture, statut);

-- Fonction trigger
CREATE OR REPLACE FUNCTION block_prestation_after_invoice_sent()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_bien_id        uuid;
  v_mois           text;
  v_proprietaire_id uuid;
  v_facture_statut  text;
  v_facture_mois    text;
BEGIN
  -- Résoudre bien_id et mois selon l'opération
  IF TG_OP = 'DELETE' THEN
    v_bien_id := OLD.bien_id;
    v_mois    := OLD.mois;
  ELSE
    v_bien_id := NEW.bien_id;
    v_mois    := NEW.mois;
  END IF;

  -- Récupérer le propriétaire du bien (null-safe)
  SELECT proprietaire_id INTO v_proprietaire_id
  FROM bien WHERE id = v_bien_id;

  -- Si pas de proprio (bien sans propriétaire), on laisse passer
  IF v_proprietaire_id IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  -- Vérifier si une facture honoraires verrouillée existe pour ce proprio + mois
  SELECT statut, mois INTO v_facture_statut, v_facture_mois
  FROM facture_evoliz
  WHERE proprietaire_id = v_proprietaire_id
    AND mois            = v_mois
    AND type_facture    = 'honoraires'
    AND statut IN ('envoye_evoliz', 'payee')
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Prestation bloquée : facture honoraires % pour ce propriétaire (mois %) — supprimer ou repasser la facture en brouillon avant de modifier les prestations.',
      v_facture_statut, v_facture_mois;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

-- Trigger
DROP TRIGGER IF EXISTS prestation_invoice_lock ON prestation_hors_forfait;

CREATE TRIGGER prestation_invoice_lock
  BEFORE INSERT OR UPDATE OR DELETE ON prestation_hors_forfait
  FOR EACH ROW EXECUTE FUNCTION block_prestation_after_invoice_sent();
