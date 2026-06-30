-- 220_mandat_pagebreak.sql
-- Mandat (templates dcb+lauian) : éviter les titres orphelins en bas de page
-- (page-break-after:avoid sur .section-title et .sub) + bloc signatures insécable.
update contract_templates set contenu_html = replace(replace(replace(contenu_html,
  'padding-bottom:6px;margin:20px 0 12px}',
  'padding-bottom:6px;margin:20px 0 12px;page-break-after:avoid;break-after:avoid}'),
  '.sub{font-weight:700;margin:12px 0 2px;color:#1C1C1C}',
  '.sub{font-weight:700;margin:12px 0 2px;color:#1C1C1C;page-break-after:avoid;break-after:avoid}'),
  '.sign-zone{display:flex;justify-content:space-between;margin-top:30px}',
  '.sign-zone{display:flex;justify-content:space-between;margin-top:30px;page-break-inside:avoid;break-inside:avoid}')
where type_contrat='mandat_administration';
