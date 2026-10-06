-- 333 — reservation.rapprochee recalculée quand le revenu ou les paiements changent (06/10/2026).
-- Cause : le rapprochement nuit pose rapprochee=true seulement si paiements ≥ 96 % du fin_revenue À CET
-- INSTANT. Si la synchro Hospitable corrige ensuite fin_revenue à la baisse (= le payout réel), le flag
-- n'était jamais réévalué → résa payée au centime affichée « virement non rapproché » dans la
-- Comptabilité (416 HMHYWKSRCS, CERES HMK5RRBF4Y, ERDIGUNEA HMJ2P92EBN, septembre 2026).
-- Promotion uniquement (jamais de retour à false : un rapprochement manuel n'est pas défait).
create or replace function public.recalculer_rapprochee(p_resa_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_rev bigint; v_paye bigint; v_flag boolean;
begin
  select fin_revenue, rapprochee into v_rev, v_flag from reservation where id = p_resa_id;
  if v_flag is true then return; end if;
  select coalesce(sum(p.montant), 0) into v_paye
    from reservation_paiement p join mouvement_bancaire m on m.id = p.mouvement_id
   where p.reservation_id = p_resa_id and m.statut_matching = 'rapproche';
  if v_paye > 0 and (coalesce(v_rev, 0) = 0 or v_paye >= v_rev * 0.96) then
    update reservation set rapprochee = true where id = p_resa_id;
    update reservation_paiement set type_paiement = 'total'
     where reservation_id = p_resa_id and type_paiement = 'acompte'
       and (select count(*) from reservation_paiement where reservation_id = p_resa_id) = 1;
  end if;
end $$;
revoke all on function public.recalculer_rapprochee(uuid) from public, anon;

create or replace function public.trg_recalc_rapprochee_paiement()
returns trigger language plpgsql security definer set search_path = public as $$
begin perform recalculer_rapprochee(new.reservation_id); return new;
exception when others then return new; end $$;
drop trigger if exists trg_recalc_rapprochee_paiement on public.reservation_paiement;
create trigger trg_recalc_rapprochee_paiement after insert or update of montant, mouvement_id on public.reservation_paiement
  for each row execute function public.trg_recalc_rapprochee_paiement();

create or replace function public.trg_recalc_rapprochee_resa()
returns trigger language plpgsql security definer set search_path = public as $$
begin perform recalculer_rapprochee(new.id); return new;
exception when others then return new; end $$;
drop trigger if exists trg_recalc_rapprochee_resa on public.reservation;
create trigger trg_recalc_rapprochee_resa after update of fin_revenue on public.reservation
  for each row when (new.rapprochee is not true and new.fin_revenue is distinct from old.fin_revenue)
  execute function public.trg_recalc_rapprochee_resa();

-- Rattrapage : résas déjà payées au moins à 96 % mais restées non rapprochées
select recalculer_rapprochee(r.id) from reservation r
 where r.rapprochee is not true and exists (select 1 from reservation_paiement p where p.reservation_id = r.id);
