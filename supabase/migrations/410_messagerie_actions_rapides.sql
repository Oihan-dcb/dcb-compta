-- 410 — Messagerie voyageurs : actions rapides depuis un message (11/10/2026, demande d'Oïhan :
-- « on n'a pas de raccourci dans la Messagerie pour créer un signalement, un ticket technique… »).
--
-- Les actions réutilisent les tables EXISTANTES (tech_issues, signalements, mission_menage.consigne_staff,
-- besoin_sac, guest_thread_note) — aucun nouveau circuit. Cette migration ajoute seulement :
--   • guest_thread_action : journal « telle action a été créée depuis telle conversation / tel message »
--     (lien visible dans le fil, base du futur suivi d'avancement communiqué au voyageur) ;
--   • source_conversation_id sur tech_issues et signalements : lien retour du ticket vers la conversation ;
--   • guest_action_titre_cache : cache des titres proposés par l'IA (bouton « Proposer un titre », à la
--     demande uniquement — jamais deux appels pour le même texte).
-- Accès : API PowerHouse (service role, api/guest-context.js) — RLS activée sans politique, comme
-- guest_thread_note.

create table if not exists public.guest_thread_action (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null,
  hospitable_reservation_id text,
  message_id text,                       -- hospitable_messages.id du message cité (null = depuis le panneau)
  citation text,                         -- extrait cité (sélection ou message entier, 1 000 car. max)
  type text not null check (type in ('technique', 'signalement', 'consigne', 'sac', 'note')),
  cible_table text not null check (cible_table in ('tech_issues', 'signalements', 'mission_menage', 'besoin_sac', 'guest_thread_note')),
  cible_id uuid not null,
  titre text not null,
  bien_id uuid references public.bien(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists guest_thread_action_conv_idx on public.guest_thread_action (conversation_id, created_at);
create index if not exists guest_thread_action_cible_idx on public.guest_thread_action (cible_table, cible_id);
alter table public.guest_thread_action enable row level security;

alter table public.tech_issues add column if not exists source_conversation_id text;
alter table public.signalements add column if not exists source_conversation_id text;
comment on column public.tech_issues.source_conversation_id is 'Conversation de la Messagerie voyageurs d''où le ticket a été créé (lien retour, migration 410).';
comment on column public.signalements.source_conversation_id is 'Conversation de la Messagerie voyageurs d''où le signalement a été créé (lien retour, migration 410).';

create table if not exists public.guest_action_titre_cache (
  cle text primary key,                  -- sha256(type + texte normalisé)
  titre text not null,
  categorie text,
  created_at timestamptz not null default now()
);
alter table public.guest_action_titre_cache enable row level security;
