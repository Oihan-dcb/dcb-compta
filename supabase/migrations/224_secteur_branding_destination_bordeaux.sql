-- 224_secteur_branding_destination_bordeaux.sql
-- Sous-marque théorique "Destination Bordeaux" (09/09/2026, demande Oïhan) : une identité
-- d'affichage rattachée aux biens `secteur IN ('bordeaux','bassin-arcachon')`, SANS toucher
-- à `bien.agence` (reste 'dcb' partout — facturation/Evoliz/séquestre inchangés).
--
-- À NE PAS CONFONDRE avec `agency_config.agence='bordeaux'` (ligne existante depuis 04/2026) :
-- celle-ci est réservée à la vraie scission DBDX future — entité de facturation indépendante,
-- IBAN/Evoliz propres, cf. project_bdx_migration. La sous-marque ci-dessous est un habillage
-- théorique/UI uniquement, pas une entité comptable.

create table if not exists secteur_branding (
  id            text primary key,        -- ex. 'destination-bordeaux'
  label         text not null,           -- 'Destination Bordeaux'
  secteurs      text[] not null,         -- secteurs bien.secteur couverts par cette sous-marque
  tagline       text,                    -- ex. "L'art de recevoir à Bordeaux" (déjà utilisé tel quel dans mandat.html)
  brand_color   text,
  logo_storage_path text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table secteur_branding enable row level security;
drop policy if exists staff_all_secteur_branding on secteur_branding;
create policy staff_all_secteur_branding on secteur_branding for all to authenticated
  using (auth_user_is_staff()) with check (auth_user_is_staff());

insert into secteur_branding (id, label, secteurs, tagline)
values ('destination-bordeaux', 'Destination Bordeaux', array['bordeaux','bassin-arcachon'], 'L''art de recevoir à Bordeaux')
on conflict (id) do nothing;
