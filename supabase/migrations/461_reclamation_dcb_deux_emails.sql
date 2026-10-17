-- 461 — Réclamations DCB : les DEUX adresses (Oïhan 17/10/2026 : « les deux ») dans le paragraphe médiation des modèles
-- DCB mandat_administration fr 2026-v3 et mobilite fr 2026-v3 (créés par 460 le même jour, AUCUN document généré dessus :
-- vérifié mandat_signature / rental_contracts = 0 → mise à jour en place). Lauïan inchangé ({{agence_email}} = laura@).
update contract_templates
set contenu_html = replace(contenu_html,
  'adressée par écrit à l''Agence ({{agence_email}} ou par courrier à son adresse)',
  'adressée par écrit à l''Agence (oihan@destinationcotebasque.com ou conciergerie@destinationcotebasque.com, ou par courrier à son adresse)')
where agence = 'dcb' and is_active and type_contrat in ('mandat_administration','mobilite') and version = '2026-v3'
  and not exists (select 1 from mandat_signature m where m.template_id = contract_templates.id)
  and not exists (select 1 from rental_contracts r where r.template_id = contract_templates.id);
