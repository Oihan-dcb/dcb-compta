-- 424 — Contrats saisonniers : ligne « dont options choisies » (services vendus en ligne, 15/10/2026).
-- Bloc {{#has_options}}…{{/has_options}} inséré juste après la ligne « Total à régler » des 6 templates saisonniers
-- actifs (DCB / Lauïan × FR / EN / ES). Sans option (has_options faux, cas de tous les contrats existants) le bloc
-- ne rend RIEN : HTML strictement identique. Montants et échéances inchangés (le total inclut déjà les options).
-- Variables : has_options, options_total_eur, options_detail (dcb-planning api/generate-contract.js).
create table if not exists public.contract_templates_backup_20261015 as
  select * from public.contract_templates where is_active and type_contrat = 'saisonnier';
alter table public.contract_templates_backup_20261015 enable row level security;
update public.contract_templates t set contenu_html = regexp_replace(t.contenu_html,
  '(\{\{modalite_loyer_label\}\}</td>\s*</tr>)',
  '\1{{#has_options}}<tr><td>' || case t.langue when 'en' then 'including selected options' when 'es' then 'de los cuales opciones elegidas' else 'dont options choisies' end
  || '<br><span style="font-weight:normal;font-size:9pt;color:#8C7B65;">{{options_detail}}</span></td><td class="amount">{{options_total_eur}}</td><td style="font-size:9pt"></td></tr>{{/has_options}}'),
  updated_at = now()
where t.is_active and t.type_contrat = 'saisonnier' and position('has_options' in t.contenu_html) = 0;
