-- 078_fix_managers_ids.sql
-- Correctif ciblé par UUID :
--   - Oïhan (prenom="Oihan" sans accent) → is_chat_manager + tous les groupes
--   - Léa ESCUDIER (type="ae") → is_chat_manager + bordeaux en plus d'arcachon

-- ── 1. Activer is_chat_manager pour Oïhan et Léa ─────────────────────
UPDATE auto_entrepreneur
  SET is_chat_manager = true
  WHERE ae_user_id IN (
    '62753152-5321-40ce-ac86-36a54c2de2aa',   -- Oïhan CAMPANDEGUI
    'a55bd53b-eb9c-4927-b018-6a1569fddebe'    -- Léa ESCUDIER
  );

-- ── 2. Oïhan → tous les groupes (is_manager=true) ─────────────────────
INSERT INTO chat_group_members (group_id, user_id, is_manager)
SELECT g.id, '62753152-5321-40ce-ac86-36a54c2de2aa', true
FROM chat_groups g
ON CONFLICT (group_id, user_id) DO UPDATE SET is_manager = true;

-- ── 3. Léa → bordeaux en plus d'arcachon (is_manager=true) ───────────
INSERT INTO chat_group_members (group_id, user_id, is_manager)
SELECT g.id, 'a55bd53b-eb9c-4927-b018-6a1569fddebe', true
FROM chat_groups g
WHERE g.slug IN ('bordeaux','arcachon')
ON CONFLICT (group_id, user_id) DO UPDATE SET is_manager = true;

-- ── 4. Oïhan et Léa → toutes les rooms open de leurs groupes ─────────
INSERT INTO chat_room_members (room_id, user_id)
SELECT r.id, m.user_id
FROM chat_rooms r
JOIN chat_group_members m ON m.group_id = r.group_id
WHERE r.type = 'open'
  AND m.user_id IN (
    '62753152-5321-40ce-ac86-36a54c2de2aa',
    'a55bd53b-eb9c-4927-b018-6a1569fddebe'
  )
ON CONFLICT (room_id, user_id) DO NOTHING;
