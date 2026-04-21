-- Migration 020 : RLS sur encaissement_allocation et encaissement_anomalie
--
-- Ces tables sont lues par dcb-compta (rôle anon) et écrites par l'Edge Function
-- allocate-encaissements (service role — bypass RLS automatique).
-- Le portail AE n'y accède jamais.

ALTER TABLE encaissement_allocation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_can_select_encaissement_allocation" ON encaissement_allocation
  FOR SELECT TO anon USING (true);

ALTER TABLE encaissement_anomalie ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_can_select_encaissement_anomalie" ON encaissement_anomalie
  FOR SELECT TO anon USING (true);
