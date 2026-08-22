-- Migration 243 — table `bien_pret_jour` : statut "bien physiquement pret" par bien et par jour.
--
-- Contexte : jusqu'ici AUCUN signal fiable ne disait "le menage de ce bien est termine".
-- `mission_menage.statut='valide'` n'est PAS ce signal : c'est un statut de VALIDATION
-- ADMINISTRATIVE pour la paie AE (l'admin clique "valider" pour declencher la facturation,
-- souvent plusieurs jours apres le menage reel — voir docs/data-model.md `mission_menage`
-- et `validerMission` dans dcb-portail-ae/src/pages/Portail.jsx).
--
-- Le seul signal PHYSIQUE fiable est l'envoi par l'AE d'un media `subject='apres_menage'`
-- avec un `bien_id` dans la messagerie interne (table `media_library`, alimentee par
-- dcb-portail-ae/src/pages/Messagerie.jsx `confirmUpload`). Cette table capture cet
-- evenement sous forme de statut interrogeable en O(1) : "ce bien est-il pret le JJ/MM ?".
--
-- Une seule ligne par (bien_id, date) — l'index unique sert aussi de cle d'upsert idempotente :
-- un AE qui envoie 3 videos "apres menage" sur le meme bien le meme jour ne cree qu'une ligne
-- et ne declenche qu'UNE notification manager (voir RPC `confirmer_bien_pret` plus bas).

CREATE TABLE IF NOT EXISTS bien_pret_jour (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  bien_id       uuid        NOT NULL REFERENCES bien(id) ON DELETE CASCADE,
  date          date        NOT NULL DEFAULT CURRENT_DATE,
  pret          boolean     NOT NULL DEFAULT true,
  source        text        NOT NULL DEFAULT 'media_apres_menage',
  media_id      uuid        REFERENCES media_library(id) ON DELETE SET NULL,
  confirme_par  uuid,
  confirme_at   timestamptz NOT NULL DEFAULT now(),
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bien_id, date)
);

COMMENT ON TABLE bien_pret_jour IS
  'Statut "bien physiquement pret" par bien et par jour. Une ligne avec pret=true = le menage a ete confirme termine sur le terrain (media apres_menage envoye dans la messagerie interne). ABSENCE de ligne = PAS pret (jamais "inconnu" : on reste prudent). Ne JAMAIS deriver ce statut de mission_menage.statut, qui est un statut de paie.';
COMMENT ON COLUMN bien_pret_jour.pret IS
  'true = pret. false = remis en "pas pret" a la main par un manager (ex. re-souillure, controle qualite KO) sans perdre la tracabilite. Toute lecture doit filtrer pret=true.';
COMMENT ON COLUMN bien_pret_jour.source IS
  'Origine de la confirmation : ''media_apres_menage'' (video/photo AE, cas nominal) | ''manuel'' (manager PowerHouse).';
COMMENT ON COLUMN bien_pret_jour.media_id IS
  'Ligne media_library qui a declenche le passage a "pret" — tracabilite : on peut reouvrir la video du menage.';
COMMENT ON COLUMN bien_pret_jour.confirme_par IS
  'auth.users.id de l''AE (ou du manager) qui a confirme. Pas de FK : auth.users n''est pas reference depuis public dans ce projet (cf. chat_messages.sender_id).';
COMMENT ON COLUMN bien_pret_jour.confirme_at IS
  'Horodatage de la confirmation effective (heure a laquelle le menage a ete declare fini), distinct de created_at.';

CREATE INDEX IF NOT EXISTS bien_pret_jour_date_idx ON bien_pret_jour(date DESC);
CREATE INDEX IF NOT EXISTS bien_pret_jour_media_id_idx ON bien_pret_jour(media_id);

-- updated_at auto
CREATE OR REPLACE FUNCTION bien_pret_jour_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bien_pret_jour_touch_trg ON bien_pret_jour;
CREATE TRIGGER bien_pret_jour_touch_trg
  BEFORE UPDATE ON bien_pret_jour
  FOR EACH ROW EXECUTE FUNCTION bien_pret_jour_touch();

-- ── RPC de confirmation idempotente ───────────────────────────────────────────
-- Retourne true UNIQUEMENT si le bien vient de PASSER a "pret" (transition), false s'il
-- l'etait deja. C'est ce booleen qui conditionne l'envoi de la notification manager :
-- recevoir l'evenement deux fois ne plante pas, ne duplique pas la ligne, et ne re-notifie pas.
CREATE OR REPLACE FUNCTION confirmer_bien_pret(
  p_bien_id      uuid,
  p_date         date    DEFAULT NULL,
  p_media_id     uuid    DEFAULT NULL,
  p_confirme_par uuid    DEFAULT NULL,
  p_source       text    DEFAULT 'media_apres_menage'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_transition boolean;
BEGIN
  IF p_bien_id IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO bien_pret_jour (bien_id, date, pret, source, media_id, confirme_par)
  VALUES (
    p_bien_id,
    COALESCE(p_date, (now() AT TIME ZONE 'Europe/Paris')::date),
    true,
    COALESCE(p_source, 'media_apres_menage'),
    p_media_id,
    p_confirme_par
  )
  ON CONFLICT (bien_id, date) DO UPDATE
    SET pret         = true,
        source       = EXCLUDED.source,
        media_id     = COALESCE(EXCLUDED.media_id, bien_pret_jour.media_id),
        confirme_par = COALESCE(EXCLUDED.confirme_par, bien_pret_jour.confirme_par),
        confirme_at  = now()
    -- Ne re-ecrit QUE si la ligne etait a "pas pret" : sinon aucun row retourne
    -- → v_transition NULL → false → pas de notification en double.
    WHERE bien_pret_jour.pret = false
  RETURNING true INTO v_transition;

  RETURN COALESCE(v_transition, false);
END;
$$;

COMMENT ON FUNCTION confirmer_bien_pret(uuid, date, uuid, uuid, text) IS
  'Upsert idempotent du statut "pret" d''un bien pour une date. Retourne true si et seulement si le bien vient de passer a "pret" (a utiliser pour ne notifier les managers qu''une fois). Date par defaut = date du jour a Paris.';

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Lecture : tout interne (staff + AE) — meme perimetre que media_library, qui est la source.
-- Ecriture directe : staff/bureau uniquement (remise a "pas pret" manuelle depuis PowerHouse).
-- Le cas nominal passe par l'endpoint serveur (service_role, qui bypasse RLS).
ALTER TABLE bien_pret_jour ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS internal_select_bien_pret_jour ON bien_pret_jour;
CREATE POLICY internal_select_bien_pret_jour ON bien_pret_jour
  FOR SELECT TO authenticated
  USING (auth_user_is_internal());

DROP POLICY IF EXISTS staff_write_bien_pret_jour ON bien_pret_jour;
CREATE POLICY staff_write_bien_pret_jour ON bien_pret_jour
  FOR ALL TO authenticated
  USING (auth_user_is_staff())
  WITH CHECK (auth_user_is_staff());

-- Postgres accorde EXECUTE a PUBLIC par defaut : sans ce REVOKE, la RPC (SECURITY DEFINER)
-- serait appelable avec la seule cle anon, permettant de marquer n'importe quel bien "pret".
REVOKE ALL ON FUNCTION confirmer_bien_pret(uuid, date, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION confirmer_bien_pret(uuid, date, uuid, uuid, text) TO authenticated, service_role;
