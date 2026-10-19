-- 482 — Hub Missions : inventaire non fait / incomplet = mission signalée (non bloquant), 19/10/2026.
-- Ajoute à mission_hub_periode (définition en vigueur, quelle que soit la dernière migration qui l'a redéfinie,
-- 476 à ce jour) l'anomalie calculée par inventaire_anomalie() (481) :
--   « inventaire non fait » (mission d'inventaire terminée sans inventaire terminé) ou
--   « inventaire incomplet : x % des articles vus » (< 90 %).
-- Seulement une fois la mission finie (« Terminer » appuyé), comme l'extra prévu non fait (476).
-- Patch par ancres sur la définition en base (pas de copie du corps) pour ne pas écraser les règles d'un autre chantier.
-- ⚠ Toute redéfinition future de mission_hub_periode doit garder ces deux lignes (repère : « 482 »).
do $mig$
declare d text; d2 text;
begin
  d := pg_get_functiondef('public.mission_hub_periode(date, date, timestamptz)'::regprocedure);
  if position('inventaire_anom' in d) > 0 then return; end if;  -- déjà branché
  d2 := replace(d, ' as extras_prevus_non_faits,',
    E' as extras_prevus_non_faits,\n    -- 482 : inventaire non fait / incomplet (< 90 % des articles vus)\n    public.inventaire_anomalie(m.id, m.ical_uid, t.type_terrain) as inventaire_anom,');
  if d2 = d then raise exception '482 : ancre extras_prevus_non_faits introuvable'; end if;
  d := d2;
  d2 := replace(d, $a$then 'extra prévu non fait : ' || base.extras_prevus_non_faits end$a$,
    $a$then 'extra prévu non fait : ' || base.extras_prevus_non_faits end,
      -- 482 : inventaire (mission finie seulement)
      case when base.ended_at is not null then base.inventaire_anom end$a$);
  if d2 = d then raise exception '482 : ancre anomalie extra prévu introuvable'; end if;
  execute d2;
end $mig$;
