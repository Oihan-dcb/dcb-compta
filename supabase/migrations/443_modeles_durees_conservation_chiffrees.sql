-- 443 — Durées de conservation CHIFFRÉES dans les modèles FUTURS (décision d'Oïhan 16/10/2026)
-- Mandats DCB / Lauïan (variante apporteur Bordeaux incluse : même modèle), bail mobilité DCB / Lauïan,
-- contrat de prestation AE DCB / Lauïan : « durée du contrat augmentée des délais légaux » remplacé par
-- les durées de la politique de confidentialité (mandat 10 ans, bail 5 ans, AE 5 ans) et la purge réelle
-- (api/cron-purge-identite.js, migration 440).
--
-- Documents déjà signés ou envoyés INCHANGÉS : les modèles 2026-v1 ne sont pas modifiés, seulement
-- désactivés ; de nouveaux modèles 2026-v2 sont créés. Les mandats envoyés (mandat_signature.template_id),
-- les contrats AE « pret » et les baux envoyés (rental_contracts.template_id) restent signés sur leur
-- modèle d'origine (generate-mandat finalize lit template_id ; generate-contrat-ae finalize et
-- bail-mobilite renderBail le font aussi depuis ce même jour).

begin;

-- Sauvegarde des 6 modèles avant modification
create table if not exists public.contract_templates_backup_443 as
  select * from public.contract_templates
  where type_contrat in ('mandat_administration', 'mobilite', 'prestation_ae') and version = '2026-v1';
alter table public.contract_templates_backup_443 enable row level security;

-- Nouvelles versions
insert into public.contract_templates (agence, langue, type_contrat, version, nom, contenu_html, variables_attendues, is_active)
select t.agence, t.langue, t.type_contrat, '2026-v2', t.nom,
  case t.type_contrat
    when 'mandat_administration' then replace(t.contenu_html,
      'conservées pendant la durée du contrat augmentée des délais légaux.',
      'conservées pendant la durée du mandat, puis 10 ans après sa fin (résiliation, remplacement par un nouveau mandat ou sortie du logement de la gestion). À cette échéance, les pièces fournies par le MANDANT (pièce d''identité, photo de vérification, attestation d''assurance habitation, relevé d''identité bancaire, titre de propriété et autres justificatifs, y compris ceux transmis lors du questionnaire d''accueil) sont supprimées automatiquement et le mandat signé, qui les reproduit en annexe, est remplacé par une version expurgée (sans ces pièces, avec l''empreinte numérique du document d''origine). Les pièces comptables sont conservées 10 ans.')
    when 'mobilite' then replace(t.contenu_html,
      'Elles sont conservées pendant la durée du contrat augmentée des délais légaux de prescription, et peuvent',
      'Elles sont conservées pendant la durée du bail, puis 5 ans après sa fin ; à cette échéance, les pièces justificatives (pièces d''identité des signataires, justificatif du motif du bail mobilité, justificatif des pouvoirs du représentant du TIERS PAYEUR, procuration le cas échéant) sont supprimées automatiquement et le bail signé, qui les reproduit en annexe, est remplacé par une version expurgée (sans ces pièces, avec l''empreinte numérique du document d''origine) ; les pièces comptables sont conservées 10 ans. Elles peuvent')
    when 'prestation_ae' then replace(t.contenu_html,
      'conservées pendant sa durée augmentée des délais légaux.',
      'conservées pendant sa durée, puis 5 ans après la fin de la collaboration ; à cette échéance, les pièces justificatives (pièce d''identité, carte Vitale, extrait Kbis ou attestation d''immatriculation, attestation d''assurance le cas échéant, relevé d''identité bancaire) sont supprimées automatiquement. Les factures et pièces comptables sont conservées 10 ans.')
  end,
  t.variables_attendues, true
from public.contract_templates t
where t.type_contrat in ('mandat_administration', 'mobilite', 'prestation_ae') and t.version = '2026-v1' and t.is_active;

-- Contrôle : 6 nouvelles versions, plus aucune formule « délais légaux », une seule modification chacune
do $$
declare n int; reste int;
begin
  select count(*) into n from public.contract_templates where version = '2026-v2'
    and type_contrat in ('mandat_administration', 'mobilite', 'prestation_ae');
  select count(*) into reste from public.contract_templates where version = '2026-v2'
    and type_contrat in ('mandat_administration', 'mobilite', 'prestation_ae') and contenu_html like '%délais légaux%';
  if n <> 6 or reste <> 0 then raise exception '443 : % modèles v2, % encore avec « délais légaux »', n, reste; end if;
end $$;

update public.contract_templates set is_active = false, updated_at = now()
where type_contrat in ('mandat_administration', 'mobilite', 'prestation_ae') and version = '2026-v1';

commit;
