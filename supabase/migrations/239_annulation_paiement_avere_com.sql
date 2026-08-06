-- Migration 239 : règle "100% COM" sur résa annulée (direct/manual) avec paiement confirmé.
--
-- Contexte : quand une résa direct/manual est annulée mais que le voyageur a quand même payé
-- (frais de retenue/annulation), le moteur de ventilation normal (isDirect && isCancelled) ne
-- crée aucune ligne — l'argent réellement encaissé par DCB reste invisible/non comptabilisé.
-- Décision Oïhan (06/08/2026, cf. incident HOST-EIEADC/408P) : dans ce cas, 100% du paiement
-- NET réellement confirmé (rapprochement bancaire, remboursements Stripe déjà déduits — cf.
-- migration/fix I-68 sync-stripe.js) devient une commission DCB (code COM), et la résa
-- n'apparaît plus dans les rapports propriétaire (fin_revenue=0, même convention que les
-- résas annulées sans frais retenus).
--
-- Déclenchement : au moment où reservation.rapprochee passe à true (paiement confirmé), pas
-- au calcul de ventilation — une résa peut être annulée des semaines avant que l'argent arrive
-- et soit rapproché. Un trigger sur reservation garantit qu'aucun point d'entrée de
-- rapprochement (matching.js, rapprochement.js — une demi-douzaine d'endroits) n'a besoin
-- d'appeler explicitement cette règle : elle s'applique uniformément quel que soit le chemin.
--
-- Exclusions volontaires :
--   - bien.skip_facturation = true (biens perso/famille Oïhan, LAGREOU/ASKIDA — DCB ne prend
--     aucune commission dessus, l'argent retenu appartient au propriétaire, pas à DCB).
--   - bien.agence != 'dcb' (règle pensée pour DCB/Stripe direct ; Lauian hors périmètre).
--   - reservation.ventilation_manuelle = true (un ajustement manuel existant ne doit jamais
--     être écrasé silencieusement par la règle automatique).
--   - montant net confirmé = 0 (rien à ventiler).
--
-- Garde-fou anti-récursion : la fonction met à jour reservation.fin_revenue/ventilation_manuelle
-- sur la même ligne qui a déclenché le trigger (AFTER UPDATE) — le second passage voit
-- rapprochee inchangé (déjà true) ET ventilation_manuelle=true, les deux conditions de garde
-- échouent alors, la récursion s'arrête après un seul niveau.

-- RLS est activée sur reservation et ventilation. SECURITY DEFINER garantit que le trigger
-- écrit dans ventilation quel que soit le rôle qui a déclenché l'UPDATE sur reservation
-- (staff authentifié côté client via matching.js/rapprochement.js, ou service_role côté
-- api/sync-stripe.js) — sans ça, RLS pourrait bloquer silencieusement le insert/delete.
create or replace function fn_annulation_paiement_avere_com()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bien record;
  v_total_paiement bigint;
  v_ht bigint;
  v_tva bigint;
begin
  if NEW.rapprochee is distinct from OLD.rapprochee
     and NEW.rapprochee = true
     and NEW.final_status = 'cancelled'
     and NEW.platform in ('direct', 'manual')
     and NEW.ventilation_manuelle = false
  then
    select b.id, b.proprietaire_id, b.agence, b.skip_facturation
      into v_bien
      from bien b
     where b.id = NEW.bien_id;

    if v_bien.agence = 'dcb' and coalesce(v_bien.skip_facturation, false) = false then
      select coalesce(sum(montant), 0) into v_total_paiement
        from reservation_paiement
       where reservation_id = NEW.id;

      if v_total_paiement <> 0 then
        delete from ventilation where reservation_id = NEW.id;

        v_ht := round(v_total_paiement / 1.20);
        v_tva := v_total_paiement - v_ht;

        insert into ventilation (
          reservation_id, bien_id, proprietaire_id, code, libelle,
          montant_ht, taux_tva, montant_tva, montant_ttc, mois_comptable, calcul_source
        ) values (
          NEW.id, NEW.bien_id, v_bien.proprietaire_id, 'COM',
          'Commission DCB — résa annulée, paiement confirmé conservé à 100%',
          v_ht, 20, v_tva, v_total_paiement, NEW.mois_comptable, 'auto_annulation_com'
        );

        update reservation
           set fin_revenue = 0, ventilation_calculee = true, ventilation_manuelle = true
         where id = NEW.id;
      end if;
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_annulation_paiement_avere_com on reservation;
create trigger trg_annulation_paiement_avere_com
  after update on reservation
  for each row
  execute function fn_annulation_paiement_avere_com();
