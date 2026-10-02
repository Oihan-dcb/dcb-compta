-- Historique des modifications des fiches propriétaire / bien (avant : seul updated_at, aucune trace de
-- l'ancienne valeur). Demandé avant la campagne mandats 10/2026 : les propriétaires complètent eux-mêmes
-- leur fiche via le lien d'onboarding — on garde « ce qui était » et « ce qu'ils ont mis ».
-- Une ligne par UPDATE effectif, uniquement les colonnes qui changent ; colonnes techniques ignorées.
CREATE TABLE IF NOT EXISTS public.fiche_historique (
  id          bigserial PRIMARY KEY,
  table_nom   text NOT NULL,              -- 'proprietaire' | 'bien'
  fiche_id    uuid NOT NULL,
  avant       jsonb NOT NULL,             -- valeurs avant, colonnes modifiées seulement
  apres       jsonb NOT NULL,             -- valeurs après
  auteur_id   uuid,                       -- auth.uid() (NULL = service / cron / formulaire public)
  auteur_email text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fiche_historique_fiche_idx ON public.fiche_historique (table_nom, fiche_id, created_at DESC);
ALTER TABLE public.fiche_historique ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fiche_historique_staff_read ON public.fiche_historique;
CREATE POLICY fiche_historique_staff_read ON public.fiche_historique FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.staff_users s WHERE s.auth_user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.trace_fiche_historique() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o jsonb := to_jsonb(OLD); n jsonb := to_jsonb(NEW);
  av jsonb := '{}'::jsonb; ap jsonb := '{}'::jsonb; k text;
  ignorees text[] := ARRAY['updated_at','derniere_sync','last_seen','evoliz_snapshot','photo_url','created_at'];
BEGIN
  FOR k IN SELECT jsonb_object_keys(n) LOOP
    IF k = ANY(ignorees) THEN CONTINUE; END IF;
    IF (o -> k) IS DISTINCT FROM (n -> k) THEN
      av := av || jsonb_build_object(k, o -> k);
      ap := ap || jsonb_build_object(k, n -> k);
    END IF;
  END LOOP;
  IF ap <> '{}'::jsonb THEN
    INSERT INTO public.fiche_historique (table_nom, fiche_id, avant, apres, auteur_id, auteur_email)
    VALUES (TG_TABLE_NAME, NEW.id, av, ap, auth.uid(),
            nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_historique_proprietaire ON public.proprietaire;
CREATE TRIGGER trg_historique_proprietaire AFTER UPDATE ON public.proprietaire
  FOR EACH ROW EXECUTE FUNCTION public.trace_fiche_historique();
DROP TRIGGER IF EXISTS trg_historique_bien ON public.bien;
CREATE TRIGGER trg_historique_bien AFTER UPDATE ON public.bien
  FOR EACH ROW EXECUTE FUNCTION public.trace_fiche_historique();
