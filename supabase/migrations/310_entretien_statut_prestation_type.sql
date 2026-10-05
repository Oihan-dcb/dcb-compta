-- 310 — entretien_statut renvoie aussi prestation_type_id (création de l'extra hors forfait au « Fait »).
drop function if exists public.entretien_statut(uuid[]);
create or replace function public.entretien_statut(p_bien_ids uuid[])
returns table (
  plan_id uuid, bien_id uuid, entretien_type_id uuid, nom text, icone text, consigne text,
  periodicite_jours integer, periodicite_sejours integer, duree_min integer,
  dernier_fait timestamptz, dernier_par text, jours_depuis integer, sejours_depuis integer,
  ratio numeric, couleur text, jamais_fait boolean, prestation_type_id uuid
) language sql stable security definer set search_path = public as $$
  with p as (
    select pl.*, t.nom, t.icone, t.consigne, t.prestation_type_id ptid,
      coalesce(pl.periodicite_jours, t.periodicite_jours) pj,
      coalesce(pl.periodicite_sejours, t.periodicite_sejours) ps,
      coalesce(pl.duree_min, t.duree_min) dm
    from bien_entretien_plan pl join entretien_type t on t.id = pl.entretien_type_id
    where pl.actif and t.actif and pl.bien_id = any(p_bien_ids)
      and (auth_user_is_internal())
  ), d as (
    select p.*, f.fait_le, a.prenom,
      coalesce(f.fait_le::date, p.reference_initiale) ref
    from p
    left join lateral (select fe.fait_le, fe.ae_id from bien_entretien_fait fe
                        where fe.plan_id = p.id and fe.statut = 'fait' order by fe.fait_le desc limit 1) f on true
    left join auto_entrepreneur a on a.id = f.ae_id
  ), c as (
    select d.*, (current_date - d.ref) jd,
      (select count(*)::int from reservation r where r.bien_id = d.bien_id and r.final_status = 'accepted'
          and r.departure_date > d.ref and r.departure_date <= current_date) sd
    from d
  )
  select c.id, c.bien_id, c.entretien_type_id, c.nom, c.icone, c.consigne, c.pj, c.ps, c.dm,
    c.fait_le, c.prenom, c.jd, c.sd,
    round(greatest(case when c.pj is not null then c.jd::numeric / c.pj else 0 end,
                   case when c.ps is not null then c.sd::numeric / c.ps else 0 end), 2),
    case when greatest(case when c.pj is not null then c.jd::numeric / c.pj else 0 end,
                       case when c.ps is not null then c.sd::numeric / c.ps else 0 end) >= 1 then 'rouge'
         when greatest(case when c.pj is not null then c.jd::numeric / c.pj else 0 end,
                       case when c.ps is not null then c.sd::numeric / c.ps else 0 end) >= 0.8 then 'orange'
         else 'vert' end,
    c.fait_le is null, c.ptid
  from c;
$$;
revoke all on function public.entretien_statut(uuid[]) from public, anon;
grant execute on function public.entretien_statut(uuid[]) to authenticated;
