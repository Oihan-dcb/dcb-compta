-- 366 — Consigne du bureau sur une mission de ménage (Messagerie PowerHouse → portail AE « Ma journée »).
-- Champ DÉDIÉ : mission_menage.note sert déjà aux notes comptables et à l'alerte des missions orphelines.
-- Attachée à la mission (pas à l'AE) : survit à un changement d'auto-entrepreneur.
alter table public.mission_menage
  add column if not exists consigne_staff text,
  add column if not exists consigne_maj_at timestamptz,
  add column if not exists consigne_maj_par uuid;
comment on column public.mission_menage.consigne_staff is 'Consigne du bureau pour l''AE de la mission (saisie depuis la Messagerie PowerHouse). Distincte de note (notes comptables/admin). Attachée à la mission : survit à un changement d''AE.';
-- Retour arrière : alter table public.mission_menage drop column consigne_staff, drop column consigne_maj_at, drop column consigne_maj_par;
