-- 351 — Statut de paiement dans le calendrier PowerHouse (08/10/2026) : les comptes staff restreints
-- à des secteurs (Léa : Bordeaux + bassin d'Arcachon, fiche AE avec acces_powerhouse, pas « bureau »)
-- doivent voir les paiements des résas de LEURS biens — et seulement ceux-là. La policy existante
-- (staff_all_reservation_paiement, auth_user_is_bureau()) reste inchangée pour le bureau.
-- Lecture seule ; les comptes staff non sectorisés et non bureau restent sans accès.
drop policy if exists reservation_paiement_lecture_secteur on public.reservation_paiement;
create policy reservation_paiement_lecture_secteur on public.reservation_paiement
  for select to authenticated
  using (
    auth_user_is_staff()
    and my_secteurs() is not null
    and reservation_id in (
      select r.id from public.reservation r where r.bien_id in (select my_scoped_bien_ids())
    )
  );
