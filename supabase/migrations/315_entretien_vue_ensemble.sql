-- 315 — Vue d'ensemble des plans d'entretien (PowerHouse) + validation groupée des suggestions (05/10/2026)
-- Évite d'ouvrir 88 fiches : une ligne par bien listé (actifs, suggestions non activées, propositions
-- des AE, rouges/orange) et une RPC bureau qui active d'un coup les suggestions détectées d'un bien.
create or replace function public.entretien_vue_ensemble()
returns table (bien_id uuid, code text, hospitable_name text, agence text, nb_actifs integer, nb_suggestions integer,
               nb_propositions integer, nb_rouges integer, nb_oranges integer)
language sql stable security definer set search_path = public as $$
  select b.id, b.code, b.hospitable_name, b.agence,
    (select count(*)::int from bien_entretien_plan p where p.bien_id = b.id and p.actif),
    (select count(*)::int from entretien_suggestions(b.id) s where s.detecte and not s.plan_actif and not s.deja_plan),
    (select count(*)::int from bien_entretien_proposition pr where pr.bien_id = b.id and pr.statut = 'propose'),
    (select count(*)::int from entretien_statut(array[b.id]) st where st.couleur = 'rouge'),
    (select count(*)::int from entretien_statut(array[b.id]) st where st.couleur = 'orange')
  from bien b
  where b.listed and auth_user_is_staff()
    and (my_secteurs() is null or b.id in (select my_scoped_bien_ids()))
  order by b.code;
$$;
revoke all on function public.entretien_vue_ensemble() from public, anon;
grant execute on function public.entretien_vue_ensemble() to authenticated;

-- Active les suggestions détectées (jamais encore décidées) d'un bien. Les lignes déjà décidées
-- (plan existant, actif ou désactivé) ne sont pas touchées : un refus antérieur reste un refus.
create or replace function public.entretien_activer_suggestions(p_bien_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not auth_user_is_bureau() then raise exception 'acces_refuse'; end if;
  insert into bien_entretien_plan (bien_id, entretien_type_id)
  select p_bien_id, s.entretien_type_id from entretien_suggestions(p_bien_id) s
   where s.detecte and not s.deja_plan
  on conflict (bien_id, entretien_type_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.entretien_activer_suggestions(uuid) from public, anon;
grant execute on function public.entretien_activer_suggestions(uuid) to authenticated;
