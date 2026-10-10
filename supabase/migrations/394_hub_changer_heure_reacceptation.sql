-- 394 — Hub des tâches : « Changer l'heure » d'une mission (10/10/2026).
--
-- Choix documenté (demande Oïhan) : quand l'heure d'une mission DÉJÀ ACCEPTÉE change,
--   • de plus de 2 h  → l'acceptation est redemandée (statut 'en_attente', comme un changement de date :
--                        l'AE avait dit oui pour un créneau, un autre créneau peut ne plus lui convenir) ;
--   • de 2 h ou moins → simple information : l'acceptation reste, seul debut_mission est recalé.
-- La règle vit dans le trigger (et non dans l'endpoint) pour s'appliquer pareil quel que soit le chemin :
-- geste « Changer l'heure » du hub, ou heure modifiée dans Hospitable puis relue par sync-ical-ae.
-- Seules les acceptations données par l'AE ou le bureau (source portail / hospitable / bureau) sont
-- redemandées — même périmètre que le changement de date (migration 374).
-- Retour arrière : recréer la fonction depuis la migration 374 (corps identique sans v_ecart_heure).

create or replace function public.mission_acceptation_sync()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_req boolean;
  v_debut timestamptz;
  r public.mission_acceptation%rowtype;
  v_nouvelle_affectation boolean := false;
  v_ecart_heure interval;
begin
  if new.ae_id is null then return new; end if;
  if tg_op = 'UPDATE'
     and old.ae_id is not distinct from new.ae_id
     and old.date_mission is not distinct from new.date_mission
     and old.heure_mission is not distinct from new.heure_mission
     and old.statut is not distinct from new.statut then
    return new;
  end if;

  v_debut := public.mission_debut(new.date_mission, new.heure_mission);
  select coalesce(a.acceptation_missions, true) into v_req from public.auto_entrepreneur a where a.id = new.ae_id;
  v_req := coalesce(v_req, true);
  select * into r from public.mission_acceptation where mission_id = new.id and ae_id = new.ae_id;

  if not found then
    if new.statut in ('cancelled', 'refuse') then return new; end if;
    if new.date_mission < v_today then
      insert into public.mission_acceptation (mission_id, ae_id, statut, source, accepte_le, debut_mission)
      values (new.id, new.ae_id, 'acceptee', 'reprise', now(), v_debut) on conflict do nothing;
    elsif not v_req then
      insert into public.mission_acceptation (mission_id, ae_id, statut, source, accepte_le, debut_mission)
      values (new.id, new.ae_id, 'acceptee', 'non_requise', now(), v_debut) on conflict do nothing;
    else
      insert into public.mission_acceptation (mission_id, ae_id, statut, assigne_le, debut_mission, derniere_minute, echeance_bureau)
      values (new.id, new.ae_id, 'en_attente', now(), v_debut, (v_debut - now()) < interval '24 hours',
              public.mission_acceptation_echeance(now(), v_debut))
      on conflict do nothing;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Écart d'heure le même jour (changement de date : règle 374 inchangée)
    if old.date_mission is not distinct from new.date_mission and old.heure_mission is distinct from new.heure_mission then
      v_ecart_heure := v_debut - public.mission_debut(old.date_mission, old.heure_mission);
      if v_ecart_heure < interval '0' then v_ecart_heure := -v_ecart_heure; end if;
    end if;
    v_nouvelle_affectation :=
         (old.ae_id is distinct from new.ae_id)
      or (old.statut in ('cancelled', 'refuse') and new.statut not in ('cancelled', 'refuse') and r.statut = 'refusee')
      or (old.date_mission is distinct from new.date_mission and r.statut = 'acceptee' and r.source in ('portail', 'hospitable', 'bureau'))
      or (coalesce(v_ecart_heure > interval '2 hours', false) and r.statut = 'acceptee' and r.source in ('portail', 'hospitable', 'bureau'));
    if v_nouvelle_affectation and new.statut not in ('cancelled', 'refuse') and new.date_mission >= v_today then
      if v_req then
        update public.mission_acceptation set
          statut = 'en_attente', source = null, assigne_le = now(), debut_mission = v_debut,
          derniere_minute = (v_debut - now()) < interval '24 hours',
          echeance_bureau = public.mission_acceptation_echeance(now(), v_debut),
          accepte_le = null, refuse_le = null, refus_motif = null, refus_precision = null, refus_apres_acceptation = false,
          hospitable_desassigne_le = null, hospitable_erreur = null, hospitable_statut = null,
          notif_ae_le = null, rappel_ae_le = null, alerte_bureau_le = null, refus_notifie_le = null,
          traite_le = null, traite_par = null, updated_at = now()
        where id = r.id;
      else
        update public.mission_acceptation set statut = 'acceptee', source = 'non_requise', accepte_le = now(),
          debut_mission = v_debut, refuse_le = null, refus_motif = null, refus_precision = null, updated_at = now()
        where id = r.id;
      end if;
    elsif r.statut = 'en_attente' and v_debut is distinct from r.debut_mission then
      update public.mission_acceptation set debut_mission = v_debut,
        derniere_minute = (v_debut - r.assigne_le) < interval '24 hours',
        echeance_bureau = public.mission_acceptation_echeance(r.assigne_le, v_debut), updated_at = now()
      where id = r.id;
    elsif r.statut = 'acceptee' and v_debut is distinct from r.debut_mission then
      -- Petit décalage (≤ 2 h) sur une mission acceptée : l'acceptation tient, l'heure de référence suit.
      update public.mission_acceptation set debut_mission = v_debut, updated_at = now() where id = r.id;
    end if;
  end if;
  return new;
end $function$;
