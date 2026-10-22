-- 523 — Mandat d'administration : le MANDANT peut être une société (22/10/2026).
-- Cas d'origine : Maison Maïté, mandat désormais au nom de la SAS MAITE (SIREN 130 274 301),
-- représentée par sa présidente. generate-mandat (dcb-planning) passe mandant_est_societe et les
-- champs mandant_societe_* / mandant_representant* quand config.mandant_societe est renseigné.
-- Modification en place des modèles actifs 2026-v3 (dcb + lauian) : uniquement des blocs
-- conditionnels ; sans mandant_est_societe le rendu est identique au caractère près.

update contract_templates set
  contenu_html = replace(replace(replace(contenu_html,
    -- 1. Désignation du mandant
    '<div class="sub">Le mandant</div>
  <p>{{mandant_civilite}}',
    '<div class="sub">Le mandant</div>
  {{#mandant_est_societe}}<p>La société <strong>{{mandant_nom}}</strong>, {{mandant_societe_forme}}{{#mandant_societe_capital}} au capital de {{mandant_societe_capital}} euros{{/mandant_societe_capital}}, immatriculée au RCS de {{mandant_societe_rcs}} sous le numéro {{mandant_societe_siren}}, dont le siège social est situé {{mandant_adresse}}, représentée par <strong>{{mandant_representant}}</strong>, agissant en sa qualité de {{mandant_representant_qualite}}, ayant tous pouvoirs à l''effet des présentes.</p>{{/mandant_est_societe}}{{^mandant_est_societe}}<p>{{mandant_civilite}}'),
    '(conjoint : {{mandant_conjoint_nom}}){{/mandant_conjoint_nom}}{{/mandant_situation_matrimoniale}}.</p>',
    '(conjoint : {{mandant_conjoint_nom}}){{/mandant_conjoint_nom}}{{/mandant_situation_matrimoniale}}.</p>{{/mandant_est_societe}}'),
    -- 2. Bloc signature : nom du représentant sous la société
    '<div class="sig-name">{{mandant_civilite}} {{mandant_nom}}</div>',
    '<div class="sig-name">{{mandant_civilite}} {{mandant_nom}}{{#mandant_est_societe}}<br>représentée par {{mandant_representant}}, {{mandant_representant_qualite}}{{/mandant_est_societe}}</div>'),
  updated_at = now()
where type_contrat = 'mandat_administration' and langue = 'fr' and version = '2026-v3' and agence in ('dcb','lauian')
  and contenu_html not like '%mandant_est_societe%';

-- 3. Résidence principale quand le mandant est une société : celle de ses occupants
update contract_templates set
  contenu_html = replace(contenu_html,
    '{{#occ_rp_entiere}}Le MANDANT indique que le bien objet du mandat <strong>constitue sa résidence principale</strong>.',
    '{{#occ_rp_entiere}}Le MANDANT indique que le bien objet du mandat <strong>constitue {{#mandant_est_societe}}la résidence principale de ses occupants{{/mandant_est_societe}}{{^mandant_est_societe}}sa résidence principale{{/mandant_est_societe}}</strong>.'),
  updated_at = now()
where type_contrat = 'mandat_administration' and langue = 'fr' and version = '2026-v3' and agence in ('dcb','lauian')
  and contenu_html not like '%la résidence principale de ses occupants%';
