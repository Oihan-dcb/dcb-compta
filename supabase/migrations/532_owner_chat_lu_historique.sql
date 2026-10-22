-- 532 : messagerie propriétaires — état « lu » de l'historique d'avant le suivi de lecture (22/10/2026).
-- Avant la 530, aucune lecture n'était enregistrée en base (le portail AE gardait un repère local par appareil) :
-- tout l'historique apparaissait « non lu » (77 non lus sur CERES). Règle factuelle, sans rien inventer :
--   un message du propriétaire SUIVI d'une réponse de l'équipe a été lu par l'équipe → lu_staff_at = date de cette réponse ;
--   un message de l'équipe SUIVI d'un message du propriétaire a été vu par lui → lu_proprio_at = date de ce message.
-- Les messages restés sans réponse restent « non lus » (ex. ELISSALT 12/10, MAITE 01/06). Idempotent (ne touche que les NULL).
update owner_chat_messages m
   set lu_staff_at = (select min(r.created_at) from owner_chat_messages r
                       where r.room_id = m.room_id and r.sender_type = 'staff' and r.deleted_at is null and r.created_at > m.created_at)
 where m.sender_type = 'proprio' and m.lu_staff_at is null and m.created_at < '2026-10-22T18:00:00Z'
   and exists (select 1 from owner_chat_messages r where r.room_id = m.room_id and r.sender_type = 'staff' and r.deleted_at is null and r.created_at > m.created_at);

update owner_chat_messages m
   set lu_proprio_at = (select min(r.created_at) from owner_chat_messages r
                         where r.room_id = m.room_id and r.sender_type = 'proprio' and r.deleted_at is null and r.created_at > m.created_at)
 where m.sender_type = 'staff' and m.lu_proprio_at is null and m.created_at < '2026-10-22T18:00:00Z'
   and exists (select 1 from owner_chat_messages r where r.room_id = m.room_id and r.sender_type = 'proprio' and r.deleted_at is null and r.created_at > m.created_at);
