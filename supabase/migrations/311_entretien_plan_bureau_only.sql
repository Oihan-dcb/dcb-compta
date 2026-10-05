-- 311 — Activer un plan d'entretien = décider de facturer le propriétaire (hors forfait) :
-- réservé au bureau (auth_user_is_bureau), plus aux managers terrain.
drop policy if exists bien_entretien_plan_write on public.bien_entretien_plan;
create policy bien_entretien_plan_write on public.bien_entretien_plan for all to authenticated
  using (auth_user_is_bureau()) with check (auth_user_is_bureau());
