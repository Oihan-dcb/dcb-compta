-- 500 — Tout propriétaire a une ligne owner_profile_config (profil « suivi », le standard).
-- Bug constaté le 19/10/2026 (Adrienne / Philippe GRANDVOINET, VILLA AGERREA) : le portail owner lit
-- la visibilité dans owner_profile_config ; sans ligne, tout est masqué (menu, Documents, blocage de
-- dates). Les comptes créés à la volée par request-access (02/10) n'écrivaient que l'ancienne table
-- owner_visibility_config. 18 fiches actives étaient sans ligne ; complétées à la main le 19/10, ce
-- trigger couvre désormais toute création de fiche, quel que soit le chemin.

create or replace function public.proprietaire_profile_config_defaut()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  insert into owner_profile_config (proprietaire_id, agence, profil, visibilite)
  values (new.id, coalesce(new.agence, 'dcb'), 'suivi', '{}'::jsonb)
  on conflict (proprietaire_id) do nothing;
  return new;
end;
$function$;

drop trigger if exists trg_proprietaire_profile_config_defaut on public.proprietaire;
create trigger trg_proprietaire_profile_config_defaut
  after insert on public.proprietaire
  for each row execute function public.proprietaire_profile_config_defaut();

-- Rattrapage (idempotent) : fiches actives sans ligne.
insert into owner_profile_config (proprietaire_id, agence, profil, visibilite)
select p.id, coalesce(p.agence, 'dcb'), 'suivi', '{}'::jsonb
from proprietaire p
where p.actif and not exists (select 1 from owner_profile_config c where c.proprietaire_id = p.id)
on conflict (proprietaire_id) do nothing;
