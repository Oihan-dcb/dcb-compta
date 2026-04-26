-- 085_email_system.sql
-- Pipeline email : comptes IMAP, templates, jobs entrants, dédup

-- Comptes IMAP/SMTP configurés dans PowerHouse Settings
CREATE TABLE IF NOT EXISTS powerhouse_imap_accounts (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  label           text NOT NULL,                    -- "contact DCB", "oihan@dcb"
  imap_host       text NOT NULL DEFAULT 'imap.mail.ovh.net',
  imap_port       int  NOT NULL DEFAULT 993,
  smtp_host       text NOT NULL DEFAULT 'ssl0.ovh.net',
  smtp_port       int  NOT NULL DEFAULT 465,
  email           text NOT NULL UNIQUE,
  password_enc    text NOT NULL,                    -- AES-256-GCM chiffré (clé = IMAP_ENCRYPTION_KEY)
  active          boolean NOT NULL DEFAULT true,
  last_polled_at  timestamptz,
  agence          text,                             -- 'dcb' | 'lauian' | null
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE powerhouse_imap_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "imap_accounts_all" ON powerhouse_imap_accounts FOR ALL USING (true) WITH CHECK (true);

-- Templates de réponse par catégorie
CREATE TABLE IF NOT EXISTS email_templates (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name             text NOT NULL,
  category         text NOT NULL CHECK (category IN ('reservation_request','availability','check_in','check_out','supplier','general')),
  subject_template text NOT NULL,
  body_template    text NOT NULL,                   -- {{guest_name}}, {{bien_name}}, {{check_in}}, {{check_out}}, {{price}}
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz DEFAULT now()
);

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "email_templates_all" ON email_templates FOR ALL USING (true) WITH CHECK (true);

-- Jobs email : emails entrants classifiés + brouillons
CREATE TABLE IF NOT EXISTS email_jobs (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id       uuid REFERENCES powerhouse_imap_accounts(id) ON DELETE SET NULL,
  message_uid      text NOT NULL,                   -- UID IMAP pour dédup
  message_id       text,                            -- header Message-ID email
  from_email       text NOT NULL,
  from_name        text,
  subject          text,
  body_text        text,                            -- contenu plain text extrait
  received_at      timestamptz NOT NULL,
  -- Classification LLM
  bien_code        text,
  action_type      text CHECK (action_type IN ('reservation_request','inquiry','supplier','guest_message','admin','none')),
  confidence       float,
  hospitable_data  jsonb,                           -- dispo + quote si fetché
  -- Brouillon généré
  draft_subject    text,
  draft_body       text,
  template_id      uuid REFERENCES email_templates(id) ON DELETE SET NULL,
  -- Workflow
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','validated','sent','rejected','skipped')),
  validated_by     text,
  validated_at     timestamptz,
  sent_at          timestamptz,
  rejection_reason text,
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_jobs_status_idx ON email_jobs(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS email_jobs_account_idx ON email_jobs(account_id);

ALTER TABLE email_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "email_jobs_all" ON email_jobs FOR ALL USING (true) WITH CHECK (true);

-- Dédup : message_id email unique par compte
CREATE TABLE IF NOT EXISTS processed_emails (
  account_id  uuid NOT NULL REFERENCES powerhouse_imap_accounts(id) ON DELETE CASCADE,
  message_uid text NOT NULL,
  processed_at timestamptz DEFAULT now(),
  PRIMARY KEY (account_id, message_uid)
);

ALTER TABLE processed_emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "processed_emails_all" ON processed_emails FOR ALL USING (true) WITH CHECK (true);
