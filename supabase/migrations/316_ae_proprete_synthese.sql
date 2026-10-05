-- 316 — Résumé IA des commentaires ménage par AE (05/10/2026)
-- Cache de la synthèse générée par dcb-planning api/proprete-synthesis.js (bouton « ✨ Résumé IA »
-- de la fiche staff PowerHouse) — régénération manuelle, pas de cron (coût maîtrisé), même modèle
-- que bien_review_synthesis. Écriture service_role uniquement.
create table if not exists public.ae_proprete_synthese (
  ae_id             uuid primary key references public.auto_entrepreneur(id) on delete cascade,
  resume            text,
  points_forts      text[] not null default '{}',
  axes_amelioration text[] not null default '{}',
  nb_avis           integer,
  moyenne           numeric,
  depuis            date,
  generated_at      timestamptz not null default now()
);
alter table public.ae_proprete_synthese enable row level security;
drop policy if exists ae_proprete_synthese_select on public.ae_proprete_synthese;
create policy ae_proprete_synthese_select on public.ae_proprete_synthese for select to authenticated
  using (auth_user_is_staff() or auth_user_is_bureau() or auth_user_owns_ae(ae_id));
