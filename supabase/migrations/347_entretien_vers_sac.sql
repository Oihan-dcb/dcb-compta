-- 347 — Entretien périodique → sac (07/10/2026, demande Oïhan) : quand un entretien qui demande du
-- matériel arrive à échéance (≥ 80 % de sa période en jours ou en séjours, « orange » de entretien_statut)
-- sur un plan ACTIF, le matériel est ajouté automatiquement aux besoins du sac du bien (besoin_sac
-- a_preparer) : il part sur la prochaine tâche (dcb-planning api/hospitable-tasks) et l'AE l'a sur place
-- le jour de l'entretien. Premier cas : « Alèses et sous-taies changées » → « Alèses + sous-taies propres ».
-- Pas de doublon : rien si un besoin du même libellé est déjà ouvert (a_preparer / dans_sac) ou a été
-- déposé il y a moins de 7 jours. Cron quotidien 5h50 UTC (avant la préparation des sacs).
alter table public.entretien_type add column if not exists sac_libelle text;
comment on column public.entretien_type.sac_libelle is 'Matériel à mettre dans le sac quand l''entretien arrive à échéance (besoin_sac auto, migration 347). NULL = aucun.';
update public.entretien_type set sac_libelle = 'Alèses + sous-taies propres', duree_min = 5,
  consigne = 'Retirer alèses et protège-oreillers (sous-taies), les mettre au linge sale (lavage), poser les propres prévus dans le sac. Signaler toute tache ou alèse abîmée.'
 where nom = 'Alèses et sous-taies changées';
update public.bien_entretien_plan set duree_min = 5
 where entretien_type_id = (select id from public.entretien_type where nom = 'Alèses et sous-taies changées');

create or replace function public.entretien_vers_sac()
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int;
begin
  with p as (
    select pl.id, pl.bien_id, t.nom, t.sac_libelle,
      coalesce(pl.periodicite_jours, t.periodicite_jours) pj,
      coalesce(pl.periodicite_sejours, t.periodicite_sejours) ps,
      coalesce((select fe.fait_le::date from bien_entretien_fait fe where fe.plan_id = pl.id and fe.statut = 'fait'
                order by fe.fait_le desc limit 1), pl.reference_initiale) ref
    from bien_entretien_plan pl join entretien_type t on t.id = pl.entretien_type_id
    where pl.actif and t.actif and t.sac_libelle is not null
  ), c as (
    select p.*, (current_date - p.ref) jd,
      (select count(*)::int from reservation r where r.bien_id = p.bien_id and r.final_status = 'accepted'
         and r.departure_date > p.ref and r.departure_date <= current_date) sd
    from p
  ), dus as (
    select * from c
    where greatest(case when pj is not null then jd::numeric / pj else 0 end,
                   case when ps is not null then sd::numeric / ps else 0 end) >= 0.8
      and not exists (select 1 from besoin_sac b where b.bien_id = c.bien_id and b.libelle = c.sac_libelle
                       and (b.statut in ('a_preparer', 'dans_sac') or (b.statut = 'depose' and b.depose_at > now() - interval '7 days')))
  )
  insert into besoin_sac (bien_id, libelle, quantite, note, statut)
  select bien_id, sac_libelle, 1, 'Entretien à échéance : ' || nom || ' (ajouté automatiquement)', 'a_preparer' from dus;
  get diagnostics n = row_count;
  return n;
end $function$;
revoke all on function public.entretien_vers_sac() from public, anon, authenticated;

select cron.schedule('entretien-vers-sac', '50 5 * * *', $$select public.entretien_vers_sac()$$);
