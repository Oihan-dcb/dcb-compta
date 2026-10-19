-- 506 — Portail voyageur : page d'entrée sejour.destinationcotebasque.com (20/10/2026).
-- « Retrouver mon séjour par e-mail ou téléphone » : liste des réservations EN COURS / À VENIR dont un contact correspond
-- (réservation, données Hospitable, contrat, devis). Appelée par le serveur seul (service_role) ; ne renvoie que des
-- identifiants : la correspondance exacte du canal est revérifiée côté serveur (api/_portailVerif.canalSaisi) avant tout
-- envoi de code. Aucune donnée n'est créée ni modifiée.
create or replace function public.portail_entree_candidats(p_email text, p_fin9 text, p_today date)
returns table (reservation_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select r.id
  from reservation r
  where r.departure_date >= p_today
    and r.arrival_date <= p_today + 400
    and coalesce(r.owner_stay, false) = false
    and (
      (p_email is not null and length(p_email) >= 5 and (
           lower(trim(r.guest_email)) = p_email
        or lower(trim(r.hospitable_raw->'guest'->>'email')) = p_email
        or exists (select 1 from rental_contracts c where c.reservation_id = r.code and c.statut <> 'cancelled' and lower(trim(c.guest_snapshot->>'email')) = p_email)
        or exists (select 1 from devis_option d where d.reservation_code = r.code and lower(trim(d.voyageur_email)) = p_email)))
      or
      (p_fin9 ~ '^[0-9]{9}$' and (
           right(regexp_replace(coalesce(r.guest_phone, ''), '\D', '', 'g'), 9) = p_fin9
        or exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(r.hospitable_raw->'guest'->'phone_numbers') = 'array'
                     then r.hospitable_raw->'guest'->'phone_numbers' else '[]'::jsonb end) x
                   where right(regexp_replace(x, '\D', '', 'g'), 9) = p_fin9)
        or exists (select 1 from rental_contracts c where c.reservation_id = r.code and c.statut <> 'cancelled' and right(regexp_replace(coalesce(c.guest_snapshot->>'telephone', ''), '\D', '', 'g'), 9) = p_fin9)
        or exists (select 1 from devis_option d where d.reservation_code = r.code and right(regexp_replace(coalesce(d.voyageur_telephone, ''), '\D', '', 'g'), 9) = p_fin9)))
    )
  order by r.arrival_date
  limit 8;
$$;

revoke all on function public.portail_entree_candidats(text, text, date) from public, anon, authenticated;
grant execute on function public.portail_entree_candidats(text, text, date) to service_role;
