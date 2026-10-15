-- 433 — Recouches : activation (décision d'Oïhan 15/10/2026) + séjour minimum 4 nuits
--
-- Règle validée : ménage le plus élevé des canaux × 1,30 ; sans changement des draps et serviettes − 45 € par lit utilisé,
-- minimum 50 € ; prix forcé d'un bien vs calculé = le plus élevé ; délai minimum de commande 48 h ; séjours de 4 nuits
-- minimum (au lieu de 3). Biens sans frais de ménage (BORDEZIA, COTREL, AITZINA) : prix non calculable → jamais proposés
-- (api/_services.offresBien ignore un prix nul).
--
-- Le seuil n'est plus codé en dur (3) dans recouche_vendue_creer / recouche_vendue_suivre : il est lu sur le service
-- (direct_service.nuits_min, jamais sous 3, défaut 4) — miroir JS : api/_services.nuitsMinService.

create or replace function public.recouche_nuits_min(p_agence text, p_cle text)
returns integer language sql stable security definer set search_path to 'public' as $$
  select greatest(3, coalesce((select s.nuits_min from direct_service s
                                where s.agence = coalesce(p_agence, 'dcb') and s.cle = p_cle and s.mission_type = 'recouche'), 4));
$$;
comment on function public.recouche_nuits_min(text, text) is 'Séjour minimum (nuits) d''une recouche vendue : direct_service.nuits_min, jamais sous 3, défaut 4 (433).';

CREATE OR REPLACE FUNCTION public.recouche_vendue_creer(p_bien uuid, p_resa_hospitable_id text, p_arrivee date, p_depart date, p_source text, p_qte integer DEFAULT 1, p_service text DEFAULT 'Recouche'::text, p_ref text DEFAULT NULL::text, p_lits integer DEFAULT NULL::integer)
 RETURNS TABLE(mission_id uuid, date_mission date, cree boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_n int := p_depart - p_arrivee;
  v_q int := greatest(1, least(coalesce(p_qte, 1), 5));
  v_duree numeric;
  v_code text;
  v_agence text;
  v_linge boolean;
  v_voy int;
  v_lib text;
  v_lits int;
  v_jeux int;
  v_d date;
  v_id uuid;
  k int;
begin
  if p_source is null or p_source !~ '^devis:[0-9a-f-]{36}:[a-z0-9_]{2,40}$' then raise exception 'source invalide'; end if;
  select b.code, coalesce(b.agence, 'dcb') into v_code, v_agence from bien b where b.id = p_bien;
  -- 433 : séjour minimum lu sur le service vendu (4 nuits depuis le 15/10/2026), jamais sous 3
  if v_n < recouche_nuits_min(v_agence, split_part(p_source, ':', 3)) then raise exception 'sejour_trop_court'; end if;
  select s.recouche_linge into v_linge from direct_service s where s.agence = v_agence and s.cle = split_part(p_source, ':', 3);
  select nullif(x.guest_count, 0) into v_voy from reservation x where x.hospitable_id = p_resa_hospitable_id and x.guest_count > 0 limit 1;
  if v_voy is null or v_voy = 0 then
    select coalesce(d.adultes, 0) + coalesce(d.enfants, 0) into v_voy from devis_option d where d.id = split_part(p_source, ':', 2)::uuid;
  end if;
  select l.nb_lits into v_lits from bien_lits_v l where l.bien_id = p_bien;
  v_jeux := case when p_lits between 1 and 30 then least(p_lits, coalesce(v_lits, p_lits))
                 when coalesce(v_voy, 0) > 0 then least(ceil(v_voy / 2.0)::int, coalesce(v_lits, ceil(v_voy / 2.0)::int)) end;
  v_lib := case v_linge when true then 'Recouche AVEC changement des draps et serviettes' when false then 'Recouche SANS changement des draps et serviettes' else 'Recouche' end;
  select percentile_cont(0.5) within group (order by m.duree_prevue) into v_duree
    from mission_menage m where m.bien_id = p_bien and m.type_mission = 'checkout' and m.duree_prevue > 0 and m.date_mission > current_date - 365;
  for k in 1..v_q loop
    v_d := recouche_vendue_date(p_arrivee, p_depart, k, v_q);
    insert into mission_menage (bien_id, date_mission, heure_mission, type_mission, statut, ae_id, titre_ical, duree_prevue, mois, note,
      vente_source, vente_resa_hospitable_id, vente_rang, vente_qte, vente_date_auto, recouche_linge, vente_voyageurs, recouche_jeux)
    values (p_bien, v_d, time '11:00', 'recouche', 'planifie', null,
      left(v_lib || ' — vendue en ligne (' || coalesce(v_code, '?') || ')', 200), coalesce(v_duree, 2), to_char(v_d, 'YYYY-MM'),
      left(p_service || ' vendu en ligne' || coalesce(' — ' || p_ref, '') || '. '
        || case v_linge when true then 'Linge à prévoir dans le sac : ' || coalesce(v_jeux || ' jeu' || case when v_jeux > 1 then 'x' else '' end || ' de draps + serviettes (' || v_jeux || ' lit' || case when v_jeux > 1 then 's' else '' end || ' utilisé' || case when v_jeux > 1 then 's' else '' end || coalesce(', ' || nullif(v_voy, 0) || ' voyageur' || case when v_voy > 1 then 's' else '' end, '') || '). ', 'draps + serviettes (nombre de lits à vérifier). ')
                        when false then 'Pas de changement de linge (ménage seul' || coalesce(', ' || v_jeux || ' lit' || case when v_jeux > 1 then 's' else '' end || ' utilisé' || case when v_jeux > 1 then 's' else '' end, '') || '). ' else '' end
        || 'Date décalable — à confirmer avec le voyageur (séjour du '
        || to_char(p_arrivee, 'DD/MM/YYYY') || ' au ' || to_char(p_depart, 'DD/MM/YYYY') || ').', 500),
      p_source || ':' || k, p_resa_hospitable_id, k, v_q, true, v_linge, nullif(v_voy, 0), v_jeux)
    on conflict (vente_source) where vente_source is not null do nothing
    returning id into v_id;
    if v_id is not null then
      insert into mission_journal (mission_id, bien_id, type, apres, texte, auteur_nom)
      values (v_id, p_bien, 'service_vendu', jsonb_build_object('date', v_d, 'source', p_source || ':' || k, 'resa', p_resa_hospitable_id, 'linge', v_linge, 'voyageurs', v_voy, 'jeux', v_jeux),
        p_service || ' vendu en ligne : ' || lower(left(v_lib, 1)) || substr(v_lib, 2) || ' créée le ' || to_char(v_d, 'DD/MM/YYYY') || ' (milieu du séjour, à confirmer avec le voyageur)', 'Vente en ligne');
      mission_id := v_id; date_mission := v_d; cree := true; return next;
    else
      select m.id, m.date_mission into mission_id, date_mission from mission_menage m where m.vente_source = p_source || ':' || k;
      cree := false; return next;
    end if;
    v_id := null;
  end loop;
  perform recouche_vendue_suivre(p_resa_hospitable_id);
end $function$;

CREATE OR REPLACE FUNCTION public.recouche_vendue_suivre(p_resa_hospitable_id text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record; m record;
  v_annule boolean; v_n int; v_cible date; n int := 0;
begin
  if p_resa_hospitable_id is null then return 0; end if;
  select x.arrival_date, x.departure_date, x.final_status, x.guest_count into r from reservation x where x.hospitable_id = p_resa_hospitable_id limit 1;
  if not found then return 0; end if;
  if coalesce(r.guest_count, 0) > 0 then
    update mission_menage mm set vente_voyageurs = r.guest_count,
        recouche_jeux = coalesce(mm.recouche_jeux, least(ceil(r.guest_count / 2.0)::int,
          coalesce((select l.nb_lits from bien_lits_v l where l.bien_id = mm.bien_id), ceil(r.guest_count / 2.0)::int))),
        updated_at = now()
     where mm.vente_resa_hospitable_id = p_resa_hospitable_id and mm.vente_source is not null and coalesce(mm.statut, '') <> 'valide'
       and mm.vente_voyageurs is distinct from r.guest_count;
  end if;
  v_annule := coalesce(r.final_status, '') ~ '^(cancelled|deleted|not accepted|checkpoint voided)';
  v_n := r.departure_date - r.arrival_date;
  for m in select mm.* from mission_menage mm
            where mm.vente_resa_hospitable_id = p_resa_hospitable_id and mm.vente_source is not null
              and coalesce(mm.statut, '') <> 'valide'
              and not exists (select 1 from mission_terrain t where t.mission_id = mm.id)
  loop
    -- 433 : séjour minimum du service vendu (clé dans vente_source devis:<id>:<cle>:<rang>)
    if v_annule or v_n < recouche_nuits_min((select coalesce(b.agence, 'dcb') from bien b where b.id = m.bien_id), split_part(m.vente_source, ':', 3)) or m.vente_rang > v_n - 1 then
      if coalesce(m.statut, '') <> 'cancelled' then
        update mission_menage set statut = 'cancelled', vente_annulee_auto = true, updated_at = now() where id = m.id;
        insert into mission_journal (mission_id, bien_id, type, avant, apres, texte, auteur_nom)
        values (m.id, m.bien_id, 'service_vendu', jsonb_build_object('date', m.date_mission, 'statut', m.statut),
          jsonb_build_object('statut', 'cancelled', 'sejour', r.arrival_date || ' → ' || r.departure_date, 'final_status', r.final_status),
          case when v_annule then 'Séjour annulé : recouche vendue annulée' else 'Séjour raccourci à ' || v_n || ' nuit(s) : recouche vendue annulée (rembourser le service si besoin)' end, 'Suivi du séjour');
        n := n + 1;
      end if;
      continue;
    end if;
    v_cible := case when m.vente_date_auto or m.date_mission <= r.arrival_date or m.date_mission >= r.departure_date
                    then recouche_vendue_date(r.arrival_date, r.departure_date, m.vente_rang, m.vente_qte) else m.date_mission end;
    if m.statut = 'cancelled' and not m.vente_annulee_auto then continue; end if;
    if v_cible is distinct from m.date_mission or m.statut = 'cancelled' then
      update mission_menage set date_mission = v_cible, mois = to_char(v_cible, 'YYYY-MM'),
        statut = case when statut = 'cancelled' then 'planifie' else statut end, vente_annulee_auto = false,
        vente_date_auto = case when m.vente_date_auto or m.date_mission <= r.arrival_date or m.date_mission >= r.departure_date then true else vente_date_auto end,
        vente_date_confirmee_le = case when v_cible is distinct from m.date_mission then null else vente_date_confirmee_le end,
        updated_at = now()
      where id = m.id;
      insert into mission_journal (mission_id, bien_id, type, avant, apres, texte, auteur_nom)
      values (m.id, m.bien_id, 'date_changee', jsonb_build_object('date', m.date_mission, 'statut', m.statut),
        jsonb_build_object('date', v_cible, 'sejour', r.arrival_date || ' → ' || r.departure_date),
        case when m.statut = 'cancelled' then 'Séjour de nouveau valide : recouche réactivée le ' else 'Dates du séjour changées : recouche déplacée au ' end
          || to_char(v_cible, 'DD/MM/YYYY') || ' (à confirmer avec le voyageur)', 'Suivi du séjour');
      n := n + 1;
    end if;
  end loop;
  return n;
end $function$;


-- Activation des deux recouches (DCB + Lauïan) à 4 nuits minimum, 48 h de délai.
update public.direct_service set actif = true, nuits_min = 4, delai_min_h = 48, maj_le = now(), maj_par = 'migration 433 (décision Oïhan 15/10/2026)'
 where cle in ('recouche', 'menage_sejour') and mission_type = 'recouche';
comment on column public.direct_service.nuits_min is 'Séjour minimum (nuits) pour proposer le service. Recouche : 4 (433, jamais sous 3).';
