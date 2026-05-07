-- Migration 125 : intégration Powens Open Banking (AIS + PIS)

-- Connexions bancaires Powens
CREATE TABLE IF NOT EXISTS powens_connection (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agence                text NOT NULL,
  account_label         text NOT NULL, -- 'seq_lc' | 'seq_lld_loyers' | 'agence'
  powens_user_id        text,
  powens_connection_id  text,
  powens_account_id     text,
  access_token          text,
  refresh_token         text,
  token_expires_at      timestamptz,
  connection_expires_at timestamptz,  -- re-SCA dans 180 jours
  connection_state      text NOT NULL DEFAULT 'disconnected',
  -- 'disconnected' | 'pending_webview' | 'connected' | 'expired' | 'error'
  pending_state         text,         -- CSRF token pour le callback OAuth
  last_sync_at          timestamptz,
  last_error            text,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),
  UNIQUE(agence, account_label)
);

-- Transactions brutes (staging avant import dans mouvement_bancaire)
CREATE TABLE IF NOT EXISTS powens_transaction_raw (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  powens_transaction_id   text UNIQUE NOT NULL,
  powens_account_id       text NOT NULL,
  agence                  text NOT NULL,
  raw_payload             jsonb NOT NULL,
  date_operation          date,
  date_valeur             date,
  libelle                 text,
  detail                  text,
  montant_centimes        integer, -- négatif = débit
  type_powens             text,
  statut                  text NOT NULL DEFAULT 'a_importer',
  -- 'a_importer' | 'importe' | 'ignore'
  mouvement_bancaire_id   uuid REFERENCES mouvement_bancaire(id) ON DELETE SET NULL,
  imported_at             timestamptz,
  created_at              timestamptz DEFAULT now()
);

-- Paiements PIS initiés
CREATE TABLE IF NOT EXISTS powens_payment (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agence              text NOT NULL,
  powens_payment_id   text UNIQUE,
  mois_comptable      text NOT NULL,
  type_virement       text NOT NULL,
  montant_centimes    integer NOT NULL,
  creditor_iban       text NOT NULL,
  creditor_nom        text NOT NULL,
  remittance          text,
  end_to_end_id       text,
  statut              text NOT NULL DEFAULT 'en_attente',
  -- 'en_attente' | 'sca_pending' | 'accepted' | 'executed' | 'rejected' | 'cancelled'
  sca_redirect_url    text,
  ventilation_ids     uuid[],
  raw_response        jsonb,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_powens_tx_agence_statut ON powens_transaction_raw(agence, statut);
CREATE INDEX IF NOT EXISTS idx_powens_tx_account ON powens_transaction_raw(powens_account_id);
CREATE INDEX IF NOT EXISTS idx_powens_payment_mois ON powens_payment(agence, mois_comptable);

-- RLS : uniquement service_role (tokens sensibles)
ALTER TABLE powens_connection ENABLE ROW LEVEL SECURITY;
ALTER TABLE powens_transaction_raw ENABLE ROW LEVEL SECURITY;
ALTER TABLE powens_payment ENABLE ROW LEVEL SECURITY;

-- Les edge functions utilisent service_role qui bypass RLS
-- Accès frontend via anon seulement pour les champs non-sensibles (via vue ou select limité)
