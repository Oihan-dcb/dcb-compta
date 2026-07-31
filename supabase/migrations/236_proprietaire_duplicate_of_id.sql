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
-- backfill des 15 paires détectées avec certitude (même nom/prénom/téléphone
-- exact, une seule des deux fiches avec un bien réel). 7 paires ambiguës (aucune
-- des deux fiches n'a de bien actif des deux côtés) laissées volontairement non
-- liées — à confirmer manuellement via l'onglet Portail Owner > Fiche liée.
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
