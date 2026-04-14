-- Lecture publique de sms_logs pour le dashboard DCB Compta (anon key)
CREATE POLICY "anon read sms_logs" ON sms_logs
  FOR SELECT USING (true);
