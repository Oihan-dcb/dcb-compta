-- Permet à la clé anonyme (dcb-compta) de lire les missions de ménage
-- Sans cette policy, seuls les AEs authentifiés voient leurs propres missions
-- mais l'app admin (clé anon) ne voit rien.
CREATE POLICY "anon_can_select_mission_menage" ON mission_menage
  FOR SELECT TO anon
  USING (true);
