-- 403 — Paiements en plusieurs fois (contract_payments) : rappel J-7, reçu le jour J, nouvelles tentatives
--        J+2 / J+4 après échec, lien sécurisé « mettre à jour ma carte » (11/10/2026).
--
-- Moteur : dcb-contrats api/_prelevement.js (cron-payments 07h00 UTC, webhook-stripe, page /carte, paiement-action).
-- Cycle d'une échéance (statut inchangé : scheduled / pending / succeeded / failed / cancelled) :
--   scheduled ──(J-7 : rappel au voyageur, une seule fois : rappel_envoye_le)──► scheduled
--   scheduled ──(jour J : tentative 1)──► pending ──► succeeded (reçu au voyageur une seule fois : recu_envoye_le)
--                                               └──► failed + prochaine_tentative_le = J+2 (tentative 2), puis J+4 (tentative 3)
--   failed après la 3e tentative, ou erreur définitive (carte volée / perdue / fermée / expirée…) → a_traiter_main = true
--   (alerte bureau « à traiter à la main », plus aucune tentative automatique).
--   Carte mise à jour par le voyageur (lien maj_carte_jeton) → nouvelle carte posée sur toutes ses échéances non payées
--   et tentative immédiate de celles qui sont dues.
-- Idempotence : chaque transition est un PATCH conditionnel (CAS) ; les mails « échec » ne partent qu'une fois par
-- tentative (echec_notifie_tentative), l'alerte bureau une fois par tentative (alerte_bureau_tentative).

alter table public.contract_payments
  add column if not exists rappel_envoye_le         timestamptz,
  add column if not exists recu_envoye_le           timestamptz,
  add column if not exists prochaine_tentative_le   date,
  add column if not exists echec_code               text,
  add column if not exists echec_definitif          boolean not null default false,
  add column if not exists a_traiter_main           boolean not null default false,
  add column if not exists echec_notifie_tentative  integer not null default 0,
  add column if not exists alerte_bureau_tentative  integer not null default 0,
  add column if not exists maj_carte_jeton          text,
  add column if not exists carte_maj_le             timestamptz;

comment on column public.contract_payments.rappel_envoye_le        is 'Rappel J-7 envoyé au voyageur (une seule fois par échéance).';
comment on column public.contract_payments.recu_envoye_le          is 'Mail « prélèvement effectué » envoyé (une seule fois).';
comment on column public.contract_payments.prochaine_tentative_le  is 'Date de la prochaine tentative automatique après un échec (J+2, J+4) ; null = aucune.';
comment on column public.contract_payments.echec_code              is 'Code Stripe du dernier échec (decline_code sinon code).';
comment on column public.contract_payments.echec_definitif         is 'Dernier échec non réessayable (carte volée / perdue / fermée / expirée…).';
comment on column public.contract_payments.a_traiter_main          is 'Plus de tentative automatique (3 échecs ou échec définitif) : le bureau traite à la main.';
comment on column public.contract_payments.echec_notifie_tentative is 'Dernière tentative pour laquelle le voyageur a été prévenu de l''échec.';
comment on column public.contract_payments.alerte_bureau_tentative is 'Dernière tentative pour laquelle le bureau a été alerté.';
comment on column public.contract_payments.maj_carte_jeton         is 'Jeton secret du lien « mettre à jour ma carte » (page /carte de dcb-contrats).';
comment on column public.contract_payments.carte_maj_le            is 'Dernière mise à jour de la carte par le voyageur via le lien.';

create unique index if not exists contract_payments_maj_carte_jeton_key
  on public.contract_payments (maj_carte_jeton) where maj_carte_jeton is not null;
create index if not exists idx_cp_reessai
  on public.contract_payments (prochaine_tentative_le) where statut = 'failed' and prochaine_tentative_le is not null;
