-- 092_mail_module.sql
-- Tables pour le module Mail PowerHouse
-- mail_messages : inbox complète (tous les emails IMAP)
-- mail_ai_analysis : résultats d'analyse IA par message

CREATE TABLE IF NOT EXISTS mail_messages (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid        REFERENCES powerhouse_imap_accounts(id) ON DELETE CASCADE,
  uid                text        NOT NULL,
  message_id         text,
  folder             text        NOT NULL DEFAULT 'INBOX',
  from_name          text,
  from_email         text,
  to_json            jsonb,
  cc_json            jsonb,
  subject            text,
  text_body          text,
  html_body          text,
  snippet            text,
  date               timestamptz,
  is_read            boolean     NOT NULL DEFAULT false,
  is_starred         boolean     NOT NULL DEFAULT false,
  has_attachments    boolean     NOT NULL DEFAULT false,
  direction          text        NOT NULL DEFAULT 'incoming' CHECK (direction IN ('incoming','outgoing')),
  status             text        NOT NULL DEFAULT 'inbox'    CHECK (status    IN ('inbox','archive','trash','sent','draft')),
  ai_status          text        NOT NULL DEFAULT 'pending'  CHECK (ai_status IN ('pending','done','error','skipped')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id, uid)
);

CREATE TABLE IF NOT EXISTS mail_ai_analysis (
  id                     uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id             uuid    REFERENCES mail_messages(id) ON DELETE CASCADE UNIQUE,
  summary                text,
  category               text,
  priority               text    CHECK (priority IN ('low','normal','high','urgent')),
  detected_entities_json jsonb,
  suggested_reply        text,
  suggested_actions_json jsonb,
  confidence             float,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mail_messages_account_status_date
  ON mail_messages(account_id, status, date DESC);

CREATE INDEX IF NOT EXISTS mail_messages_unread
  ON mail_messages(is_read, status) WHERE is_read = false;

CREATE INDEX IF NOT EXISTS mail_messages_account_uid
  ON mail_messages(account_id, uid);

-- RLS désactivé (service role uniquement depuis les API)
ALTER TABLE mail_messages    DISABLE ROW LEVEL SECURITY;
ALTER TABLE mail_ai_analysis DISABLE ROW LEVEL SECURITY;
