-- 546 — Assistant mail, lot 2 (22/10/2026, validé par Oïhan) : réponses HTML à la charte, boîte conciergerie@, vue activité de
-- l'équipe (sans lire les boîtes de Laura / Léa), factures fournisseurs → Pennylane (proposition validée d'un clic), rattachement
-- mail ↔ réservation / propriétaire / bien, relances « pas de réponse depuis 5 jours », urgences → push immédiat, modèles de
-- réponse, notifications Airbnb / Booking / Hospitable mises de côté (dossier « Plateformes »). Mêmes règles que 545 : Essai par
-- défaut, rien n'est envoyé ni transféré sans le clic de la personne.

alter table public.mail_messages add column if not exists lien_reservation_id uuid;
alter table public.mail_messages add column if not exists lien_proprietaire_id uuid;
alter table public.mail_messages add column if not exists lien_bien_id uuid;
alter table public.mail_messages add column if not exists urgence text;                 -- motif (dégât, plainte, mise en demeure…)
alter table public.mail_messages add column if not exists urgence_push_le timestamptz;
alter table public.mail_messages add column if not exists attend_reponse boolean not null default false; -- mail ENVOYÉ qui attend une réponse
alter table public.mail_messages add column if not exists relance_statut text;
alter table public.mail_messages add column if not exists relance_le timestamptz;
alter table public.mail_messages add column if not exists facture_statut text;
alter table public.mail_messages add column if not exists facture_le timestamptz;
alter table public.mail_messages add column if not exists facture_par text;
alter table public.mail_messages drop constraint if exists mail_messages_relance_check;
alter table public.mail_messages add constraint mail_messages_relance_check check (relance_statut is null or relance_statut in ('attente', 'repondu', 'ignoree'));
alter table public.mail_messages drop constraint if exists mail_messages_facture_check;
alter table public.mail_messages add constraint mail_messages_facture_check check (facture_statut is null or facture_statut in ('proposee', 'envoyee', 'ignoree'));
alter table public.mail_messages drop constraint if exists mail_messages_dossier_check;
alter table public.mail_messages add constraint mail_messages_dossier_check check (dossier in ('inbox', 'sentitems', 'junk', 'promotions', 'plateformes', 'autre'));
create index if not exists mail_messages_lien_bien on public.mail_messages (lien_bien_id, date desc) where lien_bien_id is not null;
create index if not exists mail_messages_lien_proprio on public.mail_messages (lien_proprietaire_id, date desc) where lien_proprietaire_id is not null;
create index if not exists mail_messages_lien_resa on public.mail_messages (lien_reservation_id, date desc) where lien_reservation_id is not null;
create index if not exists mail_messages_relances on public.mail_messages (account_id, date) where attend_reponse and relance_statut is distinct from 'repondu';

alter table public.mail_tri_journal drop constraint if exists mail_tri_journal_evenement_check;
alter table public.mail_tri_journal add constraint mail_tri_journal_evenement_check check (evenement in ('classe', 'deplace', 'simule', 'remis', 'demande_creee',
  'demande_simulee', 'recategorise', 'transfert', 'reponse', 'ia', 'erreur', 'traite', 'connexion', 'test', 'mode', 'sync', 'urgence', 'facture', 'relance', 'modele'));

-- Modèles de réponse (tarifs, conditions, arrivée, mandat propriétaire…) : champs {prenom} {logement} {dates} {lien_reserver} {lien_logements}.
create table if not exists public.mail_modele (
  id         uuid primary key default gen_random_uuid(),
  titre      text not null,
  categorie  text,
  langue     text not null default 'fr' check (langue in ('fr', 'en', 'es')),
  corps      text not null,
  ordre      int not null default 100,
  actif      boolean not null default true,
  cree_par   text,
  maj_le     timestamptz not null default now()
);
alter table public.mail_modele enable row level security;
revoke all on public.mail_modele from anon, authenticated;
insert into public.mail_modele (titre, categorie, langue, corps, ordre, cree_par)
select * from (values
 ('Demander les dates', 'demande_resa', 'fr', E'Bonjour {prenom},\n\nMerci pour votre message et votre intérêt pour nos logements.\n\nPourriez-vous me préciser vos dates d''arrivée et de départ ainsi que le nombre de voyageurs (adultes et enfants) ? Je vous enverrai aussitôt nos disponibilités et les tarifs.\n\nVous pouvez aussi consulter tous nos logements et leurs disponibilités ici : {lien_logements}\n\nBien cordialement,\nOïhan\nDestination Côte Basque', 10, 'modèle initial'),
 ('Tarifs et réservation en ligne', 'demande_resa', 'fr', E'Bonjour {prenom},\n\nMerci pour votre demande. Le prix exact de votre séjour ({dates}) s''affiche directement sur la page du logement, taxe de séjour et ménage compris : {lien_reserver}\n\nVous pouvez réserver et payer en ligne en toute sécurité. Je reste disponible pour toute question.\n\nBien cordialement,\nOïhan\nDestination Côte Basque', 20, 'modèle initial'),
 ('Conditions d''annulation', 'demande_resa', 'fr', E'Bonjour {prenom},\n\nLes conditions d''annulation dépendent du logement et sont indiquées avant le paiement sur la page de réservation : {lien_reserver}\n\nElles sont reprises ensuite dans votre contrat de location. N''hésitez pas si vous souhaitez que je vous les détaille pour vos dates.\n\nBien cordialement,\nOïhan\nDestination Côte Basque', 30, 'modèle initial'),
 ('Arrivée et accès au logement', 'voyageur', 'fr', E'Bonjour {prenom},\n\nToutes les informations d''arrivée (adresse, accès, codes et horaires) vous sont envoyées avant votre séjour dans votre espace voyageur. Si vous ne les trouvez pas, dites le moi et je vous les renvoie.\n\nÀ très bientôt,\nOïhan\nDestination Côte Basque', 40, 'modèle initial'),
 ('Propriétaire : confier son bien', 'proprietaire', 'fr', E'Bonjour {prenom},\n\nMerci pour votre message et pour l''intérêt que vous portez à Destination Côte Basque.\n\nNous gérons la location de votre bien de A à Z : mise en ligne et tarifs, accueil des voyageurs, ménage et linge, suivi technique et relevé de vos revenus chaque mois.\n\nLe plus simple est de nous rencontrer sur place pour visiter le bien et vous présenter notre accompagnement. Quelles seraient vos disponibilités dans les prochains jours ?\n\nBien cordialement,\nOïhan\nDestination Côte Basque', 50, 'modèle initial'),
 ('Ask for dates', 'demande_resa', 'en', E'Hello {prenom},\n\nThank you for your message and your interest in our homes.\n\nCould you let me know your arrival and departure dates and the number of guests (adults and children)? I will send you our availability and prices right away.\n\nYou can also browse all our homes here: {lien_logements}\n\nKind regards,\nOïhan\nDestination Côte Basque', 60, 'modèle initial'),
 ('Pedir las fechas', 'demande_resa', 'es', E'Hola {prenom},\n\nGracias por su mensaje y por su interés en nuestros alojamientos.\n\n¿Podría indicarme sus fechas de llegada y salida y el número de viajeros? Le enviaré enseguida nuestra disponibilidad y precios.\n\nTambién puede ver todos nuestros alojamientos aquí: {lien_logements}\n\nUn cordial saludo,\nOïhan\nDestination Côte Basque', 70, 'modèle initial')
) v(titre, categorie, langue, corps, ordre, cree_par)
where not exists (select 1 from public.mail_modele);

-- Boîte conciergerie@ (MX Plan, utilisée par Clémence) : IMAP/SMTP ssl0.ovh.net, visible par Oïhan, Essai, sans mot de passe
-- (à saisir dans PowerHouse › Paramètres › Intégrations — Messagerie).
insert into public.powerhouse_imap_accounts (label, email, protocole, imap_host, imap_port, smtp_host, smtp_port, role, agence, mode, active, mdp_present, acces_uids, cree_par)
select 'Conciergerie', 'conciergerie@destinationcotebasque.com', 'imap', 'ssl0.ovh.net', 993, 'ssl0.ovh.net', 465, 'conciergerie', 'dcb', 'essai', true, false,
       array['414218dc-b91b-454e-a0f2-9b4a3a0c5676', '62753152-5321-40ce-ac86-36a54c2de2aa']::uuid[], 'migration 546'
where not exists (select 1 from public.powerhouse_imap_accounts where lower(email) = 'conciergerie@destinationcotebasque.com');
