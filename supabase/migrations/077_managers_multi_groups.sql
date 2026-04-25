-- 077_managers_multi_groups.sql
-- Groupes Bordeaux + Arcachon avec leurs rooms + seed membres
-- Managers multi-groupes : Oïhan + Clémence dans tous les groupes,
-- Léa dans bordeaux + arcachon, Laura reste uniquement cote-basque

-- ── 1. Créer les groupes s'ils n'existent pas ────────────────────────
INSERT INTO chat_groups (name, slug) VALUES
  ('Bordeaux',  'bordeaux'),
  ('Arcachon',  'arcachon')
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Rooms Planning + Terrain pour bordeaux et arcachon ────────────
INSERT INTO chat_rooms (type, name, room_role, group_id)
SELECT 'open', 'Planning', 'planning', id
FROM chat_groups WHERE slug IN ('bordeaux','arcachon')
ON CONFLICT (group_id, room_role) DO NOTHING;

INSERT INTO chat_rooms (type, name, room_role, group_id)
SELECT 'open', 'Terrain', 'terrain', id
FROM chat_groups WHERE slug IN ('bordeaux','arcachon')
ON CONFLICT (group_id, room_role) DO NOTHING;

-- ── 3. Activer is_chat_manager pour Léa (staff uniquement, pas l'étudiante) ──
UPDATE auto_entrepreneur
  SET is_chat_manager = true
  WHERE prenom = 'Léa'
    AND type IN ('staff','gerant','assistante')
    AND actif = true;

-- ── 4. Seed membres bordeaux + arcachon depuis chat_group_slug ────────
INSERT INTO chat_group_members (group_id, user_id, is_manager)
SELECT g.id, ae.ae_user_id, COALESCE(ae.is_chat_manager, false)
FROM chat_groups g
JOIN auto_entrepreneur ae ON ae.chat_group_slug = g.slug
WHERE g.slug IN ('bordeaux','arcachon')
  AND ae.actif = true
  AND ae.ae_user_id IS NOT NULL
  AND ae.is_chat_hidden IS NOT TRUE
ON CONFLICT (group_id, user_id) DO UPDATE SET is_manager = EXCLUDED.is_manager;

-- ── 5. Oïhan et Clémence → TOUS les groupes (is_manager=true) ────────
INSERT INTO chat_group_members (group_id, user_id, is_manager)
SELECT g.id, ae.ae_user_id, true
FROM chat_groups g
CROSS JOIN auto_entrepreneur ae
WHERE ae.prenom IN ('Oïhan','Clémence')
  AND ae.actif = true
  AND ae.ae_user_id IS NOT NULL
ON CONFLICT (group_id, user_id) DO UPDATE SET is_manager = true;

-- ── 6. Léa → bordeaux + arcachon (is_manager=true) ───────────────────
INSERT INTO chat_group_members (group_id, user_id, is_manager)
SELECT g.id, ae.ae_user_id, true
FROM chat_groups g
CROSS JOIN auto_entrepreneur ae
WHERE g.slug IN ('bordeaux','arcachon')
  AND ae.prenom = 'Léa'
  AND ae.type IN ('staff','gerant','assistante')
  AND ae.actif = true
  AND ae.ae_user_id IS NOT NULL
ON CONFLICT (group_id, user_id) DO UPDATE SET is_manager = true;

-- ── 7. Toutes les rooms open ← membres de leur groupe ─────────────────
INSERT INTO chat_room_members (room_id, user_id)
SELECT r.id, m.user_id
FROM chat_rooms r
JOIN chat_group_members m ON m.group_id = r.group_id
WHERE r.type = 'open'
ON CONFLICT (room_id, user_id) DO NOTHING;

-- ── 8. Vérification (informatif, pas bloquant) ─────────────────────────
-- Résultat attendu : Oïhan + Clémence apparaissent dans 3 groupes chacun,
-- Léa dans 2 groupes (bordeaux + arcachon), Laura dans 1 groupe (cote-basque)
