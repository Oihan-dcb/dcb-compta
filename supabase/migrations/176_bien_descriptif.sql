-- Migration 176 — bien_descriptif
-- Champs complémentaires sur la table bien pour alimenter
-- l'annexe "État descriptif et conditions de la location"
-- du contrat de location saisonnière DCB.

ALTER TABLE bien
  ADD COLUMN IF NOT EXISTS date_construction     TEXT,
  ADD COLUMN IF NOT EXISTS nb_pieces_principales INT,
  ADD COLUMN IF NOT EXISTS superficie_m2         NUMERIC(6,1),
  ADD COLUMN IF NOT EXISTS etage                 TEXT,          -- "RDC" | "1er" | "2ème" | etc.
  ADD COLUMN IF NOT EXISTS distance_mer_m        INT,
  ADD COLUMN IF NOT EXISTS distance_plage_m      INT,
  ADD COLUMN IF NOT EXISTS distance_gare_m       INT,
  ADD COLUMN IF NOT EXISTS distance_centre_m     INT,
  ADD COLUMN IF NOT EXISTS exposition            TEXT,          -- "Sud-Ouest", "Plein Sud"...
  ADD COLUMN IF NOT EXISTS voisinage             TEXT,          -- "Résidentiel calme", "Centre-ville"...
  ADD COLUMN IF NOT EXISTS description_pieces    JSONB,
  -- {
  --   "etat_general": "Bon état général",
  --   "sejour": "Grand séjour lumineux avec vue mer...",
  --   "cuisine": "Cuisine équipée américaine...",
  --   "sdb": "Salle de bain avec douche à l'italienne...",
  --   "toilettes": "WC séparés"
  -- }
  ADD COLUMN IF NOT EXISTS a_piscine             BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS heure_arrivee_defaut  TEXT NOT NULL DEFAULT '17:00',
  ADD COLUMN IF NOT EXISTS heure_depart_defaut   TEXT NOT NULL DEFAULT '10:00',
  ADD COLUMN IF NOT EXISTS type_logement         TEXT;
  -- "appartement" | "villa" | "maison" | "studio" | "chambre" | "duplex"

-- Index utile pour la page PowerHouse Contrats (filtre type_logement)
CREATE INDEX IF NOT EXISTS idx_bien_type_logement
  ON bien(type_logement) WHERE type_logement IS NOT NULL;
