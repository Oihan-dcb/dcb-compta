-- 363 — Photos des signalements terrain en cartes dans la conversation (09/10/2026, Oïhan : « même système de
-- photos en tiles que pour les annotations »). Avec photos, le message posté est « PHOTOS::{json} » rendu par le
-- portail AE (components/PhotosCartes.jsx : rail de cartes, compteur, zoom) — toutes les photos, plus seulement
-- la 1re en pièce jointe. Sans photo : message texte inchangé (migration 362).
create or replace function public.terrain_msg_signalement()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_photos text[]; v_titre text; v_texte text;
begin
  if new.mission_id is null then return new; end if;
  begin v_photos := array(select jsonb_array_elements_text(to_jsonb(new.photos))); exception when others then v_photos := null; end;
  v_titre := case new.type when 'salete' then 'logement sale à l''arrivée' when 'degat' then 'dégât' when 'casse' then 'casse' else coalesce(new.type, 'signalement') end;
  v_texte := nullif(left(coalesce(new.description, new.notes, ''), 300), '');
  if coalesce(array_length(v_photos, 1), 0) > 0 then
    perform terrain_poster(new.mission_id, 'PHOTOS::' || jsonb_build_object(
      'icone', '🚨', 'couleur', '#B91C1C', 'bien', terrain_code_bien(new.mission_id),
      'titre', 'Signalement : ' || v_titre, 'texte', v_texte, 'photos', to_jsonb(v_photos))::text);
  else
    perform terrain_poster(new.mission_id, '🚨 ' || terrain_code_bien(new.mission_id) || ' — signalement : ' || v_titre
      || case when v_texte is not null then ' — ' || v_texte else '' end);
  end if;
  return new;
exception when others then return new;
end $function$;

create or replace function public.terrain_msg_tech()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_photos text[]; v_titre text; v_texte text;
begin
  if new.mission_id is null then return new; end if;
  begin v_photos := array(select u from jsonb_array_elements_text(to_jsonb(new.photos)) u where u ~ '^https?:'); exception when others then v_photos := null; end;
  v_titre := 'Problème technique : ' || coalesce(new.title, 'sans titre') || case when new.priority = 'urgent' then ' (URGENT)' else '' end;
  v_texte := case when new.description is not null and new.description <> coalesce(new.title, '') then left(new.description, 300) end;
  if coalesce(array_length(v_photos, 1), 0) > 0 then
    perform terrain_poster(new.mission_id, 'PHOTOS::' || jsonb_build_object(
      'icone', '🔧', 'couleur', '#B45309', 'bien', terrain_code_bien(new.mission_id),
      'titre', v_titre, 'texte', v_texte, 'photos', to_jsonb(v_photos))::text);
  else
    perform terrain_poster(new.mission_id, '🔧 ' || terrain_code_bien(new.mission_id) || ' — ' || v_titre
      || case when v_texte is not null then ' — ' || v_texte else '' end);
  end if;
  return new;
exception when others then return new;
end $function$;
revoke all on function public.terrain_msg_signalement() from public, anon, authenticated;
revoke all on function public.terrain_msg_tech() from public, anon, authenticated;
