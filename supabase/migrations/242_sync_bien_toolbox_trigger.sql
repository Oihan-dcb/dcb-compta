-- Trigger auto-sync bien -> bien_toolbox
-- Contexte : bien_toolbox n'a jamais ete alimentee automatiquement depuis sa creation
-- (migration 098/099, import CSV unique). 33 biens n'avaient aucune ligne toolbox
-- correspondante (ex: Ongi etorri, MFC, crees 2026-08-17) car rien ne relie bien -> bien_toolbox
-- au fil de l'eau. Ce trigger cree/met a jour automatiquement la ligne bien_toolbox
-- a chaque insert/update de bien.code ou bien.ville.
--
-- Matching prioritaire par bien_id (relation reelle) plutot que par nom_csv, car des
-- lignes bien_toolbox historiques ont un nom_csv qui ne correspond plus exactement au
-- bien.code actuel (drift depuis l'import CSV d'origine, migration 099).
--
-- Limite connue : bien.code n'est pas unique pour tous les biens (ARREBA, UNNAMED, VILLA
-- ont des doublons de code). Si un nouveau bien sans ligne toolbox existante a un code
-- qui collisionne avec le nom_csv d'un AUTRE bien deja lie, on ne cree pas la ligne
-- (ON CONFLICT DO NOTHING) plutot que de faire echouer l'insert/update du bien -
-- pre-existant, hors scope ici, a resoudre a la main si besoin (Villa Ederra/Lorea/
-- Kostaldea partagent le code "VILLA", Villa Maritxu a le code "UNNAMED").

CREATE OR REPLACE FUNCTION sync_bien_toolbox()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.code IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE bien_toolbox
     SET nom_csv = NEW.code,
         ville = COALESCE(NEW.ville, ville)
   WHERE bien_id = NEW.id;

  IF FOUND THEN
    RETURN NEW;
  END IF;

  INSERT INTO bien_toolbox (nom_csv, bien_id, ville)
  VALUES (NEW.code, NEW.id, NEW.ville)
  ON CONFLICT (nom_csv) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_bien_toolbox ON bien;
CREATE TRIGGER trg_sync_bien_toolbox
AFTER INSERT OR UPDATE OF code, ville ON bien
FOR EACH ROW
EXECUTE FUNCTION sync_bien_toolbox();

-- Backfill : creer les lignes bien_toolbox manquantes pour les biens jamais lies (par bien_id)
INSERT INTO bien_toolbox (nom_csv, bien_id, ville)
SELECT b.code, b.id, b.ville
FROM bien b
WHERE b.code IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM bien_toolbox bt WHERE bt.bien_id = b.id)
ON CONFLICT (nom_csv) DO NOTHING;
