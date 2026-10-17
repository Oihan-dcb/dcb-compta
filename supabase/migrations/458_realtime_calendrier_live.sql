-- 458 — Calendrier PowerHouse « LIVE » (17/10/2026, Oïhan : « pas d'action à faire pour voir les bonnes infos »).
-- Le Calendrier écoute déjà `reservation` ; on ajoute les contrats, les encaissements et les annulations pour que
-- la grille et le panneau du séjour se mettent à jour seuls (RLS staff inchangée : Realtime la respecte).
do $$
declare t text;
begin
  foreach t in array array['rental_contracts','reservation_paiement','resa_annulation'] loop
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
