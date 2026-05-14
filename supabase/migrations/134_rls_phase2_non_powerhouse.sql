-- Migration 134 : RLS Phase 2 — nettoyage tables non-PowerHouse
--
-- Périmètre : tables dont l'accès anon/public est injustifié
--             (ni PowerHouse, ni portail AE, ni service_role seul).
--
-- Tables PowerHouse intentionnellement conservées (sans repo source on ne touche pas) :
--   chat_group_members, chat_groups, chat_llm_jobs, chat_message_files,
--   chat_message_reads, day_notes, devis_requests, equipment*, ical_annotations,
--   manual_missions, media_library, mission_state, planning_events,
--   powerhouse_settings, property_tech, roadmap_*, staff_leave, staff_off,
--   tech_contacts, tech_issue_notes, tech_issues, toolbox_procedures, webhook_log.
--
-- Tables portail AE (anon SELECT conservé) :
--   auto_entrepreneur, bien, bien_maintenance, planning_events.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. airbnb_payout_line — données financières, accès admin uniquement
--    La policy authenticated ALL existe déjà ; on supprime l'anon ALL en doublon
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Allow anon airbnb_payout_line" ON airbnb_payout_line;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. bug_report — nettoyage doublon dangereux
--    Conserver : anon INSERT (rapport public) + anon SELECT + anon UPDATE statut
--    Supprimer : anon_all_bug_report (ALL public — superset inutile)
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "anon_all_bug_report" ON bug_report;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. bien_toolbox — doublon : deux policies authenticated
--    authenticated_all (créée avant 132) + authenticated_all_bien_toolbox (132)
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated_all" ON bien_toolbox;
