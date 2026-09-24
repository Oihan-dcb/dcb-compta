-- Fonction utilitaire pour toggle-ae-access : bannir un compte (banned_until) ne coupe
-- QUE les nouvelles connexions/refresh — une session déjà ouverte (PWA, onglet resté
-- ouvert) continue de rafraîchir son token indéfiniment. Constaté 08-09/09/2026 : des
-- AE archivés (Manon Castet, Eve Vincent...) ont continué à lire/écrire dans le
-- messenger du Portail AE des semaines après leur archivage.
--
-- Cette fonction supprime les sessions actives (cascade sur auth.refresh_tokens) d'un
-- utilisateur, exécutée en SECURITY DEFINER car auth.sessions n'est pas accessible en
-- écriture via le rôle service_role au travers de PostgREST (schéma non exposé).
create or replace function public.admin_revoke_user_sessions(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from auth.sessions where user_id = p_user_id;
end;
$$;

revoke all on function public.admin_revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.admin_revoke_user_sessions(uuid) to service_role;
