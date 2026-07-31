-- Industrialise le cas "fiche doublon inter-agence" identifié via le signalement
-- de Juhane DASCON (Lauian) bloquée sur "Accès non configuré" au Portail Owner.
--
-- Une même personne peut avoir 2 fiches proprietaire, une par agence, quand DCB
-- facture du ménage (FMEN) pour un bien géré par Lauian (ou l'inverse) : la fiche
-- de l'autre agence n'a alors aucun bien, elle sert uniquement à la facturation
-- interne. Jusqu'ici, rien ne liait ces deux fiches formellement — auth_user_id
-- devait être recopié à la main sur la fiche coquille à chaque incident.
--
-- Ajoute duplicate_of_id (fiche coquille → fiche primaire avec bien réel) +
-- backfill de 22 paires au total :
--   - 15 paires certaines (même nom/prénom/téléphone exact, une seule des deux
--     fiches avec un bien réel actif)
--   - 7 paires supplémentaires liées ensuite à la demande (même nom/prénom exact,
--     aucun bien actif des deux côtés — direction dcb→lauian par convention,
--     sans incidence fonctionnelle car owner-portal-invite propage dans les
--     deux sens)
--
-- L'edge function owner-portal-invite propage désormais auth_user_id sur les deux
-- fiches automatiquement à l'invitation (voir dcb-portail-owner/api, fonction
-- déployée séparément).

ALTER TABLE public.proprietaire
  ADD COLUMN IF NOT EXISTS duplicate_of_id uuid REFERENCES public.proprietaire(id),
  ADD CONSTRAINT proprietaire_duplicate_of_id_not_self CHECK (duplicate_of_id IS NULL OR duplicate_of_id <> id);

CREATE INDEX IF NOT EXISTS idx_proprietaire_duplicate_of_id ON public.proprietaire(duplicate_of_id) WHERE duplicate_of_id IS NOT NULL;

COMMENT ON COLUMN public.proprietaire.duplicate_of_id IS
  'Pointe vers la fiche "primaire" (avec bien réel) quand cette fiche est une coquille créée pour la facturation interne inter-agence (ex: FMEN facturé par DCB pour un bien géré par Lauian). Utilisé par owner-portal-invite pour propager auth_user_id automatiquement sur les deux fiches à l''invitation, sans intervention manuelle. Distinct de parent_proprietaire_id (comptes secondaires/co-propriétaires sur la même fiche).';

-- Backfill des paires certaines (même nom/prénom/téléphone exact, un seul côté avec bien réel)
WITH pairs AS (
  SELECT a.id AS shell_id, b.id AS primary_id
  FROM proprietaire a
  JOIN proprietaire b ON a.id <> b.id
    AND a.agence <> b.agence
    AND lower(a.nom) = lower(b.nom)
    AND coalesce(lower(a.prenom),'') = coalesce(lower(b.prenom),'')
    AND a.telephone = b.telephone
    AND a.telephone IS NOT NULL
  WHERE (SELECT count(*) FROM bien WHERE proprietaire_id = a.id OR co_proprietaire_id = a.id) = 0
    AND (SELECT count(*) FROM bien WHERE proprietaire_id = b.id OR co_proprietaire_id = b.id) > 0
)
UPDATE proprietaire p
SET duplicate_of_id = pairs.primary_id
FROM pairs
WHERE p.id = pairs.shell_id AND p.duplicate_of_id IS NULL;

-- Backfill des 7 paires restantes (même nom/prénom exact, aucun bien actif des
-- deux côtés — impossible de deviner laquelle est "primaire" par le bien, donc
-- direction dcb→lauian par simple convention)
WITH pairs2 AS (
  SELECT a.id AS dcb_id, b.id AS lauian_id
  FROM proprietaire a
  JOIN proprietaire b ON a.id <> b.id
    AND a.agence = 'dcb' AND b.agence = 'lauian'
    AND lower(a.nom) = lower(b.nom)
    AND coalesce(lower(a.prenom),'') = coalesce(lower(b.prenom),'')
  WHERE a.duplicate_of_id IS NULL AND b.duplicate_of_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM proprietaire x WHERE x.duplicate_of_id = a.id OR x.duplicate_of_id = b.id)
)
UPDATE proprietaire p
SET duplicate_of_id = pairs2.lauian_id
FROM pairs2
WHERE p.id = pairs2.dcb_id;
