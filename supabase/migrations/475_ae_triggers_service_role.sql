-- 475 — Les gardes de auto_entrepreneur laissent passer les fonctions serveur (service_role).
-- Bug constaté le 19/10/2026 : create-ae-user (edge function, clé secrète) n'a pas pu poser
-- ae_user_id sur la fiche de Claudine → « Modification de champs réservés au bureau refusée ».
-- Les deux gardes ne reconnaissaient que les comptes bureau/staff connectés (auth.uid()) ; une
-- fonction serveur n'a pas d'utilisateur. Le service_role est de confiance (jamais côté navigateur).

create or replace function public.auto_entrepreneur_prevent_self_elevation()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth_user_is_bureau() or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  if new.type is distinct from old.type
     or new.acces_admin is distinct from old.acces_admin
     or new.acces_powerhouse is distinct from old.acces_powerhouse
     or new.voit_toutes_agences is distinct from old.voit_toutes_agences
     or new.secteurs is distinct from old.secteurs
     or new.ae_user_id is distinct from old.ae_user_id
     or new.linked_ae_user_id is distinct from old.linked_ae_user_id
  then
    raise exception 'Modification de champs réservés au bureau refusée' using errcode = '42501';
  end if;
  return new;
end;
$function$;

create or replace function public.check_ae_self_update_scope()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth_user_is_staff() or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  if new.nom is distinct from old.nom
     or new.prenom is distinct from old.prenom
     or new.adresse is distinct from old.adresse
     or new.code_postal is distinct from old.code_postal
     or new.ville is distinct from old.ville
     or new.siret is distinct from old.siret
     or new.email is distinct from old.email
     or new.telephone is distinct from old.telephone
     or new.iban is distinct from old.iban
     or new.ical_url is distinct from old.ical_url
     or new.taux_horaire is distinct from old.taux_horaire
     or new.note is distinct from old.note
     or new.actif is distinct from old.actif
     or new.token_acces is distinct from old.token_acces
     or new.ae_user_id is distinct from old.ae_user_id
     or new.type is distinct from old.type
     or new.agence is distinct from old.agence
     or new.auto_send_navette is distinct from old.auto_send_navette
     or new.ical_pro is distinct from old.ical_pro
     or new.date_debut is distinct from old.date_debut
     or new.date_fin is distinct from old.date_fin
     or new.is_chat_manager is distinct from old.is_chat_manager
     or new.chat_group_slug is distinct from old.chat_group_slug
     or new.is_chat_hidden is distinct from old.is_chat_hidden
     or new.linked_ae_user_id is distinct from old.linked_ae_user_id
     or new.is_assujetti_tva is distinct from old.is_assujetti_tva
     or new.acces_admin is distinct from old.acces_admin
     or new.saisie_heures is distinct from old.saisie_heures
     or new.contrat_agences is distinct from old.contrat_agences
     or new.heures_contrat is distinct from old.heures_contrat
     or new.acces_calendrier is distinct from old.acces_calendrier
     or new.forfait_menage is distinct from old.forfait_menage
     or new.voit_toutes_agences is distinct from old.voit_toutes_agences
  then
    raise exception '🔒 Modification réservée au staff — seuls memo_perso, notification_prefs et ical_perso peuvent être modifiés directement par l''auto-entrepreneur.'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;
