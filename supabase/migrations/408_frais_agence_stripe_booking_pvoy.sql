-- 408 — Décisions Oïhan du 11/10/2026 (fiche Tarification / comparaison des canaux)
--
-- 1. Coût des paiements Stripe : à la charge de l'AGENCE propriétaire du compte Stripe utilisé (DCB pour
--    DCB, Lauïan pour Lauïan). vente_directe_parametres.stripe_a_charge : 'dcb' → 'agence' (la valeur
--    'dcb' était fausse pour Lauïan). Le justificatif séquestre impute déjà les frais Stripe à l'agence
--    du compte pour tous les paiements arrivés sur le Stripe de l'agence de la résa ; les 6 paiements
--    de résas Lauïan encaissés sur le Stripe DCB (juin → sept. 2026, mois clôturés) ont été imputés à
--    Lauïan : 209,37 € + 23,81 € (annulation ALTHEA) — rapport, pas de régularisation automatique.
-- 2. Frais de gestion Booking : reviennent à l'agence AU TITRE DE LA COM (ventilationCore.js, règle
--    datée 2026-10). booking_gestion_vers : 'dcb' → 'agence'. La comparaison des canaux n'ajoute plus
--    d'« ajustement » : la ventilation (simulation) le fait elle-même.
-- 3. Frais libres de la fiche (bien_frais catégorie « autre » : lit bébé…) : nouveau code de ventilation
--    PVOY (prestation voyageur de l'agence, TVA 20 %), facturé sur la facture COM, figé avec elle.
--    Le verrou I-132 (facture COM envoyée → lignes COM figées) couvre désormais PVOY.
-- Aucune ligne de ventilation existante n'est modifiée (vérifié : 0 écart ancien/nouveau moteur sur
-- 4 904 résas réelles).

-- ═══ 1+2. Paramètres de la comparaison des canaux ═══════════════════════════════════════════════
alter table public.vente_directe_parametres drop constraint if exists vente_directe_parametres_stripe_a_charge_check;
alter table public.vente_directe_parametres drop constraint if exists vente_directe_parametres_booking_gestion_vers_check;
update public.vente_directe_parametres
   set stripe_a_charge = 'agence', booking_gestion_vers = 'agence', confirme = true, maj_le = now(),
       maj_par = 'Décision Oïhan 11/10/2026 (migration 408)'
 where stripe_a_charge in ('dcb', 'agence') or booking_gestion_vers in ('dcb', 'agence');
alter table public.vente_directe_parametres alter column stripe_a_charge set default 'agence';
alter table public.vente_directe_parametres alter column booking_gestion_vers set default 'agence';
alter table public.vente_directe_parametres add constraint vente_directe_parametres_stripe_a_charge_check
  check (stripe_a_charge in ('agence', 'proprietaire'));
alter table public.vente_directe_parametres add constraint vente_directe_parametres_booking_gestion_vers_check
  check (booking_gestion_vers in ('agence', 'proprietaire'));
comment on table public.vente_directe_parametres is
  'Paramètres de la comparaison Airbnb / Booking / Direct, PAR AGENCE. Décisions Oïhan 11/10/2026 (408) : coût Stripe à la charge de l''agence propriétaire du compte Stripe ; frais de gestion Booking → agence (COM, appliqué par la ventilation depuis 2026-10). stripe_pct / stripe_fixe_centimes : tarif estimé (mesuré 2026 : DCB ≈ 2,0 %, Lauïan ≈ 1,6 % frais fixes compris).';
comment on column public.vente_directe_parametres.confirme is
  'true = à qui reviennent les frais (stripe_a_charge, booking_gestion_vers) décidé par Oïhan ; le tarif Stripe reste une estimation.';

-- ═══ 3. Verrou COM étendu aux prestations voyageurs (PVOY) ═════════════════════════════════════
create or replace function public.check_cloture_com_fige()
 returns trigger
 language plpgsql
as $function$
declare
  v_code text;
  v_bien_id uuid;
  v_mois text;
  v_agence text;
  v_locked boolean;
begin
  if tg_op = 'DELETE' then
    v_code := old.code; v_bien_id := old.bien_id; v_mois := old.mois_comptable;
  else
    v_code := new.code; v_bien_id := new.bien_id; v_mois := new.mois_comptable;
  end if;

  -- COM et PVOY (408) : tous deux portés par la facture COM globale du mois.
  if v_code is null or v_code not in ('COM', 'PVOY') or v_bien_id is null or v_mois is null then
    -- UPDATE qui change le code VERS COM/PVOY : contrôlé ci-dessous via old.code ; sinon libre
    if not (tg_op = 'UPDATE' and old.code in ('COM', 'PVOY')) then
      return coalesce(new, old);
    end if;
    v_code := old.code; v_bien_id := old.bien_id; v_mois := old.mois_comptable;
  end if;

  select b.agence into v_agence from bien b where b.id = v_bien_id;
  if v_agence is null then
    return coalesce(new, old);
  end if;

  select exists(
    select 1 from cloture_comptable cc
    where cc.mois = v_mois and cc.agence = v_agence and cc.cloture_facturat is not null
  ) into v_locked;

  if not v_locked then
    return coalesce(new, old);
  end if;

  -- Exception chirurgicale : liaison bancaire (mouvement_id, montant_reel) autorisée,
  -- même principe que check_cloture_bien_fige pour la ventilation générale.
  if tg_op = 'UPDATE' then
    if new.montant_ht  is not distinct from old.montant_ht
       and new.montant_tva is not distinct from old.montant_tva
       and new.montant_ttc is not distinct from old.montant_ttc
       and new.code    is not distinct from old.code then
      return new;
    end if;
  end if;

  raise exception '🔒 % figée pour % (%) — la facture COM globale a déjà été envoyée à Evoliz. Contactez Oïhan pour rouvrir (cloture_comptable.cloture_facturat).',
    case when v_code = 'PVOY' then 'Prestation voyageur (PVOY)' else 'Commission (COM)' end, v_mois, v_agence
    using errcode = 'P0001';
end;
$function$;

comment on function public.check_cloture_com_fige() is
  'I-132 étendu (408) : lignes ventilation COM et PVOY figées dès que la facture COM du mois (agence du bien) est envoyée à Evoliz.';

-- Appliquée en 408 (avec le code « EXTRA ») puis 408b le même jour (11/10/2026) : code renommé PVOY avant
-- tout usage — « EXTRA » désignait, dans la doc historique (CF-P1), les prestations AE hors forfait.
