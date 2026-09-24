-- Migration 263 : fn_log_reservation écrit la VRAIE source dans journal_ops (audit I-149, 24/09/2026)
--
-- La fonction écrivait source='webhook' en dur pour TOUTE création / changement de statut de
-- résa — y compris celles du cron nocturne. C'est ce libellé qui a masqué, en juillet, que le
-- webhook Hospitable ne livrait plus rien : le journal continuait d'afficher des « webhook ».
-- Désormais : 'app' si l'écriture vient d'une session utilisateur (UI), 'sync_hospitable' sinon
-- (cron sync-reservations ou /api/webhook-hospitable, qui passent tous deux par le service_role).

CREATE OR REPLACE FUNCTION public.fn_log_reservation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_source text := CASE WHEN auth.uid() IS NOT NULL THEN 'app' ELSE 'sync_hospitable' END;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO journal_ops (categorie, action, statut, mois_comptable, reservation_id, bien_id, source, message, apres)
    VALUES (
      'import', 'create', 'ok',
      NEW.mois_comptable, NEW.id, NEW.bien_id,
      v_source,
      'Réservation créée : ' || COALESCE(NEW.code, '?') || ' — ' || COALESCE(NEW.guest_name, 'inconnu') || ' (' || COALESCE(NEW.platform, '?') || ')',
      jsonb_build_object('code', NEW.code, 'platform', NEW.platform, 'final_status', NEW.final_status, 'fin_revenue', NEW.fin_revenue)
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.final_status IS DISTINCT FROM NEW.final_status THEN
      INSERT INTO journal_ops (categorie, action, statut, mois_comptable, reservation_id, bien_id, source, message, avant, apres)
      VALUES (
        'import',
        CASE WHEN NEW.final_status = 'cancelled' THEN 'cancel' ELSE 'update' END,
        CASE WHEN NEW.final_status = 'cancelled' THEN 'warning' ELSE 'ok' END,
        NEW.mois_comptable, NEW.id, NEW.bien_id,
        v_source,
        'Réservation ' || COALESCE(NEW.code, '?') || ' : ' || COALESCE(OLD.final_status,'?') || ' → ' || COALESCE(NEW.final_status,'?'),
        jsonb_build_object('final_status', OLD.final_status),
        jsonb_build_object('final_status', NEW.final_status)
      );
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;
