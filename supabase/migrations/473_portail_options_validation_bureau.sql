-- 473 — OPTIONS DU PORTAIL « EN ATTENTE DE VALIDATION » (17/10/2026, Oïhan : « les équipements, c'est des options avec
-- paiement en attente jusqu'à ce que le bureau les accepte »). Équipements et prestations qui mobilisent le terrain (recouche,
-- ménage en cours de séjour) : PaymentIntent en capture MANUELLE (empreinte, carte non débitée) → le bureau accepte (capture
-- → effets), refuse (empreinte annulée, rien débité) ou offre (empreinte annulée, effets à 0 €). Stock tenu jusqu'à la
-- décision ; échéance = min(fin de l'empreinte Stripe − 6 h, arrivée − 24 h) → rappel push à Oïhan puis annulation
-- automatique. Rien en compta tant que rien n'est capturé (trigger 463 : seuls les statuts payés comptent).
alter table public.portail_voyageur_commande drop constraint if exists portail_voyageur_commande_statut_check;
alter table public.portail_voyageur_commande add constraint portail_voyageur_commande_statut_check check (statut in (
  'essai_simulee', 'attente_bureau', 'payee', 'appliquee', 'echec', 'annulee',
  'paiement_attente', 'effet_en_cours', 'a_verifier', 'remboursee', 'remboursee_partiel', 'echec_paiement',
  'validation_attente',   -- 473 : empreinte posée, en attente de la décision du bureau (stock tenu)
  'refusee',              -- 473 : refusée par le bureau / échéance / séjour annulé : empreinte annulée, rien débité
  'offerte'               -- 473 : offerte : empreinte annulée, effets créés à 0 €
));
alter table public.portail_voyageur_commande
  add column if not exists validation boolean not null default false,   -- capture manuelle (décision du bureau)
  add column if not exists capture_avant timestamptz,                    -- fin de l'empreinte chez Stripe (capture_before)
  add column if not exists echeance timestamptz,                         -- décision attendue avant (puis annulation auto)
  add column if not exists rappel_le timestamptz,
  add column if not exists autorisation_etendue text,                    -- extended_authorization Stripe (enabled / disabled / null)
  add column if not exists decision jsonb;                               -- { choix: accepter|refuser|offrir|auto, par, le, motif }
create index if not exists portail_voyageur_commande_validation_idx on public.portail_voyageur_commande (echeance) where statut = 'validation_attente';
