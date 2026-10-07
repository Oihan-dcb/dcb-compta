-- 342 — « 🎯 Tes points d'attention » : checklist adaptée aux points faibles de chaque AE (07/10/2026, Oïhan).
--
-- Sources d'un point (ae_point_attention) :
--   • 'video'    : carte « 🔧 à corriger » d'un retour vidéo (video_annotation.type = 'corriger', migr. 341) — trigger ;
--   • 'controle' : contrôle bureau « à reprendre » + note (mission_terrain.controle_statut, migr. 331) — trigger ;
--   • 'avis'     : commentaire voyageur propreté < 5/5 attribué à l'AE (règle _avis_proprete_attribues, migr. 306),
--                  transformé en 1-2 consignes par Haiku dans l'edge function points-attention-avis (cron quotidien,
--                  un seul appel par avis : ae_point_attention_avis mémorise les avis traités) ;
--   • 'manuel'   : ajouté par le bureau depuis la fiche Staff PowerHouse.
-- Dédoublonnage : même AE + même bien + libellé proche (trigrammes ≥ 0,5) → occurrences + 1, compteur remis à 0,
-- point réactivé s'il était acquis (« 2e fois »). Un point retiré par le bureau n'est jamais ressuscité.
-- Sortie : 5 missions terminées de l'AE (sur le bien du point, ou toutes si point général ; hors technique) sans
-- nouveau reproche → 'acquis' automatiquement ; ou plus tôt par le bureau (✅ Acquis).
-- AE : lit SES points (RLS auth_user_owns_ae), les coche pendant la mission (mission_terrain.points_coches, non
-- bloquant). Jamais d'avis brut ni de nom de voyageur côté AE : seulement la consigne.
create extension if not exists pg_trgm with schema extensions;

create table if not exists public.ae_point_attention (
  id                uuid primary key default gen_random_uuid(),
  ae_id             uuid not null references public.auto_entrepreneur(id) on delete cascade,
  bien_id           uuid references public.bien(id) on delete cascade,   -- NULL = toutes ses missions
  libelle           text not null check (length(trim(libelle)) >= 2),
  source            text not null check (source in ('video', 'controle', 'avis', 'manuel')),
  source_ref        text,
  occurrences       integer not null default 1,
  missions_ok       integer not null default 0,
  statut            text not null default 'actif' check (statut in ('actif', 'acquis', 'retire')),
  dernier_reproche  timestamptz not null default now(),
  cree_le           timestamptz not null default now(),
  cree_par          uuid default auth.uid(),
  maj               timestamptz not null default now(),
  acquis_le         timestamptz,
  acquis_par        uuid
);
create index if not exists ae_point_attention_ae_idx on public.ae_point_attention (ae_id, statut);
alter table public.ae_point_attention enable row level security;
drop policy if exists ae_point_attention_select on public.ae_point_attention;
create policy ae_point_attention_select on public.ae_point_attention for select to authenticated
  using (auth_user_is_bureau() or auth_user_is_staff() or auth_user_owns_ae(ae_id));
-- Aucune écriture directe : uniquement via les RPC / triggers ci-dessous.

alter table public.mission_terrain add column if not exists points_coches jsonb not null default '{}'::jsonb;

create or replace function public._pa_norm(p text)
returns text language sql immutable set search_path = public, extensions as $$
  select trim(regexp_replace(lower(extensions.unaccent(coalesce(p, ''))), '[^a-z0-9]+', ' ', 'g'));
$$;

-- Ajout avec dédoublonnage. Renvoie l'id du point créé ou renforcé (NULL si libellé vide).
create or replace function public._point_attention_ajouter(p_ae_id uuid, p_bien_id uuid, p_libelle text, p_source text, p_ref text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_lib text := trim(regexp_replace(coalesce(p_libelle, ''), '\s+', ' ', 'g')); v_id uuid;
begin
  if p_ae_id is null or length(v_lib) < 2 then return null; end if;
  if length(v_lib) > 140 then v_lib := left(v_lib, 137) || '…'; end if;
  select id into v_id from ae_point_attention
   where ae_id = p_ae_id and bien_id is not distinct from p_bien_id and statut <> 'retire'
     and extensions.similarity(_pa_norm(libelle), _pa_norm(v_lib)) >= 0.5
   order by extensions.similarity(_pa_norm(libelle), _pa_norm(v_lib)) desc, maj desc
   limit 1;
  if v_id is not null then
    update ae_point_attention set occurrences = occurrences + 1, missions_ok = 0, statut = 'actif',
           acquis_le = null, acquis_par = null, dernier_reproche = now(), maj = now()
     where id = v_id;
    return v_id;
  end if;
  insert into ae_point_attention (ae_id, bien_id, libelle, source, source_ref)
  values (p_ae_id, p_bien_id, v_lib, p_source, p_ref) returning id into v_id;
  return v_id;
end $$;
revoke all on function public._point_attention_ajouter(uuid, uuid, text, text, text) from public, anon, authenticated;

-- Source 1 : carte « 🔧 à corriger » d'un retour vidéo.
create or replace function public._pa_depuis_video()
returns trigger language plpgsql security definer set search_path = public as $$
declare m mission_menage;
begin
  if new.type <> 'corriger' or length(trim(coalesce(new.texte, ''))) < 2 then return new; end if;
  select * into m from mission_menage where id = new.mission_id;
  perform _point_attention_ajouter(m.ae_id, m.bien_id, new.texte, 'video', new.id::text);
  return new;
end $$;
drop trigger if exists trg_pa_depuis_video on public.video_annotation;
create trigger trg_pa_depuis_video after insert on public.video_annotation
  for each row execute function public._pa_depuis_video();

-- Source 2 : contrôle bureau « à reprendre » (transition uniquement : re-cliquer ne compte pas deux fois).
create or replace function public._pa_depuis_controle()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.controle_statut is distinct from 'a_reprendre' or old.controle_statut is not distinct from 'a_reprendre' then return new; end if;
  perform _point_attention_ajouter(new.ae_id, new.bien_id, new.controle_note, 'controle', new.mission_id::text);
  return new;
end $$;
drop trigger if exists trg_pa_depuis_controle on public.mission_terrain;
create trigger trg_pa_depuis_controle after update of controle_statut on public.mission_terrain
  for each row execute function public._pa_depuis_controle();

-- Sortie : chaque mission terminée (hors technique) sans nouveau reproche fait avancer le compteur ; 5 → acquis.
-- Seuls comptent les points dont le dernier reproche précède le début de la mission.
create or replace function public._pa_mission_terminee()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.statut <> 'terminee' or (tg_op = 'UPDATE' and old.statut is not distinct from 'terminee') then return new; end if;
  if new.type_terrain = 'technique' then return new; end if;
  update ae_point_attention p set
         missions_ok = p.missions_ok + 1,
         statut = case when p.missions_ok + 1 >= 5 then 'acquis' else 'actif' end,
         acquis_le = case when p.missions_ok + 1 >= 5 then now() end,
         maj = now()
   where p.ae_id = new.ae_id and p.statut = 'actif'
     and (p.bien_id is null or p.bien_id = new.bien_id)
     and p.dernier_reproche < coalesce(new.started_at, now());
  return new;
end $$;
drop trigger if exists trg_pa_mission_terminee on public.mission_terrain;
create trigger trg_pa_mission_terminee after insert or update of statut on public.mission_terrain
  for each row execute function public._pa_mission_terminee();

-- AE : ses points pour une mission (bien de la mission + généraux), 5 max, récurrents puis récents d'abord.
create or replace function public.points_attention_mission(p_mission_id uuid)
returns table (id uuid, libelle text, occurrences integer, missions_ok integer, ce_bien boolean)
language plpgsql stable security definer set search_path = public as $$
declare m mission_menage;
begin
  m := _terrain_mission_check(p_mission_id);
  return query
    select p.id, p.libelle, p.occurrences, p.missions_ok, p.bien_id is not null
      from ae_point_attention p
     where p.ae_id = m.ae_id and p.statut = 'actif' and (p.bien_id is null or p.bien_id = m.bien_id)
     order by p.occurrences desc, p.dernier_reproche desc
     limit 5;
end $$;
revoke all on function public.points_attention_mission(uuid) from public, anon;
grant execute on function public.points_attention_mission(uuid) to authenticated;

-- AE : coche (non bloquante) d'un point pendant la mission en cours.
create or replace function public.point_attention_cocher(p_mission_id uuid, p_point_id uuid, p_coche boolean)
returns public.mission_terrain language plpgsql security definer set search_path = public as $$
declare m mission_menage; t mission_terrain;
begin
  m := _terrain_mission_check(p_mission_id);
  if not exists (select 1 from ae_point_attention where id = p_point_id and ae_id = m.ae_id) then raise exception 'point_introuvable'; end if;
  update mission_terrain set
    points_coches = case when p_coche then points_coches || jsonb_build_object(p_point_id::text, now())
                         else points_coches - p_point_id::text end,
    updated_at = now()
  where mission_id = p_mission_id and ended_at is null
  returning * into t;
  if not found then raise exception 'mission_non_en_cours'; end if;
  return t;
end $$;
revoke all on function public.point_attention_cocher(uuid, uuid, boolean) from public, anon;
grant execute on function public.point_attention_cocher(uuid, uuid, boolean) to authenticated;

-- Bureau : ajout manuel (même dédoublonnage) et changement de statut (✅ acquis / ✕ retiré / réactivé).
create or replace function public.point_attention_ajouter_manuel(p_ae_id uuid, p_bien_id uuid, p_libelle text)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not (auth_user_is_bureau() or auth_user_is_staff()) then raise exception 'acces_refuse'; end if;
  if length(trim(coalesce(p_libelle, ''))) < 3 then raise exception 'libelle_vide'; end if;
  return _point_attention_ajouter(p_ae_id, p_bien_id, p_libelle, 'manuel', null);
end $$;
revoke all on function public.point_attention_ajouter_manuel(uuid, uuid, text) from public, anon;
grant execute on function public.point_attention_ajouter_manuel(uuid, uuid, text) to authenticated;

create or replace function public.point_attention_statut(p_id uuid, p_statut text)
returns public.ae_point_attention language plpgsql security definer set search_path = public as $$
declare p ae_point_attention;
begin
  if not (auth_user_is_bureau() or auth_user_is_staff()) then raise exception 'acces_refuse'; end if;
  if p_statut not in ('actif', 'acquis', 'retire') then raise exception 'statut_invalide'; end if;
  update ae_point_attention set statut = p_statut,
         acquis_le = case when p_statut = 'acquis' then now() end,
         acquis_par = case when p_statut = 'acquis' then auth.uid() end,
         missions_ok = case when p_statut = 'actif' then 0 else missions_ok end,
         maj = now()
   where id = p_id returning * into p;
  if not found then raise exception 'point_introuvable'; end if;
  return p;
end $$;
revoke all on function public.point_attention_statut(uuid, text) from public, anon;
grant execute on function public.point_attention_statut(uuid, text) to authenticated;

-- Source 3 : avis voyageurs. Mémoire des avis traités (un seul appel IA par avis).
create table if not exists public.ae_point_attention_avis (
  review_id  uuid primary key references public.reservation_review(id) on delete cascade,
  ae_id      uuid references public.auto_entrepreneur(id) on delete set null,
  bien_id    uuid,
  consignes  jsonb not null default '[]'::jsonb,
  statut     text not null check (statut in ('ok', 'vide', 'erreur')),
  modele     text,
  traite_le  timestamptz not null default now()
);
alter table public.ae_point_attention_avis enable row level security;
drop policy if exists ae_point_attention_avis_select on public.ae_point_attention_avis;
create policy ae_point_attention_avis_select on public.ae_point_attention_avis for select to authenticated
  using (auth_user_is_bureau());

-- Avis à traiter : note propreté < 5, un commentaire, attribué à une AE, reçu depuis le 01/09/2026, pas encore traité.
create or replace function public.points_attention_avis_a_traiter(p_limit integer default 30)
returns table (review_id uuid, ae_id uuid, bien_id uuid, note numeric, comment text, private_feedback text)
language sql stable security definer set search_path = public as $$
  select a.review_id, a.ae_id, a.bien_id, a.note, nullif(trim(a.comment), ''), nullif(trim(a.private_feedback), '')
    from _avis_proprete_attribues('2026-06-01') a
   where a.ae_id is not null and a.note < 5
     and coalesce(a.submitted_at, a.arrival_date::timestamptz) >= '2026-09-01'
     and (nullif(trim(a.comment), '') is not null or nullif(trim(a.private_feedback), '') is not null)
     and not exists (select 1 from ae_point_attention_avis t where t.review_id = a.review_id)
   order by a.submitted_at nulls last
   limit greatest(1, least(p_limit, 100));
$$;
revoke all on function public.points_attention_avis_a_traiter(integer) from public, anon, authenticated;
grant execute on function public.points_attention_avis_a_traiter(integer) to service_role;

-- Enregistre le résultat IA d'un avis (idempotent) et crée/renforce les points. Renvoie le nombre de points touchés.
create or replace function public.points_attention_avis_enregistrer(p_review_id uuid, p_ae_id uuid, p_bien_id uuid,
  p_consignes jsonb, p_statut text, p_modele text)
returns integer language plpgsql security definer set search_path = public as $$
declare c text; n int := 0;
begin
  insert into ae_point_attention_avis (review_id, ae_id, bien_id, consignes, statut, modele)
  values (p_review_id, p_ae_id, p_bien_id, coalesce(p_consignes, '[]'::jsonb), p_statut, p_modele)
  on conflict (review_id) do nothing;
  if not found or p_statut <> 'ok' then return 0; end if;
  for c in select jsonb_array_elements_text(p_consignes) limit 2 loop
    if _point_attention_ajouter(p_ae_id, p_bien_id, c, 'avis', p_review_id::text) is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function public.points_attention_avis_enregistrer(uuid, uuid, uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.points_attention_avis_enregistrer(uuid, uuid, uuid, jsonb, text, text) to service_role;

-- Reprise de l'existant : cartes « à corriger » déjà envoyées et contrôles « à reprendre ».
do $$
declare r record;
begin
  if not exists (select 1 from ae_point_attention) then
    for r in select a.id, a.texte, mm.ae_id, mm.bien_id from video_annotation a join mission_menage mm on mm.id = a.mission_id
              where a.type = 'corriger' and a.lot_id is not null and length(trim(a.texte)) >= 2 order by a.created_at loop
      perform _point_attention_ajouter(r.ae_id, r.bien_id, r.texte, 'video', r.id::text);
    end loop;
    for r in select mission_id, ae_id, bien_id, controle_note from mission_terrain where controle_statut = 'a_reprendre' order by controle_at loop
      perform _point_attention_ajouter(r.ae_id, r.bien_id, r.controle_note, 'controle', r.mission_id::text);
    end loop;
  end if;
end $$;
