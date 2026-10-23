-- 594 — Dispense de numéro d'enregistrement (meublé de tourisme).
-- Certains logements n'ont pas de numéro car ils ne sont pas des meublés de tourisme
-- (ex. ALAIA : appartement dans une résidence de tourisme, info Laura / Oïhan 23/10/2026).
-- Texte libre = motif de la dispense ; renseigné → plus d'alerte « numéro manquant »
-- (À régler, Mise en service, aperçu annonce) et pas de préremplissage depuis le site.

alter table public.bien add column if not exists numero_enregistrement_dispense text;

comment on column public.bien.numero_enregistrement_dispense is
  'Motif de dispense du numéro d''enregistrement (ex. « Résidence de tourisme »). Non nul = numéro non requis.';

update public.bien set numero_enregistrement_dispense = 'Résidence de tourisme'
 where code = 'ALAIA' and numero_enregistrement is null and numero_enregistrement_dispense is null;
