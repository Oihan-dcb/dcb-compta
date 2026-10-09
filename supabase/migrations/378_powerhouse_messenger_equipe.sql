-- 378 — Messenger équipe dans PowerHouse (bulle 💬, 09/10/2026)
--
-- Le bureau converse avec les AE depuis PowerHouse sans basculer dans le portail AE.
-- Problème d'identité : Oïhan et Laura se connectent à PowerHouse avec leur compte PRO
-- (staff_users.auth_user_id) alors que leurs salles de chat sont rattachées à leur compte
-- PORTAIL (staff_users.ae_user_id, cf. _chat_sender()). Clémence et Léa utilisent directement
-- leur compte portail dans PowerHouse.
--
-- 1) can_access_chat_room : un compte pro relié (staff_users.ae_user_id) voit les salles de SON
--    compte portail — même personne, même périmètre (uniquement les salles dont ce compte est
--    membre). Sert au temps réel Supabase (postgres_changes filtré par la RLS) depuis PowerHouse.
--    Pour un AE / compte portail, _chat_sender() = auth.uid() → strictement aucun changement.
--    Lectures et écritures de la bulle passent par api/team-chat.js (service_role) qui résout
--    le même compte ; la policy d'INSERT (sender_id = auth.uid()) reste inchangée.
create or replace function public.can_access_chat_room(p_room_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select exists (select 1 from chat_room_members m
                  where m.room_id = p_room_id
                    and m.user_id in (auth.uid(), public._chat_sender()))
      or (exists (select 1 from chat_rooms r where r.id = p_room_id and r.is_announcement = true)
          and (public.is_internal_chat_user() or public._chat_sender() is distinct from auth.uid()));
$function$;

-- 2) Vue d'ensemble des conversations d'un compte portail, en UN appel (liste + aperçu du
--    dernier message + non-lus calculés comme le portail : messages d'autrui depuis
--    chat_room_members.last_read_at). Réservée au service_role (paramètre p_user libre).
create or replace function public.ph_chat_overview(p_user uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  with rooms as (
    select r.id, r.type, r.name, r.room_role, r.is_announcement, r.group_id,
           m.last_read_at, (m.user_id is not null) as member
      from chat_rooms r
      left join chat_room_members m on m.room_id = r.id and m.user_id = p_user
     where m.user_id is not null or r.is_announcement = true
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'type', r.type, 'name', r.name, 'room_role', r.room_role,
           'is_announcement', r.is_announcement, 'member', r.member,
           'group_slug', g.slug, 'group_name', g.name,
           'last_read_at', r.last_read_at,
           'members', case when r.is_announcement then '[]'::jsonb else coalesce((
               select jsonb_agg(x.user_id) from chat_room_members x where x.room_id = r.id), '[]'::jsonb) end,
           'unread', case when not r.member then 0 else (
               select count(*) from chat_messages c
                where c.room_id = r.id and c.deleted_at is null and c.sender_id <> p_user
                  and (r.last_read_at is null or c.created_at > r.last_read_at)) end,
           'last', (select jsonb_build_object('body', left(c.body, 300), 'sender_id', c.sender_id,
                                             'created_at', c.created_at, 'attachment', c.attachment_url is not null,
                                             'poll', c.poll_id is not null)
                      from chat_messages c
                     where c.room_id = r.id and c.deleted_at is null
                     order by c.created_at desc limit 1)
         )), '[]'::jsonb)
    from rooms r
    left join chat_groups g on g.id = r.group_id;
$function$;

revoke all on function public.ph_chat_overview(uuid) from public, anon, authenticated;
grant execute on function public.ph_chat_overview(uuid) to service_role;
