-- 533 — Brouillons des remarques sur les vidéos terrain (22/10/2026).
-- Avant : les remarques pas encore envoyées n'existaient que dans le lecteur ouvert ; fermer le panneau
-- « ⚡ Agir » (clic à côté) ou un échec d'envoi de capture les perdait toutes (11 remarques pour Léa, BGH).
-- Désormais chaque remarque est enregistrée dès sa création (capture envoyée tout de suite chez B2),
-- reste « en attente » jusqu'à « Envoyer », et se retrouve sur n'importe quel appareil.
-- Réservé au bureau : les AE ne voient jamais un brouillon (video_annotation reste la seule table qu'ils lisent).

create table if not exists public.video_annotation_brouillon (
  id             uuid primary key default gen_random_uuid(),
  mission_id     uuid not null references public.mission_menage(id) on delete cascade,
  media_id       uuid,
  t_secondes     numeric not null default 0,
  type           text not null default 'corriger' check (type in ('bravo','corriger','question')),
  texte          text,
  image_url      text,
  auteur_user_id uuid default auth.uid(),
  created_at     timestamptz not null default now()
);
create index if not exists video_annotation_brouillon_mission_idx on public.video_annotation_brouillon (mission_id, t_secondes);

alter table public.video_annotation_brouillon enable row level security;

drop policy if exists video_annotation_brouillon_bureau on public.video_annotation_brouillon;
create policy video_annotation_brouillon_bureau on public.video_annotation_brouillon
  for all to authenticated
  using (auth_user_is_bureau())
  with check (auth_user_is_bureau());
