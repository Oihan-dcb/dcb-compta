-- 369_guest_thread_guest_photo.sql — Messagerie Lot 3 (08/10/2026), perf.
-- La photo du voyageur était lue dans reservation.hospitable_raw (JSON brut, détoasté pour les
-- ~500 fils à chaque liste : ≈ 0,5 s sur 0,55 s de requête). Elle est désormais recopiée dans
-- guest_thread.guest_photo par api/guest-inbox.js quand un fil est recalculé ; vue réécrite avec
-- une liste de colonnes explicite (plus de t.*).
alter table public.guest_thread add column if not exists guest_photo text;
update public.guest_thread t set guest_photo = r.hospitable_raw->'guest'->>'profile_picture'
from public.reservation r where r.hospitable_id = t.hospitable_reservation_id and t.guest_photo is null;
drop view if exists public.guest_inbox_liste;
create view public.guest_inbox_liste with (security_invoker = true) as
select t.conversation_id, t.hospitable_reservation_id, t.last_message_at, t.last_message_from, t.last_message_source,
  t.last_message_preview, t.read_at, t.read_by, t.state, t.human_hold_until, t.created_at, t.updated_at,
  t.attend_humain, t.attend_humain_motif, t.attend_humain_msg_id, t.closed_at, t.closed_reason, t.closed_by,
  t.snoozed_until, t.decision_for, t.assigned_to, t.assigned_at, t.assigned_by, t.kind,
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
  t.guest_photo,
  i.inquiry_date,
  b.code as bien_code, b.hospitable_name as bien_nom, b.ville as bien_ville, b.agence, b.photo_url as bien_photo_url,
  g.sentiment, g.urgency_score, g.guest_language
from public.guest_thread t
left join public.reservation r on t.kind <> 'inquiry' and r.hospitable_id = t.hospitable_reservation_id
left join public.guest_inquiry i on t.kind = 'inquiry' and i.id = t.conversation_id
left join public.bien b on b.id = coalesce(r.bien_id, i.bien_id)
left join public.ga_conversation g on g.reservation_id = t.hospitable_reservation_id;
revoke all on public.guest_inbox_liste from anon, authenticated;

-- DOWN : recréer la vue de la migration 367 puis
-- alter table public.guest_thread drop column if exists guest_photo;
