-- 362 — Messagerie voyageurs PowerHouse, refonte Lot 1 (08/10/2026, Oïhan).
-- File « À traiter » fiable : clôture automatique (réponse humaine, IA Hospitable résolutive,
-- « merci », expiration 14 j), report (snooze), synchro incrémentale de l'inbox.
-- Additif uniquement : aucune colonne existante modifiée, aucune donnée réécrite ici.
alter table public.guest_thread
  add column if not exists closed_at timestamptz,
  add column if not exists closed_reason text,
  add column if not exists closed_by uuid,
  add column if not exists snoozed_until timestamptz,
  add column if not exists decision_for timestamptz;

comment on column public.guest_thread.closed_at is 'Clôture du fil (state=traite) : quand';
comment on column public.guest_thread.closed_reason is 'repondu | ia_resolutive | sans_reponse_requise | expire | manuel';
comment on column public.guest_thread.closed_by is 'auth.users.id si clôture manuelle';
comment on column public.guest_thread.snoozed_until is 'Reporté : hors file À traiter jusqu''à cette date';
comment on column public.guest_thread.decision_for is 'last_message_at pour lequel « qui a vraiment répondu » (attend_humain + clôture auto) a été calculé — synchro incrémentale api/guest-inbox.js';

-- Synchro incrémentale de l'inbox : ne relit plus que les messages (re)synchronisés depuis la
-- dernière passe, au lieu des ~8 300 messages à chaque ouverture.
create index if not exists hospitable_messages_synced_idx on public.hospitable_messages (synced_at desc);
create index if not exists hospitable_messages_conv_created_idx on public.hospitable_messages (conversation_id, created_at desc);

-- Rollback :
-- drop index if exists hospitable_messages_synced_idx; drop index if exists hospitable_messages_conv_created_idx;
-- alter table public.guest_thread drop column closed_at, drop column closed_reason, drop column closed_by,
--   drop column snoozed_until, drop column decision_for;
