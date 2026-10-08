-- 361 — Messagerie voyageurs PowerHouse : « en attente d'un humain » (08/10/2026, Oïhan).
-- Un fil ne doit pas sortir des Non lus / En attente parce qu'un message PROGRAMMÉ est parti
-- après la question du voyageur, ou parce que l'IA (Hospitable ou PowerHouse) a répondu sans
-- résoudre (« je reviens vers vous »). Calculé par api/guest-inbox.js (synchro) et
-- api/ga-process-message.js (envoi auto PowerHouse).
alter table public.guest_thread
  add column if not exists attend_humain boolean not null default false,
  add column if not exists attend_humain_motif text,
  add column if not exists attend_humain_msg_id text;
comment on column public.guest_thread.attend_humain is 'true = le voyageur attend encore une vraie réponse humaine (message programmé ou réponse IA non résolutive après sa question)';
comment on column public.guest_thread.attend_humain_msg_id is 'id hospitable_messages évalué (évite de re-classer la même réponse IA)';
