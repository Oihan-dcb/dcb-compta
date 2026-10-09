-- 376 — Position APPROXIMATIVE (réseau / adresse IP) en repli quand le GPS manque (09/10/2026)
--
-- Demande Oïhan : « même si ce n'est pas la position exacte, on peut avoir la position globale ».
-- Quand le portail AE n'obtient pas de position GPS (refus, délai, indisponible), il appelle la
-- route Vercel /api/terrain-geo-ip, qui lit les en-têtes x-vercel-ip-* de la requête et écrit ici
-- (service_role). Stockage SÉPARÉ de la position GPS, jamais mélangé :
--   { "source": "ip", "lat": .., "lng": .., "ville": "Biarritz", "region": "NAQ", "pays": "FR", "at": "..." }
-- Fiabilité : en 4G/5G l'IP est souvent localisée à la ville de l'opérateur (Bordeaux, Paris…) →
-- indication grossière, JAMAIS utilisée pour un contrôle automatique de présence.

alter table public.mission_terrain
  add column if not exists start_position_approx jsonb,
  add column if not exists end_position_approx jsonb;

comment on column public.mission_terrain.start_position_approx is
  'Repli réseau (IP, en-têtes Vercel) quand start_lat est NULL. source=ip, ville, lat/lng approximatifs. Indicatif seulement.';
comment on column public.mission_terrain.end_position_approx is
  'Repli réseau (IP, en-têtes Vercel) quand end_lat est NULL. source=ip, ville, lat/lng approximatifs. Indicatif seulement.';

notify pgrst, 'reload schema';
