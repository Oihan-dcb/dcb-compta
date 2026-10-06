-- 338 — reservation.sans_menage_motif (06/10/2026) : soupape de l'alerte alerte-sejour-sans-menage.
-- Un séjour qui n'appelle légitimement aucune mission de ménage (ménage fait par le propriétaire,
-- prolongation, bien rendu…) porte un motif → ignoré par l'alerte.
alter table public.reservation add column if not exists sans_menage_motif text;
comment on column public.reservation.sans_menage_motif is 'Séjour qui n''appelle légitimement aucune mission de ménage (ménage fait par le propriétaire, prolongation, bien rendu…) : renseigné = ignoré par l''alerte alerte-sejour-sans-menage (06/10/2026).';
