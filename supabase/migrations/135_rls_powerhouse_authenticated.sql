-- Migration 135 : RLS PowerHouse — anon/public → authenticated
--
-- PRÉREQUIS OBLIGATOIRE avant d'appliquer :
--   1. PowerHouse frontend a été déployé avec Supabase Auth (app.jsx login gate)
--   2. Tous les utilisateurs staff ont un compte Supabase Auth actif
--   3. Le login fonctionne en prod (tester sur powerhouse.vercel.app)
--   SINON : tout PowerHouse devient inaccessible.
--
-- Tables API routes service_role (déjà safe) :
--   equipment*, push_subscriptions, chat_messages, webhook_log, etc.
--   → service_role bypass RLS, non impactées par cette migration.
--
-- Tables conservées en anon SELECT (portail AE) :
--   auto_entrepreneur, bien, bien_maintenance — non touchées ici.

-- ═══════════════════════════════════════════════════════════════════════════
-- Planning & Missions (frontend PowerHouse lit en anon aujourd'hui)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'mission_state',
    'manual_missions',
    'planning_events',
    'day_notes',
    'ical_annotations',
    'roadmap_logs',
    'roadmap_schedule'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=t) THEN
      -- Supprimer toutes policies anon/public existantes
      EXECUTE format('DROP POLICY IF EXISTS "anon_all_%s" ON %I', t, t);
      EXECUTE format('DROP POLICY IF EXISTS "Allow all %s" ON %I', t, t);
      EXECUTE format('DROP POLICY IF EXISTS "Allow all for anon" ON %I', t);
      -- Créer policy authenticated
      EXECUTE format('DROP POLICY IF EXISTS "authenticated_all_%s" ON %I', t, t);
      EXECUTE format(
        'CREATE POLICY "authenticated_all_%s" ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
        t, t
      );
    END IF;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Équipements
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "equip_all" ON equipment;
DROP POLICY IF EXISTS "authenticated_all_equipment" ON equipment;
CREATE POLICY "authenticated_all_equipment" ON equipment
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "booking_all" ON equipment_bookings;
DROP POLICY IF EXISTS "authenticated_all_equipment_bookings" ON equipment_bookings;
CREATE POLICY "authenticated_all_equipment_bookings" ON equipment_bookings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_all" ON equipment_booking_logs;
DROP POLICY IF EXISTS "authenticated_all_equipment_booking_logs" ON equipment_booking_logs;
CREATE POLICY "authenticated_all_equipment_booking_logs" ON equipment_booking_logs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- Technique & Contacts
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'property_tech',
    'tech_contacts',
    'tech_issue_notes',
    'toolbox_procedures'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=t) THEN
      EXECUTE format('DROP POLICY IF EXISTS "anon_all_%s" ON %I', t, t);
      EXECUTE format('DROP POLICY IF EXISTS "Allow all %s" ON %I', t, t);
      EXECUTE format('DROP POLICY IF EXISTS "anon read %s" ON %I', t, t);
      EXECUTE format('DROP POLICY IF EXISTS "anon write %s" ON %I', t, t);
      EXECUTE format('DROP POLICY IF EXISTS "%s_read" ON %I', t, t);
      EXECUTE format('DROP POLICY IF EXISTS "%s_insert" ON %I', t, t);
      EXECUTE format('DROP POLICY IF EXISTS "%s_delete" ON %I', t, t);
      EXECUTE format('DROP POLICY IF EXISTS "authenticated_all_%s" ON %I', t, t);
      EXECUTE format(
        'CREATE POLICY "authenticated_all_%s" ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
        t, t
      );
    END IF;
  END LOOP;
END $$;

-- tech_issues : était ouvert aux anon (pour signalement portail AE / externe)
-- → authenticated uniquement (les AEs du portail sont authenticated)
DROP POLICY IF EXISTS "ti_insert" ON tech_issues;
DROP POLICY IF EXISTS "ti_select" ON tech_issues;
DROP POLICY IF EXISTS "authenticated_all_tech_issues" ON tech_issues;
CREATE POLICY "authenticated_all_tech_issues" ON tech_issues
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- Staff congés/absences (lecture planning)
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "staff_leave_anon_select" ON staff_leave;
DROP POLICY IF EXISTS "authenticated_all_staff_leave" ON staff_leave;
CREATE POLICY "authenticated_all_staff_leave" ON staff_leave
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "staff_off_anon_select" ON staff_off;
DROP POLICY IF EXISTS "authenticated_all_staff_off" ON staff_off;
CREATE POLICY "authenticated_all_staff_off" ON staff_off
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- Paramètres & Infrastructure PowerHouse
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "allow_all" ON powerhouse_settings;
DROP POLICY IF EXISTS "anon_all_powerhouse_settings" ON powerhouse_settings;
DROP POLICY IF EXISTS "authenticated_all_powerhouse_settings" ON powerhouse_settings;
CREATE POLICY "authenticated_all_powerhouse_settings" ON powerhouse_settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- webhook_log : écrit par mail-actions.js (service_role), lu par admin
DROP POLICY IF EXISTS "anon_all_webhook_log" ON webhook_log;
DROP POLICY IF EXISTS "wl_open" ON webhook_log;
DROP POLICY IF EXISTS "authenticated_all_webhook_log" ON webhook_log;
CREATE POLICY "authenticated_all_webhook_log" ON webhook_log
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- devis_requests : PowerHouse envoie/reçoit les devis
DROP POLICY IF EXISTS "anon read devis_requests" ON devis_requests;
DROP POLICY IF EXISTS "anon write devis_requests" ON devis_requests;
DROP POLICY IF EXISTS "anon_all_devis_requests" ON devis_requests;
DROP POLICY IF EXISTS "authenticated_all_devis_requests" ON devis_requests;
CREATE POLICY "authenticated_all_devis_requests" ON devis_requests
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- media_library : photos missions/biens
DROP POLICY IF EXISTS "anon_all_media_library" ON media_library;
DROP POLICY IF EXISTS "authenticated_all_media_library" ON media_library;
CREATE POLICY "authenticated_all_media_library" ON media_library
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- Chat infra (SELECT public conservé pour retro-compat Realtime PowerHouse)
-- Ces tables ont déjà des policies authenticated pour WRITE.
-- On ferme les SELECT public restants.
-- ═══════════════════════════════════════════════════════════════════════════

-- chat_group_members : WRITE déjà authenticated (132), fermer SELECT public
DROP POLICY IF EXISTS "chat_group_members_select" ON chat_group_members;
-- chat_group_members_write (authenticated ALL) couvre déjà SELECT

-- chat_groups : WRITE déjà authenticated (132), fermer SELECT public
DROP POLICY IF EXISTS "chat_groups_select" ON chat_groups;

-- chat_llm_jobs
DROP POLICY IF EXISTS "chat_llm_jobs_select" ON chat_llm_jobs;
DROP POLICY IF EXISTS "chat_llm_jobs_service_all" ON chat_llm_jobs;
DROP POLICY IF EXISTS "chat_llm_jobs_update" ON chat_llm_jobs;
DROP POLICY IF EXISTS "authenticated_all_chat_llm_jobs" ON chat_llm_jobs;
CREATE POLICY "authenticated_all_chat_llm_jobs" ON chat_llm_jobs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- chat_message_files
DROP POLICY IF EXISTS "chat_message_files_select" ON chat_message_files;
DROP POLICY IF EXISTS "authenticated_all_chat_message_files" ON chat_message_files;
CREATE POLICY "authenticated_all_chat_message_files" ON chat_message_files
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- chat_message_reads
DROP POLICY IF EXISTS "reads insert own" ON chat_message_reads;
DROP POLICY IF EXISTS "reads select all" ON chat_message_reads;
DROP POLICY IF EXISTS "authenticated_all_chat_message_reads" ON chat_message_reads;
CREATE POLICY "authenticated_all_chat_message_reads" ON chat_message_reads
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
