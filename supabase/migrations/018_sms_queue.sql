CREATE TABLE IF NOT EXISTS sms_queue (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospitable_reservation_id  text,
  guest_name                 text,
  guest_phone                text,
  guest_country              text,
  property_name              text,
  comment                    text,
  language                   text,
  rating                     int,
  send_at                    timestamptz NOT NULL,
  status                     text NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'sent', 'error', 'skipped')),
  error_message              text,
  twilio_sid                 text,
  created_at                 timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sms_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access" ON sms_queue
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "anon read sms_queue" ON sms_queue
  FOR SELECT USING (true);
