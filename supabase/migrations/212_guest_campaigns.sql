-- Messages voyageurs — bulk messaging via Hospitable (PowerHouse).
-- V1 : campagne manuelle, ciblage par présence/plateforme/bien, envoi immédiat, historique.

create table if not exists public.guest_campaign (
  id          uuid primary key default gen_random_uuid(),
  titre       text not null,
  type        text not null default 'info' check (type in ('service','info','commercial')),
  statut      text not null default 'brouillon' check (statut in ('brouillon','envoyee','annulee')),
  message     text not null,
  ciblage     jsonb not null default '{}'::jsonb,   -- {date_from,date_to,platforms[],bien_ids[]}
  nb_recipients int not null default 0,
  nb_sent     int not null default 0,
  nb_failed   int not null default 0,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  sent_at     timestamptz
);

create table if not exists public.guest_campaign_recipient (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references public.guest_campaign(id) on delete cascade,
  reservation_id uuid references public.reservation(id),
  hospitable_id  text,
  guest_name   text,
  platform     text,
  langue       text,
  message_rendu text,
  statut       text not null default 'pending' check (statut in ('pending','sent','failed','skipped')),
  hospitable_message_id text,
  error        text,
  sent_at      timestamptz,
  created_at   timestamptz not null default now(),
  unique (campaign_id, reservation_id)
);
create index if not exists guest_campaign_recipient_campaign_idx on public.guest_campaign_recipient(campaign_id);

-- RLS : lecture par le staff admin (PowerHouse) ; écritures via service_role (endpoints).
alter table public.guest_campaign           enable row level security;
alter table public.guest_campaign_recipient enable row level security;

drop policy if exists guest_campaign_admin_read on public.guest_campaign;
create policy guest_campaign_admin_read on public.guest_campaign for select to authenticated
  using (exists (select 1 from public.auto_entrepreneur a where a.ae_user_id = auth.uid() and a.acces_admin));

drop policy if exists guest_campaign_recipient_admin_read on public.guest_campaign_recipient;
create policy guest_campaign_recipient_admin_read on public.guest_campaign_recipient for select to authenticated
  using (exists (select 1 from public.auto_entrepreneur a where a.ae_user_id = auth.uid() and a.acces_admin));
