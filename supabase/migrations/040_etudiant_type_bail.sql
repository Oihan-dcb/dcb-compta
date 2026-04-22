-- Migration 040 : type_bail sur etudiant (etudiant / mobilite)
ALTER TABLE etudiant
  ADD COLUMN IF NOT EXISTS type_bail text NOT NULL DEFAULT 'etudiant'
    CHECK (type_bail IN ('etudiant', 'mobilite'));

-- Mobilités identifiées
UPDATE etudiant SET type_bail = 'mobilite'
  WHERE nom IN ('Morandière', 'Emma', 'Ebony');
