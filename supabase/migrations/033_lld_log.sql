-- Migration 033 : Journal d'activité par étudiant (lld_log)
-- Trace toutes les actions : relances SMS/email, quittances, loyers reçus, virements

CREATE TABLE IF NOT EXISTS lld_log (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agence         text        NOT NULL DEFAULT 'dcb',
  etudiant_id    uuid        REFERENCES etudiant(id) ON DELETE CASCADE,
  loyer_suivi_id uuid        REFERENCES loyer_suivi(id) ON DELETE SET NULL,
  type           text        NOT NULL,
  -- 'sms_relance' | 'email_relance' | 'quittance_envoyee' | 'loyer_recu'
  -- | 'virement_effectue' | 'relance_escalade' | 'relance_manuelle'
  canal          text,        -- 'sms' | 'email' | 'pdf' | 'ui'
  destinataire   text,        -- numéro tel ou adresse email
  statut         text        DEFAULT 'ok', -- 'ok' | 'erreur'
  mois           text,        -- mois concerné (format YYYY-MM)
  details        jsonb       DEFAULT '{}', -- montant, nb_relance, message, etc.
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lld_log_etudiant_idx ON lld_log (etudiant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lld_log_agence_idx   ON lld_log (agence, created_at DESC);

-- RLS ouverte (cohérent avec les autres tables LLD)
ALTER TABLE lld_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open_all_lld_log" ON lld_log FOR ALL TO public USING (true) WITH CHECK (true);
