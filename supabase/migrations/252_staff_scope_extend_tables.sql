-- 252_staff_scope_extend_tables.sql
-- Phase 2b (accès staff scopé géographique — Léa Escudier / Bordeaux+Bassin) : étend le scoping
-- posé en migration 223 (bien.secteur / my_scoped_bien_ids()) aux tables qui ont un bien_id réel
-- (FK confirmée vers bien.id) et une policy staff/internal aujourd'hui non scopée.
--
-- Comportement inchangé pour tout le monde AUJOURD'HUI : secteurs est NULL pour tous les comptes
-- existants → my_secteurs() renvoie NULL → toutes les policies ci-dessous équivalent exactement
-- à l'ancien comportement. Vérifié par tests d'impersonation après application.
--
-- Transform appliqué :
--   auth_user_is_staff()    →  auth_user_is_staff() AND (my_secteurs() IS NULL OR bien_id IN (SELECT my_scoped_bien_ids()))
--   auth_user_is_internal() →  (auth_user_is_staff() AND <même check>) OR (auth_user_is_internal() AND NOT auth_user_is_staff())
--     (préserve l'accès plein d'un AE de terrain non-staff, qui n'a pas vocation à être scopé ici)
--
-- Hors scope de cette migration (documenté, pas oublié) :
--   - bien_maintenance : bien_id est TEXT (pas uuid, pas de FK) — sémantique à clarifier avant d'y toucher.
--   - planning_events : pas de colonne bien_id du tout (agenda personnel par staff_id) — non applicable.
--   - mission_menage : policies gated sur auth_user_is_bureau()/auth_user_owns_ae(), jamais sur
--     auth_user_is_staff() seul — un staff scopé (non bureau) n'y a de toute façon aucun accès
--     aujourd'hui, scoper ne changerait rien ; à traiter séparément si besoin métier réel.
--   - Les endpoints api/*.js en service_role (bypassent la RLS) — risque n°1 identifié par
--     l'audit initial, chantier à part.

-- ── Helper : biens via bien_toolbox.id (signalements, inventaire_bien_*) ────────────────────
create or replace function my_scoped_bien_toolbox_ids()
returns setof uuid
language sql stable security definer
set search_path = 'public'
as $$
  select t.id from bien_toolbox t where t.bien_id in (select my_scoped_bien_ids());
$$;

-- ── bien_notes ────────────────────────────────────────────────────────────────────────────
drop policy if exists staff_all_bien_notes on bien_notes;
create policy staff_all_bien_notes on bien_notes for all to authenticated
  using (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
  with check (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));

-- ── bien_pret_jour (staff write only — le SELECT internal_select_bien_pret_jour reste tel quel) ──
drop policy if exists staff_write_bien_pret_jour on bien_pret_jour;
create policy staff_write_bien_pret_jour on bien_pret_jour for all to authenticated
  using (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
  with check (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));

-- ── mandat_signature ──────────────────────────────────────────────────────────────────────
drop policy if exists mandat_sig_staff_all on mandat_signature;
create policy mandat_sig_staff_all on mandat_signature for all to authenticated
  using (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
  with check (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));

drop policy if exists mandat_sig_select on mandat_signature;
create policy mandat_sig_select on mandat_signature for select to authenticated
  using (
    (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
    or (proprietaire_id in (select my_proprietaire_ids()))
  );

-- ── rental_contracts (le SELECT staff seulement — service_all pour service_role reste tel quel) ──
drop policy if exists rental_contracts_staff_select on rental_contracts;
create policy rental_contracts_staff_select on rental_contracts for select to authenticated
  using (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));

-- ── reservation ───────────────────────────────────────────────────────────────────────────
drop policy if exists reservation_staff_all on reservation;
create policy reservation_staff_all on reservation for all to authenticated
  using (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
  with check (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));

-- ── tech_issues ───────────────────────────────────────────────────────────────────────────
drop policy if exists tech_issues_staff_write on tech_issues;
create policy tech_issues_staff_write on tech_issues for all to authenticated
  using (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
  with check (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));

drop policy if exists tech_issues_select_scoped on tech_issues;
create policy tech_issues_select_scoped on tech_issues for select to authenticated
  using (
    (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
    or (bien_id in (select my_bien_ids()))
    or (exists (
      select 1 from mission_menage m join auto_entrepreneur a on a.id = m.ae_id
      where m.bien_id = tech_issues.bien_id and a.ae_user_id = auth.uid()
    ))
  );

-- ── auth_user_is_internal() → staff scopé OR (internal non-staff, càd AE, inchangé) ─────────
drop policy if exists bien_toolbox_internal_all on bien_toolbox;
create policy bien_toolbox_internal_all on bien_toolbox for all to authenticated
  using ((auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids()))) or (auth_user_is_internal() and not auth_user_is_staff()))
  with check ((auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids()))) or (auth_user_is_internal() and not auth_user_is_staff()));

drop policy if exists memo_bien_internal_all on memo_bien;
create policy memo_bien_internal_all on memo_bien for all to authenticated
  using ((auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids()))) or (auth_user_is_internal() and not auth_user_is_staff()))
  with check ((auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids()))) or (auth_user_is_internal() and not auth_user_is_staff()));

drop policy if exists internal_all_media_library on media_library;
create policy internal_all_media_library on media_library for all to authenticated
  using ((auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids()))) or (auth_user_is_internal() and not auth_user_is_staff()))
  with check ((auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids()))) or (auth_user_is_internal() and not auth_user_is_staff()));

drop policy if exists cloture_bien_internal_select on cloture_bien;
create policy cloture_bien_internal_select on cloture_bien for select to authenticated
  using ((auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids()))) or (auth_user_is_internal() and not auth_user_is_staff()));

drop policy if exists cloture_bien_internal_insert on cloture_bien;
create policy cloture_bien_internal_insert on cloture_bien for insert to authenticated
  with check ((auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids()))) or (auth_user_is_internal() and not auth_user_is_staff()));

drop policy if exists manual_missions_internal_all on manual_missions;
create policy manual_missions_internal_all on manual_missions for all to authenticated
  using ((auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids()))) or (auth_user_is_internal() and not auth_user_is_staff()))
  with check ((auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids()))) or (auth_user_is_internal() and not auth_user_is_staff()));

drop policy if exists internal_all_reservation_review on reservation_review;
create policy internal_all_reservation_review on reservation_review for all to authenticated
  using ((auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids()))) or (auth_user_is_internal() and not auth_user_is_staff()))
  with check ((auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids()))) or (auth_user_is_internal() and not auth_user_is_staff()));

drop policy if exists internal_all_bien_review_synthesis on bien_review_synthesis;
create policy internal_all_bien_review_synthesis on bien_review_synthesis for all to authenticated
  using ((auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids()))) or (auth_user_is_internal() and not auth_user_is_staff()))
  with check ((auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids()))) or (auth_user_is_internal() and not auth_user_is_staff()));

-- ── signalements / inventaire_bien_* : bien_id référence bien_toolbox.id (convention, pas FK) ──
drop policy if exists signalements_select_internal on signalements;
create policy signalements_select_internal on signalements for select to authenticated
  using ((auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_toolbox_ids()))) or (auth_user_is_internal() and not auth_user_is_staff()));

drop policy if exists signalements_insert_internal on signalements;
create policy signalements_insert_internal on signalements for insert to authenticated
  with check ((auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_toolbox_ids()))) or (auth_user_is_internal() and not auth_user_is_staff()));

drop policy if exists signalements_update_internal on signalements;
create policy signalements_update_internal on signalements for update to authenticated
  using ((auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_toolbox_ids()))) or (auth_user_is_internal() and not auth_user_is_staff()))
  with check ((auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_toolbox_ids()))) or (auth_user_is_internal() and not auth_user_is_staff()));

drop policy if exists inventaire_bien_stock_internal_all on inventaire_bien_stock;
create policy inventaire_bien_stock_internal_all on inventaire_bien_stock for all to authenticated
  using ((auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_toolbox_ids()))) or (auth_user_is_internal() and not auth_user_is_staff()))
  with check ((auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_toolbox_ids()))) or (auth_user_is_internal() and not auth_user_is_staff()));

drop policy if exists inventaire_bien_config_internal_all on inventaire_bien_config;
create policy inventaire_bien_config_internal_all on inventaire_bien_config for all to authenticated
  using ((auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_toolbox_ids()))) or (auth_user_is_internal() and not auth_user_is_staff()))
  with check ((auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_toolbox_ids()))) or (auth_user_is_internal() and not auth_user_is_staff()));

-- ── proprietaire : scope UPDATE/DELETE via bien lié (my_secteurs() null → inchangé) ──────────
-- INSERT reste non scopé (proprio_staff_insert) : création possible avant tout bien rattaché.
drop policy if exists proprio_staff_update on proprietaire;
create policy proprio_staff_update on proprietaire for update to authenticated
  using (auth_user_is_staff() and (
    my_secteurs() is null
    or exists (select 1 from bien b where (b.proprietaire_id = proprietaire.id or b.co_proprietaire_id = proprietaire.id) and b.id in (select my_scoped_bien_ids()))
    or (not exists (select 1 from bien b where b.proprietaire_id = proprietaire.id or b.co_proprietaire_id = proprietaire.id) and proprietaire.created_at > now() - interval '48 hours')
  ))
  with check (auth_user_is_staff());

drop policy if exists proprio_staff_delete on proprietaire;
create policy proprio_staff_delete on proprietaire for delete to authenticated
  using (auth_user_is_staff() and (
    my_secteurs() is null
    or exists (select 1 from bien b where (b.proprietaire_id = proprietaire.id or b.co_proprietaire_id = proprietaire.id) and b.id in (select my_scoped_bien_ids()))
    or (not exists (select 1 from bien b where b.proprietaire_id = proprietaire.id or b.co_proprietaire_id = proprietaire.id) and proprietaire.created_at > now() - interval '48 hours')
  ));

drop policy if exists proprio_select_scoped on proprietaire;
create policy proprio_select_scoped on proprietaire for select to authenticated
using (
  (auth_user_is_staff() and (
    my_secteurs() is null
    or exists (select 1 from bien b where (b.proprietaire_id = proprietaire.id or b.co_proprietaire_id = proprietaire.id) and b.id in (select my_scoped_bien_ids()))
    or (not exists (select 1 from bien b where b.proprietaire_id = proprietaire.id or b.co_proprietaire_id = proprietaire.id) and proprietaire.created_at > now() - interval '48 hours')
  ))
  or (auth_user_id = auth.uid())
  or (id in (select my_proprietaire_ids()))
  or (email = my_auth_email())
  or (exists (
    select 1 from bien b join mission_menage m on m.bien_id = b.id join auto_entrepreneur a on a.id = m.ae_id
    where (b.proprietaire_id = proprietaire.id or b.co_proprietaire_id = proprietaire.id) and a.ae_user_id = auth.uid()
  ))
);
