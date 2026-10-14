-- 419 — Accueil PowerHouse : grille LIBRE (14/10/2026, Oïhan : « ça se pousse à gauche, je veux que ce soit libre »).
-- Remplace la maçonnerie (ordre + taille) par une vraie grille de tableau de bord : chaque tuile a une position
-- (x = colonne 0-11, y = rangée ≥ 0) et une taille (w = largeur en colonnes 1-12, h = hauteur en rangées 2-60),
-- sur 12 colonnes, cases vides permises. Sur tablette / téléphone l'écran convertit en 1 ou 2 colonnes dans
-- l'ordre de lecture ; ordre_mobile = ordre téléphone propre au compte s'il l'a réglé (sinon null = ordre de lecture).
-- Même table, même RLS (414 : chacun ne voit / n'écrit que sa ligne). Ligne sans grille = ancienne disposition,
-- convertie à l'écran (et proposition « Appliquer la nouvelle disposition par défaut »).
alter table public.ph_accueil_disposition
  add column if not exists grille       jsonb,   -- {"aujourdhui": {"x":0,"y":0,"w":8,"h":12}, …}
  add column if not exists ordre_mobile jsonb;   -- ["aujourdhui", "demain", …] ou null

create or replace function public.ph_accueil_grille_ok(g jsonb)
returns boolean language sql immutable as $$
  select g is null or (jsonb_typeof(g) = 'object' and not exists (
    select 1 from jsonb_each(g) e
     where jsonb_typeof(e.value) <> 'object'
        or jsonb_typeof(e.value->'x') <> 'number' or jsonb_typeof(e.value->'y') <> 'number'
        or jsonb_typeof(e.value->'w') <> 'number' or jsonb_typeof(e.value->'h') <> 'number'
        or (e.value->>'x')::numeric not between 0 and 11
        or (e.value->>'w')::numeric not between 1 and 12
        or (e.value->>'x')::numeric + (e.value->>'w')::numeric > 12
        or (e.value->>'y')::numeric not between 0 and 2000
        or (e.value->>'h')::numeric not between 2 and 60))
$$;

alter table public.ph_accueil_disposition drop constraint if exists ph_accueil_dispo_grille_chk;
alter table public.ph_accueil_disposition add constraint ph_accueil_dispo_grille_chk check (public.ph_accueil_grille_ok(grille));
alter table public.ph_accueil_disposition drop constraint if exists ph_accueil_dispo_ordre_mobile_chk;
alter table public.ph_accueil_disposition add constraint ph_accueil_dispo_ordre_mobile_chk
  check (ordre_mobile is null or jsonb_typeof(ordre_mobile) = 'array');

comment on column public.ph_accueil_disposition.grille is 'Accueil grille libre (419) : {tuile: {x,y,w,h}} sur 12 colonnes, rangées de 22 px ; null = ancienne disposition (ordre).';
comment on column public.ph_accueil_disposition.ordre_mobile is 'Accueil grille libre (419) : ordre téléphone/tablette propre au compte ; null = ordre de lecture de la grille.';
