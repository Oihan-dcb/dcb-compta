-- 465 — Page « À faire » de l'Accueil PowerHouse (17/10/2026) : mise à jour LIVE sans bouton.
-- L'écran s'abonne (Realtime postgres_changes, regroupé 2 s) aux tables qui font apparaître ou disparaître
-- une ligne. reservation, rental_contracts, reservation_paiement, resa_annulation, tech_issues, mission_menage
-- et mission_terrain sont déjà publiées (458 et avant). On ajoute ici les autres sources du « À faire ».
-- Les événements ne sont remis qu'aux comptes qui peuvent LIRE la ligne (RLS des tables, inchangée) ;
-- l'écran ne lit rien dans l'événement : il recharge /api/dashboard?w=afaire (droits vérifiés côté serveur).
-- bail_demande n'a pas de lecture « authenticated » (service seulement) → non publiée : l'intervalle de secours
-- (2 min) la couvre.
do $$
declare t text;
begin
  foreach t in array array['contract_payments','payment_guarantees','mandat_lien','contract_alerts','guest_thread','signalements','mission_acceptation'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
