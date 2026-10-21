-- 521 — Relecture des guides d'arrivée (21/10/2026, objectif d'Oïhan : « finir les guides », relire et publier vite
-- sans dépendre de Claude).
--
-- Journal des décisions de relecture, une ligne par geste (PowerHouse › Biens › 🗝 Guides d'arrivée › Relecture) :
--   a_corriger : commentaire libre d'Oïhan ; le bien passe « à corriger » et apparaît dans Accueil › À faire › Vérifier
--                tant qu'aucun geste plus récent (corrige / publie) n'existe ;
--   corrige    : la correction est faite, le bien revient dans la file de relecture ;
--   publie     : publication (portail + page WordPress) faite par le clic d'Oïhan, avec l'instantané du contrôle
--                automatique final (prêt / réserves) au moment du clic.
-- L'historique « qui a publié quand » est aussi dans bien_arrivee (publie_le, publie_par_label) ; ce journal ajoute le
-- contrôle et les commentaires. Aucun code d'accès n'y est jamais écrit (le contrôle ne contient que des libellés).
-- RLS activée sans politique : accès service seulement (api/bien-arrivee.js, api/_aFaire.js), comme 501.

begin;

create table if not exists public.bien_arrivee_relecture (
  id uuid primary key default gen_random_uuid(),
  bien_id uuid not null references public.bien(id) on delete cascade,
  arrivee_id uuid references public.bien_arrivee(id) on delete set null,
  version integer,
  action text not null check (action in ('a_corriger', 'corrige', 'publie')),
  commentaire text check (commentaire is null or length(commentaire) <= 2000),
  controle jsonb,
  par uuid,
  par_label text,
  cree_le timestamptz not null default now()
);

create index if not exists bien_arrivee_relecture_bien_idx on public.bien_arrivee_relecture (bien_id, cree_le desc);

alter table public.bien_arrivee_relecture enable row level security;

comment on table public.bien_arrivee_relecture is 'Relecture des guides d''arrivée (521) : à corriger (commentaire) / corrigé / publié (contrôle final). Service seulement.';

commit;
