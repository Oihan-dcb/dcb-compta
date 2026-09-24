-- Migration 262 : garde-fous table proprietaire (audit segment Propriétaires, 24/09/2026 — I-148)
--
-- 1. evoliz_snapshot : dernières valeurs lues chez Evoliz, pour que la synchro ne mette à jour
--    un champ local QUE si Evoliz l'a réellement modifié (sinon elle écrasait chaque nuit toute
--    saisie faite dans dcb-compta / PowerHouse, et repassait actif=true — cf. proprietaireSyncCore.js).
-- 2. IBAN validé en base (format + clé ISO 13616 mod 97, longueur 27 pour FR), pour TOUTES les
--    sources d'écriture (dcb-compta, PowerHouse, onboarding). Uniquement quand l'IBAN CHANGE : une
--    fiche existante au IBAN invalide (BOISSY) reste modifiable sur ses autres champs.
-- 3. Un propriétaire connecté au portail (auth.uid() non staff) ne peut plus modifier que
--    last_seen / auth_user_id de sa fiche. La policy proprio_update_last_seen n'avait aucune
--    restriction de colonne : il pouvait changer son taux_commission, son IBAN, son agence…
--    Le staff (auth_user_is_staff) et le service_role (Edge Functions, crons : auth.uid() NULL)
--    ne sont pas concernés.
-- 4. Les 31 fiches fusionnées (duplicate_of_id renseigné — copies des propriétaires Lauïan dans
--    l'Evoliz DCB) étaient toutes actives : la synchro Evoliz les réactivait chaque nuit.

ALTER TABLE public.proprietaire ADD COLUMN IF NOT EXISTS evoliz_snapshot jsonb;
COMMENT ON COLUMN public.proprietaire.evoliz_snapshot IS
  'Dernières valeurs lues chez Evoliz (nom, prenom, telephone, adresse, code_postal, ville, pays). Un champ local n''est mis à jour par la synchro que si Evoliz a changé depuis ce snapshot, ou si le champ local est vide.';

-- ── 2. IBAN ────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.iban_est_valide(p_iban text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  ib text := upper(regexp_replace(coalesce(p_iban, ''), '[^A-Za-z0-9]', '', 'g'));
  mv text;
  digits text := '';
  c text;
  i int;
BEGIN
  IF ib !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$' THEN RETURN false; END IF;
  IF left(ib, 2) = 'FR' AND length(ib) <> 27 THEN RETURN false; END IF;
  mv := substr(ib, 5) || substr(ib, 1, 4);
  FOR i IN 1..length(mv) LOOP
    c := substr(mv, i, 1);
    digits := digits || CASE WHEN c ~ '[0-9]' THEN c ELSE (ascii(c) - 55)::text END;
  END LOOP;
  RETURN digits::numeric % 97 = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_proprietaire_iban()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.iban IS NOT NULL AND btrim(NEW.iban) <> '' AND NOT public.iban_est_valide(NEW.iban) THEN
    RAISE EXCEPTION 'IBAN invalide (%…) : vérifier la saisie — clé de contrôle ou longueur incorrecte', left(upper(regexp_replace(NEW.iban, '\s', '', 'g')), 4)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_proprietaire_iban_ins ON public.proprietaire;
CREATE TRIGGER trg_check_proprietaire_iban_ins
  BEFORE INSERT ON public.proprietaire
  FOR EACH ROW EXECUTE FUNCTION public.check_proprietaire_iban();

DROP TRIGGER IF EXISTS trg_check_proprietaire_iban_upd ON public.proprietaire;
CREATE TRIGGER trg_check_proprietaire_iban_upd
  BEFORE UPDATE OF iban ON public.proprietaire
  FOR EACH ROW
  WHEN (NEW.iban IS DISTINCT FROM OLD.iban)
  EXECUTE FUNCTION public.check_proprietaire_iban();

-- ── 3. Colonnes modifiables par le propriétaire lui-même ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.garde_colonnes_proprietaire()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- service_role / cron / Edge Function : pas de session utilisateur
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF public.auth_user_is_staff() THEN RETURN NEW; END IF;
  IF (to_jsonb(NEW) - 'last_seen' - 'auth_user_id' - 'updated_at')
     IS DISTINCT FROM (to_jsonb(OLD) - 'last_seen' - 'auth_user_id' - 'updated_at') THEN
    RAISE EXCEPTION 'Modification non autorisée : seul le staff peut modifier cette fiche propriétaire'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.garde_colonnes_proprietaire() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_garde_colonnes_proprietaire ON public.proprietaire;
CREATE TRIGGER trg_garde_colonnes_proprietaire
  BEFORE UPDATE ON public.proprietaire
  FOR EACH ROW EXECUTE FUNCTION public.garde_colonnes_proprietaire();

-- ── 4. Doublons fusionnés : archivés ──────────────────────────────────────────────────────
UPDATE public.proprietaire SET actif = false WHERE duplicate_of_id IS NOT NULL AND actif;
