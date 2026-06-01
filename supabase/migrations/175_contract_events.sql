-- Migration 175 — contract_events
-- Journal d'audit append-only : chaque événement du cycle de vie d'un contrat.
-- Aucun UPDATE ni DELETE autorisé — garanti par trigger DB.
-- Constitue la preuve juridique complète du processus de signature.

CREATE TABLE IF NOT EXISTS contract_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES rental_contracts(id),
  event_type  TEXT NOT NULL,
  -- Événements possibles :
  --
  -- Génération
  --   generated            → contrat créé depuis PowerHouse
  --   pdf_draft_created    → PDF draft généré et stocké
  --
  -- Envoi
  --   sent_email           → email envoyé au voyageur avec lien
  --   reminded             → relance email envoyée
  --
  -- Session de signature
  --   sign_page_opened     → voyageur a ouvert le lien
  --   otp_sent             → SMS OTP envoyé via Twilio
  --   otp_failed           → tentative OTP incorrecte
  --   otp_verified         → OTP validé
  --   identity_photo_taken → selfie pris et uploadé
  --   identity_verified    → étape photo complète
  --   scroll_complete      → lecture 95% du contrat atteinte
  --   clause_accepted      → une clause cochée (metadata.clause)
  --   signature_drawn      → signature canvas enregistrée
  --
  -- Finalisation
  --   signed               → contrat signé (toutes étapes complètes)
  --   pdf_signed_created   → PDF final avec signature généré
  --   confirmation_email   → email de confirmation + PDF envoyé au voyageur
  --
  -- Stripe
  --   stripe_setup_created → SetupIntent créé
  --   stripe_card_saved    → CB enregistrée (SetupIntent succeeded)
  --   stripe_setup_failed  → SetupIntent échoué
  --   stripe_charged       → débit effectué (frais/dégâts réels)
  --   stripe_released      → empreinte supprimée (fin séjour OK)
  --
  -- Fin de vie
  --   cancelled            → contrat annulé manuellement
  --   expired              → lien de signature expiré

  actor       TEXT,
  -- 'system'        → action automatique (génération, cron)
  -- 'staff:{ae_id}' → action manuelle depuis PowerHouse
  -- 'guest'         → action du voyageur sur la page signature

  metadata    JSONB DEFAULT '{}',
  -- Contexte libre selon event_type, ex :
  -- { "ip": "1.2.3.4", "email": "jean@...", "clause": "garantie_cb",
  --   "amount_cts": 8500, "reason": "dégâts cuisine", "scroll_pct": 97 }

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE contract_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_all" ON contract_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read" ON contract_events
  FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_contract_events_contract
  ON contract_events(contract_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contract_events_type
  ON contract_events(event_type, created_at DESC);

-- ── Trigger append-only ───────────────────────────────────────────────────────
-- Interdit tout UPDATE et DELETE sur cette table.
-- Le journal d'audit doit être immuable pour valeur probatoire.

CREATE OR REPLACE FUNCTION contract_events_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'contract_events est en lecture seule (append-only). Aucun UPDATE ni DELETE autorisé.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER no_update_contract_events
  BEFORE UPDATE OR DELETE ON contract_events
  FOR EACH ROW EXECUTE FUNCTION contract_events_immutable();
