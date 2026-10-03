-- 299 — Boîte à outils : l'adresse suit Hospitable (02-03/10/2026, décision Oïhan :
-- « utilise Hospitable comme source de vérité »).
--
-- bien.adresse est le miroir d'Hospitable (sync-biens : address.display ; vérifié identique
-- sur 15/15 annonces via le MCP Hospitable le 02/10/2026). bien_toolbox.adresse était une saisie
-- libre issue de l'import CSV d'avril, jamais resynchronisée (54 vides, 31 divergentes, ex. MUNDUZ
-- « Biarritz » au lieu de Bidart). Désormais bien_toolbox.adresse = adresse Hospitable raccourcie
-- (sans région ni pays) à chaque insert/update de bien.adresse. Les précisions terrain
-- (étage, porte…) vivent dans bien_toolbox.ou_appart, jamais touché par la synchro.
--
-- Appliqué en prod le 03/10/2026 (execute_sql). Données associées, faites hors migration :
--   • fusion de 26 fiches toolbox en double (anciens noms CSV vs codes) — sauvegarde
--     bkp_toolbox_fusion_20261002* ;
--   • alignement des adresses + 4 précisions recopiées dans ou_appart (ALAIA, BELEZIA, COCO,
--     ENEA) — sauvegarde bkp_toolbox_adresse_20261003.

create or replace function public.adresse_courte(a text) returns text
language sql immutable as $$
  select nullif(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(coalesce(a, ''),
          ',\s*(Nouvelle[- ]Aquitaine|Aquitaine|Pays Basque|Pyr[ée]n[ée]es[- ]Atlantiques|Gironde)\y', '', 'gi'),
        ',\s*(FR|France)\s*(?=,|$)', '', 'gi'),
      '^[\s,]+|[\s,]+$', '', 'g'),
    '^(FR|France)$', '', 'i'), '')
$$;

create or replace function public.sync_bien_toolbox()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.code is null then
    return new;
  end if;
  -- 299 : l'adresse suit Hospitable (bien.adresse), raccourcie ; on n'efface jamais avec un vide.
  update bien_toolbox
     set nom_csv = new.code,
         ville   = coalesce(new.ville, ville),
         adresse = coalesce(adresse_courte(new.adresse), adresse)
   where bien_id = new.id;
  if found then
    return new;
  end if;
  insert into bien_toolbox (nom_csv, bien_id, ville, adresse)
  values (new.code, new.id, new.ville, adresse_courte(new.adresse))
  on conflict (nom_csv) do nothing;
  return new;
end;
$function$;

create or replace trigger trg_sync_bien_toolbox
  after insert or update of code, ville, adresse on public.bien
  for each row execute function sync_bien_toolbox();
