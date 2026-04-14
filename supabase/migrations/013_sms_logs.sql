-- ============================================================
-- SMS logs — avis 5 étoiles → remerciement client
-- ============================================================

CREATE TABLE IF NOT EXISTS sms_logs (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospitable_reservation_id  text,
  guest_name                 text,
  guest_phone                text,
  language                   text CHECK (language IN ('FR', 'EN', 'ES')),
  rating                     int,
  sms_body                   text,
  status                     text NOT NULL CHECK (status IN ('sent', 'error', 'no_phone', 'skipped')),
  twilio_sid                 text,
  error_message              text,
  sent_at                    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sms_logs ENABLE ROW LEVEL SECURITY;

-- Service role only (Edge Function)
CREATE POLICY "service role full access" ON sms_logs
  FOR ALL USING (auth.role() = 'service_role');
