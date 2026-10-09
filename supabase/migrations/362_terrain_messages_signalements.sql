-- 362 — Tout ce qui est signalé depuis Ma journée part aussi dans la conversation du staff (09/10/2026, Oïhan :
-- « Camille a signalé un appartement sale à l'arrivée et ça n'a rien envoyé dans le feed de conv ; je veux que le
-- mécanisme soit le même : quand une action est signalée/rapportée dans Ma journée, un message auto s'envoie »).
-- Même mécanisme que le « ✅ BIEN ok » de fin de mission (migration 330, terrain_message_fin_mission) : message
-- dans la staff_room du staff, expéditeur = le staff lui-même. Déclencheurs, uniquement quand la ligne est liée
-- à une mission (donc saisie depuis Ma journée / ⚡ Agir) :
--   · état à l'arrivée « problème »            (mission_terrain.etat_arrivee)
--   · signalement voyageur (saleté, dégât…)    (signalements.mission_id) — 1re photo en pièce jointe
--   · ticket technique                         (tech_issues.mission_id)  — 1re photo en pièce jointe
--   · extra constaté / entretien fait (temps en plus, en attente de validation) (prestation_hors_forfait)
--   · « Il manque… » pour le prochain sac      (besoin_sac.mission_source_id)

create or replace function public.terrain_poster(p_mission_id uuid, p_corps text, p_piece text default null)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare m mission_menage; a auto_entrepreneur; v_room uuid;
begin
  select * into m from mission_menage where id = p_mission_id;
  if m.id is null then return; end if;
  select * into a from auto_entrepreneur where id = m.ae_id;
  if a.ae_user_id is null then return; end if;
  select r.id into v_room
    from chat_rooms r join chat_room_members cm on cm.room_id = r.id and cm.user_id = a.ae_user_id
   where r.type = 'staff_room'
   order by (r.name ilike coalesce(nullif(a.prenom, ''), '§') || '%') desc, r.created_at
   limit 1;
  if v_room is null then return; end if;
  insert into chat_messages (room_id, sender_id, body, attachment_url) values (v_room, a.ae_user_id, p_corps, p_piece);
exception when others then
  return;
end $function$;
revoke all on function public.terrain_poster(uuid, text, text) from public, anon, authenticated;

create or replace function public.terrain_code_bien(p_mission_id uuid)
 returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce(b.code, b.hospitable_name, 'Bien') from mission_menage m left join bien b on b.id = m.bien_id where m.id = p_mission_id
$$;
revoke all on function public.terrain_code_bien(uuid) from public, anon, authenticated;

-- État à l'arrivée
create or replace function public.terrain_msg_etat_arrivee()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if new.etat_arrivee is not null and new.etat_arrivee <> 'ok'
     and (tg_op = 'INSERT' or old.etat_arrivee is distinct from new.etat_arrivee) then
    perform terrain_poster(new.mission_id, '⚠️ ' || terrain_code_bien(new.mission_id) || ' — état à l''arrivée : '
      || case new.etat_arrivee when 'probleme' then 'problème signalé' else new.etat_arrivee end);
  end if;
  return new;
exception when others then return new;
end $function$;
drop trigger if exists trg_terrain_msg_etat_arrivee on public.mission_terrain;
create trigger trg_terrain_msg_etat_arrivee after insert or update of etat_arrivee on public.mission_terrain
  for each row execute function public.terrain_msg_etat_arrivee();

-- Signalement (saleté, dégât…)
create or replace function public.terrain_msg_signalement()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_photos text[]; v_nb int;
begin
  if new.mission_id is null then return new; end if;
  begin v_photos := array(select jsonb_array_elements_text(to_jsonb(new.photos))); exception when others then v_photos := null; end;
  v_nb := coalesce(array_length(v_photos, 1), 0);
  perform terrain_poster(new.mission_id,
    '🚨 ' || terrain_code_bien(new.mission_id) || ' — signalement : '
      || case new.type when 'salete' then 'logement sale à l''arrivée' when 'degat' then 'dégât' when 'casse' then 'casse' else coalesce(new.type, 'autre') end
      || case when coalesce(new.description, new.notes) is not null then ' — ' || left(coalesce(new.description, new.notes), 300) else '' end
      || case when v_nb > 0 then ' · 📷 ' || v_nb || ' photo' || case when v_nb > 1 then 's' else '' end else '' end,
    v_photos[1]);
  return new;
exception when others then return new;
end $function$;
drop trigger if exists trg_terrain_msg_signalement on public.signalements;
create trigger trg_terrain_msg_signalement after insert on public.signalements
  for each row execute function public.terrain_msg_signalement();

-- Ticket technique
create or replace function public.terrain_msg_tech()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_photos text[];
begin
  if new.mission_id is null then return new; end if;
  begin v_photos := array(select jsonb_array_elements_text(to_jsonb(new.photos))); exception when others then v_photos := null; end;
  perform terrain_poster(new.mission_id,
    '🔧 ' || terrain_code_bien(new.mission_id) || ' — problème technique : ' || coalesce(new.title, 'sans titre')
      || case when new.priority = 'urgent' then ' (URGENT)' else '' end
      || case when new.description is not null and new.description <> coalesce(new.title, '') then ' — ' || left(new.description, 300) else '' end,
    v_photos[1]);
  return new;
exception when others then return new;
end $function$;
drop trigger if exists trg_terrain_msg_tech on public.tech_issues;
create trigger trg_terrain_msg_tech after insert on public.tech_issues
  for each row execute function public.terrain_msg_tech();

-- Extra constaté
create or replace function public.terrain_msg_extra()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  -- seulement ce que le staff déclare sur le terrain (en attente de validation) — pas les prestations saisies
  -- par le bureau (déjà validées)
  if new.mission_id is null or coalesce(new.statut, '') <> 'en_attente' then return new; end if;
  perform terrain_poster(new.mission_id,
    '⏱ ' || terrain_code_bien(new.mission_id) || ' — temps en plus déclaré : ' || coalesce(left(new.description, 200), 'temps supplémentaire')
      || case when new.duree_minutes is not null then ' (' || new.duree_minutes || ' min)' else '' end || ' · à valider par le bureau');
  return new;
exception when others then return new;
end $function$;
drop trigger if exists trg_terrain_msg_extra on public.prestation_hors_forfait;
create trigger trg_terrain_msg_extra after insert on public.prestation_hors_forfait
  for each row execute function public.terrain_msg_extra();

-- « Il manque… » (besoin pour le prochain sac)
create or replace function public.terrain_msg_besoin()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if new.mission_source_id is null then return new; end if;
  perform terrain_poster(new.mission_source_id,
    '🧺 ' || terrain_code_bien(new.mission_source_id) || ' — il manque : ' || new.libelle
      || case when new.quantite > 1 then ' ×' || new.quantite else '' end || ' (prévu dans le prochain sac)');
  return new;
exception when others then return new;
end $function$;
drop trigger if exists trg_terrain_msg_besoin on public.besoin_sac;
create trigger trg_terrain_msg_besoin after insert on public.besoin_sac
  for each row execute function public.terrain_msg_besoin();

revoke all on function public.terrain_msg_etat_arrivee() from public, anon, authenticated;
revoke all on function public.terrain_msg_signalement() from public, anon, authenticated;
revoke all on function public.terrain_msg_tech() from public, anon, authenticated;
revoke all on function public.terrain_msg_extra() from public, anon, authenticated;
revoke all on function public.terrain_msg_besoin() from public, anon, authenticated;
