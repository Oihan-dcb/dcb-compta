-- 512 — « ✏️ Modifier une réservation » : ACCORD DU VOYAGEUR (20/10/2026, demande d'Oïhan « et le voyageur accepte la modif ? »).
--
-- Deux modes au moment de confirmer (resa_modification.mode_accord) :
--   'immediat' : le voyageur l'a déjà demandée / acceptée → appliquée tout de suite (comportement de la 511) ;
--   'accord'   : RIEN n'est appliqué ; le voyageur reçoit l'avant / après et répond (page /api/resa-accord, lien aussi dans son
--                portail) : « J'accepte » → application automatique des étapes ; « Je refuse » ou expiration (48 h par défaut) →
--                retour à l'état d'origine + alerte au bureau. Contrat signé : la SIGNATURE DE L'AVENANT vaut acceptation.
--                Pendant l'attente, les nuits ajoutées sont bloquées dans Hospitable (note « Modif en attente … »), libérées au refus,
--                à l'expiration ou juste avant d'appliquer.
-- accord = { token, expire_le, delai_h, jours_bloques[], note_blocage, avenant_id, envoye_le, accepte_le, refuse_le, source, motif }.

alter table public.resa_modification add column if not exists mode_accord text not null default 'immediat' check (mode_accord in ('immediat', 'accord'));
alter table public.resa_modification add column if not exists accord jsonb;
alter table public.resa_modification drop constraint if exists resa_modification_statut_check;
alter table public.resa_modification add constraint resa_modification_statut_check check (statut in ('en_cours', 'termine', 'partiel', 'attente_accord', 'refusee', 'expiree', 'annulee'));

-- Une seule modification « vivante » par résa (en cours, à reprendre ou en attente d'accord).
drop index if exists public.resa_modification_une_en_cours;
create unique index if not exists resa_modification_une_en_cours on public.resa_modification (reservation_id) where statut in ('en_cours', 'partiel', 'attente_accord');
create unique index if not exists resa_modification_accord_token on public.resa_modification ((accord->>'token')) where accord ? 'token';
create index if not exists resa_modification_attente_idx on public.resa_modification ((accord->>'expire_le')) where statut = 'attente_accord';

alter table public.dispo_action_log drop constraint if exists dispo_action_log_action_check;
alter table public.dispo_action_log add constraint dispo_action_log_action_check check (action = any (array[
  'block', 'unblock', 'set_rules', 'create_direct_reservation', 'create_manual_reservation', 'devis_option', 'devis_prolonger',
  'devis_annuler', 'devis_convertir', 'devis_expire', 'sejour_hors_hospitable', 'sejour_hors_bloquer', 'sejour_hors_annuler',
  'sejour_hors_refacturation', 'contrat_brouillon', 'devis_envoyer', 'devis_paiement', 'devis_paye_converti', 'devis_rembourse',
  'resa_annuler_rembourser', 'portail_option_payee', 'portail_option_rembourse',
  'resa_modifier', 'resa_complement_paye', 'resa_trop_percu_rembourse',
  'resa_modif_proposee', 'resa_modif_acceptee', 'resa_modif_refusee', 'resa_modif_expiree', 'resa_modif_annulee']));
