-- 334 — Séjour propriétaire sans ménage réalisé = sans frais (06/10/2026, Oïhan : AUREAN 09/2026
-- « au final on a fait aucun ménage chez lui » — séjour 5MBZWH maintenu, ménage du 17/09 annulé, mais
-- 75 € de forfait ménage + 25 € de débours AE facturés).
-- reservation.menage_proprio_annule = true quand le séjour est un séjour propriétaire, qu'au moins une
-- mission ménage lui est rattachée et que TOUTES sont annulées/refusées. Les lecteurs (facture
-- honoraires + débours, rapport, Comptabilité, contrôle Tréso) le traitent comme un séjour annulé.
alter table public.reservation add column if not exists menage_proprio_annule boolean not null default false;

create or replace function public.maj_menage_proprio(p_resa_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_owner boolean; v_nb int; v_actives int;
begin
  if p_resa_id is null then return; end if;
  select owner_stay into v_owner from reservation where id = p_resa_id;
  if v_owner is not true then return; end if;
  select count(*), count(*) filter (where statut not in ('cancelled', 'refuse')) into v_nb, v_actives
    from mission_menage where reservation_id = p_resa_id;
  update reservation set menage_proprio_annule = (v_nb > 0 and v_actives = 0)
   where id = p_resa_id and menage_proprio_annule is distinct from (v_nb > 0 and v_actives = 0);
end $$;
revoke all on function public.maj_menage_proprio(uuid) from public, anon;

create or replace function public.trg_maj_menage_proprio()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform maj_menage_proprio(new.reservation_id);
  if tg_op = 'UPDATE' and old.reservation_id is distinct from new.reservation_id then perform maj_menage_proprio(old.reservation_id); end if;
  return new;
exception when others then return new; end $$;
drop trigger if exists trg_maj_menage_proprio on public.mission_menage;
create trigger trg_maj_menage_proprio after insert or update of statut, reservation_id on public.mission_menage
  for each row execute function public.trg_maj_menage_proprio();

select maj_menage_proprio(id) from reservation where owner_stay is true;
