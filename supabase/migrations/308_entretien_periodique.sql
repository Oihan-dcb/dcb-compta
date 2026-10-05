-- 308 — Entretien périodique des biens (05/10/2026)
-- Ce qu'on nettoie « pas à chaque fois » (filtre lave-linge, bouches VMC, vitres…), fait par l'AE
-- pendant un ménage quand c'est dû. Trois tables :
--   entretien_type        catalogue (fréquence par défaut en jours ET/OU en séjours, durée estimée)
--   bien_entretien_plan   ce qui s'applique à un bien (fréquence/durée ajustables)
--   bien_entretien_fait   journal des passages (fait | impossible + raison), mission et AE
-- « Dernière fois » = calculée depuis le journal (jamais stockée). Couleur : rouge si le délai est
-- dépassé (jours OU séjours, au premier atteint), orange à 80 %, vert sinon.
-- Anti « mur de rouge » : à la création d'un plan, reference_initiale est tirée au hasard dans les
-- 70 % de la période → les premières échéances s'étalent au lieu d'arriver toutes le même jour.
-- Indépendant de bien_maintenance (entretiens techniques / prestataires de PageEntretiens).
create table if not exists public.entretien_type (
  id                  uuid primary key default gen_random_uuid(),
  nom                 text not null unique,
  icone               text not null default '🧽',
  periodicite_jours   integer check (periodicite_jours > 0),
  periodicite_sejours integer check (periodicite_sejours > 0),
  duree_min           integer not null default 15,
  consigne            text,
  ordre               integer not null default 0,
  actif               boolean not null default true,
  check (periodicite_jours is not null or periodicite_sejours is not null)
);

create table if not exists public.bien_entretien_plan (
  id                  uuid primary key default gen_random_uuid(),
  bien_id             uuid not null references public.bien(id) on delete cascade,
  entretien_type_id   uuid not null references public.entretien_type(id) on delete restrict,
  periodicite_jours   integer check (periodicite_jours > 0),
  periodicite_sejours integer check (periodicite_sejours > 0),
  duree_min           integer,
  note                text,
  actif               boolean not null default true,
  reference_initiale  date,
  created_by          uuid default auth.uid(),
  created_at          timestamptz not null default now(),
  unique (bien_id, entretien_type_id)
);

create table if not exists public.bien_entretien_fait (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references public.bien_entretien_plan(id) on delete cascade,
  bien_id     uuid not null references public.bien(id) on delete cascade,
  mission_id  uuid references public.mission_menage(id) on delete set null,
  ae_id       uuid references public.auto_entrepreneur(id) on delete set null,
  statut      text not null default 'fait' check (statut in ('fait', 'impossible')),
  raison      text,
  photo_url   text,
  fait_le     timestamptz not null default now(),
  created_by  uuid default auth.uid()
);
create index if not exists bien_entretien_fait_plan_idx on public.bien_entretien_fait (plan_id, fait_le desc);

-- Étalement de la première échéance
create or replace function public._entretien_plan_reference() returns trigger
language plpgsql set search_path = public as $$
declare p int;
begin
  if new.reference_initiale is null then
    select coalesce(new.periodicite_jours, t.periodicite_jours, 30) into p from entretien_type t where t.id = new.entretien_type_id;
    new.reference_initiale := current_date - floor(random() * p * 0.7)::int;
  end if;
  return new;
end $$;
drop trigger if exists trg_entretien_plan_reference on public.bien_entretien_plan;
create trigger trg_entretien_plan_reference before insert on public.bien_entretien_plan
  for each row execute function public._entretien_plan_reference();

alter table public.entretien_type enable row level security;
alter table public.bien_entretien_plan enable row level security;
alter table public.bien_entretien_fait enable row level security;
drop policy if exists entretien_type_select on public.entretien_type;
create policy entretien_type_select on public.entretien_type for select to authenticated using (auth_user_is_internal());
drop policy if exists entretien_type_write on public.entretien_type;
create policy entretien_type_write on public.entretien_type for all to authenticated
  using (auth_user_peut_editer_fiches()) with check (auth_user_peut_editer_fiches());
drop policy if exists bien_entretien_plan_select on public.bien_entretien_plan;
create policy bien_entretien_plan_select on public.bien_entretien_plan for select to authenticated using (
  (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
  or (auth_user_is_internal() and not auth_user_is_staff()));
drop policy if exists bien_entretien_plan_write on public.bien_entretien_plan;
create policy bien_entretien_plan_write on public.bien_entretien_plan for all to authenticated
  using (auth_user_peut_editer_fiches()) with check (auth_user_peut_editer_fiches());
drop policy if exists bien_entretien_fait_select on public.bien_entretien_fait;
create policy bien_entretien_fait_select on public.bien_entretien_fait for select to authenticated using (
  (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
  or (auth_user_is_internal() and not auth_user_is_staff()));
-- Journal en ajout seulement : l'AE n'écrit que pour lui-même ; le bureau / managers pour tous.
drop policy if exists bien_entretien_fait_insert on public.bien_entretien_fait;
create policy bien_entretien_fait_insert on public.bien_entretien_fait for insert to authenticated with check (
  (ae_id is not null and auth_user_owns_ae(ae_id)) or auth_user_peut_editer_fiches());

-- Statut calculé (lu par le portail ET PowerHouse : une seule règle).
create or replace function public.entretien_statut(p_bien_ids uuid[])
returns table (
  plan_id uuid, bien_id uuid, entretien_type_id uuid, nom text, icone text, consigne text,
  periodicite_jours integer, periodicite_sejours integer, duree_min integer,
  dernier_fait timestamptz, dernier_par text, jours_depuis integer, sejours_depuis integer,
  ratio numeric, couleur text, jamais_fait boolean
) language sql stable security definer set search_path = public as $$
  with p as (
    select pl.*, t.nom, t.icone, t.consigne,
      coalesce(pl.periodicite_jours, t.periodicite_jours) pj,
      coalesce(pl.periodicite_sejours, t.periodicite_sejours) ps,
      coalesce(pl.duree_min, t.duree_min) dm
    from bien_entretien_plan pl join entretien_type t on t.id = pl.entretien_type_id
    where pl.actif and t.actif and pl.bien_id = any(p_bien_ids)
      and (auth_user_is_internal())
  ), d as (
    select p.*, f.fait_le, a.prenom,
      coalesce(f.fait_le::date, p.reference_initiale) ref
    from p
    left join lateral (select fe.fait_le, fe.ae_id from bien_entretien_fait fe
                        where fe.plan_id = p.id and fe.statut = 'fait' order by fe.fait_le desc limit 1) f on true
    left join auto_entrepreneur a on a.id = f.ae_id
  ), c as (
    select d.*, (current_date - d.ref) jd,
      (select count(*)::int from reservation r where r.bien_id = d.bien_id and r.final_status = 'accepted'
          and r.departure_date > d.ref and r.departure_date <= current_date) sd
    from d
  )
  select c.id, c.bien_id, c.entretien_type_id, c.nom, c.icone, c.consigne, c.pj, c.ps, c.dm,
    c.fait_le, c.prenom, c.jd, c.sd,
    round(greatest(case when c.pj is not null then c.jd::numeric / c.pj else 0 end,
                   case when c.ps is not null then c.sd::numeric / c.ps else 0 end), 2),
    case when greatest(case when c.pj is not null then c.jd::numeric / c.pj else 0 end,
                       case when c.ps is not null then c.sd::numeric / c.ps else 0 end) >= 1 then 'rouge'
         when greatest(case when c.pj is not null then c.jd::numeric / c.pj else 0 end,
                       case when c.ps is not null then c.sd::numeric / c.ps else 0 end) >= 0.8 then 'orange'
         else 'vert' end,
    c.fait_le is null
  from c;
$$;
revoke all on function public.entretien_statut(uuid[]) from public, anon;
grant execute on function public.entretien_statut(uuid[]) to authenticated;

insert into public.entretien_type (nom, icone, periodicite_jours, periodicite_sejours, duree_min, consigne, ordre) values
  ('Bouches VMC', '🌀', 60, null, 15, 'Démonter les grilles, laver à l''eau savonneuse, sécher, remonter.', 1),
  ('Filtre lave-linge', '🧺', 30, 8, 10, 'Trappe en bas à droite : poser une serpillière, dévisser, vider, rincer le filtre.', 2),
  ('Filtre lave-vaisselle', '🍽', 30, 8, 10, 'Retirer le filtre au fond de la cuve, rincer sous l''eau chaude.', 3),
  ('Vitres et baies (intérieur + extérieur)', '🪟', 30, null, 30, 'Savon noir si embruns, puis vinaigre et microfibre sèche.', 4),
  ('Joints douche / anti-moisissure', '🚿', 30, null, 15, 'Anti-moisissure sur les joints uniquement, laisser agir, rincer.', 5),
  ('Détartrage robinets et pommeaux', '💧', 30, null, 10, 'Vinaigre blanc chaud, laisser tremper le pommeau.', 6),
  ('Frigo à fond (+ congélateur)', '❄️', 60, null, 20, 'Vider, retirer les bacs, laver, dégivrer si besoin.', 7),
  ('Four, plaques et hotte à fond', '🍳', 30, null, 20, 'Savon noir, filtre de hotte au lave-vaisselle si métallique.', 8),
  ('Sous les lits et derrière les meubles', '🛏', 30, null, 20, 'Décaler, aspirer, laver le sol.', 9),
  ('Matelas aspirés / retournés', '🛌', 90, null, 20, 'Aspirer les deux faces, retourner tête-pieds.', 10),
  ('Rideaux et voilages', '🪟', 180, null, 30, 'Décrocher, laver, raccrocher humides.', 11),
  ('Mobilier extérieur et terrasse', '🌿', 30, null, 20, 'Brosser, savon noir, rincer.', 12),
  ('Bacs à poubelle', '🗑', 30, null, 10, 'Laver et désinfecter les bacs.', 13),
  ('Barbecue / plancha', '🔥', 30, 6, 15, 'Gratter, dégraisser, huiler la plancha.', 14)
on conflict (nom) do nothing;
