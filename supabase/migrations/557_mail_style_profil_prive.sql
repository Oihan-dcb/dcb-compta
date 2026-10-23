-- 557 — Profil de style appris des mails d'Oïhan : rangé sur SA boîte (powerhouse_imap_accounts.style_profil, aucun accès
-- client) au lieu de ga_agency_config (lisible par le bureau), car il contient de courts extraits anonymisés de ses mails.
-- Lu côté serveur seulement : brouillons de l'assistant mail (boîte concernée) et IA voyageurs (boîte principale de l'agence).
alter table public.powerhouse_imap_accounts add column if not exists style_profil jsonb;
update public.powerhouse_imap_accounts a set style_profil = c.style_profil_mail
  from public.ga_agency_config c where c.agence = a.agence and a.role = 'principal' and c.style_profil_mail is not null and a.style_profil is null;
alter table public.ga_agency_config drop column if exists style_profil_mail;
