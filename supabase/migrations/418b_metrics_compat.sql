-- 418b — compatibilité : ph_metrics(début, fin, agence) (416) rétabli au-dessus de ph_metrics_comparer, le temps que
-- PowerHouse passe à la page Metrics v2. Mêmes droits (ph_metrics_comparer refuse sans droit perf).
create or replace function public.ph_metrics(p_debut date, p_fin date, p_agence text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare j jsonb;
begin
  j := ph_metrics_comparer(jsonb_build_array(jsonb_build_object('debut', p_debut, 'fin', p_fin),
         jsonb_build_object('debut', (p_debut - interval '1 year')::date, 'fin', (p_fin - interval '1 year')::date)), 'date', p_agence, null);
  return (j - 'periodes') || jsonb_build_object('n', j->'periodes'->0, 'n1', j->'periodes'->1);
end $$;
revoke all on function public.ph_metrics(date, date, text) from public, anon;
grant execute on function public.ph_metrics(date, date, text) to authenticated;
