-- Test 471 (transaction annulée par l'exception finale) : contrôle à la clôture + repli régularisation. Jamais 4XUWQQ.
do $$
declare r record; c uuid := gen_random_uuid(); msg text := ''; v text; avant text; apres text; nq int;
begin
  select rr.id, rr.bien_id, rr.code, rr.mois_comptable into r from reservation rr join bien b on b.id = rr.bien_id
   where rr.mois_comptable = '2026-10' and rr.final_status = 'accepted' and rr.code <> '4XUWQQ' and coalesce(b.agence,'dcb') = 'dcb'
     and not bien_mois_fige(rr.bien_id, '2026-10') and exists (select 1 from ventilation v where v.reservation_id = rr.id and v.code = 'VIR')
     and not exists (select 1 from cloture_comptable cc where cc.mois = '2026-10') limit 1;
  select string_agg(code || ':' || montant_ttc, ',' order by code) into avant from ventilation where reservation_id = r.id and code <> 'PVOY';
  select count(*) into nq from net.http_request_queue;
  insert into portail_voyageur_commande (id, reservation_id, bien_id, agence, lignes, total_centimes, statut, essai, paiement_mode, paye_le)
  values (c, r.id, r.bien_id, 'dcb', '[{"libelle":"Option voyageur : Lit bébé","montant_centimes":5000,"service_cle":"lit_bebe"}]', 5000, 'payee', false, 'stripe', now());
  select count(*) - nq into nq from net.http_request_queue; msg := 'resa ' || r.code || ' | recalcul immédiat demandé=' || nq;
  select options_compta_centimes::text into v from reservation where id = r.id; msg := msg || ' | témoin=' || v || ' (nuit pas passée)';
  -- A : clôture du bien → ligne PVOY ajoutée DANS 2026-10 avant le gel
  insert into cloture_bien (agence, bien_id, mois, active) values ('dcb', r.bien_id, '2026-10', true);
  select string_agg(code || ' ' || montant_ttc || ' (' || mois_comptable || ')', ' ; ') into v from ventilation where reservation_id = r.id and note like 'Contrôle à la clôture 471%'; msg := msg || ' | A: ' || coalesce(v, 'rien');
  select options_compta_centimes::text into v from reservation where id = r.id; msg := msg || ' témoin=' || v;
  -- rejeu (autre gel du même mois) : rien de plus
  perform portail_options_controle_cloture(r.bien_id, '2026-10', 'rejeu');
  select count(*)::text into v from portail_option_regul where reservation_id = r.id and sens = 'cloture'; msg := msg || ' | traces=' || v;
  -- B : remboursement après gel → régularisation 468 (−) dans le premier mois ouvert
  update portail_voyageur_commande set lignes = jsonb_set(lignes, '{0,rembourse_le}', to_jsonb(now()::text)), statut = 'remboursee' where id = c;
  select string_agg(sens || ' ' || montant_centimes || ' → ' || coalesce(mois_regul, 'ERR'), ' ; ') into v from portail_option_regul where reservation_id = r.id and sens <> 'cloture'; msg := msg || ' | B: ' || coalesce(v, 'rien');
  perform portail_options_controle_cloture(r.bien_id, '2026-10', 'contrôle après remboursement');
  select count(*)::text into v from portail_option_regul where reservation_id = r.id; msg := msg || ' | total traces=' || v || ' (pas de double)';
  select string_agg(code || ':' || montant_ttc, ',' order by code) into apres from ventilation where reservation_id = r.id and code <> 'PVOY';
  msg := msg || ' | HON/LOY/VIR identiques=' || (avant = apres);
  raise exception 'TEST (annulé) %', msg;
end $$;
-- Test 471 repli : mois déjà gelé côté COM au moment du contrôle → régularisation dans le premier mois ouvert (transaction annulée).
do $$
declare r record; c uuid := gen_random_uuid(); msg text := ''; v text;
begin
  select rr.id, rr.bien_id, rr.code into r from reservation rr join bien b on b.id = rr.bien_id
   where rr.mois_comptable = '2026-10' and rr.final_status = 'accepted' and rr.code <> '4XUWQQ' and coalesce(b.agence,'dcb') = 'dcb'
     and not bien_mois_fige(rr.bien_id, '2026-10') and not exists (select 1 from cloture_comptable cc where cc.mois = '2026-10') limit 1;
  insert into portail_voyageur_commande (id, reservation_id, bien_id, agence, lignes, total_centimes, statut, essai, paiement_mode, paye_le)
  values (c, r.id, r.bien_id, 'dcb', '[{"libelle":"Option voyageur : Départ jusqu''à 14 h","montant_centimes":4500,"service_cle":"depart_14h"}]', 4500, 'payee', false, 'stripe', now());
  set local session_replication_role = replica;   -- gel COM posé SANS ses triggers (simule un gel antérieur au contrôle)
  insert into cloture_comptable (mois, agence, cloture_facturat) values ('2026-10', 'dcb', now());
  set local session_replication_role = origin;
  insert into cloture_bien (agence, bien_id, mois, active) values ('dcb', r.bien_id, '2026-10', true);
  select string_agg(sens || ' ' || montant_centimes || ' → ' || coalesce(mois_regul, 'ERR ' || erreur), ' ; ') into v from portail_option_regul where reservation_id = r.id; msg := 'resa ' || r.code || ' | ' || coalesce(v, 'rien');
  select string_agg(code || ' ' || montant_ttc || ' (' || mois_comptable || ')', ' ; ') into v from ventilation where reservation_id = r.id and note like 'Contrôle à la clôture 471%'; msg := msg || ' | ventilation: ' || coalesce(v, 'rien');
  raise exception 'TEST (annulé) %', msg;
end $$;
