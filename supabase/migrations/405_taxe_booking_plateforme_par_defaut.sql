-- 405 — Taxe de séjour : Booking = « la plateforme » collecte, PAR DÉFAUT et pour TOUS les biens
--       (11/10/2026, décision Oïhan : « Ce n'est pas à nous de déclarer la taxe pour Booking, Booking s'en charge. »)
--
-- Avant (401 + 404) : défaut Booking = « nous » ; seuls les biens dont une résa Booking portait « (Withheld Tax) »
-- basculaient automatiquement sur « plateforme » (6 biens). Les résas Booking sans ligne de taxe restaient donc dans
-- notre déclaration.
-- Maintenant :
--   1. défaut de colonne bien.taxe_collecte.booking = 'plateforme' (+ contrainte : clé absente = plateforme) ;
--   2. tous les biens réglés « nous » (valeur par défaut de 401 : AUCUN réglage manuel trouvé dans le journal) passent
--      à « plateforme », tracé dans bien_tarification_journal (taxe_maj_par = « auto : règle générale … ») ;
--   3. le trigger 404 de bascule automatique est retiré (inutile, et il écraserait un « nous » forcé à la main) ;
--      taxe_booking_collecteur() reste (signalement) ;
--   4. taxe_sejour_bien() : la dernière résa Booking observée prend aussi les lignes « taxe de séjour (x %) » sans
--      « Withheld » → la fiche PowerHouse signale dans « À vérifier » une taxe que nous aurions facturée.
-- Forcer « nous » reste possible bien par bien (fiche 💶 Tarifs & frais › Taxe de séjour, réglage explicite journalisé) :
-- seules les résas Booking SANS « Withheld » de ce bien reviennent alors dans la déclaration (« Withheld » = Booking a
-- retenu la taxe → toujours exclue).
-- Déclaration (dcb-compta PageTaxeSejour, src/lib/taxeSejour.js collecteurResa) : plus aucune résa Booking ; une résa
-- Booking avec une ligne taxe sans « Withheld » est seulement signalée « À vérifier », jamais réintégrée d'office.
-- Déclarations passées : rien n'est modifié (aucune table de déclarations).

-- ── 1. Défaut + contrainte ──────────────────────────────────────────────────────────────────────────────────
alter table public.bien alter column taxe_collecte set default '{"airbnb":"plateforme","booking":"plateforme","direct":"nous"}'::jsonb;
alter table public.bien drop constraint if exists bien_taxe_collecte_check;
alter table public.bien add constraint bien_taxe_collecte_check check (
  jsonb_typeof(taxe_collecte) = 'object'
  and coalesce(taxe_collecte->>'airbnb', 'plateforme') in ('plateforme', 'nous')
  and coalesce(taxe_collecte->>'booking', 'plateforme') in ('plateforme', 'nous')
  and coalesce(taxe_collecte->>'direct', 'nous') in ('plateforme', 'nous'));
comment on column public.bien.taxe_collecte is
  'Qui collecte la taxe par canal : plateforme (elle la reverse elle-même, hors déclaration) ou nous (déclaration agence). Défaut : Airbnb et Booking = plateforme, Direct = nous (405, 11/10/2026).';

-- ── 2. Bascule de tous les biens ────────────────────────────────────────────────────────────────────────────
update public.bien
   set taxe_collecte = jsonb_set(coalesce(taxe_collecte, '{}'::jsonb), '{booking}', '"plateforme"'),
       taxe_maj_le   = now(),
       taxe_maj_par  = 'auto : règle générale — Booking collecte et reverse la taxe de séjour (décision Oïhan 11/10/2026)'
 where coalesce(taxe_collecte->>'booking', 'plateforme') <> 'plateforme';

-- ── 3. Plus de bascule automatique par résa ─────────────────────────────────────────────────────────────────
drop trigger if exists trg_reservation_taxe_collecte_booking on public.reservation;
drop function if exists public.trg_reservation_taxe_collecte_booking();

-- ── 4. taxe_sejour_bien : dernière ligne de taxe de séjour Booking (avec ou sans « Withheld ») ─────────────
create or replace function public.taxe_sejour_bien(p_bien uuid, p_jour date default current_date)
returns jsonb language plpgsql stable set search_path = public as $function$
declare
  b record; bar record; v_trouve boolean := false;
  v_commune text; v_src text; v_classe text; v_eff text; v_expire boolean; v_incoh boolean;
  v_cherche text[]; v_annee int := extract(year from p_jour)::int;
  v_hosp jsonb; v_book jsonb;
begin
  select id, agence, ville, classification, classification_confirmee, classification_date, classification_fin,
         taxe_commune, taxe_regime, taxe_collecte, taxe_tarif_saisi, taxe_note, taxe_maj_le, taxe_maj_par
    into b from bien where id = p_bien;
  if not found then return null; end if;

  v_commune := nullif(trim(coalesce(nullif(trim(b.taxe_commune), ''), b.ville)), '');
  v_src := case when nullif(trim(b.taxe_commune), '') is not null then 'saisie' when v_commune is not null then 'ville' end;
  v_classe := coalesce(b.classification, 'non_classe');
  v_incoh := b.classification_fin is not null and b.classification_date is not null and b.classification_fin <= b.classification_date;
  v_expire := v_classe in ('1_etoile', '2_etoiles', '3_etoiles', '4_etoiles', '5_etoiles', 'palace')
              and b.classification_fin is not null and not v_incoh and b.classification_fin < p_jour;
  v_eff := case when v_expire then 'non_classe' else v_classe end;
  v_cherche := case v_eff when 'chambre_hotes' then array['chambre_hotes', '1_etoile'] when 'autre' then array[]::text[] else array[v_eff] end;

  if v_commune is not null and cardinality(v_cherche) > 0 then
    select c.id, c.agence, c.commune, c.classification, c.annee, c.type_calcul, c.taux_pct, c.plafond_ht, c.tarif_pers_nuit,
           c.coeff_additionnel, c.notes
      into bar
      from taxe_sejour_config c
     where lower(trim(c.commune)) = lower(v_commune) and c.classification = any(v_cherche)
     order by array_position(v_cherche, c.classification), abs(c.annee - v_annee), (c.agence = b.agence) desc, c.annee desc
     limit 1;
    v_trouve := found;
  end if;

  select jsonb_build_object('code', r.code, 'arrivee', r.arrival_date, 'libelle', t->>'label', 'montant_centimes', (t->>'amount')::int,
           'nuits', r.nights, 'adultes', coalesce(nullif(r.hospitable_raw->'guests'->>'adult_count', '')::int, r.guest_count),
           'voyageurs', coalesce(nullif(r.hospitable_raw->'guests'->>'total', '')::int, r.guest_count))
    into v_hosp
    from reservation r
    cross join lateral jsonb_array_elements(coalesce(r.hospitable_raw->'financials'->'guest'->'taxes', '[]'::jsonb)) t
   where r.bien_id = p_bien and r.platform = 'direct' and r.final_status = 'accepted' and not coalesce(r.owner_stay, false)
     and coalesce((t->>'amount')::int, 0) > 0 and coalesce(t->>'label', '') !~* '^(pass-through|tva)'
   order by r.arrival_date desc
   limit 1;

  -- 405 : même motif que taxe_booking_collecteur() (« taxe de séjour (5.5%) » sans Withheld comprise).
  select jsonb_build_object('code', r.code, 'arrivee', r.arrival_date, 'libelle', t->>'label', 'montant_centimes', (t->>'amount')::int,
           'retenue', coalesce(t->>'label', '') ~* 'withheld')
    into v_book
    from reservation r
    cross join lateral jsonb_array_elements(coalesce(r.hospitable_raw->'financials'->'guest'->'taxes', '[]'::jsonb)) t
   where r.bien_id = p_bien and r.platform = 'booking' and r.final_status = 'accepted'
     and coalesce(t->>'label', '') ~* '(city.?tax|taxe de s[ée]jour|tourist.?tax)'
   order by r.arrival_date desc, (coalesce(t->>'label', '') ~* 'withheld') desc
   limit 1;

  return jsonb_build_object(
    'bien_id', b.id, 'agence', b.agence, 'ville', b.ville,
    'commune', v_commune, 'commune_source', v_src,
    'classement', v_classe, 'classement_effectif', v_eff, 'confirme', b.classification_confirmee,
    'date', b.classification_date, 'fin', b.classification_fin, 'expire', v_expire, 'dates_incoherentes', v_incoh,
    'regime', b.taxe_regime, 'collecte', b.taxe_collecte, 'tarif_saisi', b.taxe_tarif_saisi, 'note', b.taxe_note,
    'maj_le', b.taxe_maj_le, 'maj_par', b.taxe_maj_par, 'annee', v_annee,
    'bareme', case when v_trouve then jsonb_build_object('id', bar.id, 'agence', bar.agence, 'commune', bar.commune,
       'classification', bar.classification, 'annee', bar.annee, 'type_calcul', bar.type_calcul, 'taux_pct', bar.taux_pct,
       'plafond_ht', bar.plafond_ht, 'tarif_pers_nuit', bar.tarif_pers_nuit, 'coeff_additionnel', bar.coeff_additionnel,
       'notes', bar.notes, 'ligne_equivalente', bar.classification <> v_eff) end,
    'hospitable', v_hosp, 'booking', v_book);
end $function$;

comment on function public.taxe_booking_collecteur(jsonb) is
  'Constat sur une résa Booking (hospitable_raw) : plateforme (« Withheld Tax »), nous (ligne taxe de séjour sans Withheld → à signaler, 405), null (aucune ligne). Ne décide plus seul : défaut Booking = plateforme (405). Miroir JS : dcb-compta src/lib/taxeSejour.js taxeBookingCollecteur().';
