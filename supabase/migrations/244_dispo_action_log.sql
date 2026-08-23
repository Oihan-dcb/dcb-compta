-- 244_dispo_action_log.sql
--
-- Journal des actions manuelles posées depuis "Dispos" (PowerHouse) sur le calendrier
-- d'un bien : bloquer/débloquer une période, régler min_stay/prix, créer une réservation
-- directe. Voir dcb-planning/api/dispo-action.js.
--
-- Pourquoi cette table existe : property_calendar est réécrit toutes les 5 min par
-- sync-ical-planning (DELETE + INSERT depuis Hospitable, migration 155) — aucune écriture
-- manuelle n'y survit. La seule cible d'écriture valable pour une action est l'API
-- Hospitable elle-même (PUT /v2/properties/{id}/calendar, déjà utilisé par
-- api/blocage-retry.js). dispo_action_log est donc la SEULE mémoire durable de "qui a
-- fait quoi et pourquoi" sur ce calendrier.
--
-- Toutes les actions listées dans le CHECK sont désactivées par défaut côté API
-- (DISPO_ACTIONS_ENABLED dans dispo-action.js) — cette table existe déjà pour que
-- l'activation future n'exige aucune nouvelle migration.

create table dispo_action_log (
  id                uuid primary key default gen_random_uuid(),
  bien_id           uuid not null references bien(id) on delete cascade,
  action            text not null check (action in ('block','unblock','set_rules','create_direct_reservation')),
  date_debut        date,
  date_fin          date,          -- exclusive, cohérent avec property_calendar.date_fin (pas la convention inclusive de blocage-retry.js)
  motif             text,
  payload           jsonb,
  acteur            uuid,          -- pas de FK : auth.users n'est pas référencé depuis public dans ce projet (même remarque que 243_bien_pret_jour.sql)
  acteur_label      text,
  hospitable_status int,
  ok                boolean not null default false,
  error             text,
  idempotency_key   text unique,
  created_at        timestamptz not null default now()
);

comment on table dispo_action_log is 'Journal des actions manuelles sur le calendrier Hospitable posées depuis Dispos (PowerHouse) — seule trace durable, property_calendar étant réécrit toutes les 5 min.';
comment on column dispo_action_log.date_fin is 'Exclusive (jour de départ), alignée sur property_calendar.date_fin — pas la convention inclusive de blocage-retry.js.';
comment on column dispo_action_log.acteur is 'user.id du manager PowerHouse ayant déclenché l''action, sans FK (auth.users non référencé depuis public ici).';
comment on column dispo_action_log.idempotency_key is 'Clé fournie par le client — évite de rejouer deux fois le même appel Hospitable en cas de retry réseau.';

create index idx_dispo_action_log_bien on dispo_action_log(bien_id, date_debut);
create index idx_dispo_action_log_created on dispo_action_log(created_at desc);

alter table dispo_action_log enable row level security;

-- Même politique de lecture que property_calendar : tout compte authentifié peut consulter
-- l'historique (utilisé par le drawer de détail de Dispos, PowerHouse étant déjà manager-only).
create policy dispo_action_log_read_authenticated on dispo_action_log
  for select to authenticated using (true);

-- Seule la route api/dispo-action.js (service role) écrit — aucun client n'insère directement.
create policy dispo_action_log_write_service on dispo_action_log
  for all to service_role using (true) with check (true);
