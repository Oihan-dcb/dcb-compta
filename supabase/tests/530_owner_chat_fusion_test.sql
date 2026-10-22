-- Test de la reprise d'historique de la messagerie propriétaires (migrations 530-531), SANS RIEN LAISSER EN BASE :
-- tout se passe dans un bloc qui se termine par une exception volontaire « TEST_FUSION_OK » (annulation complète).
-- Exécution : coller dans l'éditeur SQL (ou MCP execute_sql) ; le résultat attendu est l'erreur « TEST_FUSION_OK … ».
-- Toute autre erreur = test en échec (le message dit lequel).
do $$
declare
  p uuid := gen_random_uuid(); s uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  b1 uuid := gen_random_uuid(); b2 uuid := gen_random_uuid(); bx uuid := gen_random_uuid();
  rg uuid; rb1 uuid; rb2 uuid; rs uuid; conv uuid;
  m1 uuid; m2 uuid; m3 uuid; m4 uuid; m5 uuid; mn uuid;
  v jsonb; n int; e_avant text; e_apres text;
begin
  insert into proprietaire (id, nom, prenom, agence) values (p, 'TEST-FUSION', 'Principal', 'dcb');
  insert into proprietaire (id, nom, prenom, agence, parent_proprietaire_id) values (s, 'TEST-FUSION', 'Secondaire', 'dcb', p);
  insert into proprietaire (id, nom, agence) values (x, 'TEST-AUTRE', 'dcb');
  insert into bien (id, hospitable_id, hospitable_name, code, proprietaire_id) values
    (b1, 'test-' || b1, 'Test B1', 'TST-B1', p), (b2, 'test-' || b2, 'Test B2', 'TST-B2', p), (bx, 'test-' || bx, 'Test BX', 'TST-BX', x);
  insert into owner_chat_rooms (type, proprio_id, bien_id, name) values ('support', p, null, 'Général') returning id into rg;
  insert into owner_chat_rooms (type, proprio_id, bien_id, name) values ('support', p, b1, 'TST-B1') returning id into rb1;
  insert into owner_chat_rooms (type, proprio_id, bien_id, name) values ('support', p, b2, 'TST-B2') returning id into rb2;
  insert into owner_chat_rooms (type, proprio_id, bien_id, name) values ('support', s, null, 'Général') returning id into rs;
  -- Le déclencheur redirige déjà les insertions dans un salon de bien : on insère d'abord SANS déclencheur pour simuler
  -- l'historique d'avant la 530.
  alter table owner_chat_messages disable trigger owner_chat_messages_avant_insert;
  insert into owner_chat_messages (room_id, sender_id, sender_type, sender_name, body, created_at) values (rg, gen_random_uuid(), 'proprio', 'P', 'Bonjour (général)', now() - interval '5 day') returning id into m1;
  insert into owner_chat_messages (room_id, sender_id, sender_type, sender_name, body, created_at, pinned) values (rb1, gen_random_uuid(), 'proprio', 'P', 'Fuite B1', now() - interval '4 day', true) returning id into m2;
  insert into owner_chat_messages (room_id, sender_id, sender_type, sender_name, body, created_at, reply_to_id, reply_to_body) values (rb1, gen_random_uuid(), 'staff', 'Équipe', 'On s''en occupe', now() - interval '4 day' + interval '1 hour', m2, 'Fuite B1') returning id into m3;
  insert into owner_chat_messages (room_id, sender_id, sender_type, sender_name, body, created_at, attachment_url, attachment_type, deleted_at) values (rb2, gen_random_uuid(), 'proprio', 'P', null, now() - interval '3 day', 'chat/x.jpg', 'image', now() - interval '2 day') returning id into m4;
  insert into owner_chat_messages (room_id, sender_id, sender_type, sender_name, body, created_at) values (rs, gen_random_uuid(), 'proprio', 'S', 'Message du secondaire', now() - interval '1 day') returning id into m5;
  alter table owner_chat_messages enable trigger owner_chat_messages_avant_insert;
  insert into owner_chat_message_reactions (message_id, emoji, sender_type, sender_id) values (m3, '👍', 'proprio', gen_random_uuid());

  select md5(string_agg(concat_ws('|', id, sender_type, sender_name, body, created_at, deleted_at, reply_to_id, attachment_url, pinned), '#' order by id))
    into e_avant from owner_chat_messages where id in (m1, m2, m3, m4, m5);

  v := owner_chat_fusionner();
  conv := owner_chat_conversation_de(p);
  if conv <> rg then raise exception 'ÉCHEC : la conversation doit être le salon général existant du principal'; end if;
  if owner_chat_conversation_de(s) <> rg then raise exception 'ÉCHEC : la fiche secondaire doit partager la conversation du principal'; end if;
  select count(*) into n from owner_chat_messages where id in (m1, m2, m3, m4, m5) and room_id = rg;
  if n <> 5 then raise exception 'ÉCHEC : % messages sur 5 dans la conversation', n; end if;
  if (select bien_id from owner_chat_messages where id = m2) is distinct from b1 or (select bien_id from owner_chat_messages where id = m3) is distinct from b1
     or (select bien_id from owner_chat_messages where id = m4) is distinct from b2 or (select bien_id from owner_chat_messages where id = m1) is not null
     or (select bien_id from owner_chat_messages where id = m5) is not null then raise exception 'ÉCHEC : étiquettes de bien'; end if;
  if (select origine_room_id from owner_chat_messages where id = m2) <> rb1 or (select origine_room_id from owner_chat_messages where id = m5) <> rs
     or (select origine_room_id from owner_chat_messages where id = m1) is not null then raise exception 'ÉCHEC : salon d''origine (retour arrière)'; end if;
  select md5(string_agg(concat_ws('|', id, sender_type, sender_name, body, created_at, deleted_at, reply_to_id, attachment_url, pinned), '#' order by id))
    into e_apres from owner_chat_messages where id in (m1, m2, m3, m4, m5);
  if e_avant <> e_apres then raise exception 'ÉCHEC : contenu des messages modifié'; end if;
  if (select count(*) from owner_chat_message_reactions where message_id = m3) <> 1 then raise exception 'ÉCHEC : réaction perdue'; end if;
  if (select count(*) from owner_chat_rooms where id in (rb1, rb2, rs) and archive_le is not null and fusionne_dans = rg) <> 3 then raise exception 'ÉCHEC : anciens salons non archivés'; end if;
  if (select count(*) from owner_chat_rooms where id in (rb1, rb2, rs)) <> 3 then raise exception 'ÉCHEC : un ancien salon a été supprimé'; end if;
  -- Idempotence : 2e passage = rien
  v := owner_chat_fusionner();
  if (v->>'messages_deplaces')::int <> 0 or (v->>'salons_archives')::int <> 0 then raise exception 'ÉCHEC : 2e passage non nul %', v; end if;
  -- Ancienne appli qui écrit encore dans un salon de bien → redirigé dans la conversation, étiqueté
  insert into owner_chat_messages (room_id, sender_id, sender_type, sender_name, body) values (rb2, gen_random_uuid(), 'proprio', 'P', 'Écrit dans l''ancien salon') returning id into mn;
  if (select room_id from owner_chat_messages where id = mn) <> rg or (select bien_id from owner_chat_messages where id = mn) <> b2 then raise exception 'ÉCHEC : redirection de l''ancien salon'; end if;
  -- Étiquette d'un bien d'un autre propriétaire refusée
  begin
    insert into owner_chat_messages (room_id, sender_id, sender_type, sender_name, body, bien_id) values (rg, gen_random_uuid(), 'staff', 'É', 'x', bx);
    raise exception 'ÉCHEC : étiquette d''un bien étranger acceptée';
  exception when insufficient_privilege then null;
  end;
  raise exception 'TEST_FUSION_OK (5 messages repris, contenu identique, 1 réaction, 3 salons archivés, idempotent, redirection et garde-fou OK)';
end $$;
