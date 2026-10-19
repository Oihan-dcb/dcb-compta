-- 485 — Photos d'intervention HORS RÉSEAU + temps passé dans le rapport propriétaire (19/10/2026, demandes Oïhan).
--
-- 1. Hors réseau (cave, montagne) : le portail garde la photo sur le téléphone (IndexedDB) avec sa zone, son moment,
--    son commentaire et l'heure de PRISE, puis l'envoie dès que le réseau revient (dans l'ordre). Pour que ces envois
--    différés ne créent jamais de doublon et ne soient pas refusés parce que la mission est finie entre-temps :
--      * mission_extra_prevu_photo.client_id : identifiant unique fabriqué par le téléphone (un par photo) ;
--        intervention_photo_ajouter(…, p_client_id) est IDEMPOTENTE : un 2e envoi du même client_id renvoie la
--        photo déjà enregistrée, sans rien insérer ;
--      * la règle « photo prise pendant la mission » se juge sur l'heure de PRISE (p_prise_le) : une photo prise
--        entre le démarrage (marge 10 min) et 2 h après « Terminer » est acceptée même si elle arrive plus tard
--        (réseau revenu le soir), dans la limite de 14 jours après la fin de la mission. Sans heure de prise
--        (ancienne version du portail), la règle reste celle de 483 (envoi au plus tard 2 h après la fin).
--    Le point de vérification du hub (intervention_photo_anomalie, calculé à la lecture) se recalcule de lui-même
--    dès que les photos arrivent.
-- 2. Temps passé : intervention_rapport.afficher_temps (vrai par défaut) — « Temps d'intervention : X h Y min » dans
--    l'écran de relecture et dans l'en-tête du PDF propriétaire (justifie la refacturation au temps) ; le bureau peut
--    le retirer au cas par cas. Le temps est calculé par PowerHouse (api/intervention-rapport) : durée de la
--    prestation hors forfait liée à l'extra « ménage poussé », sinon durée réelle saisie sur l'extra prévu, sinon
--    durée de la mission (déclarée, sinon corrigée, sinon chrono). Jamais le nom de l'intervenante.

begin;

-- ── 1. Identifiant client unique par photo ───────────────────────────────────────────────────
alter table public.mission_extra_prevu_photo add column if not exists client_id uuid;
create unique index if not exists mission_extra_prevu_photo_client_id_uniq
  on public.mission_extra_prevu_photo (client_id) where client_id is not null;
comment on column public.mission_extra_prevu_photo.client_id is
  'Identifiant de la photo fabriqué par le téléphone (485) : rend l''envoi idempotent (file hors réseau du portail, renvois automatiques).';

-- ── 2. Ajout idempotent, contrôle sur l'heure de prise ───────────────────────────────────────
drop function if exists public.intervention_photo_ajouter(uuid, text, text, text, uuid, text, text, timestamptz);
create or replace function public.intervention_photo_ajouter(
  p_mission_id uuid, p_moment text, p_url text, p_storage_path text, p_piece_id uuid default null,
  p_zone_nom text default null, p_commentaire text default null, p_prise_le timestamptz default null,
  p_client_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare m mission_menage; t mission_terrain; v uuid; v_extra uuid; v_nom text;
begin
  m := _terrain_mission_check(p_mission_id);   -- sa mission, pas annulée

  -- Idempotence : déjà reçue (renvoi après coupure réseau, double tentative) → même photo, rien d'autre
  if p_client_id is not null then
    select f.id into v from mission_extra_prevu_photo f where f.client_id = p_client_id and f.mission_id = m.id;
    if v is not null then return v; end if;
  end if;

  select * into t from mission_terrain where mission_id = m.id;
  if not found or t.started_at is null then raise exception 'mission_pas_en_cours'; end if;
  if not intervention_photos_attendues(m.id, t.type_terrain) then raise exception 'pas_d_intervention_photo'; end if;
  if t.ended_at is not null and t.ended_at < now() - interval '2 hours' then
    -- Envoi différé (photo gardée hors réseau) : accepté si la photo a été PRISE pendant la mission
    if p_prise_le is null
       or p_prise_le < t.started_at - interval '10 minutes'
       or p_prise_le > t.ended_at + interval '2 hours'
       or t.ended_at < now() - interval '14 days' then
      raise exception 'mission_terminee';
    end if;
  end if;
  if p_prise_le is not null and p_prise_le < t.started_at - interval '10 minutes' then raise exception 'photo_avant_mission'; end if;

  if p_moment not in ('avant', 'pendant', 'apres') then raise exception 'moment_invalide'; end if;
  if coalesce(p_storage_path, '') !~ ('^' || m.ae_id::text || '/intervention/') then raise exception 'chemin_invalide'; end if;
  if p_piece_id is not null then
    select p.nom into v_nom from inventaire_piece p join bien_toolbox bt on bt.id = p.bien_id where p.id = p_piece_id and bt.bien_id = m.bien_id;
    if v_nom is null then raise exception 'zone_hors_bien'; end if;
  else
    v_nom := left(trim(coalesce(p_zone_nom, '')), 60);
    if length(v_nom) < 1 then raise exception 'zone_obligatoire'; end if;
  end if;
  select x.id into v_extra from mission_extra_prevu x where x.mission_id = m.id and x.genre = 'menage_pousse' and x.statut in ('prevu', 'fait') order by x.created_at limit 1;
  begin
    insert into mission_extra_prevu_photo (extra_id, mission_id, moment, url, storage_path, commentaire, prise_le, ae_id, piece_id, zone_nom, ordre, client_id)
    values (v_extra, m.id, p_moment, p_url, p_storage_path, nullif(left(trim(coalesce(p_commentaire, '')), 500), ''),
            least(coalesce(p_prise_le, now()), now()), m.ae_id, p_piece_id, v_nom,
            coalesce((select max(f.ordre) from mission_extra_prevu_photo f where f.mission_id = m.id and f.moment = p_moment), 0) + 10,
            p_client_id)
    returning id into v;
  exception when unique_violation then
    -- deux envois simultanés du même client_id : on renvoie celui qui a gagné
    select f.id into v from mission_extra_prevu_photo f where f.client_id = p_client_id;
    if v is null then raise; end if;
  end;
  return v;
end $$;
revoke all on function public.intervention_photo_ajouter(uuid, text, text, text, uuid, text, text, timestamptz, uuid) from public, anon;
grant execute on function public.intervention_photo_ajouter(uuid, text, text, text, uuid, text, text, timestamptz, uuid) to authenticated;

-- ── 3. Temps passé dans le rapport propriétaire ──────────────────────────────────────────────
alter table public.intervention_rapport add column if not exists afficher_temps boolean not null default true;
comment on column public.intervention_rapport.afficher_temps is
  'Afficher « Temps d''intervention : X h Y min » dans le PDF propriétaire (485, vrai par défaut ; décoché au cas par cas par le bureau).';

commit;
