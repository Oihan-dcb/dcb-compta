-- 360 — Étudiants gérés par le propriétaire (08/10/2026, Oïhan : « B16 et B24, les étudiants sont gérés par les
-- proprios, same pour GASQ et DUL »). DCB n'a ni le bail ni forcément la réservation : on ne peut pas prouver la
-- location étudiante de l'année → le contrôle ⚖️ ne doit pas les marquer « saisonnier non autorisé » ; il affiche
-- « étudiant géré par le propriétaire ».
alter table public.bien add column if not exists etudiant_gere_proprio boolean not null default false;
comment on column public.bien.etudiant_gere_proprio is 'La location étudiante est gérée directement par le propriétaire (pas de bail chez DCB) : conformité saisonnier déclarée par lui. Migration 360.';
update public.bien set etudiant_gere_proprio = true, type_exploitation = coalesce(type_exploitation, 'mixte_etudiant_saisonnier')
 where code in ('B16', 'B24', 'GASQ', 'DUL');
update public.bien set type_exploitation = 'mixte_etudiant_saisonnier' where code = 'GASQ';
-- GASQ : masqué « pas réservable » (sourdine) → en réalité loué à un étudiant hors DCB
update public.bien set hors_location = true, hors_location_motif = 'etudiant_hors_dcb' where code = 'GASQ';

drop function if exists public.conformite_saisonnier(int);
create function public.conformite_saisonnier(p_annee int)
 returns table (bien_id uuid, code text, bail_etudiant boolean, source text)
 language sql stable security definer set search_path to 'public' as $$
  select b.id, b.code,
         bien_bail_etudiant_annee(b.id, p_annee) or b.etudiant_gere_proprio,
         case when bien_bail_etudiant_annee(b.id, p_annee) then 'dcb' when b.etudiant_gere_proprio then 'proprio' end
    from bien b
   where b.type_exploitation = 'mixte_etudiant_saisonnier' and auth_user_is_internal()
$$;
revoke all on function public.conformite_saisonnier(int) from public, anon;
grant execute on function public.conformite_saisonnier(int) to authenticated;
update public.bien set hors_location_motif = 'etudiant_hors_dcb' where code = 'DUL';
