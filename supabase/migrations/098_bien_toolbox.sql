-- Migration 094 : table bien_toolbox
-- Informations pratiques pour les AE/staff : accès, codes, linge, etc.

CREATE TABLE IF NOT EXISTS bien_toolbox (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bien_id        uuid REFERENCES bien(id) ON DELETE SET NULL,
  nom_csv        text NOT NULL UNIQUE,
  statut         text,
  type_location  text,
  ville          text,
  adresse        text,
  parking        text,
  code_entree    text,
  code_coffre    text,
  coffre_lieu    text,
  ou_appart      text,
  poubelles      text,
  lien_arrivee   text,
  mdp_arrivee    text,
  temps_nettoyage   text,
  temps_nettoyage_h numeric,
  linge_plat     text,
  linge_eponge   text,
  consommables   text,
  particularite  text,
  notes          text,
  updated_at     timestamptz DEFAULT now(),
  updated_by     uuid REFERENCES auth.users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS bien_toolbox_bien_id_key ON bien_toolbox(bien_id) WHERE bien_id IS NOT NULL;
