-- 453 : réglage par bien « mode de location » côté site / vente directe (16/10/2026, décision d'Oïhan).
--   null          = rien de particulier (déduit de statut_location / hors_location, comportement inchangé) ;
--   'saisonnier'  = saisonnier court (explicite) ;
--   'bail_mobilite' = proposé en BAIL MOBILITÉ (1 à 10 mois), pas en saisonnier court : dans la liste /reserver, carte
--                   « Moyenne durée · bail mobilité (1 à 10 mois) », sans prix ni dispo calculée, bouton « Nous contacter »,
--                   affichée seulement sans dates ou pour une recherche de 30 nuits ou plus ;
--   'vitrine'     = présenté sur le site sans réservation (jamais dans la liste des logements du site non publiés).
-- N'affecte NI statut_location (ménage, compta, conformité) NI Hospitable.
alter table public.bien add column if not exists mode_location_site text
  check (mode_location_site in ('saisonnier', 'bail_mobilite', 'vitrine'));
comment on column public.bien.mode_location_site is 'Mode de location présenté sur le site / vente directe : null = déduit du statut ; saisonnier | bail_mobilite (1 à 10 mois, « Nous contacter ») | vitrine (453, 16/10/2026)';
update public.bien set mode_location_site = 'bail_mobilite' where code in ('VILLA AGERREA', 'BORDEZIA') and mode_location_site is distinct from 'bail_mobilite';
