-- 564 — Taille des lits dans la mission AE (23/10/2026, retour de Claudine : « prendre la bonne alèse »)
-- Le portail AE (Ma journée › mission) affiche chaque lit du logement avec sa dimension (largeur × longueur) et le
-- linge prévu (King, Queen, Twin…). Les AE ne lisent pas bien_lit directement : RPC limitée aux comptes internes
-- (AE actifs, équipe). Lits sans dimension = remontés dans PowerHouse › Accueil › À faire (api/_aFaire.js).
create or replace function public.ae_lits_biens(p_bien_ids uuid[])
returns table (bien_id uuid, lit_id uuid, piece text, type text, largeur_cm smallint, longueur_cm smallint, linge text,
               places smallint, transforme_type text, transforme_nombre smallint, transforme_largeur_cm smallint, transforme_linge text, ordre smallint)
language sql stable security definer set search_path = public as $$
  select l.bien_id, l.id, l.piece, l.type, l.largeur_cm, l.longueur_cm, l.linge, l.places,
         l.transforme_type, l.transforme_nombre, l.transforme_largeur_cm, l.transforme_linge, l.ordre
    from bien_lit l
   where l.actif and l.bien_id = any(coalesce(p_bien_ids, '{}')) and auth_user_is_internal()
   order by l.bien_id, l.ordre, l.piece, l.id
$$;
revoke all on function public.ae_lits_biens(uuid[]) from public, anon;
grant execute on function public.ae_lits_biens(uuid[]) to authenticated, service_role;
