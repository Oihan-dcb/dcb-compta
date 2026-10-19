-- 496 : avis hôte « mis en différé » AUTOMATIQUEMENT quand un signalement / une réclamation touche le séjour (19/10/2026, demande Oïhan :
-- « un signalement retarde l'envoi auto des commentaires »). api/cron-avis-differe.js, interrupteur Vercel AVIS_DIFFERE_AUTO=actif
-- (absent = ESSAI : rien n'est écrit chez Hospitable, seulement le journal). Ne touche JAMAIS un avis déjà programmé / modifié par
-- un humain (contenu ≠ 5★ automatique d'Hospitable, ou déjà programmé en fin de fenêtre).
alter table public.avis_hote_voyageur
  add column if not exists a_relire boolean not null default false,   -- mis en différé par l'automatisme : à relire avant la fin de la fenêtre
  add column if not exists auto_differe_le timestamptz;

create table if not exists public.avis_auto_journal (
  id               uuid primary key default gen_random_uuid(),
  review_id        text not null,
  reservation_code text,
  bien_id          uuid,
  mode             text not null check (mode in ('essai', 'reel')),
  action           text not null,          -- differe | ignore_humain | ignore_deja_differe | ignore_sans_probleme | erreur …
  motif            text,
  corps            jsonb,                  -- ce qui a été (ou aurait été) envoyé
  resultat         jsonb,
  notifie          text,
  cree_le          timestamptz not null default now()
);
create index if not exists avis_auto_journal_review on public.avis_auto_journal (review_id, cree_le desc);
alter table public.avis_auto_journal enable row level security;
comment on table public.avis_auto_journal is 'Journal de l''automatisme « avis mis en différé » (496) — essai et réel.';
