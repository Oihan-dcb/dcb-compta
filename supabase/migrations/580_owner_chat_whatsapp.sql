-- 580 — Messagerie propriétaires, étape 2 : WhatsApp (23/10/2026)
--
-- Numéro pro DCB +33 6 25 31 62 34 en « coexistence » (application WhatsApp Business conservée + WhatsApp Cloud API).
-- Le webhook PowerHouse (dcb-planning api/whatsapp-webhook.js) range chaque message entrant :
--   * numéro d'une fiche propriétaire ACTIVE (principale ou secondaire, ou numéro mémorisé à la main) → la conversation
--     du propriétaire (owner_chat_messages, canal 'whatsapp', canal_ref = wamid, dédoublonné par l'index unique existant) ;
--   * numéro inconnu, ambigu (plusieurs propriétaires) ou d'une fiche inactive → file « à rattacher » (jamais perdu) ;
--   * interrupteur OWNER_CHAT_WHATSAPP absent → journal « essai » seulement (aucune écriture dans les conversations).
-- Les messages envoyés par Oïhan depuis l'application (« echo ») ne sont gardés QUE vers un numéro de propriétaire :
-- rien n'est journalisé pour les autres contacts (voyageurs, proches).

-- 1. Suivi WhatsApp d'un message de la conversation
alter table public.owner_chat_messages
  add column if not exists canal_contact text,          -- numéro E.164 sans « + » du correspondant WhatsApp
  add column if not exists canal_statut text,           -- sent / delivered / read / failed (statuts Meta)
  add column if not exists canal_statut_at timestamptz,
  add column if not exists canal_erreur text;
do $$ begin
  alter table public.owner_chat_messages add constraint owner_chat_messages_canal_statut_check
    check (canal_statut is null or canal_statut in ('sent', 'delivered', 'read', 'failed'));
exception when duplicate_object then null; end $$;
comment on column public.owner_chat_messages.canal_contact is 'WhatsApp : numéro E.164 (sans +) du propriétaire qui a écrit / à qui la réponse est partie (dcb-compta 580)';
comment on column public.owner_chat_messages.canal_statut is 'WhatsApp : dernier statut Meta (sent, delivered, read, failed) ; read pose aussi lu_proprio_at';

-- Fenêtre de service de 24 h : dernier message WhatsApp du propriétaire d'une conversation
create index if not exists owner_chat_messages_wa_fenetre_idx on public.owner_chat_messages (room_id, created_at desc)
  where canal = 'whatsapp' and sender_type = 'proprio' and deleted_at is null;

-- 2. Journal des messages WhatsApp entrants (rattachés, à rattacher, ignorés, essai)
create table if not exists public.owner_chat_whatsapp_entrant (
  id uuid primary key default gen_random_uuid(),
  wa_message_id text not null unique,                  -- wamid Meta (dédoublonnage des renvois du webhook)
  sens text not null default 'entrant' check (sens in ('entrant', 'echo')),
  tel text not null,                                   -- E.164 sans « + »
  profil_nom text,                                     -- nom du profil WhatsApp (non fiable, indicatif)
  type text,                                           -- text, image, document, audio, video, location…
  body text,
  media jsonb,                                         -- { id, mime, nom } : téléchargé seulement au rattachement
  horodatage timestamptz,                              -- heure Meta du message
  statut text not null check (statut in ('rattache', 'a_rattacher', 'ignore', 'essai', 'erreur')),
  motif text,                                          -- inconnu, ambigu, inactif, type_non_pris, essai : …
  proprio_id uuid references public.proprietaire(id) on delete set null,
  room_id uuid references public.owner_chat_rooms(id) on delete set null,
  message_id uuid references public.owner_chat_messages(id) on delete set null,
  traite_par uuid,
  traite_le timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists owner_chat_whatsapp_entrant_statut_idx on public.owner_chat_whatsapp_entrant (statut, created_at desc);
create index if not exists owner_chat_whatsapp_entrant_tel_idx on public.owner_chat_whatsapp_entrant (tel);
alter table public.owner_chat_whatsapp_entrant enable row level security;
revoke all on public.owner_chat_whatsapp_entrant from anon, authenticated;
comment on table public.owner_chat_whatsapp_entrant is 'WhatsApp propriétaires (580) : journal des messages entrants, file « à rattacher » ; service role seulement (api/whatsapp-webhook.js, api/owner-chat.js)';

-- 3. Numéros WhatsApp mémorisés à la main (rattachement depuis la file) : un numéro = un propriétaire
create table if not exists public.owner_chat_whatsapp_numero (
  tel text primary key check (tel ~ '^[1-9][0-9]{7,14}$'),
  proprio_id uuid not null references public.proprietaire(id) on delete cascade,
  ajoute_par uuid,
  note text,
  created_at timestamptz not null default now()
);
alter table public.owner_chat_whatsapp_numero enable row level security;
revoke all on public.owner_chat_whatsapp_numero from anon, authenticated;
comment on table public.owner_chat_whatsapp_numero is 'WhatsApp propriétaires (580) : numéro supplémentaire d''un propriétaire, mémorisé lors d''un rattachement manuel ; service role seulement';

-- 4. Purge : contenu des messages jamais rattachés effacé au bout de 90 jours, lignes supprimées au bout de 12 mois
create or replace function public.owner_chat_whatsapp_purge() returns void language sql security definer set search_path = public as $$
  update public.owner_chat_whatsapp_entrant set body = null, media = null, profil_nom = null
   where statut in ('a_rattacher', 'ignore', 'essai', 'erreur') and created_at < now() - interval '90 days' and (body is not null or media is not null);
  delete from public.owner_chat_whatsapp_entrant where created_at < now() - interval '12 months';
$$;
revoke all on function public.owner_chat_whatsapp_purge() from public, anon, authenticated;
select cron.schedule('purge-owner-chat-whatsapp', '50 3 * * *', 'select public.owner_chat_whatsapp_purge()')
 where not exists (select 1 from cron.job where jobname = 'purge-owner-chat-whatsapp');
