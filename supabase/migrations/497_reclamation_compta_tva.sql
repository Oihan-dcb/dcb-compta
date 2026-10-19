-- 497 : RÉCLAMATIONS VOYAGEURS — compta AVEC TVA (décisions d'Oïhan du 19/10/2026).
--  · Ménage en plus 35 €/h (déjà posé dans reclamation_reglage par le coordinateur) ; répartition par ligne modifiable
--    (agence / propriétaire / partagé avec % agence) ; seuil 10 € ; montants du barème = montants TTC demandés au voyageur.
--  · TVA : tva_indemnite = true (dcb + lauian) → part AGENCE = revenu de l'agence sous COM avec TVA 20 % (comme la pénalité
--    de départ tardif, 471). Part PROPRIÉTAIRE = refacturation pour le compte du propriétaire (débours), sans TVA agence.
--  · reservation.reclamations_agence = [{libelle, montant (centimes TTC), reclamation_id, dans_revenu, tva}] → ventilationCore :
--    ligne COM « Indemnité voyageur (réclamation dégâts / ménage) » ; dans_revenu (argent arrivé DANS le virement Airbnb /
--    Booking, déjà dans fin_revenue) → retiré du LOY ; sinon (carte de garantie / encaissement agence) rien à retirer.
--  · reclamation_compta_appliquer(id, par, dry) : appelé par PowerHouse au clic « Appliquer en compta » ; jamais automatique.
--    Mois du séjour FIGÉ → rien n'est écrit (statut « bloquee ») : la régularisation se fait à la main (cas ambigu : selon que
--    le virement plateforme est arrivé avant ou après la clôture, le propriétaire a été payé ou non).

update public.reclamation_reglage set tva_indemnite = true,
  mention_tva = 'Montants TTC, dont TVA 20 % sur la part de l''agence. La part reversée au propriétaire (débours pour son compte) n''est pas soumise à la TVA de l''agence.',
  maj_le = now(), maj_par = 'migration 497 (décision Oïhan 19/10/2026)';

alter table public.reservation add column if not exists reclamations_agence jsonb;
comment on column public.reservation.reclamations_agence is '497 : parts AGENCE des réclamations voyageurs encaissées [{libelle, montant (centimes TTC), reclamation_id, dans_revenu, tva}] → ligne COM (ventilationCore) ; dans_revenu → retirée du LOY.';

create or replace function public.reclamation_compta_appliquer(p_id uuid, p_par text, p_dry boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d record; r record; v_tot int; v_ag int; v_pr int; v_dans boolean; v_tva boolean; v_fige boolean; v_plan jsonb := '[]'; v_mois text;
begin
  select * into d from reclamation_voyageur where id = p_id;
  if d.id is null then return jsonb_build_object('erreur', 'Dossier introuvable'); end if;
  if d.statut <> 'encaissee' or coalesce(d.encaisse_centimes, 0) <= 0 then return jsonb_build_object('erreur', 'Rien d''encaissé'); end if;
  if d.compta_statut = 'appliquee' then return jsonb_build_object('erreur', 'Compta déjà appliquée'); end if;
  select rr.id, rr.code, rr.bien_id, rr.mois_comptable, rr.guest_name, rr.reclamations_agence, b.proprietaire_id
    into r from reservation rr left join bien b on b.id = rr.bien_id where rr.id = d.reservation_id;
  select coalesce(tva_indemnite, true) into v_tva from reclamation_reglage where agence = d.agence;
  v_tot := d.part_agence_centimes + d.part_proprio_centimes;
  v_ag := case when v_tot > 0 then round(d.encaisse_centimes::numeric * d.part_agence_centimes / v_tot)::int else d.encaisse_centimes end;
  v_pr := d.encaisse_centimes - v_ag;
  v_dans := d.encaisse_source in ('airbnb', 'booking');
  v_fige := r.mois_comptable is not null and bien_mois_fige(r.bien_id, r.mois_comptable);
  if v_ag > 0 then v_plan := v_plan || jsonb_build_array(jsonb_build_object('quoi', 'com_agence', 'montant_cts', v_ag, 'tva', v_tva,
    'detail', format('Part agence %s € TTC → ligne COM « Indemnité voyageur »%s du séjour (mois %s)%s.', replace(to_char(v_ag / 100.0, 'FM999990.00'), '.', ','),
      case when v_tva then ' (TVA 20 % incluse)' else ' (hors TVA)' end, r.mois_comptable,
      case when v_dans then ', retirée du reversement propriétaire (elle est arrivée dans le virement de la plateforme)' else '' end))); end if;
  if v_pr > 0 then
    if v_dans then v_plan := v_plan || jsonb_build_array(jsonb_build_object('quoi', 'proprio_loy', 'montant_cts', v_pr,
      'detail', format('Part propriétaire %s € : reste dans son reversement (arrivée dans le virement de la plateforme).', replace(to_char(v_pr / 100.0, 'FM999990.00'), '.', ','))));
    else v_plan := v_plan || jsonb_build_array(jsonb_build_object('quoi', 'proprio_remboursement', 'montant_cts', v_pr,
      'detail', format('Part propriétaire %s € : reversée par un frais « remboursement » (mois suivant).', replace(to_char(v_pr / 100.0, 'FM999990.00'), '.', ','))));
    end if;
  end if;
  if d.ajustement_id is not null then v_plan := v_plan || jsonb_build_array(jsonb_build_object('quoi', 'ajustement',
    'detail', 'Remboursement de la plateforme qualifié (ménage, sans part forfait) : la part agence passe par la ligne COM.')); end if;
  if v_fige then
    return jsonb_build_object('bloque', true, 'plan', v_plan, 'raison', format('Le mois %s du séjour est clôturé : rien n''est écrit automatiquement. À régulariser à la main dans dcb-compta (ligne COM de régularisation dans un mois ouvert ; et, si le virement de la plateforme a été reversé au propriétaire avant la clôture, retenue de la part agence sur son prochain reversement).', r.mois_comptable));
  end if;
  if p_dry then return jsonb_build_object('dry', true, 'plan', v_plan); end if;

  if v_ag > 0 then
    update reservation set reclamations_agence = coalesce(reclamations_agence, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'libelle', 'Indemnité voyageur (réclamation)', 'montant', v_ag, 'reclamation_id', d.id, 'dans_revenu', v_dans, 'tva', v_tva)),
      ventilation_calculee = false
     where id = r.id;
  end if;
  if v_pr > 0 and not v_dans then
    v_mois := to_char((now() at time zone 'Europe/Paris') + interval '1 month', 'YYYY-MM');
    insert into frais_proprietaire (bien_id, proprietaire_id, date, libelle, montant_ttc, statut, mode_traitement, mode_encaissement, mois_facturation, source)
    values (r.bien_id, r.proprietaire_id, (now() at time zone 'Europe/Paris')::date,
      left(format('Indemnité voyageur reversée — %s (%s) — réclamation %s', r.code, coalesce(r.guest_name, 'voyageur'), coalesce(d.facture_numero, left(d.id::text, 8))), 250),
      v_pr, 'a_facturer', 'remboursement', 'dcb', v_mois, 'manuel');
  end if;
  if d.ajustement_id is not null then
    update reservation_ajustement set type = 'menage', montant_fmen = 0, montant_auto = 0, statut = 'traite',
      qualifie_par = coalesce(p_par, 'reclamation'), qualifie_le = now()
     where id = d.ajustement_id and statut = 'a_qualifier';
    update reservation set ventilation_calculee = false where id = r.id;
  end if;
  update reclamation_voyageur set compta_statut = 'appliquee', compta = jsonb_build_object('plan', v_plan, 'le', now(), 'par', p_par),
    journal = journal || jsonb_build_array(jsonb_build_object('le', now(), 'quoi', 'compta_appliquee', 'par', p_par)), maj_le = now()
   where id = d.id;
  return jsonb_build_object('ok', true, 'plan', v_plan);
end $$;
revoke all on function public.reclamation_compta_appliquer(uuid, text, boolean) from public, anon, authenticated;
