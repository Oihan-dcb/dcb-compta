-- 067_reseed_chat_members.sql
-- Re-seed chat_group_members + chat_room_members depuis chat_group_slug
-- (les tables étaient vides car la RLS récursive bloquait les inserts du 059)

-- 1. Membres de groupe depuis chat_group_slug
INSERT INTO chat_group_members (group_id, user_id, is_manager)
SELECT g.id, ae.ae_user_id, COALESCE(ae.is_chat_manager, false)
FROM chat_groups g
JOIN auto_entrepreneur ae ON ae.chat_group_slug = g.slug
WHERE ae.actif = true
  AND ae.ae_user_id IS NOT NULL
  AND ae.is_chat_hidden IS NOT TRUE
ON CONFLICT (group_id, user_id) DO UPDATE SET is_manager = EXCLUDED.is_manager;

-- 2. Membres de rooms open depuis chat_group_members
INSERT INTO chat_room_members (room_id, user_id)
SELECT r.id, m.user_id
FROM chat_rooms r
JOIN chat_group_members m ON m.group_id = r.group_id
WHERE r.type = 'open'
ON CONFLICT (room_id, user_id) DO NOTHING;
