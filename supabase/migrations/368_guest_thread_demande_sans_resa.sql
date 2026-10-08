-- 368_guest_thread_demande_sans_resa.sql — Messagerie Lot 3 (08/10/2026).
-- Une demande avant réservation (guest_thread.kind = 'inquiry', migration 367) n'a pas de
-- réservation Hospitable : hospitable_reservation_id devient facultatif pour elle seule.
alter table public.guest_thread alter column hospitable_reservation_id drop not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'guest_thread_resa_ou_demande') then
    alter table public.guest_thread add constraint guest_thread_resa_ou_demande
      check (kind = 'inquiry' or hospitable_reservation_id is not null);
  end if;
end $$;

-- DOWN :
-- delete from public.guest_thread where kind = 'inquiry';
-- alter table public.guest_thread drop constraint if exists guest_thread_resa_ou_demande;
-- alter table public.guest_thread alter column hospitable_reservation_id set not null;
