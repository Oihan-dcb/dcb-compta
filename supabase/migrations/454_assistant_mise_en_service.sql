-- 454 : Assistant « 🏁 Nouveau bien » / Mise en service (PowerHouse, 16/10/2026, demande d'Oïhan).
--
-- 1. bien_mise_en_service : ce que l'équipe COCHE à la main dans l'assistant (étapes qui ne se détectent pas :
--    annonce Airbnb / Booking, bloc de réservation posé sur la page du site…) + statut forcé « fait » /
--    « non concerné » avec une note. Tout le reste de l'assistant est CALCULÉ (aucune copie des données).
--    Lecture : staff de son périmètre ; écriture : auth_user_peut_editer_fiches (bureau, managers du secteur).
-- 2. mes_preremplir(bien, items, par) : « Préremplir ce qui peut l'être » — applique en UNE transaction les
--    propositions validées dans l'aperçu (calculées par api/_miseEnService.js). JAMAIS d'écrasement : chaque
--    élément n'est écrit que si la valeur est encore vide au moment de l'écriture (sinon « déjà saisi : gardé »).
--    Journal : les triggers existants (bien_tarification, bien_frais, bien_vente_directe, taxe) écrivent dans
--    bien_tarification_journal ; les écritures sans trigger (horaires, n° d'enregistrement, lits) y sont ajoutées
--    ici ; toutes les lignes du lot portent lot / lot_libelle « Assistant Nouveau bien — préremplissage ».
--    service_role seulement (l'API vérifie droits + périmètre avant d'appeler).

create table if not exists public.bien_mise_en_service (
  bien_id      uuid not null references public.bien(id) on delete cascade,
  etape        text not null check (etape ~ '^[a-z][a-z0-9_]{1,39}$'),
  coches       jsonb not null default '{}'::jsonb check (jsonb_typeof(coches) = 'object'), -- { cle: { le, par } }
  statut_force text check (statut_force in ('fait', 'non_concerne')),
  note         text check (note is null or char_length(note) <= 500),
  constat      jsonb,  -- dernier constat AUTOMATIQUE (ex. bloc de réservation lu sur la page du site : { etat, le })
  maj_le       timestamptz not null default now(),
  maj_par      text,
  primary key (bien_id, etape)
);
alter table public.bien_mise_en_service add column if not exists constat jsonb;
comment on table public.bien_mise_en_service is 'Assistant Nouveau bien (454) : cases cochées à la main par étape + statut forcé (fait / non concerné). Le reste est calculé (api/bien-mise-en-service.js).';

alter table public.bien_mise_en_service enable row level security;
drop policy if exists bien_mise_en_service_lecture on public.bien_mise_en_service;
create policy bien_mise_en_service_lecture on public.bien_mise_en_service for select to authenticated
  using (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));
drop policy if exists bien_mise_en_service_ecriture on public.bien_mise_en_service;
create policy bien_mise_en_service_ecriture on public.bien_mise_en_service for all to authenticated
  using (auth_user_peut_editer_fiches() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
  with check (auth_user_peut_editer_fiches() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));
grant select, insert, update, delete on public.bien_mise_en_service to authenticated;

-- ─── Préremplissage ─────────────────────────────────────────────────────────────────────────────────
-- items : [{ id, type, … }] ; types :
--   tarif  { cle ∈ majoration|prix_base_nuit|prix_base_weekend, canal, valeur, mode? }
--   frais  { cle ∈ gestion|menage_community, canal, valeur, categorie, type_valeur, unite, libelle, origine }
--   bien   { champ ∈ heure_arrivee_defaut|heure_depart_defaut|taxe_commune|numero_enregistrement, valeur }
--   titre  { fr }                       → bien_vente_directe.contenu.titre.fr (ligne créée NON publiée si absente)
--   lits_hospitable {}                  → bien_lits_depuis_hospitable (room_details) si aucun lit
--   lit    { piece, lit (simple|double|queen|king|canape_lit|superpose), largeur_cm?, ordre?, note } → bien_lit (source hospitable) si le bien n'avait AUCUN lit au départ
create or replace function public.mes_preremplir(p_bien uuid, p_items jsonb, p_par text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  it jsonb; v_typ text; v_id text; v_cle text; v_canal text; v_val numeric; v_txt text; v_n int;
  v_ok jsonb := '[]'::jsonb; v_ko jsonb := '[]'::jsonb;
  v_lot uuid := gen_random_uuid();
  v_lib constant text := 'Assistant Nouveau bien — préremplissage';
  v_par text := left(coalesce(nullif(btrim(p_par), ''), 'assistant') || ' — assistant Nouveau bien', 120);
  v_sans_lit boolean;
  v_f record;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'items_invalides'; end if;
  if jsonb_array_length(p_items) > 60 then raise exception 'trop_d_items'; end if;
  if not exists (select 1 from bien where id = p_bien) then raise exception 'bien_introuvable'; end if;
  v_sans_lit := not exists (select 1 from bien_lit where bien_id = p_bien and actif);

  for it in select * from jsonb_array_elements(p_items) loop
    v_typ := it->>'type'; v_id := coalesce(it->>'id', v_typ);
    begin
      if v_typ = 'tarif' then
        v_cle := it->>'cle'; v_canal := it->>'canal'; v_val := (it->>'valeur')::numeric;
        if v_cle not in ('majoration', 'prix_base_nuit', 'prix_base_weekend') or v_canal not in ('tous', 'airbnb', 'booking', 'direct')
           or v_val is null or v_val < 0 then
          v_ko := v_ko || jsonb_build_object('id', v_id, 'raison', 'valeur refusée'); continue;
        end if;
        if exists (select 1 from bien_tarification where bien_id = p_bien and cle = v_cle and canal = v_canal and source = 'powerhouse' and (valeur is not null or texte is not null)) then
          v_ko := v_ko || jsonb_build_object('id', v_id, 'raison', 'déjà saisi : gardé'); continue;
        end if;
        insert into bien_tarification (bien_id, cle, canal, source, valeur, mode, maj_le, maj_par)
        values (p_bien, v_cle, v_canal, 'powerhouse', v_val, nullif(it->>'mode', ''), now(), v_par)
        on conflict (bien_id, cle, canal, source) do update set valeur = excluded.valeur, mode = excluded.mode, maj_le = now(), maj_par = v_par
          where bien_tarification.valeur is null and bien_tarification.texte is null;
        v_ok := v_ok || jsonb_build_object('id', v_id);

      elsif v_typ = 'frais' then
        v_cle := it->>'cle'; v_canal := it->>'canal'; v_val := (it->>'valeur')::numeric;
        if v_cle not in ('gestion', 'menage_community') or v_canal not in ('airbnb', 'booking', 'direct') or v_val is null or v_val < 0 then
          v_ko := v_ko || jsonb_build_object('id', v_id, 'raison', 'valeur refusée'); continue;
        end if;
        select * into v_f from bien_frais where bien_id = p_bien and cle = v_cle;
        if found then
          if not v_f.actif then v_ko := v_ko || jsonb_build_object('id', v_id, 'raison', 'frais désactivé à la main : gardé'); continue; end if;
          if v_f.valeur is not null or (v_f.valeurs_canal ? v_canal and v_f.valeurs_canal->>v_canal is not null) then
            v_ko := v_ko || jsonb_build_object('id', v_id, 'raison', 'déjà saisi : gardé'); continue;
          end if;
          update bien_frais set valeurs_canal = coalesce(valeurs_canal, '{}'::jsonb) || jsonb_build_object(v_canal, v_val), maj_le = now(), maj_par = v_par
           where id = v_f.id;
        else
          insert into bien_frais (bien_id, cle, libelle, categorie, actif, type_valeur, unite, valeur, valeurs_canal, origine, maj_le, maj_par)
          values (p_bien, v_cle, coalesce(nullif(it->>'libelle', ''), v_cle), it->>'categorie', true, it->>'type_valeur', coalesce(it->>'unite', 'par_sejour'),
                  null, jsonb_build_object(v_canal, v_val), left(coalesce(it->>'origine', v_lib), 300), now(), v_par);
        end if;
        v_ok := v_ok || jsonb_build_object('id', v_id);

      elsif v_typ = 'bien' then
        v_cle := it->>'champ'; v_txt := nullif(btrim(it->>'valeur'), '');
        if v_txt is null then v_ko := v_ko || jsonb_build_object('id', v_id, 'raison', 'valeur vide'); continue; end if;
        if v_cle in ('heure_arrivee_defaut', 'heure_depart_defaut') then
          if v_txt !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then v_ko := v_ko || jsonb_build_object('id', v_id, 'raison', 'heure invalide'); continue; end if;
          execute format('update bien set %I = $1 where id = $2 and nullif(btrim(%I), '''') is null', v_cle, v_cle) using v_txt, p_bien;
        elsif v_cle = 'numero_enregistrement' then
          if v_txt !~ '^[0-9A-Z]{13}$' then v_ko := v_ko || jsonb_build_object('id', v_id, 'raison', 'numéro invalide'); continue; end if;
          if exists (select 1 from bien where numero_enregistrement = v_txt and id <> p_bien) then
            v_ko := v_ko || jsonb_build_object('id', v_id, 'raison', 'numéro déjà porté par un autre bien'); continue;
          end if;
          update bien set numero_enregistrement = v_txt where id = p_bien and nullif(btrim(numero_enregistrement), '') is null;
        elsif v_cle = 'taxe_commune' then
          if not exists (select 1 from taxe_sejour_config where lower(commune) = lower(v_txt)) then
            v_ko := v_ko || jsonb_build_object('id', v_id, 'raison', 'commune sans barème'); continue;
          end if;
          update bien set taxe_commune = v_txt, taxe_maj_le = now(), taxe_maj_par = left('auto : ' || v_par, 120)
           where id = p_bien and nullif(btrim(taxe_commune), '') is null;
        else
          v_ko := v_ko || jsonb_build_object('id', v_id, 'raison', 'champ refusé'); continue;
        end if;
        get diagnostics v_n = row_count;
        if v_n = 0 then v_ko := v_ko || jsonb_build_object('id', v_id, 'raison', 'déjà saisi : gardé'); continue; end if;
        if v_cle <> 'taxe_commune' then -- taxe : journal par trg_bien_taxe_journal
          insert into bien_tarification_journal (bien_id, cle, canal, operation, avant, apres, par)
          values (p_bien, 'fiche:' || v_cle, 'tous', 'ajout', null, jsonb_build_object('valeur', v_txt), v_par);
        end if;
        v_ok := v_ok || jsonb_build_object('id', v_id);

      elsif v_typ = 'titre' then
        v_txt := nullif(btrim(it->>'fr'), '');
        if v_txt is null or char_length(v_txt) > 120 then v_ko := v_ko || jsonb_build_object('id', v_id, 'raison', 'titre invalide'); continue; end if;
        if not exists (select 1 from bien_vente_directe where bien_id = p_bien) then
          insert into bien_vente_directe (bien_id, active, essai, contenu, maj_le, maj_par)
          values (p_bien, false, false, jsonb_build_object('titre', jsonb_build_object('fr', v_txt)), now(), v_par);
        else
          update bien_vente_directe
             set contenu = contenu || jsonb_build_object('titre', coalesce(case when jsonb_typeof(contenu->'titre') = 'object' then contenu->'titre' end, '{}'::jsonb) || jsonb_build_object('fr', v_txt)),
                 maj_le = now(), maj_par = v_par
           where bien_id = p_bien and nullif(btrim(contenu #>> '{titre,fr}'), '') is null;
          get diagnostics v_n = row_count;
          if v_n = 0 then v_ko := v_ko || jsonb_build_object('id', v_id, 'raison', 'déjà saisi : gardé'); continue; end if;
        end if;
        v_ok := v_ok || jsonb_build_object('id', v_id);

      elsif v_typ = 'lits_hospitable' then
        if not v_sans_lit or exists (select 1 from bien_lit where bien_id = p_bien) then
          v_ko := v_ko || jsonb_build_object('id', v_id, 'raison', 'couchages déjà saisis : gardés'); continue;
        end if;
        v_n := bien_lits_depuis_hospitable(p_bien);
        if v_n = 0 then v_ko := v_ko || jsonb_build_object('id', v_id, 'raison', 'aucun lit dans l''annonce Hospitable'); continue; end if;
        insert into bien_tarification_journal (bien_id, cle, canal, operation, avant, apres, par)
        values (p_bien, 'couchages', 'tous', 'ajout', null, jsonb_build_object('lits', v_n, 'source', 'room_details Hospitable'), v_par);
        v_ok := v_ok || jsonb_build_object('id', v_id, 'lits', v_n);

      elsif v_typ = 'lit' then
        if not v_sans_lit then v_ko := v_ko || jsonb_build_object('id', v_id, 'raison', 'couchages déjà saisis : gardés'); continue; end if;
        if coalesce(it->>'lit', '') not in ('simple', 'double', 'queen', 'king', 'canape_lit', 'superpose') then
          v_ko := v_ko || jsonb_build_object('id', v_id, 'raison', 'type de lit refusé'); continue;
        end if;
        insert into bien_lit (bien_id, piece, type, largeur_cm, ordre, source, maj_par, note)
        values (p_bien, left(coalesce(nullif(btrim(it->>'piece'), ''), 'Chambre'), 60), it->>'lit',
                coalesce(case when (it->>'largeur_cm') ~ '^[0-9]{2,3}$' and (it->>'largeur_cm')::int between 60 and 220 then (it->>'largeur_cm')::smallint end, lit_largeur_defaut(it->>'lit')),
                coalesce((it->>'ordre')::smallint, 100), 'hospitable', v_par, left(coalesce(it->>'note', 'Déduit de l''annonce — à vérifier'), 200));
        insert into bien_tarification_journal (bien_id, cle, canal, operation, avant, apres, par)
        values (p_bien, 'couchages', 'tous', 'ajout', null, jsonb_build_object('piece', it->>'piece', 'type', it->>'lit', 'largeur_cm', it->>'largeur_cm', 'source', 'texte de l''annonce'), v_par);
        v_ok := v_ok || jsonb_build_object('id', v_id);

      else
        v_ko := v_ko || jsonb_build_object('id', v_id, 'raison', 'type inconnu');
      end if;
    exception when others then
      v_ko := v_ko || jsonb_build_object('id', v_id, 'raison', 'erreur : ' || left(sqlerrm, 160));
    end;
  end loop;

  -- Lot : toutes les lignes de journal écrites par CETTE transaction pour ce bien (triggers compris).
  update bien_tarification_journal set lot = v_lot, lot_libelle = v_lib
   where bien_id = p_bien and le = now() and lot is null;

  return jsonb_build_object('lot', v_lot, 'appliques', v_ok, 'ignores', v_ko);
end $$;
revoke all on function public.mes_preremplir(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.mes_preremplir(uuid, jsonb, text) to service_role;
comment on function public.mes_preremplir(uuid, jsonb, text) is 'Assistant Nouveau bien (454) : applique les propositions de préremplissage validées, sans jamais écraser une valeur saisie ; journal bien_tarification_journal (lot).';
