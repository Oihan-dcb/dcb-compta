-- 421b — Metrics › Avis : « À répondre » limité aux avis des 30 derniers jours (15/10/2026).
-- Constat après le rattrapage sync-reviews : Hospitable renvoie can_respond = true pour 2 181 avis Airbnb, y compris
-- des avis de plusieurs années → la liste d'action ne garde que les avis récents sans réponse.

create or replace function public.ph_metrics_avis(p_periodes jsonb, p_agence text default null, p_biens uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_biens uuid[]; v_eq boolean; v_res jsonb := '[]'::jsonb; p jsonb; d1 date; f1 date; k int;
begin
  v_biens := ph_metrics_biens_onglet(p_agence, p_biens, false);
  v_eq := ph_metrics_droit_equipe();
  if jsonb_typeof(p_periodes) <> 'array' or jsonb_array_length(p_periodes) not between 1 and 4 then raise exception 'periode_invalide'; end if;
  for k in 0 .. jsonb_array_length(p_periodes) - 1 loop
    p := p_periodes -> k; d1 := (p->>'debut')::date; f1 := (p->>'fin')::date;
    if d1 is null or f1 is null or f1 < d1 or f1 - d1 > 731 then raise exception 'periode_invalide'; end if;
    v_res := v_res || jsonb_build_array(ph_metrics_avis_calc(v_biens, d1, f1, v_eq, k = 0));
  end loop;
  return jsonb_build_object('equipe', v_eq, 'nb_biens', coalesce(array_length(v_biens, 1), 0), 'periodes', v_res,
    'reponses_depuis', (select min(submitted_at) from reservation_review where peut_repondre is not null),
    'a_repondre', (select coalesce(jsonb_agg(x order by x->>'le' desc), '[]'::jsonb) from (
       select jsonb_build_object('id', rv.id, 'bien', b.code, 'le', rv.submitted_at, 'note', rv.rating, 'nom', rv.reviewer_name,
              'plateforme', coalesce(rv.plateforme, r.platform), 'comment', left(rv.comment, 300)) x
         from reservation_review rv left join reservation r on r.id = rv.reservation_id
         join bien b on b.id = coalesce(r.bien_id, rv.bien_id)
        where b.id = any(v_biens) and rv.peut_repondre and rv.reponse is null and rv.repondu_le is null
          and rv.submitted_at >= now() - interval '30 days'
        order by rv.submitted_at desc limit 40) z));
end $$;
revoke all on function public.ph_metrics_avis(jsonb, text, uuid[]) from public, anon;
grant execute on function public.ph_metrics_avis(jsonb, text, uuid[]) to authenticated;
