-- 409 — Réglages des biens EN MASSE + tags de biens (PowerHouse, demande Oïhan 11/10/2026).
--
-- « Configuration en masse » : appliquer un réglage (majoration d'un canal, un frais et ses paramètres, prix de base,
-- caution, séjour min, conditions de vente directe, tag…) à PLUSIEURS biens d'un coup, avec aperçu « avant → après »
-- par bien, option « seulement les biens où c'est vide » / « écraser », journalisé dans l'historique de CHAQUE bien.
--
-- · bien_reglages_masse(p_biens, p_ops, p_mode, p_simuler, p_libelle) : SECURITY INVOKER — les écritures passent par
--   les mêmes tables, la même RLS (périmètre de Léa : my_scoped_bien_ids) et les mêmes triggers de journal que l'écran
--   💶 Tarification / 🌐 Vente directe ; tout ou rien (une transaction). p_simuler = true → rien n'est écrit, renvoie
--   l'aperçu ; false → applique et renvoie le même détail. Accès : bureau (auth_user_is_bureau) ou staff_scope (Léa),
--   et CHAQUE bien doit être dans le périmètre de l'utilisateur.
-- · bien_tarification_journal.lot / lot_libelle : un lot = une application en masse ; renseignés par DÉFAUT de colonne
--   depuis la variable de transaction dcb.lot_masse / dcb.lot_libelle (posée par la fonction) → aucun trigger réécrit.
-- · bien.tags (text[]) : étiquettes libres PowerHouse (filtre du hub et de la config en masse), journalisées.
-- Aucune écriture Hospitable.

-- ═══ 1. Journal : lot ════════════════════════════════════════════════════════════════════════════
alter table public.bien_tarification_journal
  add column if not exists lot uuid default nullif(current_setting('dcb.lot_masse', true), '')::uuid,
  add column if not exists lot_libelle text default nullif(current_setting('dcb.lot_libelle', true), '');
comment on column public.bien_tarification_journal.lot is 'Application en masse (409) qui a produit la ligne — null = modification bien par bien.';

-- ═══ 2. Tags de biens ═══════════════════════════════════════════════════════════════════════════
alter table public.bien add column if not exists tags text[] not null default '{}';
comment on column public.bien.tags is 'Étiquettes libres PowerHouse (409) : filtre du hub Biens et de la configuration en masse. Pas les tags Hospitable.';

create or replace function public.trg_bien_tags_journal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.tags is distinct from new.tags then
    insert into bien_tarification_journal (bien_id, cle, canal, operation, avant, apres, par)
    values (new.id, 'tags', 'tous', 'modification', to_jsonb(coalesce(old.tags, '{}')), to_jsonb(coalesce(new.tags, '{}')), coalesce(auth.email(), 'système'));
  end if;
  return new;
end $$;
drop trigger if exists trg_bien_tags_journal on public.bien;
create trigger trg_bien_tags_journal after update of tags on public.bien
  for each row execute function public.trg_bien_tags_journal();

-- ═══ 3. Application en masse ════════════════════════════════════════════════════════════════════
-- p_ops : tableau (1 à 10) d'opérations :
--   {"type":"tarif","cle":"majoration","canal":"airbnb","valeur":22.732,"texte":null,"mode":null,"effacer":false,"detail":"…"}
--      valeurs € en CENTIMES (comme l'écran) ; « vide » = aucune saisie PowerHouse pour (cle, canal).
--   {"type":"frais","cle":"menage_cleaning","canal":null|"airbnb","defaut":{libelle,categorie,type_valeur,unite,ordre,canaux,max_nuits,actif},
--    "champs":{"valeur":4500,"actif":true,"type_valeur":"eur","unite":"par_sejour","canaux":["direct"]|null,"max_nuits":2|null,"libelle":"…"}}
--      canal renseigné → la valeur va dans valeurs_canal[canal] ; « vide » = frais absent ou valeur visée non réglée.
--   {"type":"vente_directe","champs":{"active":true,"meilleur_prix":"alerte","paiement_defaut":"totalite","seuil_totalite_jours":30,"fenetre_min_jours":1}}
--      « vide » = aucun réglage de vente directe enregistré pour le bien.
--   {"type":"tag","ajouter":"vue mer"} | {"type":"tag","retirer":"vue mer"}  (mode sans objet)
-- Retour : {lot, simulation, lignes:[{bien_id, code, op, cle, canal, avant, apres, action}]}
--   action : ajout | modification | suppression | identique | deja_renseigne (mode « vides », valeur gardée)
create or replace function public.bien_reglages_masse(p_biens uuid[], p_ops jsonb, p_mode text default 'vides', p_simuler boolean default true, p_libelle text default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_lot uuid := gen_random_uuid();
  v_email text := coalesce(auth.email(), 'système');
  v_lib text := left(coalesce(nullif(btrim(p_libelle), ''), 'Modification en masse'), 200);
  v_lignes jsonb := '[]'::jsonb;
  v_bien record; v_op jsonb; v_i int; v_type text;
  v_cle text; v_canal text; v_avant jsonb; v_apres jsonb; v_action text;
  v_val numeric; v_txt text; v_mode text; v_eff boolean;
  r_t record; r_f record; r_v record;
  v_champs jsonb; v_vc jsonb; v_vide boolean; v_tags text[];
  c_tarif_cles constant text[] := array['prix_base_nuit', 'prix_base_weekend', 'majoration', 'voyageurs_inclus', 'supplement_voyageur', 'capacite_max',
    'caution_mode', 'caution', 'remise_semaine', 'remise_mois', 'remise_last_minute', 'remise_last_minute_jours', 'remise_early_bird',
    'remise_early_bird_mois', 'annulation_contrat', 'min_nuits', 'max_nuits', 'fenetre_mois', 'reservation_instantanee'];
  c_vd_champs constant text[] := array['active', 'meilleur_prix', 'paiement_defaut', 'seuil_totalite_jours', 'fenetre_min_jours'];
  c_frais_champs constant text[] := array['libelle', 'actif', 'type_valeur', 'unite', 'canaux', 'max_nuits'];
  k text;
begin
  if auth.uid() is null or not (auth_user_is_bureau() or auth_user_powerhouse_role() = 'staff_scope') then
    raise exception 'Configuration en masse réservée au bureau' using errcode = '42501';
  end if;
  if p_mode not in ('vides', 'ecraser') then raise exception 'Mode inconnu : %', p_mode; end if;
  if coalesce(array_length(p_biens, 1), 0) = 0 then raise exception 'Aucun bien sélectionné'; end if;
  if array_length(p_biens, 1) > 300 then raise exception 'Trop de biens (300 au plus)'; end if;
  if jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) = 0 or jsonb_array_length(p_ops) > 10 then raise exception 'Opérations invalides (1 à 10)'; end if;
  if exists (select 1 from unnest(p_biens) b(id) where b.id not in (select my_scoped_bien_ids())) then
    raise exception 'Un ou plusieurs biens sont hors de votre périmètre' using errcode = '42501';
  end if;

  if not p_simuler then
    perform set_config('dcb.lot_masse', v_lot::text, true);
    perform set_config('dcb.lot_libelle', v_lib, true);
  end if;

  for v_bien in select b.id, b.code, b.tags from bien b where b.id = any(p_biens) order by b.code loop
    for v_i in 0 .. jsonb_array_length(p_ops) - 1 loop
      v_op := p_ops -> v_i; v_type := v_op ->> 'type';
      v_avant := null; v_apres := null; v_action := null; v_canal := null; v_cle := null;

      -- ── Réglage bien_tarification (saisie PowerHouse) ──
      if v_type = 'tarif' then
        v_cle := v_op ->> 'cle'; v_canal := coalesce(nullif(v_op ->> 'canal', ''), 'tous');
        if not (v_cle = any(c_tarif_cles)) then raise exception 'Réglage non modifiable en masse : %', v_cle; end if;
        v_eff := coalesce((v_op ->> 'effacer')::boolean, false);
        v_val := nullif(v_op ->> 'valeur', '')::numeric; v_txt := nullif(btrim(coalesce(v_op ->> 'texte', '')), ''); v_mode := nullif(v_op ->> 'mode', '');
        if not v_eff and v_val is null and v_txt is null then raise exception 'Valeur manquante pour %', v_cle; end if;
        if v_val is not null and v_cle <> 'majoration' and v_val < 0 then raise exception 'Valeur négative pour %', v_cle; end if;
        if v_cle = 'majoration' and v_val is not null and (v_val < -50 or v_val > 300) then raise exception 'Majoration hors bornes (-50 %% à 300 %%)'; end if;
        select * into r_t from bien_tarification where bien_id = v_bien.id and cle = v_cle and canal = v_canal and source = 'powerhouse';
        if found then v_avant := jsonb_build_object('valeur', r_t.valeur, 'mode', r_t.mode, 'texte', r_t.texte); end if;
        if v_eff then
          v_apres := null;
          v_action := case when v_avant is null then 'identique' else 'suppression' end;
        else
          v_apres := jsonb_build_object('valeur', v_val, 'mode', v_mode, 'texte', v_txt);
          v_action := case when v_avant is null then 'ajout'
                           when r_t.valeur is not distinct from v_val and r_t.texte is not distinct from v_txt then 'identique'
                           when p_mode = 'vides' then 'deja_renseigne'
                           else 'modification' end;
        end if;
        if not p_simuler then
          if v_action in ('ajout', 'modification') then
            insert into bien_tarification (bien_id, cle, canal, source, valeur, texte, mode, options, detail, maj_le, maj_par)
            values (v_bien.id, v_cle, v_canal, 'powerhouse', v_val, v_txt, v_mode, null, left(coalesce(nullif(v_op ->> 'detail', ''), v_lib), 500), now(), v_email)
            on conflict (bien_id, cle, canal, source) do update
              set valeur = excluded.valeur, texte = excluded.texte, mode = excluded.mode, detail = excluded.detail, maj_le = excluded.maj_le, maj_par = excluded.maj_par;
          elsif v_action = 'suppression' then
            delete from bien_tarification where id = r_t.id;
          end if;
        end if;

      -- ── Frais (bien_frais) ──
      elsif v_type = 'frais' then
        v_cle := v_op ->> 'cle'; v_canal := nullif(v_op ->> 'canal', '');
        if v_cle is null or v_cle !~ '^[a-z][a-z0-9_]{1,40}$' then raise exception 'Frais invalide : %', v_cle; end if;
        v_champs := coalesce(v_op -> 'champs', '{}'::jsonb);
        select * into r_f from bien_frais where bien_id = v_bien.id and cle = v_cle;
        if found then
          v_avant := jsonb_build_object('libelle', r_f.libelle, 'categorie', r_f.categorie, 'actif', r_f.actif, 'type_valeur', r_f.type_valeur, 'unite', r_f.unite,
            'valeur', r_f.valeur, 'valeurs_canal', r_f.valeurs_canal, 'canaux', to_jsonb(r_f.canaux), 'max_nuits', r_f.max_nuits, 'ordre', r_f.ordre);
          v_apres := v_avant;
        else
          if v_op -> 'defaut' is null or v_op -> 'defaut' ->> 'libelle' is null then raise exception 'Frais % : définition manquante', v_cle; end if;
          v_apres := jsonb_build_object('libelle', v_op -> 'defaut' ->> 'libelle', 'categorie', coalesce(v_op -> 'defaut' ->> 'categorie', 'autre'),
            'actif', coalesce((v_op -> 'defaut' ->> 'actif')::boolean, true), 'type_valeur', coalesce(v_op -> 'defaut' ->> 'type_valeur', 'eur'),
            'unite', coalesce(v_op -> 'defaut' ->> 'unite', 'par_sejour'), 'valeur', null, 'valeurs_canal', null,
            'canaux', coalesce(v_op -> 'defaut' -> 'canaux', 'null'::jsonb), 'max_nuits', coalesce(v_op -> 'defaut' -> 'max_nuits', 'null'::jsonb),
            'ordre', coalesce((v_op -> 'defaut' ->> 'ordre')::int, 100));
        end if;
        foreach k in array c_frais_champs loop
          if v_champs ? k then v_apres := jsonb_set(v_apres, array[k], v_champs -> k); end if;
        end loop;
        if v_champs ? 'valeur' then
          if v_champs -> 'valeur' <> 'null'::jsonb and (v_champs ->> 'valeur')::numeric < 0 then raise exception 'Valeur négative pour le frais %', v_cle; end if;
          if v_canal is null then
            v_apres := jsonb_set(v_apres, '{valeur}', v_champs -> 'valeur');
          else
            v_vc := coalesce(nullif(v_apres -> 'valeurs_canal', 'null'::jsonb), '{}'::jsonb);
            v_vc := case when v_champs -> 'valeur' = 'null'::jsonb then v_vc - v_canal else v_vc || jsonb_build_object(v_canal, (v_champs ->> 'valeur')::numeric) end;
            v_apres := jsonb_set(v_apres, '{valeurs_canal}', case when v_vc = '{}'::jsonb then 'null'::jsonb else v_vc end);
          end if;
        end if;
        if v_apres ->> 'type_valeur' = 'pct' then v_apres := jsonb_set(v_apres, '{unite}', '"par_sejour"'); end if;
        if jsonb_typeof(v_apres -> 'canaux') = 'array' and jsonb_array_length(v_apres -> 'canaux') = 0 then v_apres := jsonb_set(v_apres, '{canaux}', 'null'::jsonb); end if;
        -- « vide » : frais absent, ou valeur visée (commune / du canal) non réglée
        v_vide := v_avant is null or (v_champs ? 'valeur' and (case when v_canal is null then v_avant -> 'valeur' = 'null'::jsonb
                                                                    else coalesce(v_avant -> 'valeurs_canal' -> v_canal, 'null'::jsonb) = 'null'::jsonb end));
        v_action := case when v_avant is null then 'ajout'
                         when v_avant = v_apres then 'identique'
                         when p_mode = 'vides' and not v_vide then 'deja_renseigne'
                         else 'modification' end;
        if not p_simuler and v_action in ('ajout', 'modification') then
          insert into bien_frais (bien_id, cle, libelle, categorie, actif, type_valeur, unite, valeur, valeurs_canal, canaux, max_nuits, ordre, origine, maj_le, maj_par)
          values (v_bien.id, v_cle, left(v_apres ->> 'libelle', 80), v_apres ->> 'categorie', (v_apres ->> 'actif')::boolean, v_apres ->> 'type_valeur', v_apres ->> 'unite',
            (v_apres ->> 'valeur')::numeric, nullif(v_apres -> 'valeurs_canal', 'null'::jsonb),
            case when jsonb_typeof(v_apres -> 'canaux') = 'array' then array(select jsonb_array_elements_text(v_apres -> 'canaux')) end,
            (v_apres ->> 'max_nuits')::int, (v_apres ->> 'ordre')::int, left(v_lib, 300), now(), v_email)
          on conflict (bien_id, cle) do update set libelle = excluded.libelle, categorie = excluded.categorie, actif = excluded.actif, type_valeur = excluded.type_valeur,
            unite = excluded.unite, valeur = excluded.valeur, valeurs_canal = excluded.valeurs_canal, canaux = excluded.canaux, max_nuits = excluded.max_nuits,
            origine = excluded.origine, maj_le = excluded.maj_le, maj_par = excluded.maj_par;
        end if;
        v_cle := 'frais:' || v_cle; v_canal := coalesce(v_canal, 'tous');

      -- ── Conditions de vente directe ──
      elsif v_type = 'vente_directe' then
        v_cle := 'vente_directe'; v_canal := 'direct';
        v_champs := coalesce(v_op -> 'champs', '{}'::jsonb);
        select * into r_v from bien_vente_directe where bien_id = v_bien.id;
        if found then
          v_avant := jsonb_build_object('active', r_v.active, 'meilleur_prix', r_v.meilleur_prix, 'paiement_defaut', r_v.paiement_defaut,
            'seuil_totalite_jours', r_v.seuil_totalite_jours, 'fenetre_min_jours', r_v.fenetre_min_jours);
          v_apres := v_avant;
        else
          v_apres := jsonb_build_object('active', false, 'meilleur_prix', 'bloquant', 'paiement_defaut', 'acompte_50', 'seuil_totalite_jours', 30, 'fenetre_min_jours', 1);
        end if;
        foreach k in array c_vd_champs loop
          if v_champs ? k then v_apres := jsonb_set(v_apres, array[k], v_champs -> k); end if;
        end loop;
        v_action := case when v_avant is null then 'ajout' when v_avant = v_apres then 'identique' when p_mode = 'vides' then 'deja_renseigne' else 'modification' end;
        if not p_simuler and v_action in ('ajout', 'modification') then
          insert into bien_vente_directe (bien_id, active, meilleur_prix, paiement_defaut, seuil_totalite_jours, fenetre_min_jours, maj_le, maj_par)
          values (v_bien.id, (v_apres ->> 'active')::boolean, v_apres ->> 'meilleur_prix', v_apres ->> 'paiement_defaut',
            (v_apres ->> 'seuil_totalite_jours')::int, (v_apres ->> 'fenetre_min_jours')::int, now(), v_email)
          on conflict (bien_id) do update set active = excluded.active, meilleur_prix = excluded.meilleur_prix, paiement_defaut = excluded.paiement_defaut,
            seuil_totalite_jours = excluded.seuil_totalite_jours, fenetre_min_jours = excluded.fenetre_min_jours, maj_le = excluded.maj_le, maj_par = excluded.maj_par;
        end if;
        -- Journal comparable à l'écran (même forme que trg_bien_vente_directe_journal, champs utiles seulement)

      -- ── Tags ──
      elsif v_type = 'tag' then
        v_cle := 'tags'; v_canal := 'tous';
        v_txt := lower(btrim(coalesce(v_op ->> 'ajouter', v_op ->> 'retirer', '')));
        if v_txt = '' or length(v_txt) > 40 then raise exception 'Tag invalide'; end if;
        v_avant := to_jsonb(coalesce(v_bien.tags, '{}'));
        v_tags := case when v_op ? 'ajouter' then (select array_agg(distinct t order by t) from unnest(coalesce(v_bien.tags, '{}') || array[v_txt]) t)
                       else array_remove(coalesce(v_bien.tags, '{}'), v_txt) end;
        v_apres := to_jsonb(coalesce(v_tags, '{}'));
        v_action := case when v_avant = v_apres then 'identique' else 'modification' end;
        if not p_simuler and v_action = 'modification' then
          update bien set tags = coalesce(v_tags, '{}') where id = v_bien.id;
          v_bien.tags := coalesce(v_tags, '{}');
        end if;
      else
        raise exception 'Type d''opération inconnu : %', v_type;
      end if;

      v_lignes := v_lignes || jsonb_build_object('bien_id', v_bien.id, 'code', v_bien.code, 'op', v_i, 'cle', v_cle, 'canal', v_canal,
        'avant', v_avant, 'apres', v_apres, 'action', v_action);
    end loop;
  end loop;

  return jsonb_build_object('lot', case when p_simuler then null else v_lot end, 'simulation', p_simuler, 'libelle', v_lib, 'lignes', v_lignes);
end $$;
revoke all on function public.bien_reglages_masse(uuid[], jsonb, text, boolean, text) from public, anon;
grant execute on function public.bien_reglages_masse(uuid[], jsonb, text, boolean, text) to authenticated;
