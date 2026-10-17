-- 472 — ÉQUIPEMENTS PAR ZONE (17/10/2026, 1er vrai paiement d'option 4XUWQQ). Constat : une chaise haute stockée sur la Côte
-- basque a été réservée pour COTREL (Bordeaux) — la table equipment n'avait pas de zone, un bien de Bordeaux voyait le
-- stock de Biarritz. Correction à la racine :
--   - bien.zone_logistique (colonne calculée, jamais saisie) : 'bordeaux' (Bordeaux et sa métropole), 'arcachon' (Bassin
--     d'Arcachon), sinon 'cote_basque' — d'après bien.zone / bien.ville ;
--   - equipment.zone : dépôt de l'équipement. Existant = 'cote_basque' (déduit : toutes les réservations passées de ces
--     équipements sont sur la Côte basque ; la seule à Bordeaux est la commande f51dc07b qui a révélé le problème) ;
--   - trigger : on ne peut plus réserver un équipement d'une autre zone que celle du bien (tous les chemins : Réserver,
--     portail voyageur, 📦 Équipements, panneau du séjour) ; PowerHouse filtre aussi le catalogue et le stock par zone.
alter table public.bien add column if not exists zone_logistique text generated always as (
  case
    when (coalesce(zone, '') || ' ' || coalesce(ville, '')) ~* '(bordeaux|bouscat|m[ée]rignac|pessac|talence|b[èe]gles|cenon|lormont|floirac|eysines|bruges|blanquefort|villenave)' then 'bordeaux'
    when (coalesce(zone, '') || ' ' || coalesce(ville, '')) ~* '(arcachon|la teste|pyla|cap.ferret|l[èe]ge|andernos|gujan|arès|biganos)' then 'arcachon'
    else 'cote_basque'
  end) stored;
comment on column public.bien.zone_logistique is '472 : zone logistique (dépôt des équipements) déduite de zone / ville : cote_basque | bordeaux | arcachon.';

alter table public.equipment add column if not exists zone text not null default 'cote_basque';
alter table public.equipment drop constraint if exists equipment_zone_check;
alter table public.equipment add constraint equipment_zone_check check (zone in ('cote_basque', 'bordeaux', 'arcachon'));
comment on column public.equipment.zone is '472 : dépôt de l''équipement (cote_basque | bordeaux | arcachon) — réservable seulement pour un bien de la même zone (bien.zone_logistique).';

create or replace function public.trg_equipment_booking_zone() returns trigger language plpgsql set search_path = public as $$
declare ez text; bz text; bc text;
begin
  if new.bien_id is null or new.equipment_id is null or coalesce(new.statut, '') = 'annule' then return new; end if;
  if tg_op = 'UPDATE' and new.equipment_id is not distinct from old.equipment_id and new.bien_id is not distinct from old.bien_id then return new; end if;
  select zone into ez from equipment where id = new.equipment_id;
  select zone_logistique, code into bz, bc from bien where id = new.bien_id;
  if ez is not null and bz is not null and ez <> bz then
    raise exception 'Équipement stocké en zone « % » : impossible de le réserver pour % (zone « % »)', ez, coalesce(bc, 'ce bien'), bz using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists trg_equipment_booking_zone on public.equipment_bookings;
create trigger trg_equipment_booking_zone before insert or update of equipment_id, bien_id on public.equipment_bookings
  for each row execute function public.trg_equipment_booking_zone();

-- Journal des actions : les paiements d'options du portail n'y entraient pas (contrainte d'actions) — constaté sur le 1er vrai
-- paiement (commande f51dc07b : insertion refusée silencieusement).
alter table public.dispo_action_log drop constraint if exists dispo_action_log_action_check;
alter table public.dispo_action_log add constraint dispo_action_log_action_check check (action = any (array['block', 'unblock', 'set_rules', 'create_direct_reservation', 'create_manual_reservation',
  'devis_option', 'devis_prolonger', 'devis_annuler', 'devis_convertir', 'devis_expire', 'sejour_hors_hospitable', 'sejour_hors_bloquer', 'sejour_hors_annuler', 'sejour_hors_refacturation',
  'contrat_brouillon', 'devis_envoyer', 'devis_paiement', 'devis_paye_converti', 'devis_rembourse', 'resa_annuler_rembourser', 'portail_option_payee', 'portail_option_rembourse']));
