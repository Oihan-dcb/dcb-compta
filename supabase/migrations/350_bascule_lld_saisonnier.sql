-- 350 — Bascule LLD ⇄ saisonnier anticipée (07/10/2026, décisions Oïhan).
-- Chaque bail (table etudiant, non archivé) produit deux bascules dans bascule_bien :
--   · vers_lld        à date_entree   : on RETIRE le linge (on laisse alèses + sous-taies) et les consommables
--                                       voyageurs (savons, gels…) ; on LAISSE huile, sel, poivre, 1 rouleau de
--                                       papier toilette (catalogue_items.garder_en_lld) et le coffre à clés ;
--   · vers_saisonnier à la sortie (réelle, sinon prévue) : restock COMPLET des consommables du bien (hors
--                                       articles restés en place), alèses + sous-taies, jeu de linge complet,
--                                       inventaire du petit équipement remis « à vérifier », ménage de fond
--                                       payé par le PROPRIÉTAIRE (Oïhan 07/10).
-- Calendrier (cron quotidien bascules_planifier, 6h05 UTC) : J-30 → visible au bureau (PowerHouse → Biens →
-- 🔁 Bascules, bandeau) ; J-7 → besoins au sac créés automatiquement (prochaine tâche du bien).
-- Les plans d'entretien n'ont pas besoin d'être forcés : après des mois de bail, ils sont tous échus
-- (périodicités en jours). Pendant un bail en cours, entretien_vers_sac n'ajoute plus rien au sac du bien.

alter table public.catalogue_items add column if not exists garder_en_lld boolean not null default false;
comment on column public.catalogue_items.garder_en_lld is 'Reste dans le bien pendant une location étudiante (pas retiré au passage en LLD, pas réassorti au retour). Migration 350.';
update public.catalogue_items set garder_en_lld = true
 where nom in ('Huile d''olive', 'Huile de tournesol', 'Sel fin', 'Poivre moulu', 'Papier toilette');

create table if not exists public.bascule_bien (
  id uuid primary key default gen_random_uuid(),
  bien_id uuid not null references public.bien(id) on delete cascade,
  etudiant_id uuid not null references public.etudiant(id) on delete cascade,
  sens text not null check (sens in ('vers_lld', 'vers_saisonnier')),
  date_bascule date not null,
  statut text not null default 'prevue' check (statut in ('prevue', 'preparee', 'faite', 'annulee')),
  preparee_at timestamptz,
  faite_at timestamptz,
  faite_par uuid,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (etudiant_id, sens)
);
comment on table public.bascule_bien is 'Passage d''un bien LLD ⇄ saisonnier (restock / retrait anticipés). Migration 350.';
alter table public.bascule_bien enable row level security;
create policy bascule_bien_bureau on public.bascule_bien for all
  using (public.auth_user_is_bureau()) with check (public.auth_user_is_bureau());

create or replace function public.bascules_planifier()
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare b record; n int := 0; v_lib text;
begin
  -- 1. Bascules à partir des baux (dates suivies tant que la bascule n'est pas préparée)
  insert into bascule_bien (bien_id, etudiant_id, sens, date_bascule)
  select e.bien_id, e.id, s.sens, s.d
    from etudiant e
    cross join lateral (values ('vers_lld', e.date_entree),
                               ('vers_saisonnier', coalesce(e.date_sortie_reelle, e.date_sortie_prevue))) s(sens, d)
   where not coalesce(e.archived, false) and e.bien_id is not null and s.d is not null and s.d >= current_date - 1
  on conflict (etudiant_id, sens) do update
     set date_bascule = excluded.date_bascule, updated_at = now()
   where bascule_bien.statut = 'prevue' and bascule_bien.date_bascule is distinct from excluded.date_bascule;
  update bascule_bien bb set statut = 'annulee', updated_at = now()
    from etudiant e where e.id = bb.etudiant_id and coalesce(e.archived, false) and bb.statut = 'prevue';

  -- 2. J-7 : besoins au sac
  for b in select * from bascule_bien where statut = 'prevue' and date_bascule <= current_date + 7 loop
    if b.sens = 'vers_saisonnier' then
      insert into besoin_sac (bien_id, item_id, libelle, quantite, note)
      select distinct on (ci.id) b.bien_id, ci.id, ci.nom, 1, 'Remise en saisonnier (fin de bail ' || to_char(b.date_bascule, 'DD/MM/YYYY') || ') — restock complet'
        from bien_toolbox t
        join inventaire_bien_config c on c.bien_id = t.id and c.actif
        join catalogue_items ci on ci.id = c.item_id
       where t.bien_id = b.bien_id and ci.type in ('consommable', 'stock') and not ci.garder_en_lld
         and not exists (select 1 from besoin_sac x where x.bien_id = b.bien_id and x.item_id = ci.id and x.statut in ('a_preparer', 'dans_sac'));
      foreach v_lib in array array['Alèses + sous-taies propres', 'Jeu de linge complet (draps + serviettes)'] loop
        if not exists (select 1 from besoin_sac x where x.bien_id = b.bien_id and x.libelle = v_lib and x.statut in ('a_preparer', 'dans_sac')) then
          insert into besoin_sac (bien_id, libelle, quantite, note)
          values (b.bien_id, v_lib, 1, 'Remise en saisonnier (fin de bail ' || to_char(b.date_bascule, 'DD/MM/YYYY') || ')');
        end if;
      end loop;
      -- les étudiants cassent / emportent : le petit équipement est à revérifier (manquants → sac)
      update inventaire_bien_stock s set statut = 'a_verifier', derniere_maj_at = now()
        from catalogue_items ci, bien_toolbox t
       where ci.id = s.item_id and ci.type = 'petit_equipement' and t.id = s.bien_id and t.bien_id = b.bien_id
         and s.statut in ('present', 'ok');
    else
      foreach v_lib in array array[
        'À RÉCUPÉRER : tout le linge (draps, serviettes) — laisser alèses et sous-taies',
        'À RÉCUPÉRER : consommables voyageurs (savons, gels douche, shampoings, capsules…) — laisser huile, sel, poivre, 1 rouleau de papier toilette et le coffre à clés'] loop
        if not exists (select 1 from besoin_sac x where x.bien_id = b.bien_id and x.libelle = v_lib and x.statut in ('a_preparer', 'dans_sac')) then
          insert into besoin_sac (bien_id, libelle, quantite, note)
          values (b.bien_id, v_lib, 1, 'Passage en location étudiante le ' || to_char(b.date_bascule, 'DD/MM/YYYY'));
        end if;
      end loop;
    end if;
    update bascule_bien set statut = 'preparee', preparee_at = now(), updated_at = now() where id = b.id;
    n := n + 1;
  end loop;
  return n;
end $function$;
revoke all on function public.bascules_planifier() from public, anon, authenticated;
select cron.schedule('bascules-lld-saisonnier', '5 6 * * *', $$select public.bascules_planifier()$$);

-- Pendant un bail en cours, pas d'entretien au sac (personne ne passe dans le bien)
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
      and not exists (select 1 from etudiant e where e.bien_id = pl.bien_id and not coalesce(e.archived, false)
                        and e.date_entree <= current_date
                        and coalesce(e.date_sortie_reelle, e.date_sortie_prevue, 'infinity'::date) > current_date)
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
