-- Migration 172 — contract_sign_sessions
-- Session de signature liée à un contrat.
-- Contient le token public (lien voyageur), l'état de chaque étape
-- et l'audit trail de la signature (IP, user-agent, canvas, clauses).

CREATE TABLE IF NOT EXISTS contract_sign_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id  UUID NOT NULL REFERENCES rental_contracts(id) ON DELETE CASCADE,

  -- Lien public sécurisé
  token        UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  expires_at   TIMESTAMPTZ NOT NULL,   -- NOW() + 72h à la création
  attempts     INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  statut       TEXT NOT NULL DEFAULT 'active',
  -- active | used | expired | revoked

  -- ── Étape 1 : OTP téléphone ───────────────────────────────────────────────
  -- Numéro vérifié = guest_snapshot.telephone (non modifiable par le voyageur)
  phone_verified    BOOLEAN NOT NULL DEFAULT false,
  otp_sent_at       TIMESTAMPTZ,
  otp_verified_at   TIMESTAMPTZ,

  -- ── Étape 2 : photo live (selfie) ────────────────────────────────────────
  -- Stockée dans Supabase Storage, bucket privé contracts-identity
  -- Accès service_role uniquement
  identity_photo_url TEXT,
  identity_verified  BOOLEAN NOT NULL DEFAULT false,
  identity_taken_at  TIMESTAMPTZ,

  -- ── Étape 3 : lecture + acceptation clauses ──────────────────────────────
  -- Bouton "Suivant" actif uniquement si scroll ≥ 95% ET toutes clauses cochées
  clauses_accepted   JSONB DEFAULT '{}',
  -- {
  --   "contrat": true,
  --   "garantie_cb": true,
  --   "rgpd_bailleur": true,
  --   "rgpd_locataire": true
  -- }
  scroll_pct_atteint INT DEFAULT 0,    -- % de scroll atteint (doit être >= 95)
  clauses_done_at    TIMESTAMPTZ,

  -- ── Étape 4 : signature manuscrite ───────────────────────────────────────
  signature_canvas   TEXT,             -- base64 du dessin (canvas.toDataURL)
  signature_done_at  TIMESTAMPTZ,

  -- ── Étape 5 : SetupIntent confirmé ───────────────────────────────────────
  stripe_confirmed   BOOLEAN NOT NULL DEFAULT false,
  stripe_done_at     TIMESTAMPTZ,

  -- ── Audit final ──────────────────────────────────────────────────────────
  signed_at          TIMESTAMPTZ,
  ip_address         TEXT,
  user_agent         TEXT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE contract_sign_sessions ENABLE ROW LEVEL SECURITY;

-- Service role = accès complet
CREATE POLICY "service_all" ON contract_sign_sessions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Pas de politique anon/authenticated : la session est accédée
-- uniquement via le token dans l'API publique sign-contract.js
-- (pas d'accès direct PostgREST côté client)

CREATE INDEX IF NOT EXISTS idx_sign_sessions_contract
  ON contract_sign_sessions(contract_id);

CREATE INDEX IF NOT EXISTS idx_sign_sessions_token
  ON contract_sign_sessions(token)
  WHERE statut = 'active';
