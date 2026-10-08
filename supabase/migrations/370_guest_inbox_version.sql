-- 370_guest_inbox_version.sql — Messagerie Lot 3 (08/10/2026), perf.
-- Version de la liste de la Messagerie (≈ 2 ms) : api/guest-inbox.js garde la vue
-- guest_inbox_liste en mémoire (instance chaude) tant que cette version ne change pas (≤ 2 min).
create or replace function public.guest_inbox_version() returns text
language sql stable security definer set search_path = public as $$
  select concat_ws('|',
    (select count(*)::text || '@' || coalesce(max(updated_at)::text, '') from guest_thread),
    (select coalesce(max(synced_at)::text, '') from guest_inquiry),
    (select coalesce(max(updated_at)::text, '') from ga_conversation))
$$;
revoke all on function public.guest_inbox_version() from public, anon, authenticated;
-- DOWN : drop function if exists public.guest_inbox_version();
