do $$
declare r record; c uuid := gen_random_uuid(); msg text := ''; v text; vir_avant text; vir_apres text; n int;
begin
  select rr.id, rr.bien_id, rr.mois_comptable, rr.code into r from reservation rr
   where rr.mois_comptable = '2026-09' and rr.final_status = 'accepted' and bien_mois_fige(rr.bien_id, '2026-09')
     and exists (select 1 from ventilation v where v.reservation_id = rr.id and v.code = 'VIR') limit 1;
  msg := 'resa ' || r.code || ' fige(09)=' || bien_mois_fige(r.bien_id, '2026-09') || ' ouvert=' || mois_ouvert_regul(r.bien_id, '2026-10');
  select string_agg(code || ':' || montant_ttc, ',' order by code, mois_comptable) into vir_avant from ventilation where reservation_id = r.id and code <> 'PVOY';
  insert into portail_voyageur_commande (id, reservation_id, bien_id, agence, lignes, total_centimes, statut, essai, paiement_mode, paye_le)
  values (c, r.id, r.bien_id, 'dcb', '[{"libelle":"Option voyageur : Départ jusqu''à 14 h","montant_centimes":4500,"service_cle":"depart_14h"},{"libelle":"Option voyageur : Lit bébé","montant_centimes":5000,"service_cle":"lit_bebe"}]', 9500, 'paiement_attente', false, 'stripe', now());
  select count(*) into n from portail_option_regul where commande_id = c; msg := msg || ' | attente regul=' || n;
  update portail_voyageur_commande set statut = 'payee' where id = c;
  select string_agg(sens || ' ' || montant_centimes || ' → ' || coalesce(mois_regul, 'ERR ' || erreur), ' ; ') into v from portail_option_regul where commande_id = c; msg := msg || ' | payee: ' || v;
  update portail_voyageur_commande set statut = 'payee' where id = c; -- rejeu
  update portail_voyageur_commande set lignes = jsonb_set(lignes, '{0,rembourse_le}', to_jsonb(now()::text)), statut = 'remboursee_partiel' where id = c;
  select count(*) into n from portail_option_regul where commande_id = c; msg := msg || ' | après remb. ligne 0 : ' || n || ' regul';
  select string_agg(code || ' ' || montant_ttc || ' (' || mois_comptable || ')', ' ; ') into v from ventilation where reservation_id = r.id and code = 'PVOY' and note like 'Régularisation automatique 468%'; msg := msg || ' | PVOY regul: ' || v;
  select string_agg(code || ':' || montant_ttc, ',' order by code, mois_comptable) into vir_apres from ventilation where reservation_id = r.id and code <> 'PVOY';
  msg := msg || ' | lignes hors PVOY (HON/LOY/VIR…) identiques=' || (vir_avant = vir_apres) || ' [' || left(vir_apres, 80) || ']';
  raise exception 'TEST (annulé) %', msg;
end $$;
