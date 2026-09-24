-- Migration 271 : ajustements ménage M+1 sur la facture honoraires DCB (I-155, 24/09/2026)
--
-- Problème : le coût réel de l'aide-ménage (ventilation AUTO/FMEN.montant_reel) est souvent connu
-- APRÈS l'envoi de la facture du mois (ménage de fin de mois déclaré début M+1). Or la clôture du
-- bien (trg_fige_cloture) interdisait toute modification de montant_reel, et update-ventilation-auto
-- sautait les biens clôturés : le réel restait figé pour toujours (ex. BELEZIA/HMB8ZZT4FP juillet,
-- ménage validé 125 € après l'envoi, réel resté à 0 €) et le forfait ménage facturé ne se
-- régularisait jamais.
--
-- Principe : la clôture fige la FACTURE (montants facturés), pas l'information de coût réel.
--   1. trg_fige_cloture : sur ventilation, un UPDATE qui ne change ni montant_ht/tva/ttc ni code est
--      autorisé même bien clôturé — donc montant_reel et fmen_facture (mémoire du facturé) aussi.
--   2. facture_evoliz_ligne.ventilation_id : ligne « Ajustement ménage » rattachée à sa résa ; le
--      marqueur fmen_facture de la résa n'est avancé qu'à l'envoi Evoliz de la facture (evoliz.js).
--   3. Backfill de fmen_facture (mémoire de ce qui a été facturé), agence dcb, jusqu'à août 2026 :
--      - avant mai 2026 : valeur effective actuelle → aucun ajustement rétroactif ;
--      - mai→août, biens mode proprio : effectif actuel (mois déjà régularisés à la main par les frais
--        « Ajustement ménage (coût réel) » de septembre, journal regularisation_fmen_reel) ;
--      - mai→août, biens mode dcb : le forfait prévu, réellement facturé → l'écart dû au réel figé
--        sortira proprement en ajustement sur septembre (simulation validée par Oïhan le 24/09).

create or replace function public.check_cloture_bien_fige()
returns trigger
language plpgsql
as $function$
declare
  v_bien uuid;
  v_mois text;
begin
  if tg_op = 'DELETE' then v_bien := old.bien_id; else v_bien := new.bien_id; end if;

  if tg_table_name = 'ventilation' then
    if tg_op = 'DELETE' then v_mois := old.mois_comptable; else v_mois := new.mois_comptable; end if;
  elsif tg_table_name = 'prestation_hors_forfait' then
    if tg_op = 'DELETE' then v_mois := old.mois; else v_mois := new.mois; end if;
  elsif tg_table_name = 'frais_proprietaire' then
    if tg_op = 'DELETE' then v_mois := left(old."date"::text, 7); else v_mois := left(new."date"::text, 7); end if;
  end if;

  if v_bien is null or v_mois is null then
    return coalesce(new, old);
  end if;

  if not exists (select 1 from cloture_bien cb where cb.bien_id = v_bien and cb.mois = v_mois and cb.active) then
    return coalesce(new, old);
  end if;

  -- ── Bien clôturé : exceptions chirurgicales par table ──
  if tg_op = 'UPDATE' then
    if tg_table_name = 'ventilation' then
      -- Montants FACTURÉS inchangés → autorisé : liaison bancaire (mouvement_id), coût réel de
      -- l'aide-ménage (montant_reel) et mémoire du facturé (fmen_facture) — I-155, migration 271.
      if new.montant_ht  is not distinct from old.montant_ht
         and new.montant_tva is not distinct from old.montant_tva
         and new.montant_ttc is not distinct from old.montant_ttc
         and new.code is not distinct from old.code then
        return new;
      end if;
    elsif tg_table_name = 'prestation_hors_forfait' then
      if new.montant is not distinct from old.montant
         and new.duree_minutes is not distinct from old.duree_minutes
         and new.type_imputation is not distinct from old.type_imputation
         and new.mois is not distinct from old.mois
         and new.bien_id is not distinct from old.bien_id then
        return new; -- transition de statut / validation : autorisée
      end if;
    elsif tg_table_name = 'frais_proprietaire' then
      if new.montant_ttc is not distinct from old.montant_ttc
         and new.montant_deduit_loy is not distinct from old.montant_deduit_loy
         and new.mode_traitement is not distinct from old.mode_traitement
         and new.bien_id is not distinct from old.bien_id then
        return new; -- statut / statut_deduction / reliquat : autorisés
      end if;
    end if;
  end if;

  raise exception '🔒 Bien clôturé (mois %) : la facture est envoyée à Evoliz, la saisie est figée. Rouvrez la saisie depuis Facturation (🔓 Rouvrir saisie — supprime aussi le brouillon Evoliz).', v_mois
    using errcode = 'P0001';
end
$function$;

alter table public.facture_evoliz_ligne
  add column if not exists ventilation_id uuid references public.ventilation(id) on delete set null;
comment on column public.facture_evoliz_ligne.ventilation_id is
  'I-155 : ligne « Ajustement ménage » d''une résa d''un mois déjà facturé — son montant avance ventilation.fmen_facture à l''envoi Evoliz.';

-- Backfill de la mémoire du facturé (agence dcb uniquement : Lauïan a déjà son propre marquage)
update public.ventilation v
set fmen_facture = case
    when v.mois_comptable < '2026-05' then coalesce(v.montant_reel, v.montant_ttc)
    when b.mode_encaissement = 'proprio' then coalesce(v.montant_reel, v.montant_ttc)
    else v.montant_ttc
  end
from public.bien b
where b.id = v.bien_id and b.agence = 'dcb'
  and v.code = 'FMEN' and v.fmen_facture is null
  and v.mois_comptable <= '2026-08';
