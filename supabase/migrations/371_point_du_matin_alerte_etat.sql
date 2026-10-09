-- Migration 371 : Point du matin — destinataires centralisés, mémoire des alertes, trace post-facture
-- (audit des mails automatiques du 09/10/2026, validé par Oïhan).
--
-- 1. notification_destinataire : SEULE source des adresses internes qui reçoivent les mails
--    automatiques (alertes, Point du matin, copies d'échec…). Avant : adresses codées en dur dans
--    ~40 fichiers de 4 dépôts, dont lauracoursan@hotmail.fr (boîte perso) dans 9 alertes Lauïan.
--    Lecture : fonction destinataires(role, agence) (SQL / RPC) ; agence '*' = toutes agences.
-- 2. alerte_etat : mémoire des alertes (une ligne par anomalie ouverte). Chaque contrôle de nuit
--    publie sa liste COMPLÈTE via alerte_signaler() : nouveau → ligne créée ; toujours là →
--    last_seen ; disparu → resolved_at (clôture automatique quand l'anomalie disparaît).
--    Le Point du matin lit cette table : nouveautés en tête, rappels à J+3 puis J+7 puis chaque
--    semaine, le reste sur une ligne « toujours ouvert » avec l'ancienneté.
--    Modèle : reservation_changement_post_facture.alerte_envoyee_at (migration 260).
-- 3. point_du_matin_envoi : un envoi par agence et par jour (anti-doublon si le cron est rejoué).
-- 4. trace_changement_post_facture : ne trace plus les changements sans effet financier
--    (demande jamais acceptée qui expire, écart de revenu < 1 €). 54 lignes ouvertes au 09/10/2026
--    dont ~35 sans effet (not accepted → expired/declined, allers-retours deleted ↔ accepted).

-- ── 1. Destinataires ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_destinataire (
  role        text        NOT NULL,  -- point_du_matin | responsable | conciergerie | paie | cabinet_paie
  agence      text        NOT NULL DEFAULT '*', -- 'dcb' | 'lauian' | '*' (toutes)
  email       text        NOT NULL,
  actif       boolean     NOT NULL DEFAULT true,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, agence, email)
);
ALTER TABLE public.notification_destinataire ENABLE ROW LEVEL SECURITY;
-- Lecture réservée au service_role (edge functions, api Vercel) : pas de policy.
COMMENT ON TABLE public.notification_destinataire IS
  'Seule source des adresses internes des mails automatiques (audit 09/10/2026). role × agence (* = toutes). Lire via destinataires(role, agence).';

INSERT INTO public.notification_destinataire (role, agence, email, note) VALUES
  ('point_du_matin', 'dcb',    'oihan@destinationcotebasque.com', 'Point du matin DCB (08:00)'),
  ('point_du_matin', 'lauian', 'laura@destinationcotebasque.com', 'Point du matin Lauïan (08:00) — remplace lauracoursan@hotmail.fr'),
  ('responsable',    'dcb',    'oihan@destinationcotebasque.com', 'Responsable agence : brouillons de contrat à vérifier, échecs d''envoi'),
  ('responsable',    'lauian', 'laura@destinationcotebasque.com', 'Responsable agence Lauïan'),
  ('conciergerie',   '*',      'conciergerie@destinationcotebasque.com', 'Boîte opérationnelle (signalements AE, last-minute, 120 nuitées)'),
  ('paie',           '*',      'oihan@destinationcotebasque.com', 'Rappel navette paie (le 28)'),
  ('cabinet_paie',   '*',      'marie@payeetconseil.com',          'Cabinet de paie — navette mensuelle')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.destinataires(p_role text, p_agence text DEFAULT '*')
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce(array_agg(DISTINCT email ORDER BY email), '{}')
  FROM notification_destinataire
  WHERE actif AND role = p_role
    AND (agence = coalesce(nullif(p_agence, ''), '*') OR agence = '*'
         -- agence inconnue (ex. 'bdx' rattachée à DCB) : repli sur DCB
         OR (agence = 'dcb' AND coalesce(p_agence, '*') NOT IN (SELECT DISTINCT agence FROM notification_destinataire WHERE role = p_role)));
$$;
REVOKE EXECUTE ON FUNCTION public.destinataires(text, text) FROM PUBLIC, anon, authenticated;

-- ── 2. Mémoire des alertes ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.alerte_etat (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source           text        NOT NULL,  -- ex. 'solde_booking_platform', 'menage_orphelin', 'sequestre'
  agence           text        NOT NULL,
  cle              text        NOT NULL,  -- identifiant stable de l'anomalie dans sa source
  libelle          text        NOT NULL,
  montant_cts      bigint,
  detail           jsonb,
  first_seen       timestamptz NOT NULL DEFAULT now(),
  last_seen        timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  last_notified_at timestamptz,
  nb_notifications integer     NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS alerte_etat_ouverte_uniq
  ON public.alerte_etat (source, agence, cle) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS alerte_etat_agence_ouverte_idx
  ON public.alerte_etat (agence) WHERE resolved_at IS NULL;
ALTER TABLE public.alerte_etat ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS alerte_etat_staff_select ON public.alerte_etat;
CREATE POLICY alerte_etat_staff_select ON public.alerte_etat FOR SELECT TO authenticated
  USING (public.auth_user_is_internal());
COMMENT ON TABLE public.alerte_etat IS
  'Mémoire des alertes (audit 09/10/2026) : une ligne par anomalie ouverte, alimentée par alerte_signaler(), lue par le Point du matin.';

-- Publie la liste COMPLÈTE d'une source pour une agence.
-- p_items : [{cle, libelle, montant_cts?, detail?}]
-- p_complet = false : ne clôture pas les absents (source partielle).
CREATE OR REPLACE FUNCTION public.alerte_signaler(p_source text, p_agence text, p_items jsonb, p_complet boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_item jsonb; v_nouveaux int := 0; v_maj int := 0; v_resolus int := 0; v_cles text[] := '{}';
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) LOOP
    CONTINUE WHEN coalesce(v_item->>'cle', '') = '';
    v_cles := v_cles || (v_item->>'cle');
    UPDATE alerte_etat SET
      last_seen = now(),
      libelle = coalesce(v_item->>'libelle', libelle),
      montant_cts = CASE WHEN v_item ? 'montant_cts' THEN (v_item->>'montant_cts')::bigint ELSE montant_cts END,
      detail = coalesce(v_item->'detail', detail)
    WHERE source = p_source AND agence = p_agence AND cle = v_item->>'cle' AND resolved_at IS NULL;
    IF FOUND THEN v_maj := v_maj + 1;
    ELSE
      INSERT INTO alerte_etat (source, agence, cle, libelle, montant_cts, detail)
      VALUES (p_source, p_agence, v_item->>'cle', coalesce(v_item->>'libelle', v_item->>'cle'),
              nullif(v_item->>'montant_cts', '')::bigint, v_item->'detail');
      v_nouveaux := v_nouveaux + 1;
    END IF;
  END LOOP;
  IF p_complet THEN
    UPDATE alerte_etat SET resolved_at = now()
    WHERE source = p_source AND agence = p_agence AND resolved_at IS NULL AND NOT (cle = ANY(v_cles));
    GET DIAGNOSTICS v_resolus = ROW_COUNT;
  END IF;
  RETURN jsonb_build_object('nouveaux', v_nouveaux, 'maj', v_maj, 'resolus', v_resolus);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.alerte_signaler(text, text, jsonb, boolean) FROM PUBLIC, anon, authenticated;

-- ── 3. Journal des envois du Point du matin ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.point_du_matin_envoi (
  agence      text        NOT NULL,
  jour        date        NOT NULL,
  envoye_at   timestamptz NOT NULL DEFAULT now(),
  destinataires text[],
  nb_nouveaux integer, nb_rappels integer, nb_ouverts integer,
  resend_id   text,
  PRIMARY KEY (agence, jour)
);
ALTER TABLE public.point_du_matin_envoi ENABLE ROW LEVEL SECURITY;

-- ── 4. Trace post-facture : seulement ce qui a un effet financier ───────────────────────────
-- Familles de statut : 'accepted' (séjour), 'cancelled' (peut porter des frais d'annulation),
-- tout le reste (not accepted*, declined, expired, deleted, inquiry…) = aucun revenu.
CREATE OR REPLACE FUNCTION public.famille_statut_resa(s text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN s = 'accepted' THEN 'accepted' WHEN s = 'cancelled' THEN 'cancelled' ELSE 'nul' END
$$;

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
  -- Sans effet financier : même famille de statut et revenu inchangé à 1 € près
  -- (ex. demande 'not accepted' qui passe 'expired', arrondi de 0,58 € — 09/10/2026).
  IF famille_statut_resa(OLD.final_status) = famille_statut_resa(NEW.final_status)
     AND abs(coalesce(NEW.fin_revenue, 0) - coalesce(OLD.fin_revenue, 0)) < 100 THEN
    RETURN NEW;
  END IF;
  -- Ni avant ni après la résa ne porte de revenu (statut 'nul' des deux côtés, ou revenu nul) : rien à refacturer.
  IF famille_statut_resa(OLD.final_status) = 'nul' AND famille_statut_resa(NEW.final_status) = 'nul' THEN
    RETURN NEW;
  END IF;

  SELECT id, proprietaire_id, agence INTO v_bien FROM bien WHERE id = NEW.bien_id;
  IF v_bien.proprietaire_id IS NULL THEN RETURN NEW; END IF;

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
  RAISE WARNING 'trace_changement_post_facture: %', SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.trace_changement_post_facture() FROM PUBLIC, anon, authenticated;
