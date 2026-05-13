-- Migration 129 : clôture comptable
-- Verrou mensuel par (mois, agence) en 3 étapes séquentielles :
--   1. ventil      → bloque reventilation + sync webhooks
--   2. rappro      → bloque mouvements bancaires + rapprochements
--   3. facturat    → bloque prestations AE + push Evoliz
--
-- cloture_audit est INEFAÇABLE : triggers interdisent DELETE et UPDATE

-- ── Table principale ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cloture_comptable (
  mois             text        NOT NULL,          -- YYYY-MM
  agence           text        NOT NULL,          -- 'dcb' | 'lauian'
  cloture_ventil   timestamptz,                   -- NULL = étape ouverte
  cloture_rappro   timestamptz,
  cloture_facturat timestamptz,
  cloture_by       text,                          -- email du dernier acteur
  reouvertures     jsonb       NOT NULL DEFAULT '[]'::jsonb,  -- append-only
  PRIMARY KEY (mois, agence)
);

ALTER TABLE cloture_comptable ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cloture_comptable_all" ON cloture_comptable
  USING (true) WITH CHECK (true);

-- ── Table audit inefaçable ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cloture_audit (
  id      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  mois    text        NOT NULL,
  agence  text        NOT NULL,
  action  text        NOT NULL,  -- 'cloture_ventil' | 'reouverture_ventil' | 'cloture_rappro' | ...
  by      text        NOT NULL,
  at      timestamptz NOT NULL DEFAULT now(),
  note    text
);

ALTER TABLE cloture_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cloture_audit_select" ON cloture_audit FOR SELECT USING (true);
CREATE POLICY "cloture_audit_insert" ON cloture_audit FOR INSERT WITH CHECK (true);
-- Pas de policy DELETE / UPDATE → RLS bloque les rôles anon/authenticated
-- Les triggers ci-dessous bloquent également service_role

CREATE OR REPLACE FUNCTION _prevent_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'cloture_audit est inefaçable — suppressions et modifications interdites';
END;
$$;

CREATE TRIGGER no_delete_cloture_audit
  BEFORE DELETE ON cloture_audit
  FOR EACH ROW EXECUTE FUNCTION _prevent_audit_mutation();

CREATE TRIGGER no_update_cloture_audit
  BEFORE UPDATE ON cloture_audit
  FOR EACH ROW EXECUTE FUNCTION _prevent_audit_mutation();

-- ── File d'attente webhooks sur mois clôturé ─────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_pending (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  mois         text        NOT NULL,
  agence       text        NOT NULL,
  event        text        NOT NULL,
  payload      jsonb       NOT NULL,
  reason       text        NOT NULL DEFAULT 'mois_cloture',
  received_at  timestamptz NOT NULL DEFAULT now(),
  treated_at   timestamptz,
  treated_by   text,
  action_taken text        -- 'ignore' | 'reouverture_integre' | 'integre_manuellement'
);

ALTER TABLE webhook_pending ENABLE ROW LEVEL SECURITY;
CREATE POLICY "webhook_pending_all" ON webhook_pending
  USING (true) WITH CHECK (true);

-- ── Index ─────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_cloture_audit_mois   ON cloture_audit(mois, agence);
CREATE INDEX IF NOT EXISTS idx_webhook_pending_mois  ON webhook_pending(mois, treated_at NULLS FIRST);
CREATE INDEX IF NOT EXISTS idx_cloture_comptable_mois ON cloture_comptable(mois DESC);
