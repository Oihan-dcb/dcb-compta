-- 551 — Assistant mail : lien mail → demande de résa côté mail_messages.
-- Le code (api/mail-assistant.js, api/_mailAssistant.js, 65e-assistant-mail.jsx) lit et écrit
-- mail_messages.demande_id, mais la 545 n'avait créé que le lien inverse direct_demande.mail_message_id.
-- Symptôme : « column mail_messages.demande_id does not exist » à l'ouverture de 📬 Mes mails.

alter table public.mail_messages
  add column if not exists demande_id uuid references public.direct_demande(id) on delete set null;

create index if not exists mail_messages_demande_idx on public.mail_messages (demande_id) where demande_id is not null;

-- Rattrapage depuis le lien inverse déjà posé.
update public.mail_messages m
   set demande_id = d.id
  from public.direct_demande d
 where d.mail_message_id = m.id
   and m.demande_id is null;
