-- 306 — Notes de propreté par AE / staff (05/10/2026)
--
-- Attribution : un voyageur juge le ménage fait AVANT son arrivée. Avis → réservation (bien,
-- arrival_date) → dernière mission Cleaning/Check-out du bien avec date_mission ≤ arrival_date
-- (fenêtre 30 j, non annulée) → ae_id. Vérifié 05/10/2026 : 384/404 avis attribués depuis 03/2026.
-- Note = detailed_ratings[type=cleanliness] ; Booking est noté sur 10 → ramené sur 5.
-- Commentaire « ménage » = commentaire public ou privé qui parle de propreté (mots-clés FR/EN/ES),
-- ou tout commentaire d'un avis avec une note propreté ≤ 4.
create or replace function public._avis_proprete_attribues(p_depuis date)
returns table (
  review_id uuid, ae_id uuid, bien_id uuid, bien_code text, arrival_date date, platform text,
  note numeric, comment text, private_feedback text, reviewer_name text, submitted_at timestamptz, parle_menage boolean
) language sql stable security definer set search_path = public as $$
  with rv as (
    select rr.id, r.bien_id, r.arrival_date, r.platform, rr.comment, rr.private_feedback, rr.reviewer_name, rr.submitted_at,
      (select (d->>'rating')::numeric / case when r.platform = 'booking' then 2 else 1 end
         from jsonb_array_elements(rr.detailed_ratings) d
        where d->>'type' = 'cleanliness' and (d->>'rating')::numeric > 0 limit 1) as note
    from reservation_review rr join reservation r on r.id = rr.reservation_id
    where r.arrival_date >= p_depuis and jsonb_typeof(rr.detailed_ratings) = 'array'
  )
  select rv.id, (select m.ae_id from mission_menage m
            where m.bien_id = rv.bien_id and m.date_mission <= rv.arrival_date and m.date_mission >= rv.arrival_date - 30
              and m.statut not in ('cancelled', 'refuse')
              and (m.titre_ical ilike 'Cleaning%' or m.titre_ical ilike 'Check-out%')
            order by m.date_mission desc, m.heure_mission desc nulls last limit 1),
         rv.bien_id, b.code, rv.arrival_date, rv.platform, rv.note, rv.comment, rv.private_feedback, rv.reviewer_name, rv.submitted_at,
         (coalesce(rv.comment, '') || ' ' || coalesce(rv.private_feedback, '')) ~*
           '(propre|sale|salet|m[ée]nage|nettoy|poussi|cheveu|tache|odeur|moisi|clean|dirty|dust|hair|stain|smell|spotless|tidy|limpi|sucio)'
  from rv left join bien b on b.id = rv.bien_id
  where rv.note is not null;
$$;
revoke all on function public._avis_proprete_attribues(date) from public, anon, authenticated;

-- Vue d'ensemble : une ligne par AE + moyenne globale (des avis attribués).
create or replace function public.stats_proprete_ae(p_depuis date default (current_date - 365))
returns table (
  ae_id uuid, nb_avis integer, moyenne numeric, moyenne_globale numeric, ecart numeric, notes_basses integer,
  dernier_commentaire text, dernier_commentaire_date timestamptz, dernier_commentaire_note numeric, dernier_commentaire_bien text
) language plpgsql stable security definer set search_path = public as $$
begin
  if not (auth_user_is_staff() or auth_user_is_bureau()) then raise exception 'acces_refuse'; end if;
  return query
  with a as (select * from _avis_proprete_attribues(p_depuis) where _avis_proprete_attribues.ae_id is not null),
       g as (select avg(a.note) mg from a),
       last as (
         select distinct on (a.ae_id) a.ae_id, coalesce(nullif(trim(a.comment), ''), a.private_feedback) txt, a.submitted_at, a.note, a.bien_code
           from a where a.parle_menage and coalesce(nullif(trim(a.comment), ''), a.private_feedback) is not null
          order by a.ae_id, a.submitted_at desc nulls last
       )
  select a.ae_id, count(*)::int, round(avg(a.note), 2), round((select mg from g), 2), round(avg(a.note) - (select mg from g), 2),
         (count(*) filter (where a.note <= 3))::int, l.txt, l.submitted_at, l.note, l.bien_code
    from a left join last l on l.ae_id = a.ae_id
   group by a.ae_id, l.txt, l.submitted_at, l.note, l.bien_code;
end $$;
revoke all on function public.stats_proprete_ae(date) from public, anon;
grant execute on function public.stats_proprete_ae(date) to authenticated;

-- Détail d'un AE : ses avis propreté (commentaires ménage d'abord). Accessible au staff
-- PowerHouse et à l'AE lui-même (futur profil dans le portail).
create or replace function public.avis_proprete_ae(p_ae_id uuid, p_depuis date default (current_date - 365), p_limit integer default 50)
returns table (
  review_id uuid, bien_code text, arrival_date date, platform text, note numeric,
  comment text, private_feedback text, reviewer_name text, submitted_at timestamptz, parle_menage boolean
) language plpgsql stable security definer set search_path = public as $$
begin
  if not (auth_user_is_staff() or auth_user_is_bureau() or auth_user_owns_ae(p_ae_id)) then raise exception 'acces_refuse'; end if;
  return query
  select a.review_id, a.bien_code, a.arrival_date, a.platform, a.note,
         a.comment,
         -- le retour privé reste réservé au bureau (pas montré à l'AE)
         case when auth_user_is_staff() or auth_user_is_bureau() then a.private_feedback end,
         a.reviewer_name, a.submitted_at, a.parle_menage
    from _avis_proprete_attribues(p_depuis) a
   where a.ae_id = p_ae_id
   order by a.submitted_at desc nulls last
   limit greatest(1, least(p_limit, 500));
end $$;
revoke all on function public.avis_proprete_ae(uuid, date, integer) from public, anon;
grant execute on function public.avis_proprete_ae(uuid, date, integer) to authenticated;
