-- Tests du stock (transaction ANNULÉE à la fin : rien n'est écrit)
begin;
create temp table t_res (n serial, test text, ok boolean, detail text);
create or replace function pg_temp.je(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true); $$;
do $$
declare oihan text := '414218dc-b91b-454e-a0f2-9b4a3a0c5676'; laura text := '8cb18dc9-1366-47d2-b120-13b57a9630d5';
  a_drap uuid; a_pq uuid; mfc uuid; cave uuid; loge uuid; sale uuid; r uuid; v jsonb; q numeric; val numeric; c uuid; m uuid; n int; ok boolean;
begin
  select id into a_drap from stock_article where code = 'DRAP-KING';
  select id into a_pq from stock_article where code = 'PQ';
  select id into mfc from stock_depot where code = 'MFC';  select id into cave from stock_depot where code = 'CAVE-ML';
  select id into loge from stock_depot where code = 'LOGEMENTS'; select id into sale from stock_depot where code = 'SALE';
  perform pg_temp.je(oihan);
  insert into t_res (test, ok, detail) values ('niveau Oïhan = admin', stock_niveau() = 'admin', stock_niveau());

  -- 1. Inventaire initial avec 3 emplacements pour le linge
  c := stock_comptage_ouvrir('Test initial', null);
  perform stock_comptage_saisir(c, a_drap, mfc, 40);
  perform stock_comptage_saisir(c, a_drap, mfc, 2, true);          -- bouton + : 42
  perform stock_comptage_saisir(c, a_drap, mfc, -1, true);         -- bouton − : 41
  perform stock_comptage_saisir(c, a_drap, loge, 26);
  perform stock_comptage_saisir(c, a_drap, sale, 12);
  perform stock_comptage_saisir(c, a_pq, cave, 75);
  begin perform stock_comptage_saisir(c, a_pq, loge, 3); ok := false; exception when others then ok := sqlerrm = 'emplacement_reserve_au_linge'; end;
  insert into t_res (test, ok) values ('PQ refusé dans « Dans les logements » (linge seulement)', ok);
  perform pg_temp.je(laura);
  insert into t_res (test, ok, detail) values ('niveau Laura = comptage', stock_niveau() = 'comptage', stock_niveau());
  perform stock_comptage_saisir(c, a_pq, mfc, 10);                 -- Laura compte
  perform stock_comptage_statut(c, 'soumettre');
  begin perform stock_comptage_statut(c, 'valider'); ok := false; exception when others then ok := sqlerrm = 'acces_refuse'; end;
  insert into t_res (test, ok) values ('Laura ne peut pas valider un inventaire', ok);
  v := stock_comptage_detail(c);
  insert into t_res (test, ok, detail) values ('Laura ne voit pas le théorique', v->'theorique' = 'null'::jsonb or v->>'theorique' is null, left(v->>'theorique', 40));
  begin perform stock_mouvement_saisir(jsonb_build_object('article_id', a_pq, 'depot_id', mfc, 'quantite', 1, 'type', 'perte')); ok := false;
  exception when others then ok := sqlerrm = 'acces_refuse'; end;
  insert into t_res (test, ok) values ('Laura ne peut pas saisir de mouvement', ok);
  v := stock_etat();
  insert into t_res (test, ok) values ('Laura : pas de coûts dans les articles', not ((v->'articles'->0) ? 'cmp_centimes') and (v->'articles'->0->>'cout_centimes') is null);

  perform pg_temp.je(oihan);
  update stock_article set cout_defaut_centimes = 1000 where id = a_drap; -- 10 € estimé
  perform stock_comptage_statut(c, 'valider');
  select quantite into q from stock_solde where article_id = a_drap and depot_id = mfc;
  insert into t_res (test, ok, detail) values ('solde MFC drap King = 41 après inventaire initial', q = 41, q::text);
  select sum(quantite) into q from stock_solde where article_id = a_drap;
  insert into t_res (test, ok, detail) values ('parc total drap King = 41 + 26 + 12 = 79', q = 79, q::text);
  select count(*) into n from stock_mouvement where source_id = c::text and type = 'stock_initial';
  insert into t_res (test, ok, detail) values ('1er inventaire validé → mouvements stock_initial', n = 5, n::text);
  select valeur_centimes into val from stock_solde where article_id = a_drap and depot_id = mfc;
  insert into t_res (test, ok, detail) values ('valeur au coût par défaut (41 × 10 €)', val = 41000, val::text);

  -- 2. Réception chiffrée → CMP
  r := stock_reception_enregistrer(jsonb_build_object('depot_id', mfc, 'reference', 'TEST-1', 'valider', true,
         'lignes', jsonb_build_array(jsonb_build_object('article_id', a_drap, 'quantite', 21, 'cout_unitaire_centimes', 1400))));
  select cmp_centimes into val from stock_article where id = a_drap;
  -- (79 × 10 + 21 × 14) / 100 = 10,84 €
  insert into t_res (test, ok, detail) values ('CMP après réception = 1084 centimes', val = 1084, val::text);
  select quantite into q from stock_solde where article_id = a_drap and depot_id = mfc;
  insert into t_res (test, ok, detail) values ('solde MFC = 62', q = 62, q::text);

  -- 3. Sortie au CMP figé + anti-doublon
  v := stock_mouvement_saisir(jsonb_build_object('article_id', a_drap, 'depot_id', mfc, 'quantite', 2, 'type', 'perte', 'cle', 'test:perte:1'));
  v := stock_mouvement_saisir(jsonb_build_object('article_id', a_drap, 'depot_id', mfc, 'quantite', 2, 'type', 'perte', 'cle', 'test:perte:1'));
  insert into t_res (test, ok, detail) values ('même cle_source → doublon ignoré', (v->>'doublon')::boolean, v::text);
  select count(*) into n from stock_mouvement where cle_source = 'test:perte:1';
  insert into t_res (test, ok, detail) values ('une seule ligne au journal', n = 1, n::text);
  select cout_unitaire_centimes, valeur_centimes into q, val from stock_mouvement where cle_source = 'test:perte:1';
  insert into t_res (test, ok, detail) values ('sortie valorisée au CMP figé (−2 × 10,84 €)', q = 1084 and val = -2168, q || ' / ' || val);
  update stock_article set cmp_centimes = 5000 where id = a_drap; -- le CMP bouge ensuite…
  select cout_unitaire_centimes into q from stock_mouvement where cle_source = 'test:perte:1';
  insert into t_res (test, ok, detail) values ('… le coût du mouvement passé ne change pas', q = 1084, q::text);
  update stock_article set cmp_centimes = 1084 where id = a_drap;

  -- 4. Journal immuable
  begin update stock_mouvement set quantite = 99 where cle_source = 'test:perte:1'; ok := false; exception when others then ok := sqlerrm like 'journal_immuable%'; end;
  insert into t_res (test, ok) values ('UPDATE du journal refusé', ok);
  begin delete from stock_mouvement where cle_source = 'test:perte:1'; ok := false; exception when others then ok := sqlerrm like 'journal_immuable%'; end;
  insert into t_res (test, ok) values ('DELETE du journal refusé', ok);

  -- 5. Annulation = mouvement inverse, une seule fois
  select id into m from stock_mouvement where cle_source = 'test:perte:1';
  v := stock_mouvement_annuler(m, 'erreur de saisie');
  select quantite into q from stock_solde where article_id = a_drap and depot_id = mfc;
  insert into t_res (test, ok, detail) values ('annulation : solde revenu à 62', q = 62, q::text);
  begin v := stock_mouvement_annuler(m, 'encore'); ok := false; exception when others then ok := sqlerrm = 'deja_annule'; end;
  insert into t_res (test, ok) values ('2e annulation refusée', ok);

  -- 6. Transfert MFC → Au sale (même opération) puis annulation de l'opération entière
  v := stock_mouvement_saisir(jsonb_build_object('article_id', a_drap, 'depot_id', mfc, 'vers_depot_id', sale, 'quantite', 5, 'type', 'transfert'));
  select sum(quantite) into q from stock_solde where article_id = a_drap;
  insert into t_res (test, ok, detail) values ('transfert : parc total inchangé (100)', q = 100, q::text);
  select id into m from stock_mouvement where operation_id = (v->>'operation_id')::uuid limit 1;
  perform stock_mouvement_annuler(m, 'test');
  select quantite into q from stock_solde where article_id = a_drap and depot_id = sale;
  insert into t_res (test, ok, detail) values ('annulation du transfert : Au sale revenu à 12', q = 12, q::text);

  -- 7. 2e inventaire avec écarts → ecart_comptage chiffrés + pertes
  c := stock_comptage_ouvrir('Test 2', null);
  perform stock_comptage_saisir(c, a_drap, mfc, 55);    -- théorique 62 → −7
  perform stock_comptage_saisir(c, a_drap, loge, 27);   -- 26 → +1
  perform stock_comptage_saisir(c, a_drap, sale, 12);   -- 12 → 0
  perform stock_comptage_statut(c, 'valider');
  select count(*) into n from stock_mouvement where source_id = c::text and type = 'ecart_comptage';
  insert into t_res (test, ok, detail) values ('2e inventaire → 2 mouvements ecart_comptage', n = 2, n::text);
  select bilan into v from stock_comptage where id = c;
  insert into t_res (test, ok, detail) values ('bilan : perte NETTE par article = 6 (−7 au MFC et +1 dans les logements se compensent)', (v->>'pertes_unites')::numeric = 6 and (v->>'surplus_unites')::numeric = 0, v->>'pertes_unites' || '/' || (v->>'surplus_unites'));
  insert into t_res (test, ok, detail) values ('bilan : pertes chiffrées (6 × 10,84 € = 65,04 €)', (v->>'pertes_centimes')::numeric = 6504, v->>'pertes_centimes');
  select sum(quantite) into q from stock_solde where article_id = a_drap;
  insert into t_res (test, ok, detail) values ('parc total après inventaire = 94', q = 94, q::text);
  begin perform stock_mouvement_annuler((select id from stock_mouvement where source_id = c::text limit 1)); ok := false;
  exception when others then ok := sqlerrm = 'annuler_depuis_la_source'; end;
  insert into t_res (test, ok) values ('écart d''inventaire non annulable à la main', ok);

  -- 8. Contrôle des soldes
  n := stock_controle_soldes();
  insert into t_res (test, ok, detail) values ('contrôle : soldes = journal (0 écart)', n = 0, n::text);
  update stock_solde set quantite = quantite + 3 where article_id = a_drap and depot_id = mfc;
  n := stock_controle_soldes();
  select quantite into q from stock_solde where article_id = a_drap and depot_id = mfc;
  insert into t_res (test, ok, detail) values ('contrôle : écart détecté et corrigé', n = 1 and q = 55, n || ' / ' || q);

  -- 9. Compte sans droit
  perform pg_temp.je('00000000-0000-0000-0000-000000000001');
  begin perform stock_etat(); ok := false; exception when others then ok := sqlerrm = 'acces_refuse'; end;
  insert into t_res (test, ok) values ('compte sans droit refusé', ok);
end $$;
select string_agg(case when ok then '✅ ' else '❌ ' end || test || coalesce(' [' || detail || ']', ''), E'\n' order by n) as r from t_res;
rollback;
