# sync-reservations-cron (Edge Function) — ARCHIVÉE, ne pas redéployer

Supprimée de Supabase le 24/09/2026 (audit segment Réservations, accord Oïhan). Code récupéré tel
que déployé (v23, `supabase functions download`, MD5 ee1cb428db0620bcd16483ade65c688c).

- Désactivée le 07/07/2026 (migration `20260707155115_disable_legacy_sync_reservations_cron.sql`) :
  elle tournait en doublon du cron Vercel `api/sync-reservations.js` et créait des payouts Airbnb
  synthétiques avec une autre clé (`resa.id` Hospitable au lieu de l'id interne) → 234 résas avec
  payout en double, 2 virements bancaires captés à tort.
- La doc annonçait « Edge Function orpheline supprimée » mais elle était restée déployée et active,
  sans plus aucun appelant (ni pg_cron, ni code dans les 6 repos).
- Remplacée par `api/sync-reservations.js` (cron M/M-1/M-2 + mode unitaire webhook).
