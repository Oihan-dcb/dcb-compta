-- 313 — Profil AE (portail) + « Mes produits » (05/10/2026)
-- 1. besoin_sac.pour_ae_id : besoin rattaché à un AE (produits de ménage qu'il arrive à finir :
--    vinaigre blanc, savon noir, déboucheur… — liste de la Procédure ménage DCB) au lieu d'un bien.
--    Même cycle a_preparer → dans_sac (préparé par le bureau) → depose (reçu par l'AE).
-- 2. mon_profil_proprete : la note propreté de l'AE connecté + la moyenne de l'équipe, SANS le
--    détail des collègues (stats_proprete_ae reste réservée au staff PowerHouse).
alter table public.besoin_sac alter column bien_id drop not null;
alter table public.besoin_sac add column if not exists pour_ae_id uuid references public.auto_entrepreneur(id) on delete cascade;
alter table public.besoin_sac drop constraint if exists besoin_sac_cible_chk;
alter table public.besoin_sac add constraint besoin_sac_cible_chk check (bien_id is not null or pour_ae_id is not null);
create index if not exists besoin_sac_ae_idx on public.besoin_sac (pour_ae_id) where pour_ae_id is not null and statut in ('a_preparer', 'dans_sac');

create or replace function public.mon_profil_proprete(p_depuis date default (current_date - 365))
returns table (ae_id uuid, nb_avis integer, moyenne numeric, moyenne_globale numeric, ecart numeric, notes_basses integer, nb_5 integer)
language sql stable security definer set search_path = public as $$
  with me as (select a.id from auto_entrepreneur a where a.ae_user_id = auth.uid() and a.actif limit 1),
       x as (select * from _avis_proprete_attribues(p_depuis) where ae_id is not null),
       g as (select avg(note) mg from x)
  select (select id from me), count(*)::int, round(avg(x.note), 2), round((select mg from g), 2),
         round(avg(x.note) - (select mg from g), 2),
         (count(*) filter (where x.note <= 3))::int, (count(*) filter (where x.note >= 5))::int
    from x where x.ae_id = (select id from me);
$$;
revoke all on function public.mon_profil_proprete(date) from public, anon;
grant execute on function public.mon_profil_proprete(date) to authenticated;
