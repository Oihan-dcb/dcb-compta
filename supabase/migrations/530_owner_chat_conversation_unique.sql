-- 530 : Messagerie propriétaires — UNE conversation par propriétaire (22/10/2026, décision d'Oïhan)
--
-- Avant : un salon « Général » par propriétaire + un salon par bien (97 salons, 18 utilisés).
-- Après : la conversation = le salon support SANS bien (bien_id IS NULL) de la fiche PRINCIPALE
-- (une fiche secondaire, proprietaire.parent_proprietaire_id, partage la conversation du principal,
-- exactement comme resolveOwnerContext du portail lui donne les données du principal).
-- Chaque message peut porter une étiquette de bien (owner_chat_messages.bien_id).
--
-- Rien n'est supprimé : les anciens salons de bien sont ARCHIVÉS (archive_le) et pointent vers la
-- conversation (fusionne_dans) ; chaque message déplacé garde son salon d'origine (origine_room_id).
-- Retour arrière = « update owner_chat_messages set room_id = origine_room_id where origine_room_id
-- is not null » puis remettre archive_le / fusionne_dans à null (voir la mémoire projet).
--
-- Préparation étape 2 (WhatsApp, plus tard) : canal du message (portail / email / whatsapp / sms)
-- + référence externe dédoublonnée (canal_ref : id WhatsApp, Message-ID e-mail).

-- ── Colonnes ────────────────────────────────────────────────────────────────────────────────────
alter table public.owner_chat_rooms
  add column if not exists archive_le     timestamptz,
  add column if not exists fusionne_dans  uuid references public.owner_chat_rooms(id),
  add column if not exists traite_le      timestamptz,   -- « rien à répondre » posé par l'équipe
  add column if not exists traite_par     uuid,
  add column if not exists assigne_a      uuid,          -- « transmis à » (auth user)
  add column if not exists assigne_le     timestamptz;

alter table public.owner_chat_messages
  add column if not exists bien_id          uuid references public.bien(id) on delete set null,
  add column if not exists origine_room_id  uuid,
  add column if not exists canal            text not null default 'portail',
  add column if not exists canal_ref        text,
  add column if not exists envoye_depuis    text,        -- portail_owner | powerhouse | portail_ae | email | systeme
  add column if not exists lu_proprio_at    timestamptz, -- message équipe lu par le propriétaire (portail ou e-mail)
  add column if not exists lu_staff_at      timestamptz, -- message propriétaire lu par l'équipe
  add column if not exists rappel_id        uuid;        -- rappel e-mail qui couvre ce message (owner_chat_rappel)

do $$ begin
  alter table public.owner_chat_messages add constraint owner_chat_messages_canal_check
    check (canal in ('portail', 'email', 'whatsapp', 'sms'));
exception when duplicate_object then null; end $$;

create unique index if not exists owner_chat_messages_canal_ref_uniq
  on public.owner_chat_messages (canal, canal_ref) where canal_ref is not null;
create index if not exists owner_chat_messages_bien_idx
  on public.owner_chat_messages (bien_id) where bien_id is not null;
create index if not exists owner_chat_messages_staff_non_lus_idx
  on public.owner_chat_messages (room_id, created_at)
  where sender_type = 'staff' and lu_proprio_at is null and deleted_at is null;
create index if not exists owner_chat_messages_proprio_non_lus_idx
  on public.owner_chat_messages (room_id, created_at)
  where sender_type = 'proprio' and lu_staff_at is null and deleted_at is null;

-- ── Rappels e-mail (message de l'équipe non lu ~15 min) ──────────────────────────────────────────
create table if not exists public.owner_chat_rappel (
  id                 uuid primary key default gen_random_uuid(),
  room_id            uuid not null references public.owner_chat_rooms(id) on delete cascade,
  proprio_id         uuid,
  message_ids        uuid[] not null default '{}',
  premier_message_at timestamptz,
  destinataires      jsonb not null default '[]'::jsonb,
  mode               text not null check (mode in ('essai', 'envoi')),
  statut             text not null default 'a_envoyer'
                       check (statut in ('a_envoyer', 'envoye', 'essai', 'erreur', 'sans_destinataire')),
  sujet              text,
  apercu             text,
  reponse_jeton      text,
  resend_id          text,
  erreur             text,
  cree_le            timestamptz not null default now(),
  envoye_le          timestamptz
);
create index if not exists owner_chat_rappel_room_idx on public.owner_chat_rappel (room_id, cree_le desc);
alter table public.owner_chat_rappel enable row level security; -- service_role seulement

-- ── Journal des actions faites depuis la conversation (ticket, consigne, blocage proposé…) ───────
create table if not exists public.owner_chat_action (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.owner_chat_rooms(id) on delete cascade,
  message_id  uuid references public.owner_chat_messages(id) on delete set null,
  type        text not null,
  cible_table text,
  cible_id    uuid,
  titre       text,
  citation    text,
  bien_id     uuid references public.bien(id) on delete set null,
  details     jsonb,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists owner_chat_action_room_idx on public.owner_chat_action (room_id, created_at);
alter table public.owner_chat_action enable row level security; -- service_role seulement

-- ── Cache des propositions IA (réponse + actions) — garde-fou coûts côté serveur ───────────────
create table if not exists public.owner_chat_ia (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.owner_chat_rooms(id) on delete cascade,
  empreinte  text not null,
  resultat   jsonb not null,
  modele     text,
  cout_usd   numeric,
  cree_par   uuid,
  cree_le    timestamptz not null default now(),
  unique (room_id, empreinte)
);
create index if not exists owner_chat_ia_jour_idx on public.owner_chat_ia (cree_le);
alter table public.owner_chat_ia enable row level security; -- service_role seulement

-- ── Conversation d'un propriétaire (création si absente) ────────────────────────────────────────
create or replace function public.owner_chat_conversation_de(p_proprio uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_principal uuid;
  v_agence    text;
  v_room      uuid;
begin
  if p_proprio is null then return null; end if;
  select coalesce(p.parent_proprietaire_id, p.id), coalesce(pp.agence, p.agence, 'dcb')
    into v_principal, v_agence
    from proprietaire p left join proprietaire pp on pp.id = p.parent_proprietaire_id
   where p.id = p_proprio;
  if v_principal is null then return null; end if;

  select id into v_room from owner_chat_rooms
   where proprio_id = v_principal and type = 'support' and bien_id is null and fusionne_dans is null
   order by created_at asc limit 1;
  if v_room is not null then return v_room; end if;

  insert into owner_chat_rooms (type, proprio_id, bien_id, name, agence)
  values ('support', v_principal, null, 'Conversation', v_agence)
  on conflict (proprio_id) where (proprio_id is not null and bien_id is null) do nothing;

  select id into v_room from owner_chat_rooms
   where proprio_id = v_principal and type = 'support' and bien_id is null and fusionne_dans is null
   order by created_at asc limit 1;
  return v_room;
end $$;
revoke all on function public.owner_chat_conversation_de(uuid) from public, anon;
grant execute on function public.owner_chat_conversation_de(uuid) to authenticated, service_role;

-- ── Garde-fou : toute écriture dans un ancien salon atterrit dans la conversation ────────────────
-- Les applis déjà ouvertes (portail AE, portail propriétaire, notify-owner-maintenance, demandes.js)
-- peuvent encore viser un salon de bien quelques minutes après le déploiement : le message est
-- redirigé vers la conversation du propriétaire, étiqueté avec le bien du salon d'origine.
-- Une étiquette de bien doit appartenir au propriétaire de la conversation (ou en être co-propriétaire).
create or replace function public.owner_chat_messages_avant_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_cible uuid;
  v_proprio uuid;
begin
  select id, type, proprio_id, bien_id, fusionne_dans into r from owner_chat_rooms where id = new.room_id;
  if r.id is null or r.type <> 'support' then return new; end if;

  if r.fusionne_dans is not null or r.bien_id is not null then
    new.bien_id := coalesce(new.bien_id, r.bien_id);
    v_cible := coalesce(r.fusionne_dans, owner_chat_conversation_de(r.proprio_id));
    if v_cible is not null then new.room_id := v_cible; end if;
  end if;

  if new.bien_id is not null then
    select proprio_id into v_proprio from owner_chat_rooms where id = new.room_id;
    if not exists (
      select 1 from bien b
       where b.id = new.bien_id
         and (b.proprietaire_id = v_proprio or b.co_proprietaire_id = v_proprio
              or b.proprietaire_id in (select p.id from proprietaire p where p.parent_proprietaire_id = v_proprio))
    ) then
      raise exception 'Étiquette de bien hors du périmètre de ce propriétaire' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists owner_chat_messages_avant_insert on public.owner_chat_messages;
create trigger owner_chat_messages_avant_insert
  before insert on public.owner_chat_messages
  for each row execute function public.owner_chat_messages_avant_insert();

-- ── Périmètre staff (RLS portail AE) ────────────────────────────────────────────────────────────
-- Avant : un salon sans bien était visible de TOUS les managers chat. La conversation unique n'a pas
-- de bien → on rattache la visibilité aux biens du propriétaire (et de ses fiches secondaires) :
-- gérant / accès admin = tout ; manager de secteur (chat_group_slug) = propriétaires ayant au moins
-- un bien de son secteur ; diffusion (broadcast) = tous les managers, comme avant.
create or replace function public.owner_chat_staff_voit_room(p_room uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from owner_chat_rooms r
      join auto_entrepreneur ae on ae.ae_user_id = auth.uid() and ae.actif = true and ae.is_chat_manager = true
     where r.id = p_room
       and (
         ae.type = 'gerant' or ae.acces_admin = true or r.type = 'broadcast'
         or (r.bien_id is not null and exists (select 1 from bien b where b.id = r.bien_id and b.groupe = ae.chat_group_slug))
         or (r.bien_id is null and exists (
               select 1 from bien b
                where b.groupe = ae.chat_group_slug
                  and (b.proprietaire_id = r.proprio_id or b.co_proprietaire_id = r.proprio_id
                       or b.proprietaire_id in (select p.id from proprietaire p where p.parent_proprietaire_id = r.proprio_id))))
       )
  );
$$;
revoke all on function public.owner_chat_staff_voit_room(uuid) from public, anon;
grant execute on function public.owner_chat_staff_voit_room(uuid) to authenticated, service_role;

drop policy if exists staff_read_all_chat_rooms on public.owner_chat_rooms;
create policy staff_read_all_chat_rooms on public.owner_chat_rooms
  for select to authenticated using (public.owner_chat_staff_voit_room(id));

drop policy if exists staff_insert_chat_rooms on public.owner_chat_rooms;
create policy staff_insert_chat_rooms on public.owner_chat_rooms
  for insert to authenticated with check (
    exists (select 1 from auto_entrepreneur ae where ae.ae_user_id = auth.uid() and ae.actif = true and ae.is_chat_manager = true
             and (ae.type = 'gerant' or ae.acces_admin = true))
  );

drop policy if exists staff_read_all_chat_messages on public.owner_chat_messages;
create policy staff_read_all_chat_messages on public.owner_chat_messages
  for select to authenticated using (public.owner_chat_staff_voit_room(room_id));

drop policy if exists staff_insert_chat_messages on public.owner_chat_messages;
create policy staff_insert_chat_messages on public.owner_chat_messages
  for insert to authenticated with check (sender_id = auth.uid() and public.owner_chat_staff_voit_room(room_id));

drop policy if exists staff_update_chat_messages on public.owner_chat_messages;
create policy staff_update_chat_messages on public.owner_chat_messages
  for update to authenticated using (public.owner_chat_staff_voit_room(room_id));

drop policy if exists owner_chat_reactions_staff on public.owner_chat_message_reactions;
create policy owner_chat_reactions_staff on public.owner_chat_message_reactions
  for all to authenticated
  using (exists (select 1 from owner_chat_messages m where m.id = message_id and public.owner_chat_staff_voit_room(m.room_id)))
  with check (sender_id = auth.uid()
    and exists (select 1 from owner_chat_messages m where m.id = message_id and public.owner_chat_staff_voit_room(m.room_id)));

-- ── Fusion des anciens salons (idempotente : relançable, ne refait rien la 2e fois) ───────────────
create or replace function public.owner_chat_fusionner()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_cible uuid;
  n_salons int := 0;
  n_msgs int := 0;
begin
  -- 1. Salons de bien + salons « Général » des fiches secondaires → conversation du principal
  for r in
    select o.id, o.proprio_id
      from owner_chat_rooms o
      left join proprietaire p on p.id = o.proprio_id
     where o.type = 'support' and o.fusionne_dans is null
       and (o.bien_id is not null or p.parent_proprietaire_id is not null)
  loop
    v_cible := owner_chat_conversation_de(r.proprio_id);
    if v_cible is null or v_cible = r.id then continue; end if;
    update owner_chat_rooms set fusionne_dans = v_cible, archive_le = coalesce(archive_le, now()) where id = r.id;
    n_salons := n_salons + 1;
  end loop;

  -- 2. Messages encore rangés dans un salon fusionné → conversation, étiquetés avec le bien d'origine
  with dep as (
    update owner_chat_messages m
       set origine_room_id = coalesce(m.origine_room_id, m.room_id),
           bien_id = coalesce(m.bien_id, o.bien_id),
           room_id = o.fusionne_dans
      from owner_chat_rooms o
     where o.id = m.room_id and o.fusionne_dans is not null
    returning 1
  ) select count(*) into n_msgs from dep;

  return jsonb_build_object('salons_archives', n_salons, 'messages_deplaces', n_msgs);
end $$;
revoke all on function public.owner_chat_fusionner() from public, anon, authenticated;
grant execute on function public.owner_chat_fusionner() to service_role;
