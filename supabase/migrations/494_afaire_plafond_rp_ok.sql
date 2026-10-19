-- 494 : « OK » sur les alertes de plafond de nuits des résidences principales dans À faire (19/10/2026, demande Oïhan).
-- « OK » = Oïhan a pris connaissance : la ligne disparaît et ne revient que si la situation change. Empreinte =
-- bien_id|annee|nuits|plafond (api/_aFaire.js empreintePlafond), même mécanisme que les demandes Airbnb (489).
alter table public.afaire_traite drop constraint if exists afaire_traite_genre_check;
alter table public.afaire_traite add constraint afaire_traite_genre_check check (genre in ('demande_airbnb', 'plafond_rp'));
alter table public.afaire_traite drop constraint if exists afaire_traite_statut_check;
alter table public.afaire_traite add constraint afaire_traite_statut_check check (statut in ('expiree', 'traitee', 'vu'));
