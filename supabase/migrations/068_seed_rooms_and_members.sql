-- 068_seed_rooms_and_members.sql
-- Les rooms n'avaient pas été créées (RLS récursive bloquait le 058)
-- On crée les rooms open pour chaque groupe + seed des membres

-- 1. Rooms Planning + Terrain pour chaque groupe existant
INSERT INTO chat_rooms (type, name, room_role, group_id)
SELECT 'open', 'Planning', 'planning', id FROM chat_groups
ON CONFLICT DO NOTHING;

INSERT INTO chat_rooms (type, name, room_role, group_id)
SELECT 'open', 'Terrain', 'terrain', id FROM chat_groups
ON CONFLICT DO NOTHING;

-- 2. Membres de groupe depuis chat_group_slug (actifs, avec ae_user_id, non cachés)
INSERT INTO chat_group_members (group_id, user_id, is_manager)
SELECT g.id, ae.ae_user_id, COALESCE(ae.is_chat_manager, false)
FROM chat_groups g
JOIN auto_entrepreneur ae ON ae.chat_group_slug = g.slug
WHERE ae.actif = true
  AND ae.ae_user_id IS NOT NULL
  AND ae.is_chat_hidden IS NOT TRUE
ON CONFLICT (group_id, user_id) DO UPDATE SET is_manager = EXCLUDED.is_manager;

-- 3. Membres de rooms depuis chat_group_members
INSERT INTO chat_room_members (room_id, user_id)
SELECT r.id, m.user_id
FROM chat_rooms r
JOIN chat_group_members m ON m.group_id = r.group_id
WHERE r.type = 'open'
ON CONFLICT (room_id, user_id) DO NOTHING;
