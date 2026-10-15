-- 421c — Metrics › Missions : durées « réelles » sans les missions dont « Terminer » a été oublié (15/10/2026).
-- PANORAMA 09/10 (fin oubliée) comptait 1 355 min au chrono et faussait la durée moyenne ; même exclusion que la
-- règle de dépassement du hub. La durée reste visible dans la liste « À reprendre / à vérifier ».

create or replace function public.ph_metrics_missions_calc(p_biens uuid[], p_sans_bien boolean, p_debut date, p_fin date, p_equipe boolean)
returns jsonb language sql stable security definer set search_path to 'public' as $$
with r as (select depassement_pct from mission_verif_reglage where id = 1),
h as (
  select h.* from mission_hub_periode(p_debut, p_fin) h
   where h.date_mission between p_debut and p_fin
     and (h.bien_id = any(p_biens) or (p_sans_bien and h.bien_id is null))
),
mi as (
  select h.*, case when not coalesce(h.fin_oubliee, false) then h.mesure_min end as mes, m.montant, m.titre_ical, coalesce(m.impute_salaire, false) as impute_salaire,
         ma.assigne_le, ma.accepte_le, ma.refuse_le,
         -- délai d'acceptation : hors initialisation du circuit (toutes les missions assignées le 09/10/2026 11:21:43)
         case when ma.accepte_le is not null and ma.assigne_le is not null
               and not (ma.assigne_le >= '2026-10-09 11:21:43+00' and ma.assigne_le < '2026-10-09 11:21:44+00')
              then greatest(0, extract(epoch from (ma.accepte_le - ma.assigne_le)) / 60.0) end as delai_acc_min,
         (h.prevu_min > 0 and h.mesure_min is not null and not coalesce(h.fin_oubliee, false)
           and h.mesure_min > h.prevu_min * (1 + (select depassement_pct from r) / 100.0) and h.mesure_min - h.prevu_min >= 10) as depasse,
         case when m.statut = 'valide' and coalesce(m.titre_ical, '') not like 'Maintenance%' and not coalesce(m.impute_salaire, false)
              then coalesce(m.montant, 0) else 0 end as cout
    from h join mission_menage m on m.id = h.mission_id
    left join mission_acceptation ma on ma.mission_id = m.id and ma.ae_id = m.ae_id
   where h.source = 'mission'
),
ex as (
  select x.*, (select coalesce(m.type_mission, '') from mission_menage m where m.id = x.mission_id) as tm
    from prestation_hors_forfait x
   where x.date_prestation between p_debut and p_fin and coalesce(x.statut, '') not in ('cancelled', 'annule')
     and (x.bien_id = any(p_biens) or (p_sans_bien and x.bien_id is null))
),
sans as (  -- tâches Hospitable du hub sans AE (miroir depuis le 10/10/2026)
  select count(*) n from h where h.source = 'hospitable' and h.etat = 'a_attribuer'
),
agg as (
  select null::text as k, count(*) n, sum(prevu_min) prevu, count(*) filter (where mes is not null) n_mesure,
         sum(mes) filter (where mes is not null) mesure, sum(prevu_min) filter (where mes is not null) prevu_mesure,
         count(*) filter (where depasse) n_depasse, sum(mes - prevu_min) filter (where depasse) min_depasse,
         count(*) filter (where t_statut = 'terminee') n_terminee, count(*) filter (where t_statut is not null) n_ma_journee,
         count(*) filter (where video_media_id is not null) n_video,
         count(*) filter (where controle_statut = 'ok') n_verifiee, count(*) filter (where controle_statut = 'a_reprendre') n_a_reprendre,
         count(*) filter (where groupe = 'verifier') n_a_verifier, count(*) filter (where etat = 'jamais_demarree') n_jamais,
         count(*) filter (where non_faite) n_non_faite, count(*) filter (where ae_id is null) n_sans_ae_mission,
         count(*) filter (where acc_statut = 'refusee' or refuse_le is not null) n_refus,
         count(*) filter (where delai_acc_min is not null) n_acc, avg(delai_acc_min) delai_moy,
         percentile_cont(0.5) within group (order by delai_acc_min) delai_med,
         count(*) filter (where acc_statut = 'en_attente') n_acc_attente, count(*) filter (where acc_en_retard) n_acc_retard,
         count(*) filter (where mission_statut = 'valide') n_valide, count(*) filter (where hors_paie) n_hors_paie,
         sum(cout) cout, sum(nb_tech + nb_sig) n_signal
    from mi
)
select jsonb_build_object(
  'totaux', (select to_jsonb(agg) - 'k' || jsonb_build_object(
      'cout', case when p_equipe then agg.cout end,
      'n_sans_ae_hospitable', (select n from sans),
      'extras_n', (select count(*) from ex), 'extras_min', (select coalesce(sum(duree_minutes), 0) from ex),
      'extras_valide', (select count(*) from ex where statut = 'valide'), 'extras_attente', (select count(*) from ex where statut = 'en_attente'),
      'extras_refuse', (select count(*) from ex where statut = 'refuse'), 'extras_hors_circuit', (select count(*) from ex where statut = 'regle_hors_circuit'),
      'extras_cout', case when p_equipe then (select coalesce(sum(montant), 0) from ex where statut = 'valide' and not coalesce(impute_salaire, false)) end)
    from agg),
  'types', (select coalesce(jsonb_agg(jsonb_build_object('type', type, 'n', n, 'prevu', prevu, 'n_mesure', n_mesure, 'mesure', mesure,
        'prevu_mesure', prevu_mesure, 'n_depasse', n_depasse, 'cout', case when p_equipe then cout end) order by n desc), '[]'::jsonb)
      from (select type, count(*) n, sum(prevu_min) prevu, count(*) filter (where mes is not null) n_mesure, sum(mes) mesure,
                   sum(prevu_min) filter (where mes is not null) prevu_mesure, count(*) filter (where depasse) n_depasse, sum(cout) cout
              from mi group by type) x),
  'ae', (select coalesce(jsonb_agg(jsonb_build_object('ae_id', ae_id, 'nom', nom, 'n', n, 'prevu', prevu, 'n_mesure', n_mesure, 'mesure', mesure,
        'prevu_mesure', prevu_mesure, 'n_depasse', n_depasse, 'n_verifiee', n_verifiee, 'n_a_reprendre', n_a_reprendre, 'n_refus', n_refus,
        'n_acc', n_acc, 'delai_moy', delai_moy, 'n_menage', n_menage,
        'extras_n', (select count(*) from ex where ex.ae_id = x.ae_id),
        'extras_cout', case when p_equipe then (select coalesce(sum(montant), 0) from ex where ex.ae_id = x.ae_id and statut = 'valide' and not coalesce(impute_salaire, false)) end,
        'cout', case when p_equipe then cout end) order by n desc), '[]'::jsonb)
      from (select ae_id, max(trim(coalesce(ae_prenom, '') || ' ' || coalesce(ae_nom, ''))) nom, count(*) n, sum(prevu_min) prevu,
                   count(*) filter (where mes is not null) n_mesure, sum(mes) mesure, sum(prevu_min) filter (where mes is not null) prevu_mesure,
                   count(*) filter (where depasse) n_depasse, count(*) filter (where controle_statut = 'ok') n_verifiee,
                   count(*) filter (where controle_statut = 'a_reprendre') n_a_reprendre, count(*) filter (where acc_statut = 'refusee' or refuse_le is not null) n_refus,
                   count(*) filter (where delai_acc_min is not null) n_acc, avg(delai_acc_min) delai_moy,
                   count(*) filter (where type = 'menage') n_menage, sum(cout) cout
              from mi group by ae_id) x),
  'biens', (select coalesce(jsonb_agg(jsonb_build_object('id', bien_id, 'code', code, 'agence', agence, 'n', n, 'n_menage', n_menage, 'prevu', prevu,
        'n_mesure', n_mesure, 'mesure', mesure, 'prevu_mesure', prevu_mesure, 'n_depasse', n_depasse, 'n_a_reprendre', n_a_reprendre,
        'extras_n', (select count(*) from ex where ex.bien_id = x.bien_id),
        'extras_cout', case when p_equipe then (select coalesce(sum(montant), 0) from ex where ex.bien_id = x.bien_id and statut = 'valide' and not coalesce(impute_salaire, false)) end,
        'cout', case when p_equipe then cout end) order by code), '[]'::jsonb)
      from (select bien_id, max(bien_code) code, max(agence) agence, count(*) n, count(*) filter (where type = 'menage') n_menage, sum(prevu_min) prevu,
                   count(*) filter (where mes is not null) n_mesure, sum(mes) mesure, sum(prevu_min) filter (where mes is not null) prevu_mesure,
                   count(*) filter (where depasse) n_depasse, count(*) filter (where controle_statut = 'a_reprendre') n_a_reprendre, sum(cout) cout
              from mi group by bien_id) x),
  'mois', (select coalesce(jsonb_agg(jsonb_build_object('m', m, 'n', n, 'n_menage', n_menage, 'prevu', prevu, 'mesure', mesure, 'n_mesure', n_mesure,
        'n_depasse', n_depasse, 'cout', case when p_equipe then cout end,
        'extras_cout', case when p_equipe then (select coalesce(sum(montant), 0) from ex where to_char(ex.date_prestation, 'YYYY-MM') = x.m and statut = 'valide' and not coalesce(impute_salaire, false)) end) order by m), '[]'::jsonb)
      from (select to_char(date_mission, 'YYYY-MM') m, count(*) n, count(*) filter (where type = 'menage') n_menage, sum(prevu_min) prevu, sum(mes) mesure,
                   count(*) filter (where mes is not null) n_mesure, count(*) filter (where depasse) n_depasse, sum(cout) cout
              from mi group by 1) x),
  'jours', (select coalesce(jsonb_agg(jsonb_build_array(d::date, coalesce(x.n, 0), coalesce(x.cout, 0)) order by d), '[]'::jsonb)
      from generate_series(p_debut, p_fin, interval '1 day') d
      left join (select date_mission, count(*) n, sum(cout) cout from mi group by 1) x on x.date_mission = d::date),
  'extras_types', (select coalesce(jsonb_agg(jsonb_build_object('type', t, 'n', n, 'min', mn, 'cout', case when p_equipe then cout end) order by n desc), '[]'::jsonb)
      from (select coalesce(pt.nom, 'Sans type') t, count(*) n, coalesce(sum(ex.duree_minutes), 0) mn,
                   coalesce(sum(ex.montant) filter (where ex.statut = 'valide' and not coalesce(ex.impute_salaire, false)), 0) cout
              from ex left join prestation_type pt on pt.id = ex.prestation_type_id group by 1) y),
  'reprendre', (select coalesce(jsonb_agg(jsonb_build_object('mission_id', mission_id, 'bien', bien_code, 'jour', date_mission, 'type', type,
        'ae', trim(coalesce(ae_prenom, '') || ' ' || coalesce(ae_nom, '')), 'etat', etat, 'pourquoi', coalesce(controle_note, pourquoi),
        'prevu', prevu_min, 'mesure', mesure_min) order by date_mission desc), '[]'::jsonb)
      from mi where controle_statut = 'a_reprendre' or groupe in ('verifier', 'boucler') or depasse)
);
$$;
revoke all on function public.ph_metrics_missions_calc(uuid[], boolean, date, date, boolean) from public, anon, authenticated;
