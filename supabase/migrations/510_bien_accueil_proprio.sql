-- 510 — Guide d'arrivée : biens où le PROPRIÉTAIRE accueille lui-même les voyageurs (20/10/2026, décision d'Oïhan).
-- Exception à la règle « jamais de coordonnées de propriétaire dans le guide » : si accueil_proprio = true, le contact
-- du propriétaire (ex. WhatsApp) présent dans les sources est gardé dans le guide d'arrivée.
alter table public.bien add column if not exists accueil_proprio boolean not null default false;
comment on column public.bien.accueil_proprio is 'Le propriétaire accueille lui-même les voyageurs (remise des clés en personne) : son contact est autorisé dans le guide d''arrivée (510).';
update public.bien set accueil_proprio = true where code in ('GAXUXA','IBANETA','PANTXIKA','TXOMIN','BIXINTXO');
