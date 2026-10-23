-- 571 — Mandats DCB + Lauïan : le solde du loyer des réservations directes aligné sur les CGL (art. 6.2-6.3)
-- (décision d'Oïhan, tableau du 23/10/2026, incohérence relevée à l'arbitrage des faits appris des mails).
-- Avant (2026-v3) : « 50 % à la réservation, le solde du loyer acquitté un mois avant la mise à disposition des lieux. »
-- Après (2026-v4) : paiement selon les CGL, solde 30 jours avant l'arrivée (ou 7 jours après une réservation faite moins de
-- 37 jours avant), totalité à la réservation pour une arrivée dans moins de 30 jours.
-- Procédure de versionnement habituelle (cf. 460) : nouvelle ligne = copie de la v3 active avec cette seule phrase remplacée,
-- puis bascule is_active. Mandats déjà générés, envoyés ou signés : INCHANGÉS (relisent LEUR template_id).
-- La mise à jour automatique des contrats non signés (contract_maj, 520) ne concerne que type_contrat = 'saisonnier'.
-- Rejouable sans effet (not exists + garde sur la phrase).

do $$
declare
  ancien constant text := '50 % à la réservation, le solde du loyer acquitté un mois avant la mise à disposition des lieux.';
  nouveau constant text := 'Réservations en direct : paiement selon les conditions générales de location de l''agence, en une fois à la réservation, ou 50 % à la réservation et le solde 30 jours avant l''arrivée (7 jours après la réservation si celle-ci intervient moins de 37 jours avant l''arrivée), à la date fixée dans le contrat de location ; pour une arrivée dans moins de 30 jours, la totalité est réglée à la réservation.';
  ag text; src record;
begin
  foreach ag in array array['dcb', 'lauian'] loop
    if exists (select 1 from contract_templates where agence = ag and langue = 'fr' and type_contrat = 'mandat_administration' and version = '2026-v4') then
      continue;
    end if;
    select * into src from contract_templates where agence = ag and langue = 'fr' and type_contrat = 'mandat_administration' and version = '2026-v3';
    if src.id is null then raise exception 'mandat % 2026-v3 introuvable', ag; end if;
    if strpos(src.contenu_html, ancien) = 0 then raise exception 'phrase « un mois avant » introuvable dans le mandat % v3', ag; end if;
    insert into contract_templates (agence, langue, type_contrat, version, nom, contenu_html, variables_attendues, is_active)
    values (ag, 'fr', 'mandat_administration', '2026-v4', src.nom, replace(src.contenu_html, ancien, nouveau), src.variables_attendues, false);
    update contract_templates set is_active = false, updated_at = now() where agence = ag and langue = 'fr' and type_contrat = 'mandat_administration' and is_active;
    update contract_templates set is_active = true, updated_at = now() where agence = ag and langue = 'fr' and type_contrat = 'mandat_administration' and version = '2026-v4';
  end loop;
end $$;
