-- 490 — Contrat de location saisonnière : « Total à régler » affiché même quand tout est déjà payé (la colonne disait
-- « Payé le … »), relevé dans les restes du 17/10/2026 (464). 19/10/2026.
-- NOUVELLES VERSIONS des 6 modèles saisonniers actifs (anciennes lignes CONSERVÉES, désactivées, comme 443/456/464/469) :
--   dcb fr 2026-v8 → v9 ; dcb en/es, lauian fr/en/es 2026-v6 → v7.
-- Seul changement : le libellé de la 1re ligne du tableau §4 dépend de la NOUVELLE variable {{is_tout_regle}}
-- (PowerHouse api/generate-contract.js, 487e0c5 — déployé AVANT cette migration) :
--   FR « Total réglé » / « Total du séjour » · EN « Total paid » / « Total for the stay » · ES « Total pagado » / « Total de la estancia ».
--   is_tout_regle = séjour déjà payé en entier (stripe_dcb_already_paid) ou paiement en ligne sans solde restant.
-- Contrats déjà envoyés / signés : INCHANGÉS (generate-contract relit LEUR modèle par template_id) — rendu identique
-- vérifié 96/96 sur le vrai handler ; diff avant/après des 108 rendus limité à ce libellé.
-- Rejouable : n'insère que si la nouvelle version n'existe pas, puis bascule is_active.
do $$
declare
  r record;
  nouv text;
  rempl constant jsonb := jsonb_build_object(
    'fr', jsonb_build_array('<td>Total à régler{{#has_taxes_total}}', '<td>{{#is_tout_regle}}Total réglé{{/is_tout_regle}}{{^is_tout_regle}}Total du séjour{{/is_tout_regle}}{{#has_taxes_total}}'),
    'en', jsonb_build_array('<td>Total to pay{{#has_taxes_total}}',   '<td>{{#is_tout_regle}}Total paid{{/is_tout_regle}}{{^is_tout_regle}}Total for the stay{{/is_tout_regle}}{{#has_taxes_total}}'),
    'es', jsonb_build_array('<td>Total a pagar{{#has_taxes_total}}',  '<td>{{#is_tout_regle}}Total pagado{{/is_tout_regle}}{{^is_tout_regle}}Total de la estancia{{/is_tout_regle}}{{#has_taxes_total}}'));
  cible constant jsonb := '{"dcb_fr":["2026-v8","2026-v9"],"dcb_en":["2026-v6","2026-v7"],"dcb_es":["2026-v6","2026-v7"],
                           "lauian_fr":["2026-v6","2026-v7"],"lauian_en":["2026-v6","2026-v7"],"lauian_es":["2026-v6","2026-v7"]}';
begin
  for r in select * from contract_templates where type_contrat = 'saisonnier'
             and (agence || '_' || langue) in (select jsonb_object_keys(cible))
             and version = cible -> (agence || '_' || langue) ->> 0 loop
    if exists (select 1 from contract_templates where type_contrat = 'saisonnier' and agence = r.agence and langue = r.langue
               and version = cible -> (r.agence || '_' || r.langue) ->> 1) then continue; end if;
    if (length(r.contenu_html) - length(replace(r.contenu_html, rempl -> r.langue ->> 0, ''))) / length(rempl -> r.langue ->> 0) <> 1 then
      raise exception 'libellé introuvable ou non unique : % %', r.agence, r.langue;
    end if;
    nouv := replace(r.contenu_html, rempl -> r.langue ->> 0, rempl -> r.langue ->> 1);
    insert into contract_templates (agence, langue, type_contrat, version, nom, contenu_html, variables_attendues, is_active)
    values (r.agence, r.langue, 'saisonnier', cible -> (r.agence || '_' || r.langue) ->> 1, r.nom, nouv, r.variables_attendues, false);
  end loop;
  -- Bascule : la nouvelle version devient la seule active
  update contract_templates t set is_active = (t.version = cible -> (t.agence || '_' || t.langue) ->> 1)
   where t.type_contrat = 'saisonnier' and (t.agence || '_' || t.langue) in (select jsonb_object_keys(cible))
     and t.version in (cible -> (t.agence || '_' || t.langue) ->> 0, cible -> (t.agence || '_' || t.langue) ->> 1)
     and exists (select 1 from contract_templates n where n.type_contrat = 'saisonnier' and n.agence = t.agence and n.langue = t.langue
                 and n.version = cible -> (t.agence || '_' || t.langue) ->> 1);
end $$;
