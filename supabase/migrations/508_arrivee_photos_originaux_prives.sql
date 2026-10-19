-- 508 — Guide d'arrivée : éditeur de photo (flou, flèches) — les ORIGINAUX non floutés vont dans un bucket PRIVÉ,
-- jamais publiés (ni portail ni WordPress). Les photos ajoutées / annotées ne partent dans la Médiathèque WordPress
-- qu'à la PUBLICATION du guide (bien_arrivee_media_wp garde la correspondance stockage → média WP).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('arrivee-originaux', 'arrivee-originaux', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
alter table public.bien_arrivee_photo add column if not exists original_prive text;   -- chemin dans arrivee-originaux
alter table public.bien_arrivee_photo add column if not exists source_url text;       -- photo d'origine d'une version annotée
