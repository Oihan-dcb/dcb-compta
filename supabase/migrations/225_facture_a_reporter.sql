-- Migration 225 : flag "à reporter" sur facture_evoliz — facture dont le total_ht est
-- devenu négatif (ex. ajustement réservation "hébergement"/"ménage" très négatif, faute
-- agence assumée intégralement) — ne doit pas être envoyée telle quelle à Evoliz (une
-- vraie facture ne peut pas avoir un total négatif), proposée pour report sur le mois suivant.

alter table public.facture_evoliz add column if not exists a_reporter boolean not null default false;
