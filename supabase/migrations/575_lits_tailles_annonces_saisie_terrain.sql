-- 575 — Taille des lits : relevé des annonces + saisie terrain par l'AE (23/10/2026)
-- 1) Nouvelles origines de bien_lit.source : 'annonce' (texte de l'annonce Hospitable), 'savoir' (Savoir du bien),
--    'terrain' (taille relevée sur place par l'AE pendant la mission).
-- 2) Relevé du bureau : largeur_cm remplie UNIQUEMENT quand la taille est écrite en clair dans l'annonce / le Savoir
--    ET que l'attribution au lit est sans ambiguïté. La colonne linge (Twin/Queen/King = taille des DRAPS) n'est
--    jamais utilisée pour déduire la taille. longueur_cm non touchée (200 par défaut, aucune source ne la donne).
-- 3) RPC ae_lit_taille : l'AE de la mission (mission du jour ou en cours) renseigne la taille d'un lit qui n'en a pas.
--    Ne remplace jamais une taille déjà renseignée. source = 'terrain', maj_par = prénom de l'AE.
--    Le bureau garde la main (PowerHouse › fiche bien › Couchages).
-- 4) ae_lits_biens renvoie aussi source / maj_par (affichage « relevé sur place par … »).

alter table public.bien_lit drop constraint if exists bien_lit_source_check;
alter table public.bien_lit add constraint bien_lit_source_check
  check (source = any (array['saisi', 'hospitable', 'migration', 'annonce', 'savoir', 'terrain']));

-- ── 2) Relevé des annonces (seulement les lits encore sans largeur) ─────────────────────────────────
update public.bien_lit l set
  largeur_cm = v.largeur, source = v.source, maj_par = 'bureau (relevé annonces 23/10)', maj_le = now(),
  note = left(v.citation || coalesce(' · ' || l.note, ''), 200)
from (values
  -- 408P : un seul lit dans le bien
  ('0e4fe8ce-8ff4-4b31-87ae-bd2f28a8c540'::uuid, 140, 'annonce', 'Annonce Hospitable (descriptif) : « La chambre est équipée d''un lit double 140 »'),
  -- 416 : un seul lit
  ('e2a6e02c-3a04-40f2-833a-d4196de1f850'::uuid, 160, 'annonce', 'Annonce Hospitable (descriptif) : « sa cuisine équipée au lit en 160 »'),
  -- 506P : le lit double (le canapé-lit n'a pas de taille dans l'annonce)
  ('9491ec7e-bb2f-4415-a7e4-09dfd4005546'::uuid, 140, 'annonce', 'Annonce Hospitable (descriptif) : « La chambre est équipée d''un lit double 140 »'),
  -- 602 : un seul lit
  ('61d6e56b-ae30-4273-9b55-a0244b2a5f55'::uuid, 160, 'annonce', 'Annonce Hospitable (descriptif) : « avec un lit double en 160 »'),
  -- CERES : deux lits doubles, tous deux 160
  ('a3584498-e466-4cbf-a2fa-bf89af5228f3'::uuid, 160, 'annonce', 'Annonce Hospitable : « Suite principale literie 160 » et « 2ᵉ chambre, literie 160 » (Airbnb : « 160 cm-wide bed » ×2)'),
  ('d24cfbcc-ec58-4003-99f5-ea8bc5320a1a'::uuid, 160, 'annonce', 'Annonce Hospitable : « Suite principale literie 160 » et « 2ᵉ chambre, literie 160 » (Airbnb : « 160 cm-wide bed » ×2)'),
  -- DUL : deux lits doubles 160 + un lit simple 90 (lit superposé 160/90)
  ('e4af6bdb-875f-41bf-b135-dc32fdb5553d'::uuid, 160, 'annonce', 'Annonce Hospitable : « Master suite bedding 160 » et « 2nd bedroom, bunk bed, 160 and 90 »'),
  ('624dda7b-66f3-45c7-ae4b-eff0f721b926'::uuid, 160, 'annonce', 'Annonce Hospitable : « Master suite bedding 160 » et « 2nd bedroom, bunk bed, 160 and 90 »'),
  ('b43f75d8-04e3-4fe8-8d49-7dcd743f61bf'::uuid,  90, 'annonce', 'Annonce Hospitable : « 2nd bedroom, bunk bed, 160 and 90 » (seul lit simple)'),
  -- PANTXIKA : un seul lit
  ('0452718c-322a-4d4f-97d0-f049614800d1'::uuid, 160, 'savoir',  'Savoir du bien : « Lit double confortable de 160 cm »')
) as v(id, largeur, source, citation)
where l.id = v.id and l.actif and l.largeur_cm is null;

-- ── 3) Saisie terrain ─────────────────────────────────────────────────────────────────────────────
create or replace function public.ae_lit_taille(p_mission_id uuid, p_lit_id uuid, p_largeur_cm integer, p_longueur_cm integer default 200)
returns table (lit_id uuid, largeur_cm smallint, longueur_cm smallint, source text, maj_par text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  m mission_menage;
  v_jour date := (now() at time zone 'Europe/Paris')::date;
  v_prenom text;
  v_long integer := coalesce(p_longueur_cm, 200);
  l bien_lit;
begin
  m := _terrain_mission_check(p_mission_id);            -- AE de la mission, mission non annulée
  if not (m.date_mission::date = v_jour
          or exists (select 1 from mission_terrain t where t.mission_id = m.id and t.started_at is not null and t.ended_at is null)) then
    raise exception 'mission_pas_du_jour';
  end if;
  if p_largeur_cm is null or p_largeur_cm < 60 or p_largeur_cm > 220 then raise exception 'largeur_invalide'; end if;
  if v_long < 150 or v_long > 220 then raise exception 'longueur_invalide'; end if;
  select coalesce(nullif(trim(a.prenom), ''), 'AE') into v_prenom from auto_entrepreneur a where a.id = m.ae_id;

  update bien_lit b set
    largeur_cm = p_largeur_cm, longueur_cm = v_long, source = 'terrain', maj_par = v_prenom, maj_le = now(),
    note = left('Relevé sur place par ' || v_prenom || ' le ' || to_char(v_jour, 'DD/MM/YYYY') || coalesce(' · ' || b.note, ''), 200)
   where b.id = p_lit_id and b.bien_id = m.bien_id and b.actif and b.largeur_cm is null
  returning b.* into l;

  if l.id is null then
    if exists (select 1 from bien_lit b where b.id = p_lit_id and b.bien_id = m.bien_id and b.actif) then
      raise exception 'taille_deja_renseignee';
    end if;
    raise exception 'lit_introuvable';
  end if;
  return query select l.id, l.largeur_cm, l.longueur_cm, l.source, l.maj_par;
end $$;
revoke all on function public.ae_lit_taille(uuid, uuid, integer, integer) from public, anon;
grant execute on function public.ae_lit_taille(uuid, uuid, integer, integer) to authenticated, service_role;

-- ── 4) Lecture AE : + source / maj_par ──────────────────────────────────────────────────────────────
drop function if exists public.ae_lits_biens(uuid[]);
create function public.ae_lits_biens(p_bien_ids uuid[])
returns table (bien_id uuid, lit_id uuid, piece text, type text, largeur_cm smallint, longueur_cm smallint, linge text,
               places smallint, transforme_type text, transforme_nombre smallint, transforme_largeur_cm smallint, transforme_linge text, ordre smallint,
               source text, maj_par text)
language sql stable security definer set search_path = public as $$
  select l.bien_id, l.id, l.piece, l.type, l.largeur_cm, l.longueur_cm, l.linge, l.places,
         l.transforme_type, l.transforme_nombre, l.transforme_largeur_cm, l.transforme_linge, l.ordre,
         l.source, l.maj_par
    from bien_lit l
   where l.actif and l.bien_id = any(coalesce(p_bien_ids, '{}')) and auth_user_is_internal()
   order by l.bien_id, l.ordre, l.piece, l.id
$$;
revoke all on function public.ae_lits_biens(uuid[]) from public, anon;
grant execute on function public.ae_lits_biens(uuid[]) to authenticated, service_role;
