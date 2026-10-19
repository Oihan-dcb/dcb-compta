-- 486 — Plafond légal des nuits louées par an pour une RÉSIDENCE PRINCIPALE (19/10/2026, décision Oïhan « oui »).
--
-- AUCUN nouveau champ : on réutilise ce qui existe déjà.
--   · Résidence principale = bien.statut_occupation (migration 289) = la déclaration du PROPRIÉTAIRE dans le
--     questionnaire du portail owner (« Résidence principale (logement entier) », « Annexe de la résidence
--     principale… », « Résidence secondaire », « Location mixte… »), recopiée par dcb-contrats/api/mandat-onb-complete.js
--     et reprise dans le mandat (clause occ_rp_entiere, migration 460). Une annexe de la RP n'est PAS plafonnée (mandat).
--   · Plafond = config.limite_jours du DERNIER mandat signé du bien (mandat_signature, ex. BACALAN 90 à Bordeaux),
--     sinon 120 (règle nationale).
--   · Comptage = même règle que api/cron-alerte-120j.js (déjà en place) : séjours acceptés, toutes plateformes,
--     hors séjours propriétaire, hors séjours de plus de 240 nuits (bail étudiant / LLD) ; un séjour à cheval sur
--     deux années compte ses nuits dans chacune.
-- Ajouts :
--   1. est_residence_principale(statut_occupation) : LA règle, partagée (fonction SQL) ;
--   2. nuits_louees_annee(annee, biens) : compteur par bien (lu par la vente directe api/_direct.js, l'Accueil
--      › À faire › Vérifier api/_aFaire.js et la fiche bien PowerHouse) ;
--   3. données : ERDIGUNEA (décision Oïhan 19/10/2026) et COTREL (mandat signé « résidence principale (logement
--      entier) ») n'avaient pas de statut d'occupation → renseigné ; type_exploitation (PowerHouse, 356) aligné sur
--      la déclaration pour les biens où il était vide (on n'écrase rien).

create or replace function public.est_residence_principale(p_statut text)
returns boolean language sql immutable as $$
  select coalesce(p_statut ~* '^\s*r[ée]sidence principale', false);
$$;
comment on function public.est_residence_principale(text) is
  'Vrai si bien.statut_occupation (déclaration du propriétaire, portail owner / mandat) = résidence principale (logement entier). Une « Annexe de la résidence principale » n''est pas concernée. Migration 486.';

create or replace function public.nuits_louees_annee(p_annee int, p_biens uuid[] default null)
returns table (bien_id uuid, code text, plafond int, nuits int, par_plateforme jsonb)
language sql stable security invoker set search_path = public as $$
  with b as (
    select bi.id, bi.code,
           coalesce((select case when (m.config->>'limite_jours') ~ '^\d{1,3}$' then (m.config->>'limite_jours')::int end
                       from mandat_signature m where m.bien_id = bi.id and m.statut = 'signe'
                       order by m.signed_at desc nulls last, m.created_at desc limit 1), 120) as plafond
    from bien bi
    where est_residence_principale(bi.statut_occupation) and (p_biens is null or bi.id = any(p_biens))
  ), r as (
    select r.bien_id, coalesce(nullif(r.platform, ''), 'autre') as platform,
           greatest(0, least(r.departure_date, make_date(p_annee + 1, 1, 1)) - greatest(r.arrival_date, make_date(p_annee, 1, 1)))::int as n
    from reservation r join b on b.id = r.bien_id
    where r.final_status = 'accepted' and not coalesce(r.owner_stay, false)
      and r.arrival_date < make_date(p_annee + 1, 1, 1) and r.departure_date > make_date(p_annee, 1, 1)
      and (r.departure_date - r.arrival_date) <= 240
  ), p as (
    select r.bien_id, r.platform, sum(r.n)::int as n from r group by 1, 2
  )
  select b.id, b.code, b.plafond, coalesce(sum(p.n), 0)::int,
         coalesce(jsonb_object_agg(p.platform, p.n) filter (where p.platform is not null), '{}'::jsonb)
  from b left join p on p.bien_id = b.id
  group by b.id, b.code, b.plafond;
$$;
comment on function public.nuits_louees_annee(int, uuid[]) is
  'Nuits louées sur l''année civile des résidences principales (486) : acceptées, toutes plateformes, hors propriétaire, hors séjours > 240 nuits. plafond = limite_jours du dernier mandat signé, sinon 120.';
revoke all on function public.nuits_louees_annee(int, uuid[]) from public, anon;
grant execute on function public.nuits_louees_annee(int, uuid[]) to authenticated, service_role;

update public.bien set statut_occupation = 'Résidence principale (logement entier)'
 where code in ('ERDIGUNEA', 'COTREL') and statut_occupation is null;
update public.bien set type_exploitation = 'residence_principale'
 where type_exploitation is null and public.est_residence_principale(statut_occupation);
