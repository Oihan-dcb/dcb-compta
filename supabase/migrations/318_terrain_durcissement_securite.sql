-- 318 — Durcissement sécurité du workflow terrain (05/10/2026), suite à la revue des migrations 301-316
-- (tests par impersonation Xane / Léa / bureau / propriétaire, en transactions annulées).

-- ── 1. Vidéo de fin infalsifiable ─────────────────────────────────────────────
-- internal_all_media_library (FOR ALL) laissait un AE modifier n'importe quel média (ex. se
-- réattribuer la vidéo « après ménage » d'une collègue puis l'attacher à sa mission).
drop policy if exists internal_all_media_library on public.media_library;
drop policy if exists media_library_select on public.media_library;
drop policy if exists media_library_insert on public.media_library;
drop policy if exists media_library_update on public.media_library;
drop policy if exists media_library_delete on public.media_library;
create policy media_library_select on public.media_library for select to authenticated using (
  (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
  or (auth_user_is_internal() and not auth_user_is_staff()));
create policy media_library_insert on public.media_library for insert to authenticated with check (
  ((auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
   or (auth_user_is_internal() and not auth_user_is_staff()))
  and (sender_id = auth.uid() or auth_user_is_bureau()));
create policy media_library_update on public.media_library for update to authenticated
  using (auth_user_is_bureau() or (sender_id = auth.uid() and auth_user_is_internal()))
  with check (auth_user_is_bureau() or (sender_id = auth.uid() and auth_user_is_internal()));
create policy media_library_delete on public.media_library for delete to authenticated
  using (auth_user_is_bureau() or (sender_id = auth.uid() and auth_user_is_internal()));

create or replace function public.terrain_attacher_video(p_mission_id uuid, p_media_id uuid)
returns public.mission_terrain
language plpgsql security definer set search_path = public as $$
declare m mission_menage; t mission_terrain; med media_library;
begin
  m := _terrain_mission_check(p_mission_id);
  select * into t from mission_terrain where mission_id = m.id;
  if not found then raise exception 'mission_non_demarree'; end if;
  select * into med from media_library where id = p_media_id;
  if not found then raise exception 'media_introuvable'; end if;
  if med.sender_id <> auth.uid() or med.subject not in ('apres_menage', 'probleme_technique') or med.bien_id is distinct from m.bien_id then
    raise exception 'media_non_conforme';
  end if;
  if med.mission_id is not null and med.mission_id <> m.id then raise exception 'media_deja_rattache'; end if;
  if med.created_at < t.started_at then raise exception 'media_anterieur_au_demarrage'; end if;
  update media_library set mission_id = m.id where id = p_media_id and mission_id is null;
  update mission_terrain set
    video_media_id = p_media_id, video_at = now(),
    statut = case when ended_at is not null then 'terminee' else statut end,
    updated_at = now()
  where mission_id = m.id
  returning * into t;
  return t;
end $$;

-- ── 2. Catalogue d'entretien (base de facturation) : bureau uniquement ────────
drop policy if exists entretien_type_write on public.entretien_type;
create policy entretien_type_write on public.entretien_type for all to authenticated
  using (auth_user_is_bureau()) with check (auth_user_is_bureau());

-- ── 3. Notes de propreté : périmètre secteur + retours privés réservés au bureau ──
create or replace function public.stats_proprete_ae(p_depuis date default (current_date - 365))
returns table (
  ae_id uuid, nb_avis integer, moyenne numeric, moyenne_globale numeric, ecart numeric, notes_basses integer,
  dernier_commentaire text, dernier_commentaire_date timestamptz, dernier_commentaire_note numeric, dernier_commentaire_bien text
) language plpgsql stable security definer set search_path = public as $$
declare v_bureau boolean := auth_user_is_bureau();
begin
  if not (auth_user_is_staff() or v_bureau) then raise exception 'acces_refuse'; end if;
  return query
  with a as (select * from _avis_proprete_attribues(p_depuis) x
              where x.ae_id is not null
                and (v_bureau or my_secteurs() is null or x.bien_id in (select my_scoped_bien_ids()))),
       g as (select avg(a.note) mg from a),
       last as (
         select distinct on (a.ae_id) a.ae_id,
                coalesce(nullif(trim(a.comment), ''), case when v_bureau then a.private_feedback end) txt,
                a.submitted_at, a.note, a.bien_code
           from a where a.parle_menage
            and coalesce(nullif(trim(a.comment), ''), case when v_bureau then a.private_feedback end) is not null
          order by a.ae_id, a.submitted_at desc nulls last
       )
  select a.ae_id, count(*)::int, round(avg(a.note), 2), round((select mg from g), 2), round(avg(a.note) - (select mg from g), 2),
         (count(*) filter (where a.note <= 3))::int, l.txt, l.submitted_at, l.note, l.bien_code
    from a left join last l on l.ae_id = a.ae_id
   group by a.ae_id, l.txt, l.submitted_at, l.note, l.bien_code;
end $$;

create or replace function public.avis_proprete_ae(p_ae_id uuid, p_depuis date default (current_date - 365), p_limit integer default 50)
returns table (
  review_id uuid, bien_code text, arrival_date date, platform text, note numeric,
  comment text, private_feedback text, reviewer_name text, submitted_at timestamptz, parle_menage boolean
) language plpgsql stable security definer set search_path = public as $$
declare v_bureau boolean := auth_user_is_bureau(); v_soi boolean := auth_user_owns_ae(p_ae_id);
begin
  if not (auth_user_is_staff() or v_bureau or v_soi) then raise exception 'acces_refuse'; end if;
  return query
  select a.review_id, a.bien_code, a.arrival_date, a.platform, a.note, a.comment,
         case when v_bureau then a.private_feedback end,
         a.reviewer_name, a.submitted_at, a.parle_menage
    from _avis_proprete_attribues(p_depuis) a
   where a.ae_id = p_ae_id
     and (v_bureau or v_soi or my_secteurs() is null or a.bien_id in (select my_scoped_bien_ids()))
   order by a.submitted_at desc nulls last
   limit greatest(1, least(p_limit, 500));
end $$;

-- Cache du résumé IA : contient potentiellement des retours privés → bureau uniquement.
drop policy if exists ae_proprete_synthese_select on public.ae_proprete_synthese;
create policy ae_proprete_synthese_select on public.ae_proprete_synthese for select to authenticated
  using (auth_user_is_bureau());

create or replace function public.mon_profil_proprete(p_depuis date default (current_date - 365))
returns table (ae_id uuid, nb_avis integer, moyenne numeric, moyenne_globale numeric, ecart numeric, notes_basses integer, nb_5 integer)
language sql stable security definer set search_path = public as $$
  with me as (select a.id from auto_entrepreneur a
               where a.actif and (a.ae_user_id = auth.uid() or a.linked_ae_user_id = auth.uid())
               order by (a.ae_user_id = auth.uid()) desc limit 1),
       x as (select * from _avis_proprete_attribues(p_depuis) where ae_id is not null),
       g as (select avg(note) mg from x)
  select (select id from me), count(*)::int, round(avg(x.note), 2), round((select mg from g), 2),
         round(avg(x.note) - (select mg from g), 2),
         (count(*) filter (where x.note <= 3))::int, (count(*) filter (where x.note >= 5))::int
    from x where x.ae_id = (select id from me)
  having (select id from me) is not null;
$$;

-- ── 4/9. Entretien : périmètre secteur + vue d'ensemble rapide ────────────────
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
      and auth_user_is_internal()
      and (not auth_user_is_staff() or my_secteurs() is null or pl.bien_id in (select my_scoped_bien_ids()))
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

create or replace function public.entretien_suggestions(p_bien_id uuid)
returns table (entretien_type_id uuid, nom text, icone text, equipement text, detecte boolean, deja_plan boolean, plan_actif boolean)
language sql stable security definer set search_path = public as $$
  with tb as (select id from bien_toolbox where bien_id = p_bien_id and archived_at is null limit 1),
  am as (select coalesce(hospitable_amenities, '{}'::text[]) a from bien where id = p_bien_id),
  eq as (
    select 'lave_linge'::text e where exists (select 1 from bien_faq_pratique f where f.bien_id = p_bien_id and f.lave_linge)
       or array['washer'] <@ (select a from am)
       or exists (select 1 from inventaire_bien_config c join catalogue_items ci on ci.id = c.item_id
                   where c.bien_id = (select id from tb) and c.actif and ci.nom ilike 'machine à laver%')
    union select 'lave_vaisselle' where array['dishwasher'] <@ (select a from am)
       or exists (select 1 from inventaire_bien_config c join catalogue_items ci on ci.id = c.item_id
                   where c.bien_id = (select id from tb) and c.actif and ci.nom ilike 'lave-vaisselle')
    union select 'barbecue' where (select a from am) && array['bbq', 'outdoor_kitchen', 'barbeque_utensils']
    union select 'exterieur' where (select a from am) && array['patio', 'garden', 'backyard', 'outdoor_seating', 'alfresco_dining']
  )
  select t.id, t.nom, t.icone, t.equipement,
         (t.equipement is null or t.equipement in (select e from eq)),
         pl.id is not null, coalesce(pl.actif, false)
    from entretien_type t
    left join bien_entretien_plan pl on pl.entretien_type_id = t.id and pl.bien_id = p_bien_id
   where t.actif and auth_user_is_internal()
     and (not auth_user_is_staff() or my_secteurs() is null or p_bien_id in (select my_scoped_bien_ids()))
   order by t.ordre;
$$;

create or replace function public.entretien_vue_ensemble()
returns table (bien_id uuid, code text, hospitable_name text, agence text, nb_actifs integer, nb_suggestions integer,
               nb_propositions integer, nb_rouges integer, nb_oranges integer)
language sql stable security definer set search_path = public as $$
  with bs as (select b.id, b.code, b.hospitable_name, b.agence from bien b
              where b.listed and auth_user_is_staff() and (my_secteurs() is null or b.id in (select my_scoped_bien_ids()))),
  st as (select s.bien_id, count(*) filter (where s.couleur = 'rouge')::int r, count(*) filter (where s.couleur = 'orange')::int o
           from entretien_statut(array(select id from bs)) s group by 1)
  select bs.id, bs.code, bs.hospitable_name, bs.agence,
    (select count(*)::int from bien_entretien_plan p where p.bien_id = bs.id and p.actif),
    (select count(*)::int from entretien_suggestions(bs.id) s where s.detecte and not s.deja_plan),
    (select count(*)::int from bien_entretien_proposition pr where pr.bien_id = bs.id and pr.statut = 'propose'),
    coalesce(st.r, 0), coalesce(st.o, 0)
  from bs left join st on st.bien_id = bs.id
  order by bs.code;
$$;

-- ── 5. Passages d'entretien cohérents (plan ↔ bien ↔ mission ↔ AE) ────────────
drop policy if exists bien_entretien_fait_insert on public.bien_entretien_fait;
create policy bien_entretien_fait_insert on public.bien_entretien_fait for insert to authenticated with check (
  exists (select 1 from bien_entretien_plan p where p.id = plan_id and p.bien_id = bien_entretien_fait.bien_id)
  and (
    (ae_id is not null and auth_user_owns_ae(ae_id)
      and (mission_id is null or exists (select 1 from mission_menage m where m.id = mission_id
                                           and m.ae_id = bien_entretien_fait.ae_id and m.bien_id = bien_entretien_fait.bien_id)))
    or auth_user_is_bureau()
    or (auth_user_peut_editer_fiches() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
  ));

-- ── 6. Propositions : décision explicite ; l'AE complète le lien vers l'extra du jour ──
create or replace function public.traiter_proposition_entretien(p_id uuid, p_valider boolean)
returns public.bien_entretien_proposition
language plpgsql security definer set search_path = public as $$
declare pr bien_entretien_proposition; pl bien_entretien_plan;
begin
  if not auth_user_is_bureau() then raise exception 'acces_refuse'; end if;
  if p_valider is null then raise exception 'decision_requise'; end if;
  select * into pr from bien_entretien_proposition where id = p_id for update;
  if not found then raise exception 'proposition_introuvable'; end if;
  if pr.statut <> 'propose' then return pr; end if;
  if p_valider then
    select * into pl from bien_entretien_plan where bien_id = pr.bien_id and entretien_type_id = pr.entretien_type_id;
    if found then
      update bien_entretien_plan set actif = true where id = pl.id returning * into pl;
    else
      insert into bien_entretien_plan (bien_id, entretien_type_id, reference_initiale)
      values (pr.bien_id, pr.entretien_type_id, case when pr.fait_le is not null then pr.fait_le::date end)
      returning * into pl;
    end if;
    if pr.fait_le is not null and not exists (select 1 from bien_entretien_fait where plan_id = pl.id and fait_le = pr.fait_le) then
      insert into bien_entretien_fait (plan_id, bien_id, mission_id, ae_id, statut, fait_le, prestation_id)
      values (pl.id, pr.bien_id, pr.mission_id, pr.propose_par_ae_id, 'fait', pr.fait_le, pr.prestation_id);
    end if;
  end if;
  update bien_entretien_proposition set statut = case when p_valider then 'valide' else 'refuse' end,
    traite_par = auth.uid(), traite_at = now() where id = p_id returning * into pr;
  return pr;
end $$;
-- L'AE crée d'abord la proposition (échec rapide si déjà proposée), puis l'extra, puis y rattache l'extra.
drop policy if exists bien_entretien_proposition_update_ae on public.bien_entretien_proposition;
create policy bien_entretien_proposition_update_ae on public.bien_entretien_proposition for update to authenticated
  using (statut = 'propose' and propose_par_ae_id is not null and auth_user_owns_ae(propose_par_ae_id))
  with check (statut = 'propose' and propose_par_ae_id is not null and auth_user_owns_ae(propose_par_ae_id));

-- ── 7. Besoins sac : un AE n'agit que pour lui ; staff scopé voit les produits de ses AE ──
drop policy if exists besoin_sac_select on public.besoin_sac;
drop policy if exists besoin_sac_insert on public.besoin_sac;
drop policy if exists besoin_sac_update on public.besoin_sac;
create policy besoin_sac_select on public.besoin_sac for select to authenticated using (
  (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())
     or (bien_id is null and pour_ae_id in (select a.id from auto_entrepreneur a where a.secteurs && my_secteurs()))))
  or (auth_user_is_internal() and not auth_user_is_staff()));
create policy besoin_sac_insert on public.besoin_sac for insert to authenticated with check (
  (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())
     or (bien_id is null and pour_ae_id in (select a.id from auto_entrepreneur a where a.secteurs && my_secteurs()))))
  or (auth_user_is_internal() and not auth_user_is_staff() and (pour_ae_id is null or auth_user_owns_ae(pour_ae_id))));
create policy besoin_sac_update on public.besoin_sac for update to authenticated
  using (
    (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())
       or (bien_id is null and pour_ae_id in (select a.id from auto_entrepreneur a where a.secteurs && my_secteurs()))))
    or (auth_user_is_internal() and not auth_user_is_staff() and (pour_ae_id is null or auth_user_owns_ae(pour_ae_id))))
  with check (
    (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())
       or (bien_id is null and pour_ae_id in (select a.id from auto_entrepreneur a where a.secteurs && my_secteurs()))))
    or (auth_user_is_internal() and not auth_user_is_staff() and (pour_ae_id is null or auth_user_owns_ae(pour_ae_id))));

-- ── 8. Durée : plus de correction après écriture dans mission_menage ──────────
create or replace function public.terrain_corriger_duree(p_mission_id uuid, p_minutes integer, p_motif text)
returns public.mission_terrain
language plpgsql security definer set search_path = public as $$
declare t mission_terrain;
begin
  perform _terrain_mission_check(p_mission_id);
  if p_minutes is null or p_minutes < 5 or p_minutes > 16 * 60 then raise exception 'duree_invalide'; end if;
  if length(trim(coalesce(p_motif, ''))) < 3 then raise exception 'motif_obligatoire'; end if;
  update mission_terrain set
    duree_corrigee_minutes = (round(p_minutes / 5.0) * 5)::int,
    motif_correction = trim(p_motif), updated_at = now()
  where mission_id = p_mission_id and ended_at is not null and duree_appliquee_at is null
  returning * into t;
  if not found then raise exception 'mission_non_terminee_ou_deja_appliquee'; end if;
  return t;
end $$;
