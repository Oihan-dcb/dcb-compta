-- 446 — Savoir : affichage dans le portail voyageur (16/10/2026, décision Oïhan).
-- Le portail voyageur (/sejour/<jeton>, PowerHouse) n'affiche par défaut que les infos PRATIQUES ; ce qui répond à un
-- problème ou une plainte (bruit, panne, défaut, nuisances…) reste pour l'IA. Réglage par élément :
--   auto (défaut) = règle par catégorie + détection de mots sensibles (api/_portailSavoir.js) ; oui = toujours ; non = jamais.
-- N'affecte PAS ce que lit l'IA (bien_savoir.public inchangé, _savoirBien.js n'utilise pas cette colonne).
alter table public.bien_savoir
  add column if not exists portail_affichage text not null default 'auto'
  check (portail_affichage in ('auto', 'oui', 'non'));
comment on column public.bien_savoir.portail_affichage is
  'Portail voyageur : auto (catégorie pratique + pas de mot sensible) / oui (toujours) / non (jamais). Sans effet sur l''IA.';
