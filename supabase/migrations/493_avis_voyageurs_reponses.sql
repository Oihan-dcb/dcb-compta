-- 493 : Avis — PowerHouse › ⭐ Avis clients, onglets « 📝 Avis à laisser » et « 💬 Répondre » (19/10/2026, demande Oïhan).
--
-- (1) avis_hote_voyageur : brouillon de l'avis que l'HÔTE laisse sur le VOYAGEUR (Airbnb, fenêtre 14 jours après le départ).
--     La liste des avis en attente vient EN DIRECT d'Hospitable (GET /v2/guest-reviews?status=pending — Airbnb seulement) ;
--     cette table ne garde que NOTRE travail : notes, commentaire, note privée, étiquettes, publication différée, faits
--     relevés, cache IA, et le journal de publication (submit ne part QUE sur clic du bureau, avec confirmation).
-- (2) avis_reponse : brouillon de la réponse PUBLIQUE de l'hôte à un avis voyageur (reservation_review, sync-reviews).
--     Publication = POST /v2/reviews/{uuid}/respond (uuid Hospitable de l'avis, résolu au moment de publier et gardé ici).
--
-- Écrites et lues par api/avis-voyageurs.js (service role, bureau seulement) ; compteur lu par api/_aFaire.js.
-- RLS sans politique : service role seul.
-- IA : à la demande (bouton), Haiku, cache = colonnes ia_* (empreinte des faits / de l'avis) + plafond quotidien côté serveur.

create table if not exists public.avis_hote_voyageur (
  review_id                 text primary key,            -- id plateforme renvoyé par Hospitable (> 2^53 : TOUJOURS en texte)
  reservation_id            uuid references public.reservation(id) on delete set null,
  reservation_code          text,
  hospitable_reservation_id text,
  bien_id                   uuid,
  expires_at                timestamptz,                 -- fin de la fenêtre d'avis (Hospitable)
  hospitable_scheduled_for  timestamptz,                 -- publication automatique programmée par Hospitable (règle d'avis)
  statut                    text not null default 'brouillon' check (statut in (
                              'brouillon',   -- pré-rempli (règles ou IA), pas relu
                              'relu',        -- relu par le bureau, prêt à publier
                              'attendre',    -- réclamation en cours : on attend (ordre conseillé : demande de remboursement puis avis)
                              'publie',      -- envoyé à Airbnb (submit, publication immédiate)
                              'programme',   -- envoyé avec publication différée (~20 s avant la fin de la fenêtre)
                              'erreur')),
  grades                    jsonb,                       -- {rating, recommend, cleanliness, communication, respect_house_rules}
  message                   text,                        -- commentaire public
  private_feedback          text,                        -- note privée (visible du voyageur seulement)
  tags                      jsonb not null default '{}', -- {cleanliness_tags:[], respect_house_rules_tags:[], communication_tags:[], *_other_reason}
  delay_publication         boolean not null default false,
  langue                    text,
  source                    text,                        -- regles | ia | manuel
  faits                     jsonb,                       -- faits relevés au moment du brouillon (signalements, réclamation, ménage, départ, messages)
  ia_genere_le              timestamptz,
  ia_empreinte              text,
  ia_cout_usd               numeric,
  publie_le                 timestamptz,
  publie_par                text,
  publie_contenu            jsonb,                       -- ce qui a été envoyé, tel quel
  erreur                    text,
  anonymise_le              timestamptz,
  cree_le                   timestamptz not null default now(),
  maj_le                    timestamptz not null default now(),
  maj_par                   text
);
create index if not exists avis_hote_voyageur_resa on public.avis_hote_voyageur (reservation_id);
alter table public.avis_hote_voyageur enable row level security;
comment on table public.avis_hote_voyageur is 'Avis de l''hôte sur le voyageur (Airbnb) : brouillons PowerHouse, cache IA, journal de publication (493).';

create table if not exists public.avis_reponse (
  review_id                 uuid primary key references public.reservation_review(id) on delete cascade,
  hospitable_review_uuid    text,                        -- uuid Hospitable de l'avis (résolu à la publication)
  langue                    text,
  texte                     text,
  statut                    text not null default 'brouillon' check (statut in ('brouillon', 'relu', 'publie', 'erreur', 'ignore')),
  source                    text,                        -- regles | ia | manuel
  contexte                  jsonb,                       -- actions réalisées / Savoir utilisés (pour relire)
  ia_genere_le              timestamptz,
  ia_empreinte              text,
  ia_cout_usd               numeric,
  publie_le                 timestamptz,
  publie_par                text,
  erreur                    text,
  anonymise_le              timestamptz,
  cree_le                   timestamptz not null default now(),
  maj_le                    timestamptz not null default now(),
  maj_par                   text
);
alter table public.avis_reponse enable row level security;
comment on table public.avis_reponse is 'Réponse publique de l''hôte à un avis voyageur : brouillon PowerHouse, cache IA, journal de publication (493).';

-- Boîte « Répondre » : index pour les avis récents sans réponse
create index if not exists reservation_review_sans_reponse on public.reservation_review (submitted_at desc) where reponse is null;
