-- ═══════════════════════════════════════════════════════════════════════
-- 059_ae_chat_group.sql — Champ groupe messagerie sur auto_entrepreneur
--   + re-seed des membres manquants (ae_user_id null lors du 058)
--   + trigger : sync automatique lors d'un changement de groupe
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Colonne groupe messagerie ──────────────────────────────────────
ALTER TABLE auto_entrepreneur
  ADD COLUMN IF NOT EXISTS chat_group_slug text DEFAULT 'cote-basque';

-- Initialiser tous les AE actifs existants sur cote-basque si null
UPDATE auto_entrepreneur
  SET chat_group_slug = 'cote-basque'
  WHERE chat_group_slug IS NULL AND actif = true;

-- ── 2. Re-seed membres groupe (rattrape ae_user_id null au moment du 058)
INSERT INTO chat_group_members (group_id, user_id, is_manager)
SELECT g.id, ae.ae_user_id, ae.is_chat_manager
FROM chat_groups g
JOIN auto_entrepreneur ae ON ae.chat_group_slug = g.slug
WHERE ae.actif = true
  AND ae.ae_user_id IS NOT NULL
ON CONFLICT (group_id, user_id) DO UPDATE SET is_manager = EXCLUDED.is_manager;

-- ── 3. Re-seed membres rooms open (rattrape)
INSERT INTO chat_room_members (room_id, user_id)
SELECT r.id, m.user_id
FROM chat_rooms r
JOIN chat_groups g ON g.id = r.group_id
JOIN chat_group_members m ON m.group_id = g.id
WHERE r.type = 'open'
ON CONFLICT (room_id, user_id) DO NOTHING;

-- ── 4. Fonction : ajouter un AE à son groupe + rooms open ─────────────
CREATE OR REPLACE FUNCTION sync_ae_chat_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Si ae_user_id est null ou pas de groupe, rien à faire
  IF NEW.ae_user_id IS NULL OR NEW.chat_group_slug IS NULL THEN
    RETURN NEW;
  END IF;

  -- Retirer des anciens groupes si le slug a changé
  IF OLD.chat_group_slug IS DISTINCT FROM NEW.chat_group_slug AND OLD.chat_group_slug IS NOT NULL THEN
    DELETE FROM chat_group_members cgm
    USING chat_groups g
    WHERE g.id = cgm.group_id
      AND g.slug = OLD.chat_group_slug
      AND cgm.user_id = NEW.ae_user_id;
    -- Les chat_room_members liés seront supprimés en cascade si on veut,
    -- mais on les retire manuellement pour les rooms open de l'ancien groupe
    DELETE FROM chat_room_members crm
    USING chat_rooms r
    JOIN chat_groups g ON g.id = r.group_id
    WHERE crm.room_id = r.id
      AND g.slug = OLD.chat_group_slug
      AND r.type = 'open'
      AND crm.user_id = NEW.ae_user_id;
  END IF;

  -- Ajouter au nouveau groupe
  INSERT INTO chat_group_members (group_id, user_id, is_manager)
  SELECT g.id, NEW.ae_user_id, NEW.is_chat_manager
  FROM chat_groups g WHERE g.slug = NEW.chat_group_slug
  ON CONFLICT (group_id, user_id) DO UPDATE SET is_manager = EXCLUDED.is_manager;

  -- Ajouter aux rooms open du nouveau groupe
  INSERT INTO chat_room_members (room_id, user_id)
  SELECT r.id, NEW.ae_user_id
  FROM chat_rooms r
  JOIN chat_groups g ON g.id = r.group_id
  WHERE g.slug = NEW.chat_group_slug AND r.type = 'open'
  ON CONFLICT (room_id, user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- ── 5. Trigger sur auto_entrepreneur ─────────────────────────────────
DROP TRIGGER IF EXISTS trg_ae_chat_group ON auto_entrepreneur;
CREATE TRIGGER trg_ae_chat_group
  AFTER INSERT OR UPDATE OF chat_group_slug, ae_user_id, is_chat_manager
  ON auto_entrepreneur
  FOR EACH ROW
  EXECUTE FUNCTION sync_ae_chat_group();
