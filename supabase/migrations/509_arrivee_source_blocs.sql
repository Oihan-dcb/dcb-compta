-- 509 — Guide d'arrivée « conversion fidèle » : la page WP « Arrivée autonome » en blocs ordonnés (texte / image).
alter table public.bien_arrivee_source add column if not exists blocs jsonb not null default '[]'::jsonb;
comment on column public.bien_arrivee_source.blocs is 'Page WP dans l''ordre : [{t:"texte",texte,lang}|{t:"image",url,alt}] — textes caviardés (aucun code) ; base de la conversion fidèle (509).';
