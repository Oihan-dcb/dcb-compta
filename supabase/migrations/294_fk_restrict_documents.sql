-- Même principe que 293 : les données comptables / juridiques ne disparaissent plus en cascade avec une
-- fiche bien ou propriétaire supprimée (relevés envoyés, clôtures, reversements, périmètre séquestre,
-- anciens mandats, réponses au questionnaire). La suppression est refusée : fusionner / re-pointer d'abord.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname, con.conrelid::regclass AS tbl, a.attname AS col, con.confrelid::regclass AS ref
    FROM pg_constraint con
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
    WHERE con.contype = 'f' AND con.confdeltype = 'c'
      AND con.confrelid IN ('public.bien'::regclass, 'public.proprietaire'::regclass)
      AND con.conrelid IN ('public.owner_documents'::regclass, 'public.cloture_bien'::regclass,
                           'public.reversement_fait'::regclass, 'public.reversement_resa'::regclass,
                           'public.sequestre_perimetre_mensuel'::regclass, 'public.mandat_gestion'::regclass,
                           'public.proprietaire_onboarding'::regclass)
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, c.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %s(id) ON DELETE RESTRICT', c.tbl, c.conname, c.col, c.ref);
  END LOOP;
END $$;
