-- 418d — Metrics : la série « jours » de ph_metrics_calc porte aussi, par date d'arrivée, l'hébergement, les nuits des
-- séjours, le VIRProprio et les honoraires HON+COM (si droit) — pour les mini-courbes des chiffres clés. Champs AJOUTÉS
-- en fin de tableau : [jour, brut, nuits occupées, nuits dispo, hébergement, nuits séjours, VIRProprio, honoraires].
create or replace function public.ph_metrics_calc(
  p_biens uuid[], p_debut date, p_fin date, p_coupure date, p_ref date, p_hon boolean)
returns jsonb language sql stable security definer set search_path to 'public' as $$
with
bb as (
  select b.id, b.code, b.agence, b.gestion_offerte as offert, coalesce(b.gestion_loyer, true) as gestion_loyer
    from bien b where b.id = any(p_biens)
),
-- Résas rattachées à la période (arrivée), avec date de réservation pour la coupure « à date »
r0 as (
  select r.*, bb.offert, bb.gestion_loyer as bien_gl,
         coalesce(r.booking_date::date,
                  case when r.hospitable_raw->>'booking_date' ~ '^\d{4}-\d{2}-\d{2}'
                       then substr(r.hospitable_raw->>'booking_date', 1, 10)::date end,
                  least(r.created_at::date, r.arrival_date)) as reserve_le
    from reservation r join bb on bb.id = r.bien_id
   where r.arrival_date >= p_debut and r.arrival_date <= p_fin
     and (r.final_status = 'accepted'
          or (coalesce(r.fin_revenue, 0) > 0
              and r.final_status in ('cancelled', 'not_accepted', 'not accepted', 'declined', 'expired')))
),
r1 as (
  select r.id, r.bien_id, r.offert, r.bien_gl, coalesce(r.owner_stay, false) as proprio,
         r.final_status = 'accepted' as acceptee, r.platform, r.arrival_date, r.departure_date,
         greatest(coalesce(r.nights, r.departure_date - r.arrival_date), 0) as nuits, r.reserve_le,
         case when r.platform = 'airbnb' then 'airbnb' when r.platform = 'booking' then 'booking'
              when r.platform in ('direct', 'manual') then 'direct' else 'autre' end as canal,
         coalesce(r.fin_accommodation, 0) as acc, coalesce(r.fin_revenue, 0) as rev,
         coalesce(r.fin_host_service_fee, 0) as hsf, coalesce(r.fin_gross_revenue, 0) as gross,
         coalesce(r.fin_discount, 0) as disc,
         coalesce((r.hospitable_raw->'financials'->'guest'->'total_price'->>'amount')::bigint, 0) as guest_total,
         coalesce((select sum((d->>'amount')::bigint) from jsonb_array_elements(
                     case when jsonb_typeof(r.hospitable_raw->'financials'->'host'->'discounts') = 'array'
                          then r.hospitable_raw->'financials'->'host'->'discounts' else '[]'::jsonb end) d), 0) as disc_raw,
         coalesce((select sum((t->>'amount')::bigint) from jsonb_array_elements(
                     case when jsonb_typeof(r.hospitable_raw->'financials'->'guest'->'taxes') = 'array'
                          then r.hospitable_raw->'financials'->'guest'->'taxes' else '[]'::jsonb end) t
                    where lower(coalesce(t->>'label', '')) like '%withheld%'), 0) as withheld,
         fe.nf, fe.gf, fe.tx, fe.tx_nr, ve.vir, ve.hon, ve.com, ve.fmen, ve.n_vent,
         r.reserve_le <= p_coupure as connue
    from r0 r
    left join lateral (
      select count(*) as nf,
             coalesce(sum(f.amount) filter (where f.fee_type = 'guest_fee'), 0) as gf,
             coalesce(sum(f.amount) filter (where f.fee_type = 'tax'), 0) as tx,
             coalesce(sum(f.amount) filter (where f.fee_type = 'tax' and lower(coalesce(f.label, '')) not like '%remitted%'), 0) as tx_nr
        from reservation_fee f where f.reservation_id = r.id) fe on true
    left join lateral (
      select coalesce(sum(v.montant_ttc) filter (where v.code = 'VIR'), 0) as vir,
             coalesce(sum(v.montant_ht) filter (where v.code = 'HON'), 0) as hon,
             coalesce(sum(v.montant_ht) filter (where v.code = 'COM'), 0) as com,
             coalesce(sum(v.montant_ht) filter (where v.code = 'FMEN'), 0) as fmen,
             count(*) filter (where v.code = 'VIR') as n_vir, count(*) as n_vent
        from ventilation v where v.reservation_id = r.id) ve on true
   where r.reserve_le <= p_ref
),
r2 as (
  select r1.*,
         case when r1.disc_raw <> 0 then abs(r1.disc_raw) else abs(r1.disc) end as remise,
         case
           when r1.platform in ('direct', 'manual') and r1.gross > 0 then r1.gross
           when r1.platform = 'airbnb' and r1.guest_total > 0 then r1.guest_total
           when r1.platform = 'booking' and r1.nf = 0 and r1.gross > 0 then r1.gross - r1.withheld
           else r1.acc + r1.gf
                + case when r1.platform = 'booking' then r1.tx_nr else 0 end
                + case when r1.platform = 'manual' then r1.tx else 0 end
                - case when r1.platform in ('airbnb', 'manual', 'direct')
                       then (case when r1.disc_raw <> 0 then abs(r1.disc_raw) else abs(r1.disc) end) else 0 end
         end as brut
    from r1
),
r3 as (
  select r2.*,
         r2.acc - r2.remise as heb,
         case when r2.platform in ('airbnb', 'booking') then greatest(0, -r2.hsf)
              else greatest(0, r2.brut - r2.rev) end as commission,
         case when r2.reserve_le is not null and r2.acceptee then greatest(r2.arrival_date - r2.reserve_le, 0) end as delai
    from r2
),
-- Blocages = séjour propriétaire, ou « séjour » accepté sans aucun revenu (blocs étudiants / LLD saisis en manuel,
-- prêts, blocages) : ni vendu ni disponible. ≥ 28 nuits = location longue / blocage long.
r4 as (select r3.*, (r3.proprio or (r3.acceptee and r3.brut = 0 and r3.rev = 0 and r3.acc = 0)) as bloc from r3),
-- Résas comptées (hors blocages et hors biens en gestion offerte)
rc as (select * from r4 where not bloc and not offert and connue),
-- Rythme de réservation (pick-up) : TOUTES les résas connues aujourd'hui, par nombre de jours entre réservation et début
pk as (
  select p_debut - reserve_le as o, count(*) filter (where acceptee) as nb, sum(brut) as brut,
         coalesce(sum(nuits) filter (where acceptee), 0) as nuits
    from r4 where not bloc and not offert group by 1
),
-- ── Disponibilité réelle ────────────────────────────────────────────────────────────────────────
act as (
  select r.bien_id, r.arrival_date as a, r.departure_date as d
    from reservation r join bb on bb.id = r.bien_id
   where not bb.offert and r.final_status = 'accepted' and r.departure_date > r.arrival_date
  union all
  select b.id, p_ref, date '9999-12-31' from bien b join bb on bb.id = b.id
   where not bb.offert and b.statut_location = 'saisonnier' and not coalesce(b.hors_location, false)
),
o as (select act.*, max(d) over (partition by bien_id order by a, d rows between unbounded preceding and 1 preceding) as prev_d from act),
g as (select o.*, sum(case when prev_d is null or a - prev_d >= 90 then 1 else 0 end)
                    over (partition by bien_id order by a, d rows between unbounded preceding and current row) as ile from o),
iles as (select bien_id, ile, min(a) as a, max(d) as d from g group by bien_id, ile),
occ as (
  select r.bien_id, r.arrival_date as a, r.departure_date as d,
         case when (r.departure_date - r.arrival_date) >= 28
                   and (coalesce(r.owner_stay, false) or (coalesce(r.fin_revenue, 0) = 0 and coalesce(r.fin_accommodation, 0) = 0 and coalesce(r.fin_gross_revenue, 0) = 0))
                then 'longue'
              when coalesce(r.owner_stay, false) then 'proprio'
              when coalesce(r.fin_revenue, 0) = 0 and coalesce(r.fin_accommodation, 0) = 0 and coalesce(r.fin_gross_revenue, 0) = 0
                   and coalesce((r.hospitable_raw->'financials'->'guest'->'total_price'->>'amount')::bigint, 0) = 0 then 'sans_revenu'
              else 'voyageur' end as cat
    from reservation r join bb on bb.id = r.bien_id
   where not bb.offert and r.final_status = 'accepted'
     and r.arrival_date <= p_fin and r.departure_date > p_debut
     and coalesce(r.booking_date::date,
                  case when r.hospitable_raw->>'booking_date' ~ '^\d{4}-\d{2}-\d{2}'
                       then substr(r.hospitable_raw->>'booking_date', 1, 10)::date end,
                  least(r.created_at::date, r.arrival_date)) <= p_coupure
),
-- Nuits « dépliées » (une ligne par bien et par nuit de la période) puis jointures par hachage — rapide
n_occ as (
  select distinct occ.bien_id, n::date as n, occ.cat
    from occ, generate_series(greatest(occ.a, p_debut), least(occ.d - 1, p_fin), interval '1 day') n
),
n_ouv as (
  select distinct i.bien_id, n::date as n
    from iles i, generate_series(greatest(i.a, p_debut), least(i.d - 1, p_fin), interval '1 day') n
   where i.a <= p_fin and i.d > p_debut
),
n_lld as (
  select distinct e.bien_id, n::date as n
    from etudiant e join bb on bb.id = e.bien_id,
         generate_series(greatest(e.date_entree, p_debut),
                         least(coalesce(e.date_sortie_reelle, e.date_sortie_prevue, date '9999-12-31') - 1, p_fin), interval '1 day') n
   where not bb.offert and e.date_entree <= p_fin
     and coalesce(e.date_sortie_reelle, e.date_sortie_prevue, date '9999-12-31') > p_debut
),
jn as (
  select k.bien_id, k.n,
         exists (select 1 from n_occ x where x.bien_id = k.bien_id and x.n = k.n and x.cat = 'voyageur') as occupe,
         exists (select 1 from n_occ x where x.bien_id = k.bien_id and x.n = k.n and x.cat <> 'voyageur') as bloque,
         exists (select 1 from n_ouv x where x.bien_id = k.bien_id and x.n = k.n) as ouvert,
         exists (select 1 from n_lld x where x.bien_id = k.bien_id and x.n = k.n) as lld
    from (select bien_id, n from n_occ union select bien_id, n from n_ouv) k
),
dispo as (
  select bien_id,
         count(*) filter (where occupe or (ouvert and not lld and not bloque)) as dispo,
         count(*) filter (where occupe) as occupees,
         count(*) filter (where bloque and not occupe) as nuits_bloquees
    from jn group by bien_id
),
-- Avis reçus pendant la période (une note par résa), biens en gestion offerte exclus
avis as (
  select distinct on (coalesce(rv.reservation_id, rv.id)) coalesce(r.bien_id, rv.bien_id) as bien_id, rv.rating
    from reservation_review rv left join reservation r on r.id = rv.reservation_id
   where rv.rating is not null
     and (rv.submitted_at at time zone 'Europe/Paris')::date between p_debut and least(p_fin, p_coupure)
     and coalesce(r.bien_id, rv.bien_id) in (select id from bb where not offert)
   order by coalesce(rv.reservation_id, rv.id), rv.submitted_at desc
),
-- Série par mois (finances : mois d'arrivée ; occupation : nuits du mois calendaire)
mf as (
  select to_char(rc.arrival_date, 'YYYY-MM') as m,
         count(*) filter (where rc.acceptee) as nb, sum(rc.brut) as brut,
         coalesce(sum(rc.heb) filter (where rc.acceptee), 0) as heb,
         coalesce(sum(rc.nuits) filter (where rc.acceptee), 0) as nuits_resas,
         sum(rc.vir) as vir, sum(rc.hon) as hon, sum(rc.com) as com, count(*) filter (where rc.n_vent = 0) as nv
    from rc group by 1
),
mo as (
  select to_char(n, 'YYYY-MM') as m,
         count(*) filter (where occupe or (ouvert and not lld and not bloque)) as dispo,
         count(*) filter (where occupe) as occupees
    from jn group by 1
),
jo as (
  select n as j, count(*) filter (where occupe or (ouvert and not lld and not bloque)) as dispo, count(*) filter (where occupe) as occupees
    from jn group by 1
),
ja as (select arrival_date as j, sum(brut) as brut, count(*) filter (where acceptee) as nb,
              coalesce(sum(heb) filter (where acceptee), 0) as heb, coalesce(sum(nuits) filter (where acceptee), 0) as nuits_resas,
              sum(vir) as vir, sum(hon) + sum(com) as honcom from rc group by 1),
mois as (
  select coalesce(mf.m, mo.m) as m, coalesce(mf.nb, 0) as nb, coalesce(mf.brut, 0) as brut, coalesce(mf.heb, 0) as heb,
         coalesce(mf.nuits_resas, 0) as nuits_resas, coalesce(mf.vir, 0) as vir, coalesce(mf.hon, 0) as hon, coalesce(mf.com, 0) as com,
         coalesce(mo.dispo, 0) as dispo, coalesce(mo.occupees, 0) as occupees, coalesce(mf.nv, 0) as nv
    from mf full join mo on mo.m = mf.m
),
-- Agrégats par bien
pb as (
  select bb.id as bien_id, bb.code, bb.agence, bb.gestion_loyer,
         count(rc.id) filter (where rc.acceptee) as nb,
         count(rc.id) filter (where not rc.acceptee) as nb_annul,
         coalesce(sum(rc.brut), 0) as brut,
         coalesce(sum(rc.brut) filter (where not rc.acceptee), 0) as brut_annul,
         coalesce(sum(rc.heb) filter (where rc.acceptee), 0) as heb,
         coalesce(sum(rc.nuits) filter (where rc.acceptee), 0) as nuits_resas,
         coalesce(sum(rc.delai) filter (where rc.delai is not null), 0) as delai_somme,
         count(rc.delai) as delai_n,
         coalesce(sum(rc.vir), 0) as vir,
         count(rc.id) filter (where not rc.bien_gl) as nb_proprio_encaisse,
         coalesce(sum(rc.hon), 0) as hon, coalesce(sum(rc.com), 0) as com, coalesce(sum(rc.fmen), 0) as fmen,
         coalesce(sum(rc.commission), 0) as commission,
         count(rc.id) filter (where rc.n_vent = 0) as nb_non_ventile
    from bb left join rc on rc.bien_id = bb.id
   where not bb.offert
   group by bb.id, bb.code, bb.agence, bb.gestion_loyer
),
pba as (
  select pb.*, coalesce(d.dispo, 0) as dispo, coalesce(d.occupees, 0) as occupees, coalesce(d.nuits_bloquees, 0) as nuits_bloquees,
         (select count(*) from avis a where a.bien_id = pb.bien_id) as avis_n,
         (select sum(a.rating) from avis a where a.bien_id = pb.bien_id) as avis_somme
    from pb left join dispo d on d.bien_id = pb.bien_id
)
select jsonb_build_object(
  'debut', p_debut, 'fin', p_fin, 'coupure', p_coupure,
  'totaux', (select jsonb_build_object(
      'nb', coalesce(sum(nb), 0), 'nb_annul', coalesce(sum(nb_annul), 0),
      'brut', coalesce(sum(brut), 0), 'brut_annul', coalesce(sum(brut_annul), 0), 'heb', coalesce(sum(heb), 0),
      'nuits_resas', coalesce(sum(nuits_resas), 0), 'delai_somme', coalesce(sum(delai_somme), 0), 'delai_n', coalesce(sum(delai_n), 0),
      'vir', coalesce(sum(vir), 0), 'nb_proprio_encaisse', coalesce(sum(nb_proprio_encaisse), 0),
      'hon', case when p_hon then coalesce(sum(hon), 0) end, 'com', case when p_hon then coalesce(sum(com), 0) end,
      'fmen', case when p_hon then coalesce(sum(fmen), 0) end,
      'commission', coalesce(sum(commission), 0), 'nb_non_ventile', coalesce(sum(nb_non_ventile), 0),
      'dispo', coalesce(sum(dispo), 0), 'occupees', coalesce(sum(occupees), 0), 'nuits_bloquees', coalesce(sum(nuits_bloquees), 0),
      'biens_ouverts', count(*) filter (where dispo > 0),
      'avis_n', coalesce(sum(avis_n), 0), 'avis_somme', coalesce(sum(avis_somme), 0)) from pba),
  'canaux', (select coalesce(jsonb_agg(c order by c->>'canal'), '[]'::jsonb) from (
      select jsonb_build_object('canal', canal,
               'nb', count(*) filter (where acceptee), 'nb_annul', count(*) filter (where not acceptee),
               'brut', sum(brut), 'heb', coalesce(sum(heb) filter (where acceptee), 0),
               'nuits_resas', coalesce(sum(nuits) filter (where acceptee), 0), 'commission', sum(commission),
               'vir', sum(vir), 'hon', case when p_hon then sum(hon) + sum(com) end, 'nb_non_ventile', count(*) filter (where n_vent = 0),
               'manuelles', count(*) filter (where platform = 'manual' and acceptee)) as c
        from rc group by canal) x),
  'biens', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', bien_id, 'code', code, 'agence', agence, 'gl', gestion_loyer,
      'nb', nb, 'nb_annul', nb_annul, 'brut', brut, 'heb', heb, 'nuits_resas', nuits_resas,
      'delai_somme', delai_somme, 'delai_n', delai_n, 'vir', vir, 'commission', commission, 'nb_non_ventile', nb_non_ventile,
      'hon', case when p_hon then hon end, 'com', case when p_hon then com end, 'fmen', case when p_hon then fmen end,
      'dispo', dispo, 'occupees', occupees, 'nuits_bloquees', nuits_bloquees, 'avis_n', avis_n, 'avis_somme', avis_somme)
      order by brut desc, code), '[]'::jsonb) from pba where nb + nb_annul > 0 or dispo > 0 or nuits_bloquees > 0),
  'mois', (select coalesce(jsonb_agg(jsonb_build_object('m', m, 'nb', nb, 'brut', brut, 'heb', heb, 'nuits_resas', nuits_resas,
      'vir', vir, 'hon', case when p_hon then hon end, 'com', case when p_hon then com end, 'dispo', dispo, 'occupees', occupees, 'nb_non_ventile', nv) order by m), '[]'::jsonb) from mois),
  'jours', (select coalesce(jsonb_agg(jsonb_build_array(to_char(d::date, 'YYYY-MM-DD'), coalesce(ja.brut, 0), coalesce(jo.occupees, 0), coalesce(jo.dispo, 0),
                coalesce(ja.heb, 0), coalesce(ja.nuits_resas, 0), coalesce(ja.vir, 0), case when p_hon then coalesce(ja.honcom, 0) end) order by d), '[]'::jsonb)
             from generate_series(p_debut, p_fin, interval '1 day') d left join jo on jo.j = d::date left join ja on ja.j = d::date),
  'pickup', (select coalesce(jsonb_agg(jsonb_build_array(o, brut, nuits, nb) order by o desc), '[]'::jsonb) from pk),
  'evenements', (select count(*) from evenement_local e where e.date_debut between p_debut and p_fin
                    and e.agence in (select distinct agence from bb)),
  'a_part', jsonb_build_object(
      'offerts', (select jsonb_build_object('nb', count(*) filter (where acceptee and not bloc),
                     'nuits', coalesce(sum(nuits) filter (where acceptee and not bloc), 0),
                     'brut', coalesce(sum(brut) filter (where not bloc), 0),
                     'biens', coalesce((select jsonb_agg(distinct bb.code) from bb where bb.offert), '[]'::jsonb))
                    from r4 where offert),
      'blocs', (select coalesce(jsonb_object_agg(c.cat, jsonb_build_object('nuits', c.nuits)), '{}'::jsonb) from (
                  select x.cat, count(*) as nuits from n_occ x
                   where x.cat <> 'voyageur'
                     and not exists (select 1 from n_occ y where y.bien_id = x.bien_id and y.n = x.n and y.cat = 'voyageur')
                   group by x.cat) c))
);
$$;
revoke all on function public.ph_metrics_calc(uuid[], date, date, date, date, boolean) from public, anon, authenticated;
