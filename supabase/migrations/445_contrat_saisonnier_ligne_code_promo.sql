-- 445 — Contrats saisonniers : ligne « code promo » au §4 Conditions financières (16/10/2026, vente directe).
-- DÉJÀ APPLIQUÉE en production le 16/10/2026 (MCP execute_sql) — fichier de traçabilité, rejouable sans effet (garde).
-- Bloc optionnel {{#has_promo}} inséré juste après {{/has_options}} dans les 6 modèles saisonniers ACTIFS
-- (dcb fr 2026-v4, dcb en/es 2026-v2, lauian fr/en/es 2026-v2). Variables calculées par dcb-planning/api/generate-contract.js
-- (varsPromo : devis_option.promo via resa_paiement_choix.devis_id) : promo_libelle (« dont code X (−N % sur les nuits) »),
-- promo_montant_eur (« −Y € »), promo_note (« remise déjà déduite du total »). Sans code : has_promo=false → rien ne change.
-- Retour arrière : replace(contenu_html, '{{#has_promo}}…{{/has_promo}}', '').
update contract_templates
set contenu_html = replace(contenu_html, '{{/has_options}}',
  '{{/has_options}}{{#has_promo}}<tr><td>{{promo_libelle}}</td><td class="amount">{{promo_montant_eur}}</td><td style="font-size:9pt">{{promo_note}}</td></tr>{{/has_promo}}')
where is_active and type_contrat = 'saisonnier' and position('{{#has_promo}}' in contenu_html) = 0;
