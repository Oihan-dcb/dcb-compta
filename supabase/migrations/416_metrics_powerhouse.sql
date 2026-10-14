-- 416 — Page « Metrics » PowerHouse (14/10/2026) : performances par période vs N-1 à date équivalente,
-- calculées CÔTÉ BASE, droits STRICTS repris de 414 (ph_droit) :
--   perf 'tout'          Oïhan : tout, filtrable par agence
--   perf 'agence:lauian' Laura : Lauïan uniquement
--   perf 'scope'         Léa   : ses biens (my_scoped_bien_ids)
--   pas de droit perf    Clémence / futurs bureau : RIEN (acces_refuse → API 403, menu masqué)
--   honoraires (HON + COM, FMEN à part) seulement avec le droit 'honoraires'.
--
-- 1. bien.gestion_offerte : biens dont DCB offre la gestion (LAGREOU / ASKIDA biens perso d'Oïhan, AITA / VIKY
--    famille) — HON/FMEN calculés mais jamais facturés : EXCLUS des chiffres (revenus, occupation, net, honoraires),
--    comptés à part. Séjours propriétaire : exclus des revenus et des nuits disponibles, comptés à part.
-- 2. ph_metrics_calc(biens, début, fin, coupure, réf, honoraires) : calcul brut (pas de contrôle de droits,
--    NON exécutable par les comptes — appelé uniquement par ph_metrics).
-- 3. ph_metrics(début, fin, agence) : contrôle du droit + périmètre, calcule N et N-1.
--
-- Règles (identiques aux rapports dcb-compta, buildRapportData.js, sauf mention) :
--   · rattachement d'une résa à la période = date d'ARRIVÉE (= mois_comptable des rapports mensuels) ;
--   · résas retenues = acceptées + annulées AVEC un montant conservé (fin_revenue > 0, indemnité d'annulation :
--     revenus / VIRProprio / honoraires, pas de nuits) ; jamais les demandes / checkpoints / supprimées ;
--   · brut voyageur = Airbnb : guest.total_price (Hospitable) ; Direct et manuelle : total_price (fin_gross_revenue) ;
--     Booking : hébergement + frais voyageur + taxes non « remitted » (repli total − taxes « withheld ») ;
--     sinon hébergement + frais voyageur (+ taxes en manuel) − remise.
--     ÉCART VOULU avec buildRapportData pour les résas MANUELLES avec remise : le rapport ajoute hébergement +
--     frais + taxes sans retirer la remise (brut surévalué de la remise) ; ici on prend le total réellement payé.
--   · hébergement = fin_accommodation − remise (remises Hospitable, repli fin_discount) ;
--   · VIRProprio = ventilation code VIR (montant_ttc) ; honoraires = HON + COM (montant_ht), FMEN à part ;
--   · commission plateforme = Airbnb / Booking : −fin_host_service_fee ; Direct / manuelle : brut − fin_revenue ;
--   · N-1 « à date équivalente » : mêmes dates un an plus tôt, en ne gardant que les résas DÉJÀ RÉSERVÉES à la même
--     date l'an dernier (date de réservation ≤ aujourd'hui − 1 an) ;
--   · occupation = nuits occupées DANS la période / nuits disponibles RÉELLES du parc de la période : un bien n'est
--     disponible une nuit donnée que s'il était en exploitation saisonnière ce jour-là — entre deux séjours
--     (voyageur ou propriétaire) espacés de moins de 90 nuits, ou à partir d'aujourd'hui s'il est actuellement
--     saisonnier — hors bail étudiant / mobilité (table etudiant) et hors séjour propriétaire.
--     Un trou de 90 nuits ou plus sans aucun séjour = bien fermé / en location longue (biens d'été, LLD).

-- ─── 1. Biens en gestion offerte ───────────────────────────────────────────────────────────────────
alter table public.bien add column if not exists gestion_offerte boolean not null default false;
comment on column public.bien.gestion_offerte is 'Gestion offerte par DCB (biens perso d''Oïhan, famille) : HON/FMEN jamais facturés. Exclus des performances (page Metrics, 416), comptés à part.';
update public.bien set gestion_offerte = true
 where code in ('LAGREOU', 'ASKIDA', 'AITA', 'VIKY') and agence = 'dcb' and not gestion_offerte;

-- ─── 2. Calcul ─────────────────────────────────────────────────────────────────────────────────────
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
         fe.nf, fe.gf, fe.tx, fe.tx_nr, ve.vir, ve.hon, ve.com, ve.fmen
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
             count(*) filter (where v.code = 'VIR') as n_vir
        from ventilation v where v.reservation_id = r.id) ve on true
   where r.reserve_le <= p_coupure
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
-- Résas comptées (hors séjours propriétaire et hors biens en gestion offerte)
rc as (select * from r3 where not proprio and not offert),
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
  select r.bien_id, coalesce(r.owner_stay, false) as proprio, r.arrival_date as a, r.departure_date as d
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
  select distinct occ.bien_id, n::date as n, occ.proprio
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
         exists (select 1 from n_occ x where x.bien_id = k.bien_id and x.n = k.n and not x.proprio) as occupe,
         exists (select 1 from n_occ x where x.bien_id = k.bien_id and x.n = k.n and x.proprio) as bloque,
         exists (select 1 from n_ouv x where x.bien_id = k.bien_id and x.n = k.n) as ouvert,
         exists (select 1 from n_lld x where x.bien_id = k.bien_id and x.n = k.n) as lld
    from (select bien_id, n from n_occ union select bien_id, n from n_ouv) k
),
dispo as (
  select bien_id,
         count(*) filter (where occupe or (ouvert and not lld and not bloque)) as dispo,
         count(*) filter (where occupe) as occupees,
         count(*) filter (where bloque and not occupe) as nuits_proprio
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
         coalesce(sum(rc.commission), 0) as commission
    from bb left join rc on rc.bien_id = bb.id
   where not bb.offert
   group by bb.id, bb.code, bb.agence, bb.gestion_loyer
),
pba as (
  select pb.*, coalesce(d.dispo, 0) as dispo, coalesce(d.occupees, 0) as occupees, coalesce(d.nuits_proprio, 0) as nuits_proprio,
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
      'commission', coalesce(sum(commission), 0),
      'dispo', coalesce(sum(dispo), 0), 'occupees', coalesce(sum(occupees), 0), 'nuits_proprio', coalesce(sum(nuits_proprio), 0),
      'biens_ouverts', count(*) filter (where dispo > 0),
      'avis_n', coalesce(sum(avis_n), 0), 'avis_somme', coalesce(sum(avis_somme), 0)) from pba),
  'canaux', (select coalesce(jsonb_agg(c order by c->>'canal'), '[]'::jsonb) from (
      select jsonb_build_object('canal', canal,
               'nb', count(*) filter (where acceptee), 'nb_annul', count(*) filter (where not acceptee),
               'brut', sum(brut), 'heb', coalesce(sum(heb) filter (where acceptee), 0),
               'nuits_resas', coalesce(sum(nuits) filter (where acceptee), 0), 'commission', sum(commission),
               'manuelles', count(*) filter (where platform = 'manual' and acceptee)) as c
        from rc group by canal) x),
  'biens', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', bien_id, 'code', code, 'agence', agence, 'gl', gestion_loyer,
      'nb', nb, 'nb_annul', nb_annul, 'brut', brut, 'heb', heb, 'nuits_resas', nuits_resas,
      'delai_somme', delai_somme, 'delai_n', delai_n, 'vir', vir, 'commission', commission,
      'hon', case when p_hon then hon end, 'com', case when p_hon then com end, 'fmen', case when p_hon then fmen end,
      'dispo', dispo, 'occupees', occupees, 'nuits_proprio', nuits_proprio, 'avis_n', avis_n, 'avis_somme', avis_somme)
      order by brut desc, code), '[]'::jsonb) from pba where nb + nb_annul > 0 or dispo > 0 or nuits_proprio > 0),
  'a_part', jsonb_build_object(
      'offerts', (select jsonb_build_object('nb', count(*) filter (where acceptee and not proprio),
                     'nuits', coalesce(sum(nuits) filter (where acceptee and not proprio), 0),
                     'brut', coalesce(sum(brut) filter (where not proprio), 0),
                     'biens', coalesce((select jsonb_agg(distinct bb.code) from bb where bb.offert), '[]'::jsonb))
                    from r3 where offert),
      'proprio', (select jsonb_build_object('nb', count(*), 'nuits', coalesce(sum(nuits), 0))
                    from r3 where proprio and not offert and acceptee))
);
$$;
revoke all on function public.ph_metrics_calc(uuid[], date, date, date, date, boolean) from public, anon, authenticated;

-- ─── 3. Point d'entrée avec contrôle des droits ────────────────────────────────────────────────────
create or replace function public.ph_metrics(p_debut date, p_fin date, p_agence text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_per text; v_hon boolean; v_biens uuid[]; v_ref date := (now() at time zone 'Europe/Paris')::date;
  v_d1 date; v_f1 date;
begin
  select d.perimetre into v_per from ph_droit d where d.auth_user_id = auth.uid() and d.droit = 'perf';
  if v_per is null then raise exception 'acces_refuse'; end if;
  v_hon := exists (select 1 from ph_droit d where d.auth_user_id = auth.uid() and d.droit = 'honoraires');
  if p_debut is null or p_fin is null or p_fin < p_debut or p_fin - p_debut > 731 then raise exception 'periode_invalide'; end if;
  if p_agence is not null and p_agence not in ('dcb', 'lauian') then raise exception 'agence_invalide'; end if;
  select coalesce(array_agg(b.id), '{}') into v_biens from bien b
   where case when v_per = 'tout' then true
              when v_per = 'scope' then b.id in (select my_scoped_bien_ids())
              when v_per like 'agence:%' then b.agence = substr(v_per, 8)
              else false end
     and (p_agence is null or b.agence = p_agence);
  v_d1 := (p_debut - interval '1 year')::date; v_f1 := (p_fin - interval '1 year')::date;
  return jsonb_build_object(
    'perimetre', v_per, 'honoraires', v_hon, 'agence', p_agence, 'ref', v_ref,
    'agences', (select coalesce(jsonb_agg(distinct b.agence), '[]'::jsonb) from bien b where b.id = any(v_biens)),
    'n', ph_metrics_calc(v_biens, p_debut, p_fin, v_ref, v_ref, v_hon),
    'n1', ph_metrics_calc(v_biens, v_d1, v_f1, (v_ref - interval '1 year')::date, v_ref, v_hon));
end $$;
revoke all on function public.ph_metrics(date, date, text) from public, anon;
grant execute on function public.ph_metrics(date, date, text) to authenticated;
