-- ═══════════════════════════════════════════════════════════════════════
-- 058_chat.sql — Messagerie interne DCB
-- Sprint 1 : schéma complet + RLS + seed groupe Côte Basque
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Champs supplémentaires sur auto_entrepreneur ──────────────────
ALTER TABLE auto_entrepreneur
  ADD COLUMN IF NOT EXISTS date_debut      date,
  ADD COLUMN IF NOT EXISTS date_fin        date,
  ADD COLUMN IF NOT EXISTS is_chat_manager boolean NOT NULL DEFAULT false;

-- Marquer Oïhan, Laura, Clémence comme managers chat
UPDATE auto_entrepreneur
  SET is_chat_manager = true
  WHERE prenom IN ('Oïhan', 'Laura', 'Clémence') AND actif = true;

-- ── 2. Groupes ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_groups (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  slug       text        NOT NULL UNIQUE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── 3. Membres d'un groupe ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_group_members (
  group_id   uuid        NOT NULL REFERENCES chat_groups ON DELETE CASCADE,
  user_id    uuid        NOT NULL,   -- = auto_entrepreneur.ae_user_id = auth.uid()
  is_manager boolean     NOT NULL DEFAULT false,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

-- ── 4. Rooms ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_rooms (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  type       text        NOT NULL CHECK (type IN ('open','inbox','direct')),
  name       text,                   -- null pour direct
  room_role  text        CHECK (room_role IN ('planning','terrain')),
  group_id   uuid        REFERENCES chat_groups ON DELETE CASCADE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, room_role)       -- une seule room par rôle par groupe
);

-- ── 5. Membres d'une room ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_room_members (
  room_id      uuid        NOT NULL REFERENCES chat_rooms ON DELETE CASCADE,
  user_id      uuid        NOT NULL,   -- = ae_user_id = auth.uid()
  involvement  text        NOT NULL DEFAULT 'everything'
                           CHECK (involvement IN ('nothing','mentions','everything')),
  joined_at    timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz,
  PRIMARY KEY (room_id, user_id)
);

-- ── 6. Messages ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id          uuid        NOT NULL REFERENCES chat_rooms ON DELETE CASCADE,
  sender_id        uuid        NOT NULL,   -- = ae_user_id = auth.uid()
  body             text        NOT NULL CHECK (length(trim(body)) > 0),
  is_urgent        boolean     NOT NULL DEFAULT false,
  is_broadcast     boolean     NOT NULL DEFAULT false,
  broadcast_ref_id uuid,                  -- même UUID pour toutes les copies d'un broadcast
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ── 7. Pièces jointes (Sprint 2) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_message_files (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id   uuid        NOT NULL REFERENCES chat_messages ON DELETE CASCADE,
  storage_path text        NOT NULL,
  filename     text        NOT NULL,
  mime_type    text,
  size_bytes   bigint,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ── 8. Queue LLM (Sprint 3) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_llm_jobs (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id           uuid        NOT NULL REFERENCES chat_messages ON DELETE CASCADE,
  room_id              uuid        NOT NULL REFERENCES chat_rooms,
  status               text        NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending','processing','done','skipped')),
  llm_response         jsonb,
  proposed_action_type text        CHECK (proposed_action_type IN
                                   ('tech_issue','mission','devis_request','note','none')),
  proposed_action_data jsonb,
  validated_by         uuid,
  validated_at         timestamptz,
  rejected_at          timestamptz,
  rejection_reason     text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- ── 9. Index performances ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_chat_messages_room    ON chat_messages      (room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender  ON chat_messages      (sender_id);
CREATE INDEX IF NOT EXISTS idx_chat_room_members_uid ON chat_room_members  (user_id);
CREATE INDEX IF NOT EXISTS idx_chat_group_members_uid ON chat_group_members (user_id);
CREATE INDEX IF NOT EXISTS idx_chat_llm_jobs_status  ON chat_llm_jobs      (status)
  WHERE status IN ('pending','done');

-- ── 10. Realtime ──────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE chat_room_members;

-- ── 11. RLS ───────────────────────────────────────────────────────────
ALTER TABLE chat_groups          ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_group_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_rooms           ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_room_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_message_files   ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_llm_jobs        ENABLE ROW LEVEL SECURITY;

-- Groupes : visibles par leurs membres
CREATE POLICY "chat_groups_select" ON chat_groups FOR SELECT
  USING (id IN (SELECT group_id FROM chat_group_members WHERE user_id = auth.uid()));

-- Membres de groupe : visibles dans les groupes où on est membre
CREATE POLICY "chat_group_members_select" ON chat_group_members FOR SELECT
  USING (group_id IN (SELECT group_id FROM chat_group_members WHERE user_id = auth.uid()));

-- Rooms : visibles si membre
CREATE POLICY "chat_rooms_select" ON chat_rooms FOR SELECT
  USING (id IN (SELECT room_id FROM chat_room_members WHERE user_id = auth.uid()));

-- Membres de room : visibles dans les rooms où on est membre
CREATE POLICY "chat_room_members_select" ON chat_room_members FOR SELECT
  USING (room_id IN (SELECT room_id FROM chat_room_members WHERE user_id = auth.uid()));

-- Mes propres memberships : update (involvement, last_read_at)
CREATE POLICY "chat_room_members_update" ON chat_room_members FOR UPDATE
  USING (user_id = auth.uid());

-- Messages : lire si membre de la room
CREATE POLICY "chat_messages_select" ON chat_messages FOR SELECT
  USING (
    room_id IN (SELECT room_id FROM chat_room_members WHERE user_id = auth.uid())
  );

-- Messages : envoyer pour soi-même dans ses rooms
CREATE POLICY "chat_messages_insert" ON chat_messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND room_id IN (SELECT room_id FROM chat_room_members WHERE user_id = auth.uid())
    AND deleted_at IS NULL
  );

-- Fichiers : visibles si membre de la room du message
CREATE POLICY "chat_message_files_select" ON chat_message_files FOR SELECT
  USING (message_id IN (
    SELECT cm.id FROM chat_messages cm
    WHERE cm.room_id IN (SELECT room_id FROM chat_room_members WHERE user_id = auth.uid())
  ));

-- Jobs LLM : visibles par managers uniquement
CREATE POLICY "chat_llm_jobs_select" ON chat_llm_jobs FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM auto_entrepreneur
    WHERE ae_user_id = auth.uid() AND is_chat_manager = true
  ));

CREATE POLICY "chat_llm_jobs_update" ON chat_llm_jobs FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM auto_entrepreneur
    WHERE ae_user_id = auth.uid() AND is_chat_manager = true
  ));

-- ── 12. Fonction RPC : créer ou retrouver un DM ───────────────────────
CREATE OR REPLACE FUNCTION create_or_get_direct_room(other_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room_id uuid;
  v_my_id   uuid := auth.uid();
BEGIN
  IF v_my_id IS NULL THEN
    RAISE EXCEPTION 'Non authentifié';
  END IF;
  IF v_my_id = other_user_id THEN
    RAISE EXCEPTION 'Impossible de créer un DM avec soi-même';
  END IF;

  -- Chercher DM existant entre les deux users
  SELECT cr.id INTO v_room_id
  FROM chat_rooms cr
  WHERE cr.type = 'direct'
    AND EXISTS (SELECT 1 FROM chat_room_members WHERE room_id = cr.id AND user_id = v_my_id)
    AND EXISTS (SELECT 1 FROM chat_room_members WHERE room_id = cr.id AND user_id = other_user_id)
  LIMIT 1;

  IF v_room_id IS NOT NULL THEN
    RETURN v_room_id;
  END IF;

  -- Créer la room
  INSERT INTO chat_rooms (type) VALUES ('direct') RETURNING id INTO v_room_id;

  -- Ajouter les deux membres
  INSERT INTO chat_room_members (room_id, user_id)
  VALUES (v_room_id, v_my_id), (v_room_id, other_user_id);

  RETURN v_room_id;
END;
$$;

-- ── 13. Seed — groupe Côte Basque ──────────────────────────────────────

INSERT INTO chat_groups (name, slug)
VALUES ('Côte Basque', 'cote-basque')
ON CONFLICT (slug) DO NOTHING;

-- Rooms Planning + Terrain pour Côte Basque
INSERT INTO chat_rooms (type, name, room_role, group_id)
SELECT 'open', 'Planning', 'planning', id FROM chat_groups WHERE slug = 'cote-basque'
ON CONFLICT (group_id, room_role) DO NOTHING;

INSERT INTO chat_rooms (type, name, room_role, group_id)
SELECT 'open', 'Terrain', 'terrain', id FROM chat_groups WHERE slug = 'cote-basque'
ON CONFLICT (group_id, room_role) DO NOTHING;

-- Ajouter tous les AEs actifs avec ae_user_id au groupe Côte Basque
INSERT INTO chat_group_members (group_id, user_id, is_manager)
SELECT g.id, ae.ae_user_id, ae.is_chat_manager
FROM chat_groups g
CROSS JOIN auto_entrepreneur ae
WHERE g.slug = 'cote-basque'
  AND ae.actif = true
  AND ae.ae_user_id IS NOT NULL
ON CONFLICT (group_id, user_id) DO UPDATE SET is_manager = EXCLUDED.is_manager;

-- Ajouter ces membres aux rooms open du groupe
INSERT INTO chat_room_members (room_id, user_id)
SELECT r.id, m.user_id
FROM chat_rooms r
JOIN chat_groups g ON g.id = r.group_id AND g.slug = 'cote-basque'
JOIN chat_group_members m ON m.group_id = g.id
WHERE r.type = 'open'
ON CONFLICT (room_id, user_id) DO NOTHING;
