-- 358 — Règles d'Oïhan (08/10/2026) :
--   1. Type « mobilité » = UNIQUEMENT des baux mobilité, jamais de saisonnier entre deux baux → aucune bascule
--      pour les biens de type mobilite (ni location_annee) : ni restock saisonnier, ni retrait du linge au sac.
--   2. Réglementation Côte Basque et Bordeaux : le saisonnier sur une RÉSIDENCE SECONDAIRE n'est possible que si
--      le bien est loué à un étudiant dans l'année → pour les biens « mixte étudiant puis saisonnier », contrôle
--      par année civile : au moins un bail ÉTUDIANT (table etudiant, type_bail = etudiant, archivés compris, ou
--      masquage « loué à un étudiant hors DCB ») qui chevauche l'année. Sinon : saisonnier non autorisé cette
--      année-là (affiché fiche bien, hub Biens, 🔁 Bascules).
create or replace function public.bien_bail_etudiant_annee(p_bien uuid, p_annee int)
 returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from etudiant e
                  where e.bien_id = p_bien and coalesce(e.type_bail, 'etudiant') = 'etudiant'
                    and e.date_entree < make_date(p_annee + 1, 1, 1)
                    -- bail archivé sans date de sortie (ex. PAITOU 22/12/2025) : ne compte que pour son année d'entrée (358b)
                    and coalesce(e.date_sortie_reelle, e.date_sortie_prevue,
                                 case when coalesce(e.archived, false) then e.date_entree else 'infinity'::date end) >= make_date(p_annee, 1, 1))
      or exists (select 1 from bien b where b.id = p_bien and b.hors_location and b.hors_location_motif = 'etudiant_hors_dcb'
                    and p_annee = extract(year from current_date)::int)
$$;

-- Lecture pour PowerHouse (bureau / staff interne) : conformité des biens mixtes pour une année
create or replace function public.conformite_saisonnier(p_annee int)
 returns table (bien_id uuid, code text, bail_etudiant boolean)
 language sql stable security definer set search_path to 'public' as $$
  select b.id, b.code, bien_bail_etudiant_annee(b.id, p_annee)
    from bien b
   where b.type_exploitation = 'mixte_etudiant_saisonnier' and auth_user_is_internal()
$$;
revoke all on function public.bien_bail_etudiant_annee(uuid, int) from public, anon;
revoke all on function public.conformite_saisonnier(int) from public, anon;
grant execute on function public.conformite_saisonnier(int) to authenticated;

-- 1. Pas de bascule vers le saisonnier pour les biens « mobilité » / « à l'année »
create or replace function public.bascules_mobilite_planifier()
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int;
begin
  insert into bascule_bien (bien_id, etudiant_id, sens, date_bascule, note)
  select distinct r.bien_id, null::uuid, 'vers_saisonnier', r.departure_date, 'Fin de bail mobilité (' || coalesce(r.code, rc.reservation_id) || ')'
    from rental_contracts rc
    join reservation r on rc.reservation_id in (r.code, r.hospitable_id, r.id::text)
    join bien b on b.id = r.bien_id
   where rc.type_contrat = 'mobilite' and rc.statut = 'signed' and r.final_status = 'accepted'
     and r.departure_date >= current_date - 1
     and coalesce(b.type_exploitation, '') not in ('mobilite', 'location_annee')
  on conflict (bien_id, sens, date_bascule) where etudiant_id is null do nothing;
  get diagnostics n = row_count;
  return n;
end $function$;
revoke all on function public.bascules_mobilite_planifier() from public, anon, authenticated;

-- bascules_planifier (baux de la table etudiant) : la préparation J-7 ignore ces types ; et les bascules déjà
-- prévues pour ces types sont annulées.
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
  for b in select bb.* from bascule_bien bb join bien bi on bi.id = bb.bien_id
            where bb.statut = 'prevue' and bb.date_bascule <= current_date + 7
              and coalesce(bi.type_exploitation, '') not in ('mobilite', 'location_annee') loop
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

create or replace function public.bascules_exclure_types_sans_saisonnier()
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int;
begin
  update bascule_bien bb set statut = 'annulee', note = coalesce(bb.note || ' — ', '') || 'type sans saisonnier', updated_at = now()
    from bien b
   where b.id = bb.bien_id and bb.statut = 'prevue'
     and b.type_exploitation in ('mobilite', 'location_annee');
  get diagnostics n = row_count;
  return n;
end $function$;
revoke all on function public.bascules_exclure_types_sans_saisonnier() from public, anon, authenticated;

select cron.unschedule('bascules-lld-saisonnier');
select cron.schedule('bascules-lld-saisonnier', '5 6 * * *',
  $$select public.bascules_mobilite_planifier(); select public.bascules_exclure_types_sans_saisonnier(); select public.bascules_planifier(); select public.bascules_exclure_types_sans_saisonnier()$$);
