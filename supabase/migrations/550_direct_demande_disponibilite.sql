-- 550 : demandes de DISPONIBILITÉ des logements gérés d'un site (22/10/2026, site lauian-immo.com).
-- Biens hors location / vitrine (non réservables ni payables en ligne) : le bloc de leur page envoie une demande dans le flux
-- existant direct_demande (source « site »), SANS prix (aucun devis calculé) → motif_demande = 'disponibilite', total_centimes NULL.
-- Seule la contrainte « demande du site complète » change : le prix reste obligatoire pour toutes les autres demandes du site.
-- Retour arrière : supprimer/compléter les lignes motif 'disponibilite' sans prix, puis remettre la contrainte de 545.
alter table public.direct_demande drop constraint if exists direct_demande_site_complet;
alter table public.direct_demande add constraint direct_demande_site_complet check (source = 'mail' or (bien_id is not null and arrivee is not null
  and depart is not null and adultes is not null and voyageur_prenom is not null and voyageur_nom is not null
  and (total_centimes is not null or motif_demande = 'disponibilite') and consentement is not null));
comment on column public.direct_demande.motif_demande is 'Raisons du « sur demande » (liste séparée par des virgules) ; ''disponibilite'' = demande de disponibilité d''un logement géré non réservable en ligne (550, sans prix)';
