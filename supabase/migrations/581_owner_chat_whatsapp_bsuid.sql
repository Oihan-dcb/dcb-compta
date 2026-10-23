-- 581 — WhatsApp propriétaires : identifiant d'utilisateur WhatsApp (BSUID, « FR.xxxx ») (23/10/2026)
-- Depuis avril 2026, Meta peut masquer le numéro d'un contact qui a choisi un nom d'utilisateur : la notification ne porte
-- alors que from_user_id (BSUID). Le journal accepte donc un message sans numéro, et un BSUID peut être mémorisé comme
-- un numéro lors d'un rattachement manuel (il désigne alors toujours le même propriétaire).
alter table public.owner_chat_whatsapp_entrant alter column tel drop not null;
alter table public.owner_chat_whatsapp_entrant add column if not exists bsuid text;
do $$ begin
  alter table public.owner_chat_whatsapp_entrant add constraint owner_chat_whatsapp_entrant_ident_check check (tel is not null or bsuid is not null);
exception when duplicate_object then null; end $$;
create index if not exists owner_chat_whatsapp_entrant_bsuid_idx on public.owner_chat_whatsapp_entrant (bsuid) where bsuid is not null;
alter table public.owner_chat_whatsapp_numero drop constraint if exists owner_chat_whatsapp_numero_tel_check;
alter table public.owner_chat_whatsapp_numero add constraint owner_chat_whatsapp_numero_tel_check
  check (tel ~ '^[1-9][0-9]{7,14}$' or tel ~ '^[A-Z]{2}\.[A-Za-z0-9._-]{4,}$');
comment on column public.owner_chat_whatsapp_numero.tel is 'Numéro E.164 sans + OU identifiant WhatsApp BSUID (« FR.… ») mémorisé au rattachement (581)';
