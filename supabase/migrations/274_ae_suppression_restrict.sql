-- Migration 274 : interdire la suppression d'un AE qui a un historique (audit segment AE, I-157)
--
-- Les clés vers auto_entrepreneur étaient en ON DELETE CASCADE : supprimer une fiche AE effaçait
-- en silence ses missions (coûts déjà payés et refacturés), ses prestations, ses heures (staff),
-- son contrat signé et son onboarding. Plus aucun bouton ne supprime un AE (archivage depuis le
-- 23/08/2026), mais une suppression par erreur (script, SQL, ancien service) restait possible.
-- RESTRICT sur l'historique financier / légal ; taux_ae_prestation et daily_notes restent en cascade.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('mission_menage',          'mission_menage_ae_id_fkey'),
    ('prestation_hors_forfait', 'prestation_hors_forfait_ae_id_fkey'),
    ('staff_heures_jour',       'staff_heures_jour_ae_id_fkey'),
    ('ae_contrat',              'ae_contrat_ae_id_fkey'),
    ('ae_onboarding',           'ae_onboarding_ae_id_fkey')
  ) AS t(tbl, con)
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.tbl, r.con);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (ae_id) REFERENCES public.auto_entrepreneur(id) ON DELETE RESTRICT', r.tbl, r.con);
  END LOOP;
END $$;
