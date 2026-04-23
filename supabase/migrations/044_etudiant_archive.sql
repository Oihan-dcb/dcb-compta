-- Migration 044 : archivage locataires LLD + flag relances actives
ALTER TABLE etudiant
  ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS relances_actives BOOLEAN NOT NULL DEFAULT true;

-- Index pour filtrer rapidement les non-archivés
CREATE INDEX IF NOT EXISTS idx_etudiant_archived ON etudiant(archived);

-- Les locataires partis = relances désactivées par défaut (sécurité)
UPDATE etudiant SET relances_actives = false WHERE statut = 'parti';
