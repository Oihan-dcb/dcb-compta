-- 348 — Catalogue : qui paie, prix refacturé, réassort auto, équipement Hospitable (07/10/2026, demande Oïhan).
-- Logique GÉNÉRIQUE (« pense à la reproduction de logique ») : tout article du catalogue peut être
--   1. réassorti automatiquement : stock « faible » (en plus de manquant / à remplacer, déjà gérés par
--      inventaire_vers_sac) → besoin_sac à préparer, si reappro_auto ;
--   2. refacturé au proprio quand l'AE valide le dépôt du sac : payeur = 'proprio' + prix_refacture_ttc →
--      frais_proprietaire deduire_loyer (source 'auto') sur le mois du dépôt (mois suivant si le bien est
--      clôturé), relié par besoin_sac.frais_id (jamais 2 fois) ;
--   3. détecté depuis les équipements Hospitable (hospitable_amenity, sync dcb-planning
--      api/ga-sync-practical-faq.js) : équipement présent + ses consommables (catalogue_dependances).
-- payeur : 'proprio' (refacturé) · 'dcb' (produits DCB) · 'forfait' (inclus, jamais facturé) · NULL = à définir.
-- Tout est éditable dans PowerHouse → Biens → 📦 Catalogue (bureau uniquement, garde-fou trigger).

alter table public.catalogue_items
  add column if not exists payeur text check (payeur in ('proprio', 'dcb', 'forfait')),
  add column if not exists prix_refacture_ttc integer check (prix_refacture_ttc is null or prix_refacture_ttc >= 0),
  add column if not exists reappro_auto boolean not null default false,
  add column if not exists hospitable_amenity text;
comment on column public.catalogue_items.payeur is 'Qui paie : proprio (refacturé au dépôt du sac) · dcb · forfait (inclus). NULL = à définir. Migration 348.';
comment on column public.catalogue_items.prix_refacture_ttc is 'Prix TTC refacturé au proprio par unité, en centimes. Migration 348.';
comment on column public.catalogue_items.reappro_auto is 'Stock « faible » → ajout automatique au sac (manquant/à remplacer le font déjà). Migration 348.';
comment on column public.catalogue_items.hospitable_amenity is 'Clé amenity Hospitable (dishwasher, washer…) qui prouve la présence de l''équipement. Migration 348.';

alter table public.besoin_sac add column if not exists frais_id uuid references public.frais_proprietaire(id) on delete set null;
comment on column public.besoin_sac.frais_id is 'Frais proprio créé au dépôt (article payeur=proprio). Migration 348.';

-- Rayons en doublon (emoji)
update public.catalogue_items set categorie = 'Confort' where categorie = '❄️ Confort';
update public.catalogue_items set categorie = 'Général' where categorie = '📋 Général';

-- Prix proposés (marge raisonnable : achat + stockage + préparation du sac)
update public.catalogue_items set payeur = 'proprio', prix_refacture_ttc = 450, reappro_auto = true where nom = 'Sel lave-vaisselle';
update public.catalogue_items set payeur = 'proprio', prix_refacture_ttc = 550, reappro_auto = true where nom = 'Liquide rinçage';

-- Équipements ↔ amenities Hospitable
update public.catalogue_items c set hospitable_amenity = m.a
  from (values ('Lave-vaisselle','dishwasher'), ('Machine à laver','washer'), ('Sèche-linge','dryer'),
               ('Barbecue','bbq'), ('Piscine','pool'), ('Fer à repasser','iron'), ('Télévision','tv'),
               ('Climatisation','ac'), ('Bouilloire','hot_water_kettle'), ('Grille-pain','toaster'),
               ('Micro-ondes','microwave'), ('Sèche-cheveux','hair_dryer'), ('Réfrigérateur','refrigerator'),
               ('Congélateur','freezer'), ('Mixeur / blender','blender'), ('Trousse premiers secours','first_aid_kit'),
               ('Détecteur fumée','smoke_detector'), ('Détecteur CO','carbon_monoxide_detector'),
               ('Extincteur','fire_extinguisher')) m(n, a)
 where c.nom = m.n;

-- Garde-fou : seuls le bureau (ou le service) changent payeur / prix / réassort / amenity
create or replace function public.catalogue_items_garde_refacturation()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if auth.uid() is null or public.auth_user_is_bureau() then return new; end if;
  if tg_op = 'INSERT' then
    new.payeur := null; new.prix_refacture_ttc := null; new.reappro_auto := false; new.hospitable_amenity := null;
  elsif new.payeur is distinct from old.payeur or new.prix_refacture_ttc is distinct from old.prix_refacture_ttc
     or new.reappro_auto is distinct from old.reappro_auto or new.hospitable_amenity is distinct from old.hospitable_amenity then
    raise exception 'Seul le bureau peut modifier la refacturation d''un article du catalogue';
  end if;
  return new;
end $function$;
drop trigger if exists trg_catalogue_items_garde on public.catalogue_items;
create trigger trg_catalogue_items_garde before insert or update on public.catalogue_items
  for each row execute function public.catalogue_items_garde_refacturation();

-- Stock → sac : « faible » ajouté pour les articles en réassort auto
create or replace function public.inventaire_vers_sac()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_bien uuid; v_item catalogue_items;
begin
  if tg_op = 'UPDATE' and new.statut is not distinct from old.statut then return new; end if;
  select bien_id into v_bien from bien_toolbox where id = new.bien_id;
  select * into v_item from catalogue_items where id = new.item_id;
  if v_bien is null or v_item.id is null or v_item.type not in ('petit_equipement', 'consommable', 'stock') then return new; end if;
  if new.statut in ('a_remplacer', 'manquant') or (new.statut = 'faible' and v_item.reappro_auto) then
    if not exists (select 1 from besoin_sac where bien_id = v_bien and item_id = new.item_id and statut in ('a_preparer', 'dans_sac')) then
      insert into besoin_sac (bien_id, item_id, libelle, quantite, note)
      values (v_bien, new.item_id, v_item.nom, 1, case new.statut when 'a_remplacer' then 'Inventaire : à remplacer'
                                                                  when 'faible' then 'Inventaire : faible (réassort auto)'
                                                                  else 'Inventaire : manquant' end);
    end if;
  elsif new.statut in ('present', 'ok') then
    update besoin_sac set statut = 'annule', updated_at = now()
     where bien_id = v_bien and item_id = new.item_id and statut = 'a_preparer';
  end if;
  return new;
exception when others then
  return new;
end $function$;

-- Dépôt validé → frais proprio (articles payeur=proprio)
create or replace function public.besoin_sac_depose_refacture()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_item catalogue_items; v_proprio uuid; v_date date; v_frais uuid;
begin
  if new.statut <> 'depose' or old.statut = 'depose' or new.item_id is null or new.bien_id is null then return new; end if;
  select * into v_item from catalogue_items where id = new.item_id;
  if v_item.payeur is distinct from 'proprio' or coalesce(v_item.prix_refacture_ttc, 0) = 0 or new.frais_id is not null then return new; end if;
  select proprietaire_id into v_proprio from bien where id = new.bien_id;
  if v_proprio is null then return new; end if;
  v_date := coalesce(new.depose_at, now())::date;
  while exists (select 1 from cloture_bien cb where cb.bien_id = new.bien_id and cb.mois = to_char(v_date, 'YYYY-MM') and cb.active) loop
    v_date := (date_trunc('month', v_date) + interval '1 month')::date;
  end loop;
  insert into frais_proprietaire (bien_id, proprietaire_id, date, libelle, montant_ttc, statut, mode_traitement,
                                  mode_encaissement, mois_facturation, source)
  values (new.bien_id, v_proprio, v_date,
          'Réassort ' || v_item.nom || case when new.quantite > 1 then ' ×' || new.quantite else '' end
            || ' (déposé le ' || to_char(coalesce(new.depose_at, now()) at time zone 'Europe/Paris', 'DD/MM/YYYY') || ')',
          v_item.prix_refacture_ttc * new.quantite, 'a_facturer', 'deduire_loyer', 'dcb', to_char(v_date, 'YYYY-MM'), 'auto')
  returning id into v_frais;
  new.frais_id := v_frais;
  return new;
end $function$;
drop trigger if exists trg_besoin_sac_depose_refacture on public.besoin_sac;
create trigger trg_besoin_sac_depose_refacture before update of statut on public.besoin_sac
  for each row execute function public.besoin_sac_depose_refacture();

-- Le dépôt remet le stock du bien à « présent » — trigger AFTER (en BEFORE : conflit « tuple already
-- modified » avec inventaire_vers_sac, qui met à jour besoin_sac en cascade ; constaté au test, 348b)
create or replace function public.besoin_sac_depose_stock()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if new.statut = 'depose' and old.statut <> 'depose' and new.item_id is not null and new.bien_id is not null then
    update inventaire_bien_stock s set statut = 'present', derniere_maj_at = now()
     where s.item_id = new.item_id and s.bien_id in (select t.id from bien_toolbox t where t.bien_id = new.bien_id)
       and s.statut in ('faible', 'manquant', 'a_remplacer', 'a_verifier');
  end if;
  return null;
end $function$;
drop trigger if exists trg_besoin_sac_depose_stock on public.besoin_sac;
create trigger trg_besoin_sac_depose_stock after update of statut on public.besoin_sac
  for each row execute function public.besoin_sac_depose_stock();
revoke all on function public.besoin_sac_depose_stock() from public, anon, authenticated;

revoke all on function public.besoin_sac_depose_refacture() from public, anon, authenticated;
revoke all on function public.catalogue_items_garde_refacturation() from public, anon, authenticated;

-- Contrôle lave-vaisselle : l'AE relève le niveau sel / rinçage (déclenche le réassort)
update public.entretien_type
   set consigne = coalesce(consigne || ' ', '') || 'Vérifier le niveau de sel et de liquide de rinçage : s''il est bas, le passer en « faible » dans l''inventaire du bien (réassort automatique au prochain sac).'
 where nom = 'Lave-vaisselle : filtres à la brosse et grande eau' and coalesce(consigne, '') not ilike '%liquide de rinçage%';

-- 348c : inventaire_bien_config.added_by accepte 'hospitable' (articles ajoutés par la sync des équipements)
do $$ declare c text; begin
  select conname into c from pg_constraint where conrelid='public.inventaire_bien_config'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%added_by%';
  execute format('alter table public.inventaire_bien_config drop constraint %I', c);
end $$;
alter table public.inventaire_bien_config add constraint inventaire_bien_config_added_by_check
  check (added_by = any (array['manuel', 'auto_dependance', 'init', 'migration', 'hospitable']));
