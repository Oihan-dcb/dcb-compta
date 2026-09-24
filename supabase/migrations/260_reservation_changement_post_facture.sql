-- Migration 260 : trace des changements de résa survenus APRÈS génération de la facture du mois
-- (I-144, incident VIKY/HM8SZAKKMK, découvert le 24/09/2026).
--
-- Cas réel : résa Airbnb de juillet annulée le 18/07 avec une résolution Airbnb de -1500€
-- (remboursement partiel voyageur) connue de notre base seulement mi-août. La facture honoraires
-- de juillet avait été générée le 06/08 sur l'ancien revenu (3215,30€) → HON 647,57€ HT au lieu
-- de 335,07€ HT (375€ TTC en trop). La ventilation a ensuite été recalculée, mais RIEN ne signalait
-- que la facture déjà générée ne correspondait plus : un brouillon n'est jamais régénéré tout seul,
-- et pour une facture envoyée à Evoliz la ventilation est carrément verrouillée
-- (STATUTS_VERROU_FACTURE) — l'écart y est donc totalement invisible, pour tout propriétaire.
--
-- Ce trigger ne corrige rien lui-même (une facture envoyée ne se modifie pas : avoir ou
-- régularisation M+1, décision humaine) : il rend l'écart VISIBLE, et l'Edge Function
-- alerte-changement-post-facture (cron ci-dessous) l'envoie par mail le lendemain matin.

CREATE TABLE IF NOT EXISTS public.reservation_changement_post_facture (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id     uuid        NOT NULL REFERENCES public.reservation(id) ON DELETE CASCADE,
  bien_id            uuid        REFERENCES public.bien(id) ON DELETE SET NULL,
  proprietaire_id    uuid,
  agence             text,
  mois_comptable     text        NOT NULL,
  facture_id         uuid        REFERENCES public.facture_evoliz(id) ON DELETE SET NULL,
  facture_statut     text,       -- statut de la facture au moment du changement
  ancien_fin_revenue integer,
  nouveau_fin_revenue integer,
  ancien_statut      text,
  nouveau_statut     text,
  detecte_at         timestamptz NOT NULL DEFAULT now(),
  alerte_envoyee_at  timestamptz, -- posé par l'Edge Function au premier mail
  resolu_at          timestamptz, -- posé automatiquement (brouillon régénéré) ou à la main
  resolu_note        text
);

CREATE INDEX IF NOT EXISTS reservation_changement_post_facture_ouvert_idx
  ON public.reservation_changement_post_facture (agence, resolu_at);

-- Lecture/écriture service_role uniquement (Edge Function) — pas de policy.
ALTER TABLE public.reservation_changement_post_facture ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.reservation_changement_post_facture IS
  'I-144 : changement de fin_revenue/final_status sur une résa dont la facture honoraires du mois existe déjà (hors calcul_en_cours). Alimentée par trigger, lue par alerte-changement-post-facture.';

CREATE OR REPLACE FUNCTION public.trace_changement_post_facture()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bien    record;
  v_facture record;
BEGIN
  IF NEW.mois_comptable IS NULL THEN RETURN NEW; END IF;

  SELECT id, proprietaire_id, agence INTO v_bien FROM bien WHERE id = NEW.bien_id;
  IF v_bien.proprietaire_id IS NULL THEN RETURN NEW; END IF;

  -- Facture honoraires du propriétaire pour ce mois (groupe_facturation : une facture par
  -- propriétaire, bien_id = bien principal — on matche donc par propriétaire, pas par bien).
  SELECT id, statut INTO v_facture
  FROM facture_evoliz
  WHERE proprietaire_id = v_bien.proprietaire_id
    AND mois = NEW.mois_comptable
    AND type_facture = 'honoraires'
    AND statut <> 'calcul_en_cours'
  ORDER BY (bien_id = NEW.bien_id) DESC NULLS LAST, updated_at DESC
  LIMIT 1;
  IF v_facture.id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO reservation_changement_post_facture (
    reservation_id, bien_id, proprietaire_id, agence, mois_comptable, facture_id, facture_statut,
    ancien_fin_revenue, nouveau_fin_revenue, ancien_statut, nouveau_statut
  ) VALUES (
    NEW.id, NEW.bien_id, v_bien.proprietaire_id, v_bien.agence, NEW.mois_comptable, v_facture.id, v_facture.statut,
    OLD.fin_revenue, NEW.fin_revenue, OLD.final_status, NEW.final_status
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Un garde-fou ne doit JAMAIS faire échouer la synchro des réservations.
  RAISE WARNING 'trace_changement_post_facture: %', SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trace_changement_post_facture() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_trace_changement_post_facture ON public.reservation;
CREATE TRIGGER trg_trace_changement_post_facture
  AFTER UPDATE OF fin_revenue, final_status ON public.reservation
  FOR EACH ROW
  WHEN (OLD.fin_revenue IS DISTINCT FROM NEW.fin_revenue OR OLD.final_status IS DISTINCT FROM NEW.final_status)
  EXECUTE FUNCTION public.trace_changement_post_facture();

-- Alerte quotidienne 8h45 (dcb) / 8h47 (lauian) UTC — créneaux libres après sync-reviews 8h41/8h43.
select cron.schedule('alerte-changement-post-facture-dcb', '45 8 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/alerte-changement-post-facture',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')),
    body := '{"agence":"dcb"}'::jsonb
  )
  $$
);
select cron.schedule('alerte-changement-post-facture-lauian', '47 8 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/alerte-changement-post-facture',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')),
    body := '{"agence":"lauian"}'::jsonb
  )
  $$
);
