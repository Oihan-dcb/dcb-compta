-- 498 — PÉNALITÉ DE DÉPART TARDIF ENCAISSÉE VIA AIRBNB / BOOKING : correction du double comptage (19/10/2026, signalé par
-- l'agent réclamations). Une réclamation payée par la plateforme arrive DANS le virement Airbnb / Booking (déjà dans
-- fin_revenue, donc dans le résidu propriétaire LOY / VIRProprio) ; 471 la mettait AUSSI en COM → comptée deux fois.
-- Même logique que 497 (réclamations voyageurs) :
--   · reservation.penalites_depart porte 'dans_revenu' = (mode 'plateforme') → ventilationCore retire ce montant du LOY
--     (donc du VIRProprio) et garde la ligne COM « Pénalité départ tardif non autorisé » (TVA 20 %) ;
--   · débit de la carte de garantie / encaissement manuel d'une directe (hors revenu de la plateforme) : inchangé ;
--   · mois du séjour FIGÉ + plateforme : plus de ligne automatique (le propriétaire a peut-être déjà été payé) → trace
--     penalite_depart_regul avec erreur → ligne ROUGE « à régulariser à la main » dans Accueil › À faire.
-- Cas réels à régulariser au 19/10/2026 : AUCUN (penalite_depart vide, aucune reservation.penalites_depart).
-- APPLIQUÉE le 19/10/2026 (MCP) ; edge ventilation-auto redéployée ; dry-run 09-10/2026 DCB + Lauïan : 0 écart ; vitest 98.

create or replace function public.penalite_depart_vers_reservation() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_resa uuid := coalesce(new.reservation_id, old.reservation_id);
  v_list jsonb;
  comptes text[] := array['debitee', 'encaissee'];
  v_new int := 0; v_old int := 0; v_delta int;
  r record; v_m text; v_vid uuid; v_err text; v_le timestamptz; v_rid uuid := gen_random_uuid();
begin
  select jsonb_agg(jsonb_build_object('libelle', 'Pénalité départ tardif non autorisé', 'montant', p.encaisse_centimes, 'penalite_id', p.id, 'dans_revenu', p.mode = 'plateforme') order by p.cree_le)
    into v_list
    from penalite_depart p
   where p.reservation_id = v_resa and p.statut = any(comptes) and p.encaisse_centimes > 0;
  update reservation set penalites_depart = v_list, ventilation_calculee = false
   where id = v_resa and penalites_depart is distinct from v_list;

  -- Régularisation si le mois du séjour est figé : écart entre ce qui était compté et ce qui l'est maintenant.
  if tg_op in ('INSERT', 'UPDATE') and new.statut = any(comptes) then v_new := coalesce(new.encaisse_centimes, 0); end if;
  if tg_op in ('UPDATE', 'DELETE') and old.statut = any(comptes) then v_old := coalesce(old.encaisse_centimes, 0); end if;
  v_delta := v_new - v_old;
  if v_delta = 0 or tg_op = 'DELETE' then return null; end if;
  select id, bien_id, mois_comptable, code into r from reservation where id = v_resa;
  if r.id is null or r.mois_comptable is null or not bien_mois_fige(r.bien_id, r.mois_comptable) then return null; end if;
  v_le := coalesce(new.encaisse_le, now());
  -- 498 : réclamation Airbnb / Booking = argent arrivé DANS le virement de la plateforme, donc déjà dans le revenu du séjour
  -- (et peut-être déjà reversé au propriétaire avant la clôture) → pas de ligne automatique : à régulariser à la main
  -- (comme reclamation_compta_appliquer, 497), signalé en rouge dans « À faire ».
  if new.mode = 'plateforme' then
    insert into penalite_depart_regul (id, penalite_id, reservation_id, bien_id, montant_centimes, mois_sejour, mois_regul, ventilation_id, erreur)
    values (v_rid, new.id, r.id, r.bien_id, v_delta, r.mois_comptable, null, null,
            'encaissée via la plateforme alors que le mois du séjour est clôturé : à régulariser à la main (ligne COM dans un mois ouvert ; si le virement de la plateforme a déjà été reversé au propriétaire, retenue de la part agence sur son prochain reversement)');
    return null;
  end if;
  v_m := mois_ouvert_regul(r.bien_id, greatest(to_char(v_le at time zone 'Europe/Paris', 'YYYY-MM'), r.mois_comptable));
  if v_m is not null then
    begin
      insert into ventilation (reservation_id, bien_id, proprietaire_id, code, libelle, montant_ht, taux_tva, montant_tva, montant_ttc, mois_comptable, calcul_source, note)
      select r.id, r.bien_id, b.proprietaire_id, 'COM',
             -- libellé unique (contrainte ventilation_resa_code_libelle_unique) : date + référence de la régularisation
             left('Régularisation : pénalité départ tardif non autorisé' || case when v_new = 0 then ' (annulée)' when v_delta < 0 then ' (correction)' else '' end
                  || ' — séjour ' || coalesce(r.code, '') || ' de ' || r.mois_comptable || ', le ' || to_char(v_le at time zone 'Europe/Paris', 'DD/MM/YYYY')
                  || ' (réf. ' || left(v_rid::text, 8) || ')', 200),
             round(v_delta / 1.2)::int, 20, v_delta - round(v_delta / 1.2)::int, v_delta, v_m, 'manual',
             'Régularisation automatique 471 (pénalité ' || left(new.id::text, 8) || ')'
        from bien b where b.id = r.bien_id
      returning id into v_vid;
    exception when others then v_err := sqlerrm;
    end;
  else v_err := 'aucun mois ouvert trouvé';
  end if;
  insert into penalite_depart_regul (id, penalite_id, reservation_id, bien_id, montant_centimes, mois_sejour, mois_regul, ventilation_id, erreur)
  values (v_rid, new.id, r.id, r.bien_id, v_delta, r.mois_comptable, case when v_vid is not null then v_m end, v_vid, v_err);
  return null;
end $$;
revoke all on function public.penalite_depart_vers_reservation() from public, anon, authenticated;

-- Recalcul des listes existantes (aucune ligne au 19/10/2026 : sans effet).
update public.penalite_depart set statut = statut where statut in ('debitee', 'encaissee');
