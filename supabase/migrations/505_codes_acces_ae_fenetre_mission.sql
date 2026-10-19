-- 505 — Codes d'accès des logements dans le portail AE (20/10/2026, décision d'Oïhan).
-- Avant : RLS bien_toolbox_internal_all → tout AE actif lisait code_entree / code_coffre / lien_arrivee / mdp_arrivee
-- de TOUS les logements (Fiche AE, sans journal).
-- Maintenant :
--   • la table bien_toolbox n'est plus lisible directement que par le staff PowerHouse (auth_user_is_staff, périmètre) ;
--   • les AE lisent la vue bien_toolbox_ae : mêmes lignes qu'avant, SANS les 4 champs secrets (seulement « a_… » = renseigné ?) ;
--   • les valeurs passent par la RPC ae_codes_acces(bien_ids, source) : rendues seulement si ae_codes_droit(bien)
--     (bureau dans son périmètre, ou AE assigné à une mission non annulée / non refusée sur CE logement datée de la veille,
--     du jour ou du lendemain, heure de Paris) ; chaque remise est tracée dans bien_code_consultation
--     (« <source>:<champ> », qui, quand — jamais la valeur ; une ligne par compte / logement / champ / 10 min).
-- Même règle que le guide d'arrivée AE (PowerHouse api/_aeGuide.js).

create or replace function public.ae_codes_droit(p_bien_id uuid)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select coalesce(auth.role(), '') = 'service_role'
    or (auth_user_is_staff() and (my_secteurs() is null or p_bien_id in (select my_scoped_bien_ids())))
    or exists (
      select 1
      from mission_menage m
      join auto_entrepreneur a on a.id = m.ae_id
      where a.ae_user_id = auth.uid() and a.actif
        and m.bien_id = p_bien_id
        and m.statut not in ('cancelled', 'refuse')
        and m.date_mission between (now() at time zone 'Europe/Paris')::date - 1 and (now() at time zone 'Europe/Paris')::date + 1
        and not exists (select 1 from mission_acceptation x where x.mission_id = m.id and x.ae_id = a.id and x.statut = 'refusee')
    );
$$;
revoke all on function public.ae_codes_droit(uuid) from public, anon;
grant execute on function public.ae_codes_droit(uuid) to authenticated, service_role;

-- Vue du portail AE : toutes les colonnes sauf les secrets. Propriétaire = postgres (ignore la RLS de la table) ;
-- le filtre reprend EXACTEMENT l'ancienne politique bien_toolbox_internal_all.
create or replace view public.bien_toolbox_ae with (security_barrier = true) as
select t.id, t.bien_id, t.nom_csv, t.statut, t.type_location, t.ville, t.adresse, t.parking, t.coffre_lieu, t.ou_appart,
       t.poubelles, t.temps_nettoyage, t.temps_nettoyage_h, t.linge_plat, t.linge_eponge, t.consommables, t.particularite,
       t.notes, t.updated_at, t.updated_by, t.archived_at, t.inventaire_complet_at, t.inventaire_complet_releve_id,
       nullif(btrim(t.code_entree), '') is not null as a_code_entree,
       nullif(btrim(t.code_coffre), '') is not null as a_code_coffre,
       nullif(btrim(t.lien_arrivee), '') is not null as a_lien_arrivee,
       nullif(btrim(t.mdp_arrivee), '') is not null as a_mdp_arrivee
from public.bien_toolbox t
where (auth_user_is_staff() and (my_secteurs() is null or t.bien_id in (select my_scoped_bien_ids())))
   or (auth_user_is_internal() and not auth_user_is_staff());
revoke all on public.bien_toolbox_ae from public, anon;
grant select on public.bien_toolbox_ae to authenticated, service_role;

-- Remise des codes (journalisée). p_source : 'fiche_ae' | 'ma_journee'.
create or replace function public.ae_codes_acces(p_bien_ids uuid[], p_source text default 'fiche_ae')
returns table (bien_id uuid, code_entree text, code_coffre text, lien_arrivee text, mdp_arrivee text)
language plpgsql volatile security definer
set search_path to 'public'
as $$
declare
  v_src text := case when p_source in ('fiche_ae', 'ma_journee') then p_source else 'fiche_ae' end;
begin
  if auth.uid() is null then return; end if;
  return query
  with ok as (
    select distinct on (t.bien_id) t.bien_id, t.code_entree, t.code_coffre, t.lien_arrivee, t.mdp_arrivee
    from bien_toolbox t
    where t.bien_id = any (p_bien_ids[1:100]) and t.archived_at is null and ae_codes_droit(t.bien_id)
    order by t.bien_id, t.updated_at desc nulls last
  ), journal as (
    insert into bien_code_consultation (bien_id, code_key, par)
    select ok.bien_id, v_src || ':' || v.k, auth.uid()
    from ok, lateral (values ('code_entree', ok.code_entree), ('code_coffre', ok.code_coffre),
                              ('lien_arrivee', ok.lien_arrivee), ('mdp_arrivee', ok.mdp_arrivee)) v(k, val)
    where nullif(btrim(v.val), '') is not null
      and not exists (select 1 from bien_code_consultation c
                      where c.par = auth.uid() and c.bien_id = ok.bien_id and c.code_key = v_src || ':' || v.k
                        and c.at > now() - interval '10 minutes')
    returning 1
  )
  select ok.bien_id, ok.code_entree, ok.code_coffre, ok.lien_arrivee, ok.mdp_arrivee from ok;
end $$;
revoke all on function public.ae_codes_acces(uuid[], text) from public, anon;
grant execute on function public.ae_codes_acces(uuid[], text) to authenticated, service_role;

-- La table elle-même : staff PowerHouse seulement (les AE passent par la vue + la RPC).
drop policy if exists bien_toolbox_internal_all on public.bien_toolbox;
drop policy if exists bien_toolbox_staff_all on public.bien_toolbox;
create policy bien_toolbox_staff_all on public.bien_toolbox for all to authenticated
  using (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
  with check (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));
