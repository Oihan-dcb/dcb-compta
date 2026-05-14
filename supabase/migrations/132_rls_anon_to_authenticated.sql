-- Migration 132 : RLS Phase 1 — anon/public → authenticated
--
-- Périmètre : tables dont on est certain que tous les accès légitimes
--             viennent d'utilisateurs authentifiés (admin DCB, Laura, AEs portail).
--             service_role contourne toujours le RLS → Edge Functions non impactées.
--
-- Contrainte PowerHouse (hors périmètre) :
--   PowerHouse utilise l'anon key sans JWT. Les tables PowerHouse-dépendantes
--   (planning_events, equipment*, roadmap*, settings, tech_*, day_notes, etc.)
--   sont traitées en Phase 2 après vérification des accès PowerHouse.
--
-- Contrainte portail AE (anon SELECT partiel) :
--   auto_entrepreneur, bien, bien_toolbox, bien_maintenance : anon SELECT conservé
--   (à vérifier si portail AE est toujours en anon key pour ces tables).

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Clôture comptable (migration 129 — créée avec public ALL par erreur)
-- ═══════════════════════════════════════════════════════════════════════════

-- cloture_comptable : seul Oïhan clôture — doit être authenticated
DROP POLICY IF EXISTS "cloture_comptable_all" ON cloture_comptable;
DROP POLICY IF EXISTS "authenticated_all_cloture_comptable" ON cloture_comptable;
CREATE POLICY "authenticated_all_cloture_comptable" ON cloture_comptable
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- cloture_audit : append-only via triggers, lecture admin — authenticated
DROP POLICY IF EXISTS "cloture_audit_select" ON cloture_audit;
DROP POLICY IF EXISTS "cloture_audit_insert" ON cloture_audit;
DROP POLICY IF EXISTS "authenticated_cloture_audit_select" ON cloture_audit;
DROP POLICY IF EXISTS "authenticated_cloture_audit_insert" ON cloture_audit;
CREATE POLICY "authenticated_cloture_audit_select" ON cloture_audit
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_cloture_audit_insert" ON cloture_audit
  FOR INSERT TO authenticated WITH CHECK (true);

-- webhook_pending : écrit par Edge Function (service_role), lu/traité par admin — authenticated
DROP POLICY IF EXISTS "webhook_pending_all" ON webhook_pending;
DROP POLICY IF EXISTS "authenticated_all_webhook_pending" ON webhook_pending;
CREATE POLICY "authenticated_all_webhook_pending" ON webhook_pending
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 2 — LLD / portail étudiant Laura (migration 031/052 — public ALL)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'etudiant', 'etudiant_document',
    'loyer_suivi', 'lld_log', 'lld_mouvement_bancaire',
    'caution_suivi', 'virement_proprio_suivi', 'mandat_gestion'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      -- Supprimer toutes les policies anon/public existantes
      EXECUTE format('DROP POLICY IF EXISTS "anon_all_%s" ON %I', t, t);
      EXECUTE format('DROP POLICY IF EXISTS "open_all_%s" ON %I', t, t);
      EXECUTE format('DROP POLICY IF EXISTS "auth_laura_%s" ON %I', t, t);  -- remplacé par authenticated_all
      -- Tout utilisateur authentifié (Oïhan + Laura + futurs admins)
      EXECUTE format('DROP POLICY IF EXISTS "authenticated_all_%s" ON %I', t, t);
      EXECUTE format(
        'CREATE POLICY "authenticated_all_%s" ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
        t, t
      );
    END IF;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 3 — SMS (admin DCB uniquement)
-- ═══════════════════════════════════════════════════════════════════════════

-- sms_queue
DROP POLICY IF EXISTS "anon_all_sms_queue" ON sms_queue;
DROP POLICY IF EXISTS "anon read" ON sms_queue;
DROP POLICY IF EXISTS "service role full access" ON sms_queue;
DROP POLICY IF EXISTS "authenticated_all_sms_queue" ON sms_queue;
CREATE POLICY "authenticated_all_sms_queue" ON sms_queue
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- sms_logs
DROP POLICY IF EXISTS "anon_all_sms_logs" ON sms_logs;
DROP POLICY IF EXISTS "anon read sms_logs" ON sms_logs;
DROP POLICY IF EXISTS "service role full access" ON sms_logs;
DROP POLICY IF EXISTS "authenticated_all_sms_logs" ON sms_logs;
CREATE POLICY "authenticated_all_sms_logs" ON sms_logs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Email / IMAP (PowerHouse serveur — service_role uniquement)
-- ═══════════════════════════════════════════════════════════════════════════

-- hospitable_messages (réservations Airbnb/Booking — sensible)
DROP POLICY IF EXISTS "hospitable_messages_service_all" ON hospitable_messages;
DROP POLICY IF EXISTS "anon_all_hospitable_messages" ON hospitable_messages;
DROP POLICY IF EXISTS "authenticated_all_hospitable_messages" ON hospitable_messages;
CREATE POLICY "authenticated_all_hospitable_messages" ON hospitable_messages
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- email_jobs
DROP POLICY IF EXISTS "email_jobs_all" ON email_jobs;
DROP POLICY IF EXISTS "authenticated_all_email_jobs" ON email_jobs;
CREATE POLICY "authenticated_all_email_jobs" ON email_jobs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- email_templates
DROP POLICY IF EXISTS "email_templates_all" ON email_templates;
DROP POLICY IF EXISTS "authenticated_all_email_templates" ON email_templates;
CREATE POLICY "authenticated_all_email_templates" ON email_templates
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- processed_emails
DROP POLICY IF EXISTS "processed_emails_all" ON processed_emails;
DROP POLICY IF EXISTS "anon_all_processed_emails" ON processed_emails;
DROP POLICY IF EXISTS "authenticated_all_processed_emails" ON processed_emails;
CREATE POLICY "authenticated_all_processed_emails" ON processed_emails
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- mail_ai_analysis
DROP POLICY IF EXISTS "anon_all_mail_ai_analysis" ON mail_ai_analysis;
DROP POLICY IF EXISTS "authenticated_all_mail_ai_analysis" ON mail_ai_analysis;
CREATE POLICY "authenticated_all_mail_ai_analysis" ON mail_ai_analysis
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- mail_messages
DROP POLICY IF EXISTS "anon_all_mail_messages" ON mail_messages;
DROP POLICY IF EXISTS "authenticated_all_mail_messages" ON mail_messages;
CREATE POLICY "authenticated_all_mail_messages" ON mail_messages
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 5 — Chat : chat_room_state + portail AE tables
-- ═══════════════════════════════════════════════════════════════════════════

-- chat_room_state (état de lecture des rooms — users authentifiés uniquement)
DROP POLICY IF EXISTS "chat_room_state_all" ON chat_room_state;
DROP POLICY IF EXISTS "service_role_all_chat_room_state" ON chat_room_state;
DROP POLICY IF EXISTS "authenticated_all_chat_room_state" ON chat_room_state;
CREATE POLICY "authenticated_all_chat_room_state" ON chat_room_state
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- chat_polls + chat_poll_votes (portail AE — AEs sont authenticated)
DROP POLICY IF EXISTS "poll_insert" ON chat_polls;
DROP POLICY IF EXISTS "poll_select" ON chat_polls;
DROP POLICY IF EXISTS "authenticated_all_chat_polls" ON chat_polls;
CREATE POLICY "authenticated_all_chat_polls" ON chat_polls
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "vote_insert" ON chat_poll_votes;
DROP POLICY IF EXISTS "vote_select" ON chat_poll_votes;
DROP POLICY IF EXISTS "vote_delete" ON chat_poll_votes;
DROP POLICY IF EXISTS "authenticated_all_chat_poll_votes" ON chat_poll_votes;
CREATE POLICY "authenticated_all_chat_poll_votes" ON chat_poll_votes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- chat_message_reactions (portail AE — authenticated)
DROP POLICY IF EXISTS "allow all chat_message_reactions" ON chat_message_reactions;
DROP POLICY IF EXISTS "authenticated_all_chat_message_reactions" ON chat_message_reactions;
CREATE POLICY "authenticated_all_chat_message_reactions" ON chat_message_reactions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- chat_group_members : SELECT public conservé (PowerHouse), WRITE → authenticated
DROP POLICY IF EXISTS "chat_group_members_insert" ON chat_group_members;
DROP POLICY IF EXISTS "chat_group_members_delete" ON chat_group_members;
DROP POLICY IF EXISTS "chat_group_members_write" ON chat_group_members;
CREATE POLICY "chat_group_members_write" ON chat_group_members
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- chat_group_members_select (public SELECT) conservé pour PowerHouse

-- chat_groups : SELECT public conservé (PowerHouse), INSERT → authenticated
DROP POLICY IF EXISTS "chat_groups_insert" ON chat_groups;
DROP POLICY IF EXISTS "chat_groups_write" ON chat_groups;
CREATE POLICY "chat_groups_write" ON chat_groups
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- chat_groups_select (public SELECT) conservé pour PowerHouse

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 6 — Portail AE : memo_bien, prestation_hors_forfait, mission_menage
-- ═══════════════════════════════════════════════════════════════════════════

-- memo_bien (fiches bien dans portail AE — AE = authenticated)
DROP POLICY IF EXISTS "memo_bien_select" ON memo_bien;
DROP POLICY IF EXISTS "memo_bien_insert" ON memo_bien;
DROP POLICY IF EXISTS "memo_bien_update" ON memo_bien;
DROP POLICY IF EXISTS "memo_bien_delete" ON memo_bien;
DROP POLICY IF EXISTS "authenticated_all_memo_bien" ON memo_bien;
CREATE POLICY "authenticated_all_memo_bien" ON memo_bien
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- prestation_hors_forfait (portail AE — AE = authenticated)
DROP POLICY IF EXISTS "phf_select" ON prestation_hors_forfait;
DROP POLICY IF EXISTS "phf_insert" ON prestation_hors_forfait;
DROP POLICY IF EXISTS "phf_update" ON prestation_hors_forfait;
DROP POLICY IF EXISTS "authenticated_all_prestation_hors_forfait" ON prestation_hors_forfait;
CREATE POLICY "authenticated_all_prestation_hors_forfait" ON prestation_hors_forfait
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- mission_menage : UPDATE était public (vulnérable), le reste était déjà authenticated
DROP POLICY IF EXISTS "mission_update" ON mission_menage;
DROP POLICY IF EXISTS "authenticated_mission_update" ON mission_menage;
CREATE POLICY "authenticated_mission_update" ON mission_menage
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 7 — Tables admin DCB pures (taxe, config, staff)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'taxe_sejour_config', 'laura_facture', 'fournisseur_recurrent',
    'staff_heures_jour', 'staff_rdv',
    'agency_config', 'bien_toolbox'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('DROP POLICY IF EXISTS "anon_all_%s" ON %I', t, t);
      EXECUTE format('DROP POLICY IF EXISTS "authenticated_all_%s" ON %I', t, t);
      -- Drop anon SELECT partiel si existant (bien_toolbox a un anon_select séparé)
      EXECUTE format('DROP POLICY IF EXISTS "%s_anon_select" ON %I', t, t);
      EXECUTE format(
        'CREATE POLICY "authenticated_all_%s" ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
        t, t
      );
    END IF;
  END LOOP;
END $$;
