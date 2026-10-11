-- 404 — Taxe de séjour retenue par Booking (« CITY_TAX (Withheld Tax) ») : détection automatique du collecteur
--       (11/10/2026, décision Oïhan : Booking COLLECTE ET REVERSE lui-même la taxe → ces résas ne vont PAS dans notre
--       déclaration, sinon double déclaration).
--
-- Constat : depuis mars 2025, les résas Booking de GAXUXA, IBANETA, M-MAITE, MIRAMARVEL, PANTXIKA, TXOMIN portent
-- dans hospitable_raw.financials.guest.taxes une ligne « … (Withheld Tax) » (CITY_TAX, « taxe de séjour (Withheld
-- Tax) (7.20%) », « CITY TAX for Biarritz (Withheld Tax) ») ; avant (2022 → 2025) la ligne était « taxe de séjour
-- (5.5%) » SANS « Withheld » (taxe laissée dans le virement → collectée par nous). Le réglage du bien (401) disait
-- « Booking → nous » pour tous.
--
-- Racine :
--   1. taxe_booking_collecteur(raw) : 'plateforme' si une taxe voyageur porte « Withheld », 'nous' si une ligne taxe de
--      séjour sans « Withheld », null sinon. Même règle en JS : dcb-compta src/lib/taxeSejour.js collecteurResa()
--      (la déclaration décide PAR RÉSA : le constat de la résa prime sur le réglage du bien).
--   2. Trigger sur reservation (Booking) : dès qu'une résa Booking indique « Withheld », bien.taxe_collecte.booking passe
--      à « plateforme » (taxe_maj_par = « auto : … », tracé dans bien_tarification_journal). Jamais l'inverse
--      automatiquement : un retour à « nous » est signalé dans « À vérifier » (fiche PowerHouse) et se fait à la main.
--   3. Rattrapage : même règle appliquée aux biens dont la DERNIÈRE résa Booking portant une taxe de séjour dit « Withheld ».
--
-- Ventilation : NON concernée et juste. La taxe retenue par Booking n'est que dans financials.guest.taxes ; la
-- ventilation lit financials.host (revenue déjà net de cette taxe, host.taxes sans elle) → aucune ligne TAXE, rien
-- reversé au propriétaire ni gardé par DCB pour ces montants (vérifié : 0 ligne ventilation « withheld »).
-- Déclarations passées : AUCUNE n'est modifiée (pas de table de déclarations ; rapport séparé pour Oïhan / Laura).

-- ── 1. Règle ──────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.taxe_booking_collecteur(p_raw jsonb)
returns text language sql immutable set search_path = public as $$
  select case
    when bool_or(coalesce(t->>'label', '') ~* 'withheld') then 'plateforme'
    when bool_or(coalesce(t->>'label', '') ~* '(city.?tax|taxe de s[ée]jour|tourist.?tax)') then 'nous'
  end
  from jsonb_array_elements(case when jsonb_typeof(p_raw->'financials'->'guest'->'taxes') = 'array'
                                 then p_raw->'financials'->'guest'->'taxes' else '[]'::jsonb end) t
$$;
comment on function public.taxe_booking_collecteur(jsonb) is
  'Qui collecte la taxe de séjour d''une résa Booking d''après hospitable_raw : plateforme (« Withheld Tax »), nous (ligne taxe sans Withheld), null (aucune ligne). Miroir JS : dcb-compta src/lib/taxeSejour.js taxeBookingCollecteur().';

-- ── 2. Détection automatique ──────────────────────────────────────────────────────────────────────────────
create or replace function public.trg_reservation_taxe_collecte_booking()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.bien_id is not null and taxe_booking_collecteur(new.hospitable_raw) = 'plateforme' then
    update bien
       set taxe_collecte = jsonb_set(coalesce(taxe_collecte, '{}'::jsonb), '{booking}', '"plateforme"'),
           taxe_maj_le   = now(),
           taxe_maj_par  = 'auto : Booking retient la taxe (« Withheld », résa ' || coalesce(new.code, new.id::text) || ')'
     where id = new.bien_id
       and coalesce(taxe_collecte->>'booking', 'nous') <> 'plateforme';
  end if;
  return null;
end $$;
drop trigger if exists trg_reservation_taxe_collecte_booking on public.reservation;
create trigger trg_reservation_taxe_collecte_booking
  after insert or update of hospitable_raw on public.reservation
  for each row when (new.platform = 'booking')
  execute function public.trg_reservation_taxe_collecte_booking();

-- Journal : une mise à jour automatique est attribuée à « auto : … » (et non à l'utilisateur dont l'action a déclenché
-- la synchro de la résa). Reste identique à 401 sinon.
create or replace function public.trg_bien_taxe_journal()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  a jsonb := jsonb_build_object('classement', old.classification, 'confirme', old.classification_confirmee, 'date', old.classification_date,
    'fin', old.classification_fin, 'commune', old.taxe_commune, 'regime', old.taxe_regime, 'collecte', old.taxe_collecte,
    'tarif_saisi', old.taxe_tarif_saisi, 'note', old.taxe_note);
  n jsonb := jsonb_build_object('classement', new.classification, 'confirme', new.classification_confirmee, 'date', new.classification_date,
    'fin', new.classification_fin, 'commune', new.taxe_commune, 'regime', new.taxe_regime, 'collecte', new.taxe_collecte,
    'tarif_saisi', new.taxe_tarif_saisi, 'note', new.taxe_note);
  v_par text := case when new.taxe_maj_par like 'auto :%' and new.taxe_maj_par is distinct from old.taxe_maj_par
                     then new.taxe_maj_par else coalesce(auth.email(), new.taxe_maj_par, 'système') end;
begin
  if a is distinct from n then
    insert into bien_tarification_journal (bien_id, cle, canal, operation, avant, apres, par)
    values (new.id, 'taxe_sejour', 'tous', 'modification', a, n, v_par);
  end if;
  return new;
end $$;

-- ── 3. Rattrapage : dernière résa Booking avec une taxe de séjour = « Withheld » ──────────────────────────
with derniere as (
  select distinct on (r.bien_id) r.bien_id, r.code, taxe_booking_collecteur(r.hospitable_raw) as qui
    from reservation r
   where r.platform = 'booking' and r.final_status = 'accepted' and taxe_booking_collecteur(r.hospitable_raw) is not null
   order by r.bien_id, r.arrival_date desc
)
update bien b
   set taxe_collecte = jsonb_set(coalesce(b.taxe_collecte, '{}'::jsonb), '{booking}', '"plateforme"'),
       taxe_maj_le   = now(),
       taxe_maj_par  = 'auto : Booking retient la taxe (« Withheld », résa ' || d.code || ')'
  from derniere d
 where d.bien_id = b.id and d.qui = 'plateforme'
   and coalesce(b.taxe_collecte->>'booking', 'nous') <> 'plateforme';
