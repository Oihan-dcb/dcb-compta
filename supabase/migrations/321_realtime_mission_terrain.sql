-- 321 — Temps réel sur mission_terrain (05/10/2026) : PowerHouse → 📍 Terrain et l'encadré du Dashboard
-- se mettent à jour dès qu'un AE démarre / termine / envoie sa vidéo (Hospitable ne permet pas de mettre à
-- jour le statut d'avancement d'une tâche via l'API : PowerHouse est le tableau de bord de suivi).
-- La RLS s'applique au flux temps réel (mission_terrain_select).
alter publication supabase_realtime add table public.mission_terrain;
