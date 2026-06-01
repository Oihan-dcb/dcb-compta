-- Migration 174 — payment_guarantees
-- Empreinte bancaire via Stripe SetupIntent.
-- Aucun montant débité ni bloqué lors de la signature.
-- La carte est enregistrée comme garantie hôtelière.
-- Débit possible uniquement en cas de frais/dégâts réels constatés
-- après le séjour (PaymentIntent off_session du montant réel justifié).

CREATE TABLE IF NOT EXISTS payment_guarantees (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES rental_contracts(id) ON DELETE CASCADE,
  agence      TEXT NOT NULL,

  -- ── Stripe — empreinte uniquement (SetupIntent) ───────────────────────────
  -- Aucun montant, aucune autorisation, aucun blocage sur la CB.
  stripe_customer_id       TEXT,
  stripe_setup_intent_id   TEXT,
  stripe_payment_method_id TEXT,   -- payment_method enregistré après SetupIntent succeeded
  stripe_card_last4        TEXT,
  stripe_card_brand        TEXT,   -- visa | mastercard | amex | cb | ...
  stripe_card_exp          TEXT,   -- "07/28"

  -- ── Statut ────────────────────────────────────────────────────────────────
  statut TEXT NOT NULL DEFAULT 'pending',
  -- pending     → SetupIntent créé, CB pas encore enregistrée
  -- card_saved  → CB enregistrée, séjour en cours ou à venir
  -- charged     → débit effectué suite à frais/dégâts réels justifiés
  -- released    → séjour terminé sans incident, empreinte supprimée
  -- expired     → CB expirée entre signature et fin séjour
  -- failed      → SetupIntent échoué (refus CB, abandon)

  card_saved_at  TIMESTAMPTZ,
  charged_at     TIMESTAMPTZ,
  released_at    TIMESTAMPTZ,

  -- ── Débit (si frais/dégâts) ──────────────────────────────────────────────
  -- Déclenché uniquement manuellement depuis PowerHouse,
  -- après constat et justification. Le voyageur est informé avant débit.
  charge_payment_intent_id TEXT,
  charge_amount_cts        INT,      -- montant réel en centimes
  charge_reason            TEXT,     -- justification textuelle
  charge_photos_urls       TEXT[],   -- preuves (photos dégâts)

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE payment_guarantees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_all" ON payment_guarantees
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read" ON payment_guarantees
  FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_payment_guarantees_contract
  ON payment_guarantees(contract_id);

CREATE INDEX IF NOT EXISTS idx_payment_guarantees_statut
  ON payment_guarantees(agence, statut);
