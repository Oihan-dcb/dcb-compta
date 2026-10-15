-- 427 — Recouches vendues en ligne : DEUX types + règle de prix (15/10/2026, décisions d'Oïhan).
--  1. Deux services distincts au catalogue :
--       « Recouche avec changement des draps et serviettes »  (cle 'recouche', ex « Recouche (ménage + linge) »)
--       « Recouche sans changement des draps et serviettes »  (cle 'menage_sejour', ex « Ménage en cours de séjour »)
--     FUSION : « Ménage en cours de séjour » (ménage complet en milieu de séjour, sans linge, déjà mission recouche 425)
--     EST la recouche sans changement → renommée, MÊME cle (lignes de devis, surcharge du 416, clés vente_source
--     inchangées) : aucun doublon, aucun réglage par bien perdu.
--     direct_service.recouche_linge : true = avec changement (linge à prévoir), false = sans (ménage seul).
--     La mission recouche créée au milieu du séjour porte le type (mission_menage.recouche_linge) et le nombre de
--     voyageurs (vente_voyageurs : devis puis réservation synchronisée) → hub Missions, portail AE, Sacs et tâches.
--  2. Règle de prix (À VALIDER par Oïhan — services toujours DÉSACTIVÉS) : prix_regle 'menage_coef' =
--     M = frais de ménage du bien (bien_frais menage_community canal direct, repli airbnb, puis menage_cleaning booking) ;
--     AVEC changement : M × prix_coef (1,30 ; le ménage inclut déjà le linge) ;
--     SANS changement : M × prix_coef − linge_jeu_centimes (45 €) × jeux de la résa, jamais sous M × prix_plancher_coef
--     (0,50) ; arrondi à l'euro. Jeux de la résa = arrondi sup(voyageurs / 2) plafonné au nombre de lits du bien
--     (bien.nb_lits, sinon housses de couette de la fiche linge, sinon arrondi sup(capacité / 2)). Prix forcé par bien =
--     bien_direct_service.prix_centimes (prime sur la règle). Calcul : dcb-planning api/_services.js (prixService).
--  3. Traductions fixes du catalogue (nom_en / nom_es / description_en / description_es) : contrats EN / ES et parcours
--     voyageur (priment sur le cache direct_traduction, sans appel IA).

alter table public.direct_service add column if not exists prix_regle text not null default 'fixe';
alter table public.direct_service add column if not exists prix_coef numeric(4,2);
alter table public.direct_service add column if not exists recouche_linge boolean;
alter table public.direct_service add column if not exists linge_jeu_centimes integer check (linge_jeu_centimes is null or linge_jeu_centimes between 0 and 50000);
alter table public.direct_service add column if not exists prix_plancher_coef numeric(4,2) check (prix_plancher_coef is null or prix_plancher_coef between 0 and 5);
alter table public.direct_service add column if not exists nom_en text;
alter table public.direct_service add column if not exists nom_es text;
alter table public.direct_service add column if not exists description_en text;
alter table public.direct_service add column if not exists description_es text;
alter table public.direct_service drop constraint if exists direct_service_prix_regle_check;
alter table public.direct_service add constraint direct_service_prix_regle_check check (prix_regle in ('fixe', 'menage_coef'));
alter table public.direct_service drop constraint if exists direct_service_prix_coef_check;
alter table public.direct_service add constraint direct_service_prix_coef_check check (prix_coef is null or prix_coef between 0.10 and 5.00);
alter table public.direct_service drop constraint if exists direct_service_regle_coef;
alter table public.direct_service add constraint direct_service_regle_coef check (prix_regle <> 'menage_coef' or prix_coef is not null);
alter table public.direct_service drop constraint if exists direct_service_linge_recouche;
alter table public.direct_service add constraint direct_service_linge_recouche check (recouche_linge is null or mission_type = 'recouche');
alter table public.direct_service drop constraint if exists direct_service_traductions_longueur;
alter table public.direct_service add constraint direct_service_traductions_longueur check (
  (nom_en is null or char_length(nom_en) <= 80) and (nom_es is null or char_length(nom_es) <= 80)
  and (description_en is null or char_length(description_en) <= 400) and (description_es is null or char_length(description_es) <= 400));
alter table public.direct_service drop constraint if exists direct_service_prix_si_actif;
alter table public.direct_service add constraint direct_service_prix_si_actif check (type = 'demande' or prix_centimes is not null or prix_regle = 'menage_coef' or not actif);
comment on column public.direct_service.prix_regle is '''fixe'' = prix_centimes ; ''menage_coef'' = frais de ménage du bien (direct, repli airbnb, puis booking) × prix_coef, arrondi à l''euro (427). Prix forcé par bien : bien_direct_service.prix_centimes.';
comment on column public.direct_service.linge_jeu_centimes is 'Règle menage_coef : coût d''un jeu de draps + serviettes retiré par jeu de la résa (arrondi sup(voyageurs / 2), plafonné aux lits) (recouche SANS changement, 4500 par défaut). 427.';
comment on column public.direct_service.prix_plancher_coef is 'Règle menage_coef : prix jamais sous ménage × ce coefficient (0,50). 427.';
comment on column public.direct_service.recouche_linge is 'Recouche : true = avec changement des draps et serviettes (linge à prévoir), false = sans changement (ménage seul). 427.';
comment on column public.direct_service.nom_en is 'Traduction fixe (contrats EN, parcours voyageur) ; vide = cache direct_traduction puis FR. 427.';

-- Catalogue : les deux recouches (désactivées, prix à valider)
update public.direct_service set
  nom = 'Recouche avec changement des draps et serviettes',
  description = 'Ménage et changement des draps et des serviettes en milieu de séjour, à une date convenue avec vous.',
  recouche_linge = true, prix_regle = 'menage_coef', prix_coef = 1.30, linge_jeu_centimes = null, prix_plancher_coef = 0.50, actif = false, ordre = 60,
  nom_en = 'Mid-stay cleaning with fresh sheets and towels',
  nom_es = 'Limpieza a mitad de estancia con cambio de sábanas y toallas',
  description_en = 'Cleaning and a change of sheets and towels halfway through your stay, on a date agreed with you.',
  description_es = 'Limpieza y cambio de sábanas y toallas a mitad de la estancia, en una fecha acordada con usted.',
  maj_par = 'migration 427', maj_le = now()
where cle = 'recouche' and mission_type = 'recouche';
update public.direct_service set
  nom = 'Recouche sans changement des draps et serviettes',
  description = 'Ménage en milieu de séjour, sans changement des draps ni des serviettes, à une date convenue avec vous.',
  recouche_linge = false, prix_regle = 'menage_coef', prix_coef = 1.30, linge_jeu_centimes = 4500, prix_plancher_coef = 0.50, prix_centimes = null, actif = false, ordre = 61,
  nom_en = 'Mid-stay cleaning without changing sheets and towels',
  nom_es = 'Limpieza a mitad de estancia sin cambio de sábanas ni toallas',
  description_en = 'Cleaning halfway through your stay, without changing the sheets or towels, on a date agreed with you.',
  description_es = 'Limpieza a mitad de la estancia, sin cambiar sábanas ni toallas, en una fecha acordada con usted.',
  maj_par = 'migration 427', maj_le = now()
where cle = 'menage_sejour' and mission_type = 'recouche';
-- Traductions fixes des autres services du catalogue (courtes, sans IA)
update public.direct_service s set nom_en = v.en, nom_es = v.es, maj_le = now()
from (values ('lit_bebe', 'Baby cot', 'Cuna'), ('chaise_haute', 'High chair', 'Trona'),
             ('lit_appoint_80', 'Single extra bed', 'Cama supletoria individual'), ('lit_appoint_160', 'Double extra bed', 'Cama supletoria doble'),
             ('kit_plage', 'Beach kit', 'Kit de playa'), ('arrivee_anticipee', 'Early check-in', 'Llegada anticipada'),
             ('depart_tardif', 'Late check-out', 'Salida tardía'), ('accueil_vip', 'VIP welcome', 'Bienvenida VIP')) as v(cle, en, es)
where s.cle = v.cle and s.nom_en is null;

-- Nombre de LITS du bien (1 lit = 1 jeu de draps + serviettes = 2 personnes), corrigé à la main ; null = déduit
-- (housses de couette de la fiche linge bien_toolbox.linge_plat, puis arrondi sup(capacité / 2)). Saisi dans 🌐 › 🧺 Services.
alter table public.bien add column if not exists nb_lits smallint check (nb_lits is null or nb_lits between 1 and 30);
comment on column public.bien.nb_lits is 'Nombre de lits du bien saisi par le bureau (1 lit = 1 jeu de draps + serviettes = 2 personnes ; null = déduit de la fiche linge bien_toolbox.linge_plat, puis capacité / 2). 427.';

-- Lits du bien : saisi (bien.nb_lits) > fiche linge (housses de couette de bien_toolbox.linge_plat, celle que lit l'AE
-- dans Ma journée pour préparer le linge) > arrondi sup(capacité / 2). Source UNIQUE (api/_services.js la lit).
create or replace view public.bien_lits_v with (security_invoker = true) as
select b.id as bien_id, b.code, b.agence, b.capacite,
  coalesce(b.nb_lits, nullif(l.housses, 0), case when b.capacite > 0 then ceil(b.capacite / 2.0)::int end) as nb_lits,
  case when b.nb_lits is not null then 'saisi' when coalesce(l.housses, 0) > 0 then 'fiche_linge' when b.capacite > 0 then 'capacite' end as source,
  nullif(l.housses, 0) as housses_fiche_linge,
  coalesce(l.canape, false) as canape_dans_linge
from public.bien b
left join lateral (
  select sum((m[1])::int) as housses, bool_or(t.linge_plat ~* 'canap') as canape
  from public.bien_toolbox t
  left join lateral regexp_matches(coalesce(t.linge_plat, ''), '(\d+)\s*housses?\s+de\s+couette', 'gi') m on true
  where t.bien_id = b.id and t.archived_at is null
) l on true;
comment on view public.bien_lits_v is 'Nombre de lits (= jeux de draps + serviettes, 2 personnes par lit) : saisi > fiche linge (housses de couette) > capacité / 2. 427.';
revoke all on public.bien_lits_v from anon;
grant select on public.bien_lits_v to authenticated, service_role;

-- ─── Missions : type de recouche + voyageurs ───────────────────────────────────────────────────
alter table public.mission_menage add column if not exists recouche_linge boolean;
alter table public.mission_menage add column if not exists vente_voyageurs smallint;
alter table public.mission_menage add column if not exists recouche_jeux smallint;
comment on column public.mission_menage.recouche_jeux is 'Recouche vendue : lits utilisés = jeux de draps + serviettes (choisi par le voyageur « Combien de lits utilisez-vous ? », défaut arrondi sup(voyageurs / 2) plafonné aux lits du bien ; corrigeable par le bureau dans le hub). Linge du sac si AVEC changement. 427.';
comment on column public.mission_menage.recouche_linge is 'Recouche vendue : true = avec changement des draps et serviettes (linge pour vente_voyageurs), false = sans changement (pas de linge). 427.';
comment on column public.mission_menage.vente_voyageurs is 'Recouche vendue : nombre de voyageurs (devis, puis reservation.guest_count) — linge à prévoir. 427.';

-- Création : + p_lits = « Combien de lits utilisez-vous ? » choisi par le voyageur (= jeux de draps + serviettes ;
-- défaut arrondi sup(voyageurs / 2) plafonné aux lits du bien). Type lu depuis le service (cle de la source).
drop function if exists public.recouche_vendue_creer(uuid, text, date, date, text, integer, text, text);
create or replace function public.recouche_vendue_creer(p_bien uuid, p_resa_hospitable_id text, p_arrivee date, p_depart date,
  p_source text, p_qte integer default 1, p_service text default 'Recouche', p_ref text default null, p_lits integer default null)
returns table (mission_id uuid, date_mission date, cree boolean)
language plpgsql security definer set search_path to 'public' as $$
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
  if v_n < 3 then raise exception 'sejour_trop_court'; end if;
  select b.code, coalesce(b.agence, 'dcb') into v_code, v_agence from bien b where b.id = p_bien;
  select s.recouche_linge into v_linge from direct_service s where s.agence = v_agence and s.cle = split_part(p_source, ':', 3);
  select nullif(x.guest_count, 0) into v_voy from reservation x where x.hospitable_id = p_resa_hospitable_id and x.guest_count > 0 limit 1;
  if v_voy is null or v_voy = 0 then
    select coalesce(d.adultes, 0) + coalesce(d.enfants, 0) into v_voy from devis_option d where d.id = split_part(p_source, ':', 2)::uuid;
  end if;
  select l.nb_lits into v_lits from bien_lits_v l where l.bien_id = p_bien;
  v_jeux := case when p_lits between 1 and 30 then least(p_lits, coalesce(v_lits, p_lits))
                 when coalesce(v_voy, 0) > 0 then least(ceil(v_voy / 2.0)::int, coalesce(v_lits, ceil(v_voy / 2.0)::int)) end;
  v_lib := case v_linge when true then 'Recouche AVEC changement des draps et serviettes' when false then 'Recouche SANS changement des draps et serviettes' else 'Recouche' end;
  -- durée prévue = médiane des ménages de départ du bien sur 12 mois (repli 2 h)
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
end $$;
revoke all on function public.recouche_vendue_creer(uuid, text, date, date, text, integer, text, text, integer) from public, anon, authenticated;
grant execute on function public.recouche_vendue_creer(uuid, text, date, date, text, integer, text, text, integer) to service_role;

-- Suivi : + nombre de voyageurs repris de la réservation (linge à prévoir), en plus des dates / statut (425).
create or replace function public.recouche_vendue_suivre(p_resa_hospitable_id text)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  r record; m record;
  v_annule boolean; v_n int; v_cible date; n int := 0;
begin
  if p_resa_hospitable_id is null then return 0; end if;
  select x.arrival_date, x.departure_date, x.final_status, x.guest_count into r from reservation x where x.hospitable_id = p_resa_hospitable_id limit 1;
  if not found then return 0; end if;
  if coalesce(r.guest_count, 0) > 0 then
    -- recouche_jeux = lits choisis par le voyageur (ou corrigés par le bureau) : jamais écrasé ; déduit seulement s'il manque
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
    if v_annule or v_n < 3 or m.vente_rang > v_n - 1 then
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
end $$;
revoke all on function public.recouche_vendue_suivre(text) from public, anon, authenticated;
grant execute on function public.recouche_vendue_suivre(text) to service_role;

create or replace function public.trg_recouche_vendue_suivre()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'UPDATE' and old.arrival_date is not distinct from new.arrival_date and old.departure_date is not distinct from new.departure_date
     and old.final_status is not distinct from new.final_status and old.guest_count is not distinct from new.guest_count then return new; end if;
  if new.hospitable_id is not null and exists (select 1 from mission_menage m where m.vente_resa_hospitable_id = new.hospitable_id) then
    perform recouche_vendue_suivre(new.hospitable_id);
  end if;
  return new;
exception when others then
  raise warning 'recouche_vendue_suivre(%) : %', new.hospitable_id, sqlerrm;
  return new;
end $$;
drop trigger if exists trg_recouche_vendue_suivre on public.reservation;
create trigger trg_recouche_vendue_suivre after insert or update of arrival_date, departure_date, final_status, guest_count on public.reservation
  for each row execute function public.trg_recouche_vendue_suivre();
