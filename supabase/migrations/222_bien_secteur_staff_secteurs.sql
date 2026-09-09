-- 222_bien_secteur_staff_secteurs.sql
-- Phase 1 (accès staff scopé géographique — dossier Léa Escudier / Bordeaux+Bassin, audit 09/09/2026).
-- Purement additif : aucune policy RLS ne lit encore ces colonnes, comportement inchangé pour tout le monde.

-- ── bien.secteur ──────────────────────────────────────────────────────────
-- Source de vérité déclarative pour "où est ce bien géographiquement", à terme utilisée
-- à la place des regex ville/zone de api/bien-pret.js (managerRoomName), qui restent
-- inchangées pour l'instant (phase 3).
alter table bien
  add column if not exists secteur text not null default 'cote-basque';

alter table bien
  drop constraint if exists bien_secteur_chk;
alter table bien
  add constraint bien_secteur_chk check (secteur in ('cote-basque','bordeaux','bassin-arcachon'));

create index if not exists bien_secteur_idx on bien(secteur);

-- Backfill : même logique que managerRoomName (bien-pret.js:60-67), avec le trou "Bouscat" comblé
-- (LVH - BDX - Le bouscat était mal routé en chat "Managers Côte Basque" jusqu'ici, cf. audit 09/09/2026).
-- Arcachon/Bassin d'abord (priorité), puis Bordeaux uniquement sur ce qui reste en défaut.
update bien set secteur = 'bassin-arcachon'
where (coalesce(zone,'') || ' ' || coalesce(ville,'')) ~* '\y(arcachon|la teste|pyla|pilat|ar[eè]s|andernos|l[eè]ge|cap ferret|gujan|biganos)\y';

update bien set secteur = 'bordeaux'
where secteur = 'cote-basque'
  and (
    (coalesce(zone,'') || ' ' || coalesce(ville,'')) ~* '\y(bordeaux|bouscat|m[eé]rignac|pessac|talence|b[eè]gles|bruges|cenon|floirac)\y'
    or agence in ('dbdx','bordeaux')
  );

-- ── auto_entrepreneur.secteurs ───────────────────────────────────────────
-- NULL = accès à tous les secteurs (= comportement actuel, inchangé pour tout le monde).
-- Non lu par aucune policy RLS pour l'instant (branché en phase 2 via my_scoped_bien_ids()).
alter table auto_entrepreneur
  add column if not exists secteurs text[];

comment on column auto_entrepreneur.secteurs is
  'NULL = accès à tous les secteurs (défaut, comportement inchangé). Tableau de valeurs parmi (cote-basque, bordeaux, bassin-arcachon) pour un accès staff scopé géographiquement. Pas encore lu par les policies RLS au 09/09/2026 (phase 1 additive).';
