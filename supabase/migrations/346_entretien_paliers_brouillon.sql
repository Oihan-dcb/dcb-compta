-- 346 — Plans d'entretien par palier d'occupation, préparés en BROUILLON (07/10/2026, choix Oïhan « palier »).
-- Paliers sur 12 mois : intensif ≥ 40 séjours (fréquences du catalogue), moyen 15-39 (fréquences ×2,
-- appareils au nombre de séjours), faible < 15 (ménage de fond annuel : frigo, sous les lits, matelas,
-- rideaux, VMC, volets + appareils au nombre de séjours). Plans insérés actif=false (note « Palier … »).
-- « Valider » (PowerHouse 🧽 Plans d'entretien) active les brouillons tels quels sans ajouter d'autres
-- suggestions ; la vue d'ensemble compte les brouillons comme « à valider ».
create or replace function public.entretien_activer_suggestions(p_bien_id uuid)
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int;
begin
  if not auth_user_is_bureau() then raise exception 'acces_refuse'; end if;
  if exists (select 1 from bien_entretien_plan where bien_id = p_bien_id and not actif) then
    update bien_entretien_plan set actif = true where bien_id = p_bien_id and not actif;
    get diagnostics n = row_count;
    return n;
  end if;
  insert into bien_entretien_plan (bien_id, entretien_type_id)
  select p_bien_id, s.entretien_type_id from entretien_suggestions(p_bien_id) s
   where s.detecte and not s.deja_plan
  on conflict (bien_id, entretien_type_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $function$;

create or replace function public.entretien_vue_ensemble()
 returns table(bien_id uuid, code text, hospitable_name text, agence text, nb_actifs integer, nb_suggestions integer, nb_propositions integer, nb_rouges integer, nb_oranges integer)
 language sql stable security definer set search_path to 'public' as $function$
  with bs as (select b.id, b.code, b.hospitable_name, b.agence from bien b
              where b.listed and auth_user_is_staff() and (my_secteurs() is null or b.id in (select my_scoped_bien_ids()))),
  st as (select s.bien_id, count(*) filter (where s.couleur = 'rouge')::int r, count(*) filter (where s.couleur = 'orange')::int o
           from entretien_statut(array(select id from bs)) s group by 1),
  br as (select p.bien_id, count(*)::int n from bien_entretien_plan p where not p.actif group by 1)
  select bs.id, bs.code, bs.hospitable_name, bs.agence,
    (select count(*)::int from bien_entretien_plan p where p.bien_id = bs.id and p.actif),
    coalesce(br.n, (select count(*)::int from entretien_suggestions(bs.id) s where s.detecte and not s.deja_plan)),
    (select count(*)::int from bien_entretien_proposition pr where pr.bien_id = bs.id and pr.statut = 'propose'),
    coalesce(st.r, 0), coalesce(st.o, 0)
  from bs left join st on st.bien_id = bs.id left join br on br.bien_id = bs.id
  order by bs.code;
$function$;
-- Données : 515 plans brouillon insérés le 07/10/2026 (8 biens intensif / 19 moyen / 30 faible), voir journal de session.
