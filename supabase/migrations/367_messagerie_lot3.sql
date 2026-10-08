-- 367_messagerie_lot3.sql — Messagerie voyageurs PowerHouse, refonte Lot 3 (08/10/2026).
-- Rapport « Refonte Messenger PowerHouse » §4.4 Lot 3 : file au fil de l'eau, demandes (inquiries),
-- statistiques, envoi auto par catégorie (mécanisme seulement, DÉSACTIVÉ).
-- Additive et réversible (bloc DOWN en fin de fichier). RLS fermée sur les nouvelles tables
-- (aucune policy : service role uniquement, via api/guest-inbox.js / api/guest-stats.js).

-- ── 1. File « à recalculer » (perf définitive de la Messagerie) ──────────────────────────────
-- Avant : chaque GET /api/guest-inbox relisait tous les messages resynchronisés depuis la dernière
-- passe (synced_at) — or le webhook resynchronise le fil ENTIER à chaque message : des centaines
-- de lignes inchangées relues et recalculées. Désormais un trigger ne marque une conversation que
-- si un message est NOUVEAU ou réellement MODIFIÉ ; l'API ne recalcule que ces conversations, avec
-- la MÊME logique métier côté Node (juge Haiku _resolution.js, clôtures, « qui a vraiment répondu »).
create table if not exists public.guest_thread_recalcul (
  conversation_id text primary key,
  marque_at timestamptz not null default now()
);
alter table public.guest_thread_recalcul enable row level security;
revoke all on public.guest_thread_recalcul from anon, authenticated;

create or replace function public.trg_guest_thread_a_recalculer() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.conversation_id is null or new.conversation_id = '' then return new; end if;
  -- Resynchro idempotente (webhook, guest-reply) : même message, rien ne change → pas de recalcul.
  if tg_op = 'UPDATE' then
    if new.created_at is not distinct from old.created_at
       and new.sender_type is not distinct from old.sender_type
       and new.source is not distinct from old.source
       and new.body is not distinct from old.body
       and new.reservation_id is not distinct from old.reservation_id
       and (new.raw->>'sent_reference_id') is not distinct from (old.raw->>'sent_reference_id') then
      return new;
    end if;
  end if;
  insert into public.guest_thread_recalcul (conversation_id, marque_at) values (new.conversation_id, now())
  on conflict (conversation_id) do update set marque_at = excluded.marque_at;
  return new;
end $$;
revoke all on function public.trg_guest_thread_a_recalculer() from public, anon, authenticated;

drop trigger if exists trg_hospitable_messages_a_recalculer on public.hospitable_messages;
create trigger trg_hospitable_messages_a_recalculer
  after insert or update on public.hospitable_messages
  for each row execute function public.trg_guest_thread_a_recalculer();

-- Un envoi PowerHouse tracé APRÈS l'arrivée du message (course webhook / guest_reply_log) change
-- la décision « qui a répondu » : on remet la conversation dans la file.
create or replace function public.trg_guest_reply_log_a_recalculer() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.conversation_id is not null and new.conversation_id <> '' then
    insert into public.guest_thread_recalcul (conversation_id, marque_at) values (new.conversation_id, now())
    on conflict (conversation_id) do update set marque_at = excluded.marque_at;
  end if;
  return new;
end $$;
revoke all on function public.trg_guest_reply_log_a_recalculer() from public, anon, authenticated;

drop trigger if exists trg_guest_reply_log_a_recalculer on public.guest_reply_log;
create trigger trg_guest_reply_log_a_recalculer
  after insert on public.guest_reply_log
  for each row execute function public.trg_guest_reply_log_a_recalculer();

-- ── 2. Demandes avant réservation (inquiries) ───────────────────────────────────────────────
-- Les messages d'une demande arrivent par le même webhook message.created, sans reservation_id ;
-- leur conversation_id EST l'UUID de la demande Hospitable. Ils sont rangés dans
-- hospitable_messages avec reservation_id = '' (convention déjà utilisée par l'edge function
-- hospitable-webhook de dcb-compta) et bien_id renseigné (RLS staff scopée inchangée).
alter table public.guest_thread add column if not exists kind text not null default 'reservation';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'guest_thread_kind_check') then
    alter table public.guest_thread add constraint guest_thread_kind_check check (kind in ('reservation', 'inquiry'));
  end if;
end $$;
create index if not exists guest_thread_kind_idx on public.guest_thread (kind) where kind <> 'reservation';

create table if not exists public.guest_inquiry (
  id text primary key,                 -- UUID Hospitable de la demande (= conversation_id)
  property_hospitable_id text,
  bien_id uuid references public.bien(id) on delete set null,
  platform text,
  guest_name text,
  arrival_date date,
  departure_date date,
  guests_total int,
  language text,
  inquiry_date timestamptz,
  synced_at timestamptz not null default now()
);
alter table public.guest_inquiry enable row level security;
revoke all on public.guest_inquiry from anon, authenticated;

-- Liste de la Messagerie en UNE requête : fil + résa (ou fiche de demande) + bien + agent IA.
-- Avant : ~15 lookups PostgREST par lots de 80 identifiants (≈ 1,5 s). Lecture service role
-- seulement (api/guest-inbox.js applique rôle PowerHouse et périmètre géographique).
create or replace view public.guest_inbox_liste with (security_invoker = true) as
select t.*,
  coalesce(r.bien_id, i.bien_id) as bien_id,
  r.id as reservation_id, r.code,
  coalesce(r.platform, i.platform) as platform,
  coalesce(r.arrival_date, i.arrival_date) as arrival_date,
  coalesce(r.departure_date, i.departure_date) as departure_date,
  r.nights,
  coalesce(r.guest_name, i.guest_name) as guest_name,
  r.guest_email, r.guest_phone,
  coalesce(r.guest_count, i.guests_total) as guest_count,
  r.owner_stay,
  coalesce(r.guest_locale, i.language) as guest_locale,
  r.hospitable_raw->'guest'->>'profile_picture' as guest_photo,
  i.inquiry_date,
  b.code as bien_code, b.hospitable_name as bien_nom, b.ville as bien_ville, b.agence, b.photo_url as bien_photo_url,
  g.sentiment, g.urgency_score, g.guest_language
from public.guest_thread t
left join public.reservation r on t.kind <> 'inquiry' and r.hospitable_id = t.hospitable_reservation_id
left join public.guest_inquiry i on t.kind = 'inquiry' and i.id = t.conversation_id
left join public.bien b on b.id = coalesce(r.bien_id, i.bien_id)
left join public.ga_conversation g on g.reservation_id = t.hospitable_reservation_id;
revoke all on public.guest_inbox_liste from anon, authenticated;

-- ── 3. Agent IA : envoi auto par catégorie (DÉSACTIVÉ) + motif de refus ──────────────────────
-- Liste VIDE par défaut : aucune catégorie autorisée. auto_send_enabled reste false.
alter table public.ga_agency_config add column if not exists auto_send_categories text[] not null default '{}';
-- Motif structuré d'un refus de proposition (critère « 0 fait inventé » = aucun refus 'faux').
alter table public.chat_llm_jobs add column if not exists rejection_motif text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'chat_llm_jobs_rejection_motif_check') then
    alter table public.chat_llm_jobs add constraint chat_llm_jobs_rejection_motif_check
      check (rejection_motif is null or rejection_motif in ('faux', 'inutile', 'cas_particulier', 'ton', 'autre'));
  end if;
end $$;

-- Catégorie normalisée (même règle que gaCategorie() dans api/ga-process-message.js).
create or replace function public.ga_categorie_norm(c text) returns text
language sql immutable set search_path = public as $$
  select case
    when x in ('checkin', 'check in', 'arrivée', 'arrivee') then 'check-in'
    when x in ('checkout', 'check out', 'départ', 'depart') then 'check-out'
    when x in ('équipement', 'equipement', 'equipment') then 'équipement'
    when x = '' then 'autre'
    else x end
  from (select lower(trim(coalesce(c, ''))) as x) s
$$;

-- ── 4. Statistiques de la Messagerie ────────────────────────────────────────────────────────
-- Épisode = un message voyageur qui suit un message non voyageur (début d'attente), jusqu'au
-- prochain épisode. Premier répondant : équipe (Hospitable, app plateforme, PowerHouse tracé),
-- IA Hospitable, programmé (règle Hospitable ou envoi automatique PowerHouse non tracé).
-- p_bien_ids : périmètre d'un compte scopé (null = tout).
create or replace function public.guest_messagerie_stats(p_depuis timestamptz, p_bien_ids uuid[] default null)
returns jsonb language sql stable security definer set search_path = public as $$
with m as (
  select h.id, h.conversation_id, nullif(h.reservation_id, '') reservation_id, h.bien_id, h.created_at,
         h.sender_type, h.source, h.raw->>'sent_reference_id' ref,
         left(trim(regexp_replace(h.body, '\s+', ' ', 'g')), 400) nb
  from hospitable_messages h
  where h.created_at >= p_depuis - interval '3 days' and h.conversation_id is not null
    and (p_bien_ids is null or h.bien_id = any(p_bien_ids))
),
pub_humain as (
  select n.id from m n where n.source = 'public_api' and (
    exists (select 1 from guest_reply_log l where l.hospitable_message_id = n.ref)
    or exists (select 1 from chat_llm_jobs j where j.source = 'guest_agent' and j.status in ('sent', 'edited') and j.hospitable_sent_message_id = n.ref)
    or exists (select 1 from guest_reply_log l where l.hospitable_reservation_id = n.reservation_id and left(trim(regexp_replace(l.body, '\s+', ' ', 'g')), 400) = n.nb)
    or exists (select 1 from chat_llm_jobs j where j.source = 'guest_agent' and j.status in ('sent', 'edited') and j.hospitable_reservation_id = n.reservation_id and left(trim(regexp_replace(j.final_reply, '\s+', ' ', 'g')), 400) = n.nb))
),
c as (
  select n.id, n.conversation_id, n.bien_id, n.created_at,
    case when n.sender_type = 'guest' then 'guest'
         when n.source = 'AI' then 'ia'
         when n.source = 'automated' then 'programme'
         when n.source = 'public_api' and not exists (select 1 from pub_humain ph where ph.id = n.id) then 'programme'
         else 'equipe' end qui,
    lag(n.sender_type) over (partition by n.conversation_id order by n.created_at, n.id) prev_type
  from m n
),
ep0 as (
  select c.conversation_id, c.bien_id, c.created_at debut from c
  where c.qui = 'guest' and c.prev_type is distinct from 'guest' and c.created_at >= p_depuis
),
ep as (select ep0.*, lead(debut) over (partition by conversation_id order by debut) fin from ep0),
rep as (
  select ep.*,
    (select min(x.created_at) from c x where x.conversation_id = ep.conversation_id and x.created_at > ep.debut and (ep.fin is null or x.created_at < ep.fin) and x.qui = 'equipe') t_equipe,
    (select min(x.created_at) from c x where x.conversation_id = ep.conversation_id and x.created_at > ep.debut and (ep.fin is null or x.created_at < ep.fin) and x.qui in ('equipe', 'ia')) t_reponse,
    (select x.qui from c x where x.conversation_id = ep.conversation_id and x.created_at > ep.debut and (ep.fin is null or x.created_at < ep.fin) and x.qui <> 'guest' order by x.created_at, x.id limit 1) premier
  from ep
),
r as (
  select rep.*, (rep.debut at time zone 'Europe/Paris')::date jour,
         date_trunc('week', rep.debut at time zone 'Europe/Paris')::date semaine,
         extract(epoch from rep.t_equipe - rep.debut) / 60.0 delai_min
  from rep
),
ia as (
  select ga_categorie_norm(j.categories[1]) cat, j.status, j.rejection_motif,
         coalesce(j.final_reply, '') = coalesce(j.proposed_action_data->>'reply', '') identique
  from chat_llm_jobs j
  left join reservation re on re.hospitable_id = j.hospitable_reservation_id
  where j.source = 'guest_agent' and (p_bien_ids is null or re.bien_id = any(p_bien_ids))
),
iac as (
  select cat,
    count(*) filter (where status = 'sent' or (status = 'trained' and identique)) tel_quel,
    count(*) filter (where status = 'edited' or (status = 'trained' and not identique)) modifie,
    count(*) filter (where status = 'refused') refuse,
    count(*) filter (where status = 'refused' and rejection_motif = 'faux') faux,
    count(*) filter (where status = 'auto_sent') auto,
    count(*) filter (where status not in ('sent', 'trained', 'edited', 'refused', 'auto_sent')) non_revu
  from ia group by cat
)
select jsonb_build_object(
  'depuis', p_depuis,
  'episodes', (select count(*) from r),
  'delai_median_min', (select round(percentile_cont(0.5) within group (order by delai_min)::numeric, 1) from r where delai_min is not null),
  'repartition', (select jsonb_build_object(
      'equipe', count(*) filter (where premier = 'equipe'),
      'ia_hospitable', count(*) filter (where premier = 'ia'),
      'programme', count(*) filter (where premier = 'programme'),
      'sans_reponse', count(*) filter (where premier is null)) from r),
  'reponse_apres_24h', (select count(*) from r where t_reponse is not null and t_reponse - debut > interval '24 hours'),
  'par_jour', coalesce((select jsonb_agg(x order by x.jour) from (
      select jour, count(*) episodes, count(delai_min) avec_humain,
             round(percentile_cont(0.5) within group (order by delai_min)::numeric, 1) delai_median_min
      from r group by jour) x), '[]'::jsonb),
  'par_semaine', coalesce((select jsonb_agg(x order by x.semaine) from (
      select semaine, count(*) episodes, count(delai_min) avec_humain,
             round(percentile_cont(0.5) within group (order by delai_min)::numeric, 1) delai_median_min,
             count(*) filter (where premier = 'equipe') equipe, count(*) filter (where premier = 'ia') ia_hospitable,
             count(*) filter (where premier = 'programme') programme
      from r group by semaine) x), '[]'::jsonb),
  'par_bien', coalesce((select jsonb_agg(x order by x.episodes desc) from (
      select r.bien_id, b.code, count(*) episodes,
             round(percentile_cont(0.5) within group (order by r.delai_min)::numeric, 1) delai_median_min
      from r left join bien b on b.id = r.bien_id group by r.bien_id, b.code) x), '[]'::jsonb),
  'ia_dcb', coalesce((select jsonb_agg(x order by (x.tel_quel + x.modifie + x.refuse) desc) from (
      select cat, tel_quel, modifie, refuse, faux, auto, non_revu, (tel_quel + modifie + refuse) revues,
             (tel_quel + modifie + refuse) >= 30
               and tel_quel >= 0.9 * (tel_quel + modifie + refuse)
               and faux = 0 eligible
      from iac) x), '[]'::jsonb)
)
$$;
revoke all on function public.guest_messagerie_stats(timestamptz, uuid[]) from public, anon, authenticated;

-- ── 5. Reprise : messages des demandes déjà reçus par le webhook (30 derniers jours) ──────────
-- Lus dans webhook_log (payload brut Hospitable) ; le trigger ci-dessus les met dans la file.
insert into public.hospitable_messages (id, reservation_id, conversation_id, platform, body, sender_type, source, is_ai, created_at, synced_at, language, agence, bien_id, raw)
select distinct on ((w.payload->>'id')::bigint)
  (w.payload->>'id')::bigint, '', w.payload->>'conversation_id', w.payload->>'platform', trim(w.payload->>'body'),
  coalesce(w.payload->>'sender_type', w.payload->>'sender_role'), w.payload->>'source', (w.payload->>'source') = 'AI',
  (w.payload->>'created_at')::timestamptz, now(), nullif(left(w.payload->'sender'->>'locale', 2), ''), b.agence, b.id, w.payload
from public.webhook_log w
left join public.bien b on b.hospitable_id = w.payload->'property'->>'id'
where w.event = 'message.created' and coalesce(w.data_id, '') = ''
  and w.payload->>'conversation_id' is not null and coalesce(trim(w.payload->>'body'), '') <> ''
  and (w.payload->>'id') ~ '^\d+$' and w.received_at > now() - interval '30 days'
order by (w.payload->>'id')::bigint, w.received_at desc
on conflict (id) do nothing;

insert into public.guest_inquiry (id, property_hospitable_id, bien_id, platform, guest_name, synced_at)
select distinct on (w.payload->>'conversation_id')
  w.payload->>'conversation_id', w.payload->'property'->>'id', b.id, w.payload->>'platform',
  nullif(w.payload->'sender'->>'full_name', ''), now()
from public.webhook_log w
left join public.bien b on b.hospitable_id = w.payload->'property'->>'id'
where w.event = 'message.created' and coalesce(w.data_id, '') = '' and w.payload->>'conversation_id' is not null
  and coalesce(w.payload->>'sender_type', w.payload->>'sender_role') = 'guest'
  and w.received_at > now() - interval '30 days'
order by w.payload->>'conversation_id', w.received_at desc
on conflict (id) do nothing;

-- ── DOWN (à exécuter à la main si besoin) ────────────────────────────────────────────────────
-- drop view if exists public.guest_inbox_liste;
-- drop trigger if exists trg_hospitable_messages_a_recalculer on public.hospitable_messages;
-- drop trigger if exists trg_guest_reply_log_a_recalculer on public.guest_reply_log;
-- drop function if exists public.trg_guest_thread_a_recalculer();
-- drop function if exists public.trg_guest_reply_log_a_recalculer();
-- drop table if exists public.guest_thread_recalcul;
-- drop function if exists public.guest_messagerie_stats(timestamptz, uuid[]);
-- drop function if exists public.ga_categorie_norm(text);
-- delete from public.hospitable_messages where reservation_id = '';
-- drop table if exists public.guest_inquiry;
-- delete from public.guest_thread where kind = 'inquiry';
-- alter table public.guest_thread drop constraint if exists guest_thread_kind_check, drop column if exists kind;
-- alter table public.ga_agency_config drop column if exists auto_send_categories;
-- alter table public.chat_llm_jobs drop constraint if exists chat_llm_jobs_rejection_motif_check, drop column if exists rejection_motif;
