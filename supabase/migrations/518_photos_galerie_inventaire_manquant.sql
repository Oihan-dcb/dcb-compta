-- 518 (21/10/2026) — Portail AE : photos de la galerie du téléphone + inventaire « manquant » sans photo.
-- Aucune donnée existante modifiée, aucune colonne ajoutée ou retirée, signatures inchangées (CREATE OR REPLACE).
--
-- 1. intervention_photo_ajouter : une photo AVANT / PENDANT / APRÈS du ménage poussé / de fond peut venir de la
--    galerie. Une photo dont la date de prise (EXIF, lue par le portail) est antérieure au début de la mission n'est
--    plus refusée : elle est enregistrée avec SA date dans prise_le, et le bureau voit le repère
--    « ⚠️ photo antérieure à la mission » (PowerHouse › Missions › 📸 Rapports, calcul prise_le < started_at - 10 min).
--    Photos du guide d'arrivée (zone « arrivee:<clé> ») : règle inchangée (prise pendant la mission).
-- 2. inventaire_noter : photo obligatoire seulement pour un article ABÎMÉ (un article manquant ne se photographie
--    pas) ; la photo reste possible en option.

CREATE OR REPLACE FUNCTION public.intervention_photo_ajouter(p_mission_id uuid, p_moment text, p_url text, p_storage_path text, p_piece_id uuid DEFAULT NULL::uuid, p_zone_nom text DEFAULT NULL::text, p_commentaire text DEFAULT NULL::text, p_prise_le timestamp with time zone DEFAULT NULL::timestamp with time zone, p_client_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare m mission_menage; t mission_terrain; v uuid; v_extra uuid; v_nom text; v_cle text;
  v_arrivee boolean := p_piece_id is null and coalesce(p_zone_nom, '') ~ '^arrivee:';
  v_anterieure boolean;
begin
  m := _terrain_mission_check(p_mission_id);
  if p_client_id is not null then
    select f.id into v from mission_extra_prevu_photo f where f.client_id = p_client_id and f.mission_id = m.id;
    if v is not null then return v; end if;
  end if;
  select * into t from mission_terrain where mission_id = m.id;
  if not found or t.started_at is null then raise exception 'mission_pas_en_cours'; end if;
  if not intervention_photos_permises(m.id, t.type_terrain) then raise exception 'pas_d_intervention_photo'; end if;
  v_anterieure := p_prise_le is not null and p_prise_le < t.started_at - interval '10 minutes';
  if t.ended_at is not null and t.ended_at < now() - interval '2 hours' then
    if p_prise_le is null
       or (v_anterieure and v_arrivee)
       or p_prise_le > t.ended_at + interval '2 hours'
       or t.ended_at < now() - interval '14 days' then
      raise exception 'mission_terminee';
    end if;
  end if;
  -- Galerie : photo antérieure acceptée (repère côté bureau) sauf pour le guide d'arrivée
  if v_anterieure and v_arrivee then raise exception 'photo_avant_mission'; end if;
  if p_moment not in ('avant', 'pendant', 'apres') then raise exception 'moment_invalide'; end if;
  if coalesce(p_storage_path, '') !~ ('^' || m.ae_id::text || '/intervention/') then raise exception 'chemin_invalide'; end if;
  if v_arrivee then
    v_cle := substr(p_zone_nom, 9);
    select x.id, left(coalesce((select d->>'libelle' from jsonb_array_elements(x.photos_demandees) d where d->>'cle' = v_cle limit 1), ''), 60)
      into v_extra, v_nom
      from mission_extra_prevu x
     where x.mission_id = m.id and x.genre = 'photos_arrivee' and x.statut in ('prevu', 'fait')
       and exists (select 1 from jsonb_array_elements(x.photos_demandees) d where d->>'cle' = v_cle)
     order by x.created_at limit 1;
    if v_extra is null then raise exception 'photo_demandee_inconnue'; end if;
    if length(v_nom) < 1 then v_nom := 'Photo guide d''arrivée'; end if;
  elsif p_piece_id is not null then
    select p.nom into v_nom from inventaire_piece p join bien_toolbox bt on bt.id = p.bien_id where p.id = p_piece_id and bt.bien_id = m.bien_id;
    if v_nom is null then raise exception 'zone_hors_bien'; end if;
  else
    v_nom := left(trim(coalesce(p_zone_nom, '')), 60);
    if length(v_nom) < 1 then raise exception 'zone_obligatoire'; end if;
  end if;
  if v_cle is null then
    if not intervention_photos_attendues(m.id, t.type_terrain) then raise exception 'pas_d_intervention_photo'; end if;
    select x.id into v_extra from mission_extra_prevu x where x.mission_id = m.id and x.genre = 'menage_pousse' and x.statut in ('prevu', 'fait') order by x.created_at limit 1;
  end if;
  begin
    insert into mission_extra_prevu_photo (extra_id, mission_id, moment, url, storage_path, commentaire, prise_le, ae_id, piece_id, zone_nom, ordre, client_id, demande_cle)
    values (v_extra, m.id, p_moment, p_url, p_storage_path, nullif(left(trim(coalesce(p_commentaire, '')), 500), ''),
            least(coalesce(p_prise_le, now()), now()), m.ae_id, p_piece_id, v_nom,
            coalesce((select max(f.ordre) from mission_extra_prevu_photo f where f.mission_id = m.id and f.moment = p_moment), 0) + 10,
            p_client_id, v_cle)
    returning id into v;
  exception when unique_violation then
    select f.id into v from mission_extra_prevu_photo f where f.client_id = p_client_id;
    if v is null then raise; end if;
  end;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.inventaire_noter(p_releve uuid, p_item uuid, p_etat text, p_quantite integer DEFAULT NULL::integer, p_note text DEFAULT NULL::text, p_photo_url text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r inventaire_releve; c inventaire_bien_config; ci catalogue_items; l inventaire_releve_ligne; s inventaire_bien_stock;
  v_photo text; v_qte int; v_statut text; v_attendue int;
begin
  r := _inventaire_releve_check(p_releve);
  if p_etat not in ('present','manquant','abime') then raise exception 'etat_invalide'; end if;
  select * into c from inventaire_bien_config where bien_id = r.bien_id and item_id = p_item and actif;
  if not found then raise exception 'article_hors_inventaire'; end if;
  select * into ci from catalogue_items where id = p_item;
  select * into l from inventaire_releve_ligne where releve_id = r.id and item_id = p_item;
  v_photo := coalesce(nullif(trim(p_photo_url), ''), l.photo_url);
  -- 518 : photo obligatoire pour un article abîmé seulement (manquant : photo facultative)
  if p_etat = 'abime' and v_photo is null then raise exception 'photo_obligatoire'; end if;
  v_qte := case when p_etat = 'manquant' and p_quantite is null then 0 else p_quantite end;
  if v_qte is not null and (v_qte < 0 or v_qte > 999) then raise exception 'quantite_invalide'; end if;
  v_attendue := c.quantite_attendue;
  if v_attendue is null and v_qte is not null and p_etat = 'present' then
    v_attendue := v_qte;
    update inventaire_bien_config set quantite_attendue = v_qte where id = c.id;
  end if;
  insert into inventaire_releve_ligne (releve_id, item_id, piece_id, etat, quantite_attendue, quantite_constatee, etat_note, photo_url, vu_at)
  values (r.id, p_item, c.piece_id, p_etat, v_attendue, v_qte, nullif(left(trim(coalesce(p_note, '')), 300), ''), v_photo, now())
  on conflict (releve_id, item_id) do update set piece_id = excluded.piece_id, etat = excluded.etat, quantite_attendue = excluded.quantite_attendue,
     quantite_constatee = excluded.quantite_constatee, etat_note = excluded.etat_note, photo_url = excluded.photo_url, vu_at = now();
  v_statut := case p_etat when 'manquant' then 'manquant' when 'abime' then 'a_remplacer'
                else case when v_attendue is not null and v_qte is not null and v_qte < v_attendue then 'a_remplacer' else 'present' end end;
  select * into s from inventaire_bien_stock where bien_id = r.bien_id and item_id = p_item;
  insert into inventaire_bien_stock (bien_id, item_id, statut, quantite, derniere_maj_par, derniere_maj_at)
  values (r.bien_id, p_item, v_statut, v_qte, r.ae_id, now())
  on conflict (bien_id, item_id) do update set statut = excluded.statut, quantite = coalesce(excluded.quantite, inventaire_bien_stock.quantite),
     derniere_maj_par = excluded.derniere_maj_par, derniere_maj_at = now();
  if s.statut is distinct from v_statut then
    insert into inventaire_mouvements (bien_id, item_id, ancien_statut, nouveau_statut, auteur_ae_id, note)
    values (r.bien_id, p_item, s.statut, v_statut, r.ae_id, 'Inventaire complet' || coalesce(' — ' || nullif(trim(p_note), ''), ''));
  end if;
  return jsonb_build_object('etat', p_etat, 'statut_suivi', v_statut, 'quantite_attendue', v_attendue, 'quantite_constatee', v_qte);
end $function$;
