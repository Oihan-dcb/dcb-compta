-- 307 — Checklists terrain par type de mission (05/10/2026)
-- checklist_item : points génériques par type (bien_id NULL) + points propres à un bien.
-- Les coches d'une mission vivent dans mission_terrain.checklist (jsonb {item_id: horodatage}),
-- écrites via la RPC terrain_cocher (même modèle : pas d'écriture directe sur mission_terrain).
-- Non bloquant : « Terminé » avec des points non cochés demande juste une confirmation.
-- Points génériques « ménage départ » tirés de la Procédure ménage DCB (toolbox_procedures).
create table if not exists public.checklist_item (
  id           uuid primary key default gen_random_uuid(),
  type_terrain text not null check (type_terrain in ('menage', 'check_in', 'recouche', 'demande_menage', 'technique')),
  bien_id      uuid references public.bien(id) on delete cascade,
  libelle      text not null,
  ordre        integer not null default 0,
  actif        boolean not null default true,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists checklist_item_idx on public.checklist_item (type_terrain, bien_id) where actif;
alter table public.checklist_item enable row level security;
drop policy if exists checklist_item_select on public.checklist_item;
create policy checklist_item_select on public.checklist_item for select to authenticated using (auth_user_is_internal());
drop policy if exists checklist_item_write on public.checklist_item;
create policy checklist_item_write on public.checklist_item for all to authenticated
  using (auth_user_peut_editer_fiches()) with check (auth_user_peut_editer_fiches());

alter table public.mission_terrain add column if not exists checklist jsonb not null default '{}'::jsonb;

create or replace function public.terrain_cocher(p_mission_id uuid, p_item_id uuid, p_coche boolean)
returns public.mission_terrain
language plpgsql security definer set search_path = public as $$
declare t mission_terrain;
begin
  perform _terrain_mission_check(p_mission_id);
  update mission_terrain set
    checklist = case when p_coche then checklist || jsonb_build_object(p_item_id::text, now())
                     else checklist - p_item_id::text end,
    updated_at = now()
  where mission_id = p_mission_id and ended_at is null
  returning * into t;
  if not found then raise exception 'mission_non_en_cours'; end if;
  return t;
end $$;
revoke all on function public.terrain_cocher(uuid, uuid, boolean) from public, anon;
grant execute on function public.terrain_cocher(uuid, uuid, boolean) to authenticated;

insert into public.checklist_item (type_terrain, libelle, ordre)
select * from (values
  ('menage', 'WC nettoyés, brosse rincée', 1),
  ('menage', 'Bondes de douche / baignoire démontées et nettoyées', 2),
  ('menage', 'Miroirs, vitres et chromes lustrés au vinaigre', 3),
  ('menage', 'Frigo, four, micro-ondes, lave-vaisselle vidés et propres', 4),
  ('menage', 'Lits faits avec linge propre, sur-odorant sur oreillers et rideaux', 5),
  ('menage', 'Surfaces et façades de meubles, de haut en bas', 6),
  ('menage', 'Sols aspirés et lavés', 7),
  ('menage', 'Poubelles vidées + 2 sacs neufs', 8),
  ('menage', 'Consommables complets (sel, poivre, sucre, huile, café, thé, savons, PQ ×2, éponge)', 9),
  ('menage', 'Placards et tiroirs rangés joliment', 10),
  ('menage', 'Chauffage à 15 °C / clim coupée, lumières éteintes, fenêtres fermées', 11),
  ('check_in', 'Toutes les lumières et ampoules fonctionnent', 1),
  ('check_in', 'Chauffage / clim réglé selon la saison', 2),
  ('check_in', 'Wifi connecté et fonctionnel', 3),
  ('check_in', 'Bonne odeur, logement aéré puis fenêtres fermées', 4),
  ('check_in', 'Poubelles vides', 5),
  ('check_in', 'Lits et serviettes en place', 6),
  ('check_in', 'Consommables complets', 7),
  ('check_in', 'Accueil prêt (clés, livret, cadeau)', 8),
  ('recouche', 'Linge prévu changé', 1),
  ('recouche', 'Poubelles vidées', 2),
  ('recouche', 'Salle de bain et WC rafraîchis', 3),
  ('recouche', 'Rien déplacé dans les affaires des voyageurs', 4),
  ('demande_menage', 'Zone demandée nettoyée', 1),
  ('demande_menage', 'Poubelles vidées', 2),
  ('demande_menage', 'Sols aspirés et lavés', 3),
  ('technique', 'Photo avant intervention', 1),
  ('technique', 'Intervention réalisée et testée', 2),
  ('technique', 'Photo après intervention', 3),
  ('technique', 'Zone de travail nettoyée', 4)
) v(type_terrain, libelle, ordre)
where not exists (select 1 from public.checklist_item where bien_id is null);
