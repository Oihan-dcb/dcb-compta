-- Migration 224 : montants FMEN/AUTO saisis manuellement pour un ajustement qualifié 'menage'.
--
-- Un ajustement Hospitable qualifié "ménage/extra" (ex. recouche remboursée par Airbnb)
-- ne doit avoir AUCUN impact sur le propriétaire (LOY inchangé) — tout revient à DCB,
-- réparti manuellement entre FMEN (marge DCB) et AUTO (provision AE), car le calcul
-- automatique (pro-rata du host_service_fee) est conçu pour le ménage de fin de séjour
-- standard, pas pour un événement ad-hoc dont le coût réel est connu de l'utilisateur.

alter table public.reservation_ajustement add column if not exists montant_fmen integer;
alter table public.reservation_ajustement add column if not exists montant_auto integer;
