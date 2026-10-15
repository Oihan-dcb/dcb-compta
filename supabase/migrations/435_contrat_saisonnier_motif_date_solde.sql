-- 435 — Contrats saisonniers : la date du solde n'est plus décrite « 30 jours avant l'arrivée » (décision d'Oïhan 15/10/2026)
--
-- Règle réelle (generate-contract dateSolde, _resaManuelle.dateSoldeParDefaut) : la plus tardive de « arrivée − 30 j »
-- et « réservation + 7 j » ; ou date choisie par le bureau / acceptée au paiement en ligne (date_solde_force).
-- La date affichée était déjà la date réelle ; seul le motif entre parenthèses change. Il vient de la nouvelle variable
-- {{date_solde_motif}} (PowerHouse api/generate-contract.js motifDateSolde, FR / EN / ES) :
--   FR (dcb, lauian)  : « … le {{date_solde}} (30 jours avant l'arrivée). »  →  « … le {{date_solde}} ({{date_solde_motif}}). »
--   EN / ES (dcb, lauian) : ligne « solde carte » du tableau, « Automatic card charge on due date » /
--                       « Cargo automático en tarjeta en la fecha de vencimiento » + « ({{date_solde_motif}}) »
-- 6 modèles actifs (saisonnier, is_active). Sauvegarde avant modification : scratchpad contrats/sauvegarde_solde/.
-- Contrats déjà générés / signés : inchangés (contenu_html_rendered figé).
-- Rendu vérifié : 6 modèles × 6 politiques × 8 paiements × options × (règle | date convenue) = 960 rendus, seul ce passage change.

do $$
declare n int;
begin
  update contract_templates
     set contenu_html = replace(contenu_html, '(30 jours avant l''arrivée).{{/has_solde}}', '({{date_solde_motif}}).{{/has_solde}}'), updated_at = now()
   where type_contrat = 'saisonnier' and is_active and langue = 'fr'
     and contenu_html like '%(30 jours avant l''arrivée).{{/has_solde}}%';
  get diagnostics n = row_count; raise notice 'FR : % modèle(s)', n;

  update contract_templates
     set contenu_html = replace(contenu_html, 'Automatic card charge on due date</td>', 'Automatic card charge on due date ({{date_solde_motif}})</td>'), updated_at = now()
   where type_contrat = 'saisonnier' and is_active and langue = 'en'
     and contenu_html like '%Automatic card charge on due date</td>%';
  get diagnostics n = row_count; raise notice 'EN : % modèle(s)', n;

  update contract_templates
     set contenu_html = replace(contenu_html, 'Cargo automático en tarjeta en la fecha de vencimiento</td>', 'Cargo automático en tarjeta en la fecha de vencimiento ({{date_solde_motif}})</td>'), updated_at = now()
   where type_contrat = 'saisonnier' and is_active and langue = 'es'
     and contenu_html like '%Cargo automático en tarjeta en la fecha de vencimiento</td>%';
  get diagnostics n = row_count; raise notice 'ES : % modèle(s)', n;
end $$;
