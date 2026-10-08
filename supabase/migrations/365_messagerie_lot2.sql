-- 365 — Messagerie voyageurs PowerHouse, refonte Lot 2 (08/10/2026).
--
-- 1) Assignation nominative d'un fil (guest_thread.assigned_to = auth.users.id), qui remplace
--    l'exposition de la « prise en main 30 min ». Filtre « À moi » + push à la personne assignée.
-- 2) guest_thread_note : notes internes de conversation (jamais envoyées au voyageur).
-- 3) guest_reply_template : réponses rapides à variables ({{prenom}}, {{bien}}, {{heure_arrivee}}…).
-- 4) guest_scheduled_cache : cache 10 min des messages programmés Hospitable d'une résa.
-- 5) Index trigram sur hospitable_messages.body : recherche plein texte (ilike) dans les messages.
--
-- Toutes les nouvelles tables : RLS activée SANS policy → accès uniquement via les endpoints
-- service_role de PowerHouse (api/guest-context.js, api/guest-templates.js, api/guest-inbox.js),
-- qui vérifient le rôle PowerHouse et le périmètre (myScopedBienIds).
--
-- Additive et réversible :
--   drop index if exists hospitable_messages_body_trgm;
--   drop table if exists guest_scheduled_cache, guest_reply_template, guest_thread_note;
--   alter table guest_thread drop column if exists assigned_to, drop column if exists assigned_at, drop column if exists assigned_by;

alter table public.guest_thread
  add column if not exists assigned_to uuid,
  add column if not exists assigned_at timestamptz,
  add column if not exists assigned_by uuid;
create index if not exists guest_thread_assigned_idx on public.guest_thread (assigned_to) where assigned_to is not null;
comment on column public.guest_thread.assigned_to is 'Membre de l''équipe (auth.users.id) à qui le fil est assigné (Messagerie Lot 2)';

create table if not exists public.guest_thread_note (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null,
  hospitable_reservation_id text,
  body text not null check (char_length(body) between 1 and 4000),
  author_id uuid,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists guest_thread_note_conv_idx on public.guest_thread_note (conversation_id, created_at);
alter table public.guest_thread_note enable row level security;
comment on table public.guest_thread_note is 'Notes internes de conversation voyageur (Messagerie PowerHouse) — service_role uniquement';

create table if not exists public.guest_reply_template (
  id uuid primary key default gen_random_uuid(),
  titre text not null check (char_length(titre) between 1 and 120),
  corps text not null check (char_length(corps) between 1 and 4000),
  langue text not null default 'fr',
  agence text,
  position integer not null default 100,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
alter table public.guest_reply_template enable row level security;
comment on table public.guest_reply_template is 'Réponses rapides de la Messagerie PowerHouse (variables {{…}} résolues à l''insertion) — service_role uniquement';

create table if not exists public.guest_scheduled_cache (
  hospitable_reservation_id text primary key,
  data jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now()
);
alter table public.guest_scheduled_cache enable row level security;
comment on table public.guest_scheduled_cache is 'Cache 10 min des messages programmés Hospitable par réservation — service_role uniquement';

create index if not exists hospitable_messages_body_trgm on public.hospitable_messages using gin (body extensions.gin_trgm_ops);

-- Amorçage : réponses rapides les plus fréquentes (rédigées en français ; traduites à l'envoi).
insert into public.guest_reply_template (titre, corps, position)
select v.titre, v.corps, v.pos from (values
  ('Heure d''arrivée', 'Bonjour {{prenom}},

L''arrivée à {{bien}} se fait à partir de {{heure_arrivee}}. Vous recevrez toutes les instructions d''accès la veille de votre arrivée.

Belle journée !', 10),
  ('Arrivée anticipée — à confirmer', 'Bonjour {{prenom}},

L''arrivée est prévue à partir de {{heure_arrivee}}. Nous faisons le maximum pour que le logement soit prêt plus tôt et nous vous confirmons cela la veille ou le matin même.

À très vite !', 20),
  ('Départ tardif — à confirmer', 'Bonjour {{prenom}},

Le départ est prévu à {{heure_depart}} le {{date_depart}}. Nous regardons avec l''équipe de ménage si un départ plus tardif est possible et revenons vers vous rapidement.', 30),
  ('Parking', 'Bonjour {{prenom}},

Pour le stationnement : {{parking}}

N''hésitez pas si vous avez la moindre question.', 40),
  ('Remerciement fin de séjour', 'Bonjour {{prenom}},

Merci beaucoup pour votre séjour à {{ville}} ! Ce fut un plaisir de vous accueillir. Au plaisir de vous revoir,', 50)
) v(titre, corps, pos)
where not exists (select 1 from public.guest_reply_template);
