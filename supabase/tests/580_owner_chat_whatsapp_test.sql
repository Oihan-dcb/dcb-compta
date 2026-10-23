-- Test sans trace de 580-581 (WhatsApp propriétaires) : tout est annulé par l'exception finale.
-- Attendu : ERROR P0001 TEST_WA_OK messages=2 room=<conversation de la fiche d'essai c135ff5c>
do $$
declare p uuid; r uuid; m uuid; e uuid; g uuid; n int;
begin
  select id into p from proprietaire where id::text like 'c135ff5c%';
  select ae_user_id into g from auto_entrepreneur where type='gerant' and actif and ae_user_id is not null limit 1;
  r := owner_chat_conversation_de(p);
  insert into owner_chat_whatsapp_entrant (wa_message_id, tel, bsuid, type, body, statut, motif, proprio_id) values ('wamid.TEST1','33600000000',null,'text','x','rattache','fiche',p) returning id into e;
  insert into owner_chat_messages (room_id, sender_type, sender_id, sender_name, body, canal, canal_ref, canal_contact, envoye_depuis, created_at)
    values (r,'proprio',p,'Test','Bonjour WA','whatsapp','wamid.TEST1','33600000000','whatsapp', now() - interval '1 hour') returning id into m;
  insert into owner_chat_messages (room_id, sender_type, sender_id, sender_name, body, canal, canal_ref, canal_contact, envoye_depuis, canal_statut)
    values (r,'staff',g,'Oïhan','echo','whatsapp','wamid.TEST2','33600000000','whatsapp_app','sent');
  update owner_chat_messages set canal_statut='read', lu_proprio_at=now() where canal='whatsapp' and canal_ref='wamid.TEST2';
  begin
    insert into owner_chat_messages (room_id, sender_type, sender_id, sender_name, body, canal, canal_ref) values (r,'proprio',p,'T','dup','whatsapp','wamid.TEST1');
    raise exception 'doublon accepté !';
  exception when unique_violation then null; end;
  insert into owner_chat_whatsapp_entrant (wa_message_id, bsuid, statut, motif) values ('wamid.TEST3','FR.abcd1234','a_rattacher','inconnu');
  insert into owner_chat_whatsapp_numero (tel, proprio_id) values ('FR.abcd1234', p), ('33600000000', p);
  select count(*) into n from owner_chat_messages where room_id=r and canal='whatsapp';
  raise exception 'TEST_WA_OK messages=% room=%', n, r;
end $$;
