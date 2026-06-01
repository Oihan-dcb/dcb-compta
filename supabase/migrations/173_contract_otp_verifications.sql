-- Migration 173 — contract_otp_verifications
-- OTP envoyé par Twilio pour vérifier le numéro de téléphone du locataire.
-- Le code n'est JAMAIS stocké en clair — uniquement le hash bcrypt.
-- Expire 10 min après création, max 5 tentatives.

CREATE TABLE IF NOT EXISTS contract_otp_verifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES contract_sign_sessions(id) ON DELETE CASCADE,

  -- Numéro depuis guest_snapshot.telephone (non modifiable par le voyageur)
  telephone   TEXT NOT NULL,

  -- Code OTP haché — bcrypt(code_6_chiffres, 10)
  -- Jamais le code en clair
  otp_hash    TEXT NOT NULL,

  -- Expiration et tentatives
  expires_at  TIMESTAMPTZ NOT NULL,    -- NOW() + 10 min
  attempts    INT NOT NULL DEFAULT 0,  -- max 5 avant invalidation
  verified    BOOLEAN NOT NULL DEFAULT false,
  verified_at TIMESTAMPTZ,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE contract_otp_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_all" ON contract_otp_verifications
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Un seul OTP actif (non vérifié, non expiré) par session
CREATE INDEX IF NOT EXISTS idx_otp_session_active
  ON contract_otp_verifications(session_id, verified, expires_at);
