-- 395c — Simulation des règles, affinage après mesure sur 60 j passés + 21 j (10/10/2026) :
--   • repli base : une tâche assignée à 2 AE apparaissait 2 fois (iCal de chacun) → dédoublonnée par task_id ;
--   • « séjour enchaîné » : seuls prolongation / même voyageur fondent le ménage dans le séjour suivant.
--     Un séjour PROPRIÉTAIRE qui arrive le jour même n'empêche pas le ménage (10 cas sur 11 : Hospitable
--     crée bien le ménage avant l'arrivée du proprio) ; le cas sans ménage le dit dans sa phrase ;
--   • 2e tâche ménage le même jour qu'un ménage déjà rapproché = « ménage à plusieurs » (expliqué).

create or replace function public.mission_regles_simulation(p_du date, p_au date, p_taches jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_source text := case when p_taches is null then 'base' else 'hospitable' end;
  p record; t record; v_regles jsonb; v_lignes jsonb;
begin
  if p_du is null or p_au is null or p_au < p_du or p_au - p_du > 120 then raise exception 'periode_invalide'; end if;

  drop table if exists _sim_tache; drop table if exists _sim_sejour; drop table if exists _sim_ligne; drop table if exists _sim_regle_ci;

  -- ── Tâches réelles ────────────────────────────────────────────────────
  create temp table _sim_tache (task_id text, bien_id uuid, genre text, d date, nom text, pris boolean default false) on commit drop;
  if p_taches is not null then
    insert into _sim_tache (task_id, bien_id, genre, d, nom)
    select x.task_id, x.bien_id,
           case when x.task_type in (1, 4) and coalesce(x.note, '') !~* 'recouche' then 'menage'
                when coalesce(x.note, '') ~* 'recouche' then 'recouche'
                when x.task_type = 2 then 'check_in'
                when x.task_type = 3 then 'conciergerie'
                else 'technique' end,
           x.d, x.nom
    from jsonb_to_recordset(p_taches) as x(task_id text, bien_id uuid, task_type int, note text, d date, nom text)
    where x.bien_id is not null and x.d between p_du - 1 and p_au + 25;
  else
    insert into _sim_tache (task_id, bien_id, genre, d, nom)
    select distinct on (coalesce(nullif(split_part(m.ical_uid, '@', 1), ''), m.id::text))
           coalesce(nullif(split_part(m.ical_uid, '@', 1), ''), m.id::text), m.bien_id,
           case m.type_mission when 'checkout' then 'menage' when 'checkin' then 'check_in' when 'recouche' then 'recouche' else 'technique' end,
           m.date_mission, m.titre_ical
    from mission_menage m
    where m.bien_id is not null and coalesce(m.statut, '') not in ('cancelled', 'refuse')
      and m.date_mission between p_du - 1 and p_au + 25;
    insert into _sim_tache (task_id, bien_id, genre, d, nom)
    select h.task_id, h.bien_id,
           case when h.type_ph in ('menage', 'check_out') then 'menage' when h.type_ph in ('check_in', 'recouche', 'conciergerie') then h.type_ph else 'technique' end,
           (h.debut at time zone 'Europe/Paris')::date, h.nom
    from hospitable_tache h
    where h.disparu_le is null and h.bien_id is not null
      and (h.debut at time zone 'Europe/Paris')::date between p_du - 1 and p_au + 25
      and not exists (select 1 from _sim_tache s where s.task_id = h.task_id);
  end if;

  -- ── Séjours (même périmètre que mission_ecarts, migration 384) ────────
  create temp table _sim_sejour on commit drop as
  with acc as (
    select r.id, r.bien_id, r.code, r.arrival_date, r.departure_date, r.owner_stay, r.guest_name, r.platform,
           r.sans_menage_motif, r.menage_proprio_annule
    from reservation r
    where r.final_status = 'accepted' and r.departure_date >= p_du - 30 and r.arrival_date <= p_au + 25
  )
  select a.*, b.code as b_code, coalesce(b.statut_location, 'saisonnier') as statut_location, coalesce(b.hospitable_etat, '') as etat,
         coalesce(resa_est_etudiant(a.platform, a.guest_name, a.arrival_date, a.departure_date), false) as etudiant,
         nx.arrival_date as nx_arr, nx.departure_date as nx_dep,
         coalesce(nx.arrival_date = a.departure_date and ((a.guest_name is not null and nx.guest_name = a.guest_name) or nx.guest_name ilike 'prolong%'), false) as fondu,
         coalesce(nx.arrival_date = a.departure_date and nx.owner_stay, false) as proprio_enchaine
  from acc a
  join bien b on b.id = a.bien_id and b.hospitable_id is not null and b.hospitable_id !~ '^manual-'
  left join lateral (select n.* from acc n where n.bien_id = a.bien_id and n.id <> a.id and n.arrival_date >= a.departure_date
                     order by n.arrival_date, n.departure_date limit 1) nx on true;

  create temp table _sim_ligne (genre text, statut text, bien_id uuid, date_ref date, d_tache date, task_id text,
                                reservation_code text, raison text, ordre int) on commit drop;

  -- ── R1 ménage de départ ───────────────────────────────────────────────
  for p in
    select s.*, case when s.fondu then s.nx_dep + 2 when s.nx_arr is not null then greatest(s.departure_date + 2, s.nx_arr) else s.departure_date + 7 end as fin,
           case when s.etudiant then 'séjour étudiant / LLD'
                when coalesce(trim(s.sans_menage_motif), '') <> '' then 'sans ménage voulu : ' || trim(s.sans_menage_motif)
                when coalesce(s.menage_proprio_annule, false) then 'ménage du séjour proprio annulé'
                when s.fondu then 'prolongation / même voyageur le jour même (le ménage vient après le séjour suivant)' end as exclu
    from _sim_sejour s
    where s.departure_date between p_du and p_au
    order by s.departure_date, s.arrival_date
  loop
    select * into t from _sim_tache x where x.bien_id = p.bien_id and not x.pris and x.genre = 'menage' and x.d between p.departure_date and p.fin
     order by x.d limit 1;
    if p.exclu is not null then
      if t.task_id is not null then
        update _sim_tache set pris = true where task_id = t.task_id;
        insert into _sim_ligne values ('menage', 'explique', p.bien_id, p.departure_date, t.d, t.task_id, p.code,
          'Hospitable a un ménage alors que la règle ne le prévoit pas : ' || p.exclu, 1);
      end if;
      continue;
    end if;
    if t.task_id is not null then
      update _sim_tache set pris = true where task_id = t.task_id;
      insert into _sim_ligne values ('menage', 'concorde', p.bien_id, p.departure_date, t.d, t.task_id, p.code,
        case when t.d > p.departure_date then 'ménage le ' || to_char(t.d, 'DD/MM/YYYY') || ' (départ le ' || to_char(p.departure_date, 'DD/MM/YYYY') || ')'
             else 'ménage le jour du départ' end || case when p.owner_stay then ' · séjour propriétaire' else '' end, 1);
      continue;
    end if;
    select * into t from _sim_tache x where x.bien_id = p.bien_id and not x.pris and x.genre in ('technique', 'recouche', 'conciergerie') and x.d between p.departure_date and p.fin
     order by x.d limit 1;
    if t.task_id is not null then
      update _sim_tache set pris = true where task_id = t.task_id;
      insert into _sim_ligne values ('menage', 'concorde_autre_type', p.bien_id, p.departure_date, t.d, t.task_id, p.code,
        'couvert par une tâche « ' || t.genre || ' » le ' || to_char(t.d, 'DD/MM/YYYY') || ' (pas de type ménage)', 1);
      continue;
    end if;
    insert into _sim_ligne values ('menage', 'manque', p.bien_id, p.departure_date, null, null, p.code,
      case when p.departure_date >= v_today then 'aucune tâche ménage dans Hospitable avant le ' || to_char(p.fin, 'DD/MM/YYYY')
           else 'aucune tâche ménage trouvée (supprimée ou jamais créée)' end
      || case when p.owner_stay then ' · séjour propriétaire' else '' end
      || case when p.proprio_enchaine then ' · un séjour propriétaire arrive le jour même (ménage fait seulement après lui ?)' else '' end, 1);
  end loop;

  -- ── R2 check-in : règle déduite par bien (arrivées voyageurs passées de la période) ──
  create temp table _sim_regle_ci on commit drop as
  select s.bien_id, count(*) as n_arr,
         count(*) filter (where exists (select 1 from _sim_tache x where x.bien_id = s.bien_id and x.genre = 'check_in' and x.d between s.arrival_date - 1 and s.arrival_date)) as n_ci
  from _sim_sejour s
  where s.arrival_date between p_du and v_today - 1 and not coalesce(s.owner_stay, false) and not s.etudiant
  group by s.bien_id;

  for p in
    select s.* from _sim_sejour s join _sim_regle_ci rc on rc.bien_id = s.bien_id and rc.n_arr >= 2 and rc.n_ci * 2 >= rc.n_arr
    where s.arrival_date between p_du and p_au and not coalesce(s.owner_stay, false) and not s.etudiant
    order by s.arrival_date
  loop
    select * into t from _sim_tache x where x.bien_id = p.bien_id and not x.pris and x.genre = 'check_in' and x.d between p.arrival_date - 1 and p.arrival_date
     order by x.d desc limit 1;
    if t.task_id is not null then
      update _sim_tache set pris = true where task_id = t.task_id;
      insert into _sim_ligne values ('check_in', 'concorde', p.bien_id, p.arrival_date, t.d, t.task_id, p.code, 'check-in à l''arrivée', 2);
    else
      insert into _sim_ligne values ('check_in', 'manque', p.bien_id, p.arrival_date, null, null, p.code,
        case when p.arrival_date >= v_today then 'arrivée sans tâche check-in (pas encore créée ?)' else 'arrivée sans tâche check-in' end, 2);
    end if;
  end loop;

  -- ── Tâches réelles non rapprochées ────────────────────────────────────
  insert into _sim_ligne
  select x.genre,
         case when x.genre in ('technique', 'recouche', 'conciergerie') then 'hors_regles'
              when x.genre = 'check_in' and exists (select 1 from _sim_sejour s where s.bien_id = x.bien_id and s.owner_stay and x.d between s.arrival_date - 1 and s.arrival_date) then 'explique'
              when x.genre = 'check_in' and exists (select 1 from _sim_sejour s where s.bien_id = x.bien_id and x.d between s.arrival_date - 1 and s.arrival_date) then 'explique'
              when x.genre = 'menage' and exists (select 1 from _sim_sejour s where s.bien_id = x.bien_id and s.etudiant and x.d between s.departure_date and s.departure_date + 7) then 'explique'
              when x.genre = 'menage' and exists (select 1 from _sim_tache y where y.bien_id = x.bien_id and y.pris and y.genre = 'menage' and y.d = x.d) then 'explique'
              else 'en_trop' end,
         x.bien_id, x.d, x.d, x.task_id,
         null,
         case when x.genre = 'recouche' then 'recouche créée à la main (pas de règle)'
              when x.genre = 'technique' then 'maintenance créée à la main (ménage de fond, intervention…) : ' || coalesce(x.nom, '')
              when x.genre = 'conciergerie' then 'conciergerie créée à la main'
              when x.genre = 'check_in' then
                case when exists (select 1 from _sim_sejour s where s.bien_id = x.bien_id and s.owner_stay and x.d between s.arrival_date - 1 and s.arrival_date)
                       then 'accueil d''un séjour propriétaire (hors règle)'
                     when not exists (select 1 from _sim_sejour s where s.bien_id = x.bien_id and x.d between s.arrival_date - 1 and s.arrival_date)
                       then 'check-in sans arrivée ce jour-là (séjour annulé ou déplacé ?)'
                     else 'check-in ponctuel, sans doute créé à la main : la règle n''est pas active pour ce bien ('
                          || coalesce((select rc.n_ci || '/' || rc.n_arr from _sim_regle_ci rc where rc.bien_id = x.bien_id), '0/0') || ' arrivées passées avec check-in)' end
              else
                case when exists (select 1 from _sim_sejour s where s.bien_id = x.bien_id and s.etudiant and x.d between s.departure_date and s.departure_date + 7)
                       then 'ménage après un séjour étudiant / LLD (hors règle saisonnière)'
                     when exists (select 1 from _sim_tache y where y.bien_id = x.bien_id and y.pris and y.genre = 'menage' and y.d = x.d)
                       then 'ménage à plusieurs : une 2e tâche le même jour (grande maison, 2 AE)'
                     when exists (select 1 from reservation r where r.bien_id = x.bien_id and r.final_status <> 'accepted' and r.departure_date between x.d - 2 and x.d)
                       and not exists (select 1 from _sim_sejour s where s.bien_id = x.bien_id and s.departure_date between x.d - 14 and x.d)
                       then 'séjour annulé : tâche ménage restée dans Hospitable'
                     when exists (select 1 from _sim_sejour s where s.bien_id = x.bien_id and s.departure_date between x.d - 14 and x.d)
                       then '2e ménage pour le même départ (ou ménage décalé au-delà de l''arrivée suivante)'
                     else 'aucun séjour terminé dans les 14 jours (ménage de fond, séjour hors Hospitable…)' end
         end,
         3
  from _sim_tache x
  where not x.pris and x.d between p_du and p_au;

  -- ── Sortie ────────────────────────────────────────────────────────────
  select coalesce(jsonb_agg(jsonb_build_object('bien_id', rc.bien_id, 'bien_code', b.code, 'n_arr', rc.n_arr, 'n_ci', rc.n_ci,
           'check_in_actif', rc.n_arr >= 2 and rc.n_ci * 2 >= rc.n_arr) order by b.code), '[]'::jsonb)
    into v_regles from _sim_regle_ci rc join bien b on b.id = rc.bien_id;
  select coalesce(jsonb_agg(jsonb_build_object('genre', l.genre, 'statut', l.statut, 'bien_id', l.bien_id, 'bien_code', b.code,
           'date_ref', l.date_ref, 'd_tache', l.d_tache, 'task_id', l.task_id, 'reservation_code', l.reservation_code,
           'raison', l.raison, 'futur', l.date_ref >= v_today) order by b.code, l.date_ref, l.ordre), '[]'::jsonb)
    into v_lignes from _sim_ligne l left join bien b on b.id = l.bien_id;
  return jsonb_build_object('source', v_source, 'du', p_du, 'au', p_au, 'aujourdhui', v_today,
    'nb_taches', (select count(*) from _sim_tache where d between p_du and p_au), 'regles', v_regles, 'lignes', v_lignes);
end $function$;

revoke all on function public.mission_regles_simulation(date, date, jsonb) from public, anon, authenticated;
grant execute on function public.mission_regles_simulation(date, date, jsonb) to service_role;
