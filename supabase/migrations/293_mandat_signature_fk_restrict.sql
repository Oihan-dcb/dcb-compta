-- Un mandat signé est un acte juridique : il ne doit JAMAIS disparaître avec la fiche bien / propriétaire.
-- Avant : ON DELETE CASCADE → la suppression de l'ancien bien « BERRUA » (Hélène Elissalt, remplacé par
-- ONGI venu d'Hospitable) a effacé MAND-2026-0001 signé le 22/06/2026 (reconstitué le 02/10/2026 depuis
-- le PDF signé du stockage). Désormais : suppression refusée tant qu'un mandat y est rattaché — une fusion
-- de fiches doit d'abord re-pointer les mandats.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'public.mandat_signature'::regclass AND contype = 'f'
             AND confrelid IN ('public.bien'::regclass, 'public.proprietaire'::regclass) LOOP
    EXECUTE format('ALTER TABLE public.mandat_signature DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.mandat_signature
  ADD CONSTRAINT mandat_signature_bien_id_fkey FOREIGN KEY (bien_id) REFERENCES public.bien(id) ON DELETE RESTRICT,
  ADD CONSTRAINT mandat_signature_proprietaire_id_fkey FOREIGN KEY (proprietaire_id) REFERENCES public.proprietaire(id) ON DELETE RESTRICT;
