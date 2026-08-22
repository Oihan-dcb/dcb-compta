-- Phase 3 de la centralisation staff cross-app (docs/staff-data-ownership.md) : journalisation
-- (PAS de blocage) de toute modification d'un champ "classe C" (paie/légal/accès) sur
-- auto_entrepreneur par un compte bureau (staff/gérant/assistante/acces_admin).
--
-- Pourquoi log-only et pas un blocage par app : la RLS existante (ae_update) et le trigger
-- trg_check_ae_self_update_scope (migration fix_ae_privilege_escalation_and_bureau_bucket,
-- 21/08/2026) protègent déjà le vrai risque identifié (un AE qui élève ses propres privilèges
-- via son compte self-service) en bloquant tout sauf memo_perso/notification_prefs/ical_perso
-- pour un acteur non-bureau. Un compte bureau (Oïhan/Laura/gérant/assistante), lui, est
-- authentifié IDENTIQUEMENT que ce soit depuis dcb-compta ou PowerHouse — la base ne voit qu'un
-- rôle, jamais une application cliente. Un trigger ne peut donc pas distinguer "écriture
-- légitime depuis dcb-compta" de "écriture depuis une future extension malencontreuse de
-- PowerHouse" : bloquer par colonne pour tout compte bureau casserait l'écran d'admin complet
-- de dcb-compta lui-même. La protection réelle contre ce risque reste donc côté code
-- (STAFF_EDITABLE_FIELDS dans dcb-planning/src/app.jsx) ; ce trigger ajoute seulement une trace
-- d'audit dans journal_ops (déjà utilisé pour la traçabilité comptable) pour pouvoir vérifier
-- après coup, si un champ classe C change de façon inattendue, par quel auth.uid() et quand.

create or replace function public.log_auto_entrepreneur_classe_c_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  changed text[] := '{}';
begin
  -- Écritures backend (service_role, cron, edge functions) : pas de session utilisateur à
  -- auditer ici, et aucun endpoint service_role n'écrit sur cette table (vérifié par grep
  -- exhaustif dans les 3 apps consommatrices au moment de l'écriture de ce trigger).
  if auth.uid() is null then
    return new;
  end if;

  if new.taux_horaire is distinct from old.taux_horaire then changed := changed || 'taux_horaire'; end if;
  if new.heures_contrat is distinct from old.heures_contrat then changed := changed || 'heures_contrat'; end if;
  if new.forfait_menage is distinct from old.forfait_menage then changed := changed || 'forfait_menage'; end if;
  if new.is_assujetti_tva is distinct from old.is_assujetti_tva then changed := changed || 'is_assujetti_tva'; end if;
  if new.siret is distinct from old.siret then changed := changed || 'siret'; end if;
  if new.iban is distinct from old.iban then changed := changed || 'iban'; end if;
  if new.adresse is distinct from old.adresse then changed := changed || 'adresse'; end if;
  if new.date_debut is distinct from old.date_debut then changed := changed || 'date_debut'; end if;
  if new.date_fin is distinct from old.date_fin then changed := changed || 'date_fin'; end if;
  if new.type is distinct from old.type then changed := changed || 'type'; end if;
  if new.agence is distinct from old.agence then changed := changed || 'agence'; end if;
  if new.voit_toutes_agences is distinct from old.voit_toutes_agences then changed := changed || 'voit_toutes_agences'; end if;
  if new.acces_admin is distinct from old.acces_admin then changed := changed || 'acces_admin'; end if;
  if new.acces_calendrier is distinct from old.acces_calendrier then changed := changed || 'acces_calendrier'; end if;
  if new.saisie_heures is distinct from old.saisie_heures then changed := changed || 'saisie_heures'; end if;
  if new.ae_user_id is distinct from old.ae_user_id then changed := changed || 'ae_user_id'; end if;
  if new.token_acces is distinct from old.token_acces then changed := changed || 'token_acces'; end if;
  if new.actif is distinct from old.actif then changed := changed || 'actif'; end if;

  if array_length(changed, 1) > 0 then
    insert into public.journal_ops(categorie, action, statut, source, message, avant, apres, meta)
    values (
      'staff_guard',
      'update_champ_classe_c',
      'audit',
      'auto_entrepreneur_trigger',
      'Champ(s) classe C modifié(s) sur auto_entrepreneur ' || new.id::text || ' par auth.uid()=' || auth.uid()::text || ' : ' || array_to_string(changed, ', '),
      to_jsonb(old),
      to_jsonb(new),
      jsonb_build_object('ae_id', new.id, 'auth_uid', auth.uid(), 'changed_fields', changed)
    );
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_log_auto_entrepreneur_classe_c_change on public.auto_entrepreneur;
create trigger trg_log_auto_entrepreneur_classe_c_change
  before update on public.auto_entrepreneur
  for each row execute function public.log_auto_entrepreneur_classe_c_change();
