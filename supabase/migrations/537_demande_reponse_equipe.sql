-- 537 — Demandes en attente de réponse dans la messagerie d'équipe (22/10/2026, demande Oïhan :
-- « demande à Laura, et ajoute un moyen de détecter sa réponse »).
--
-- Une ligne = une question posée à quelqu'un dans une conversation de la messagerie d'équipe (chat_rooms /
-- chat_messages, portail AE + bulle 💬 PowerHouse). Dès que le DESTINATAIRE écrit dans cette conversation
-- après l'envoi, le déclencheur (AFTER INSERT sur chat_messages, quel que soit l'outil qui écrit : portail AE,
-- PowerHouse, SQL) :
--   1. passe la demande en « repondu » (repondu_le = 1re réponse, reponse_extrait = dernier message reçu) ;
--   2. envoie UNE notification push au demandeur (pg_net → portail AE api/push-ga, clé vault
--      SUPABASE_SERVICE_ROLE_KEY, urgent) ; plusieurs messages d'affilée = une seule réponse : nouvelle
--      notification seulement si le précédent push date de plus de 30 minutes ;
--   3. Accueil › À faire (api/_aFaire.js, bloc Répondre) affiche la ligne « objet » tant que statut = repondu ;
--      le bouton « Traité » (POST /api/dashboard?w=afaire_action, action demande_reponse_traitee) la ferme.
-- Une erreur dans le déclencheur n'empêche JAMAIS l'envoi du message (bloc exception).
-- test = true : demande d'essai (titre du push préfixé [ESSAI], jamais affichée dans À faire).
-- Accès : service role seul (API PowerHouse + déclencheur security definer).

create table if not exists public.demande_reponse (
  id                  uuid primary key default gen_random_uuid(),
  room_id             uuid not null references public.chat_rooms(id) on delete cascade,
  destinataire_id     uuid not null,          -- compte portail qui doit répondre (chat_messages.sender_id attendu)
  destinataire_nom    text,
  demandeur_id        uuid not null,          -- compte portail prévenu (push) quand la réponse arrive
  message_id          uuid references public.chat_messages(id) on delete set null, -- la question envoyée
  objet               text not null,          -- libellé de la ligne À faire
  titre_notif         text not null,          -- titre du push
  agence              text check (agence in ('dcb', 'lauian')),
  envoye_le           timestamptz not null default now(),
  statut              text not null default 'attente' check (statut in ('attente', 'repondu', 'traite', 'annule')),
  repondu_le          timestamptz,
  reponse_message_id  uuid,
  reponse_extrait     text,
  nb_reponses         integer not null default 0,
  notifie_le          timestamptz,
  nb_notifs           integer not null default 0,
  traite_le           timestamptz,
  traite_par          text,
  motif               text,
  test                boolean not null default false,
  cree_le             timestamptz not null default now()
);
create index if not exists demande_reponse_ouverte on public.demande_reponse (room_id, destinataire_id) where statut in ('attente', 'repondu');
alter table public.demande_reponse enable row level security;
-- Aucune politique : service role uniquement.
comment on table public.demande_reponse is 'Questions posées dans la messagerie d''équipe en attente de réponse : push au demandeur + ligne Accueil › À faire à la réponse (537).';

create or replace function public.demande_reponse_detecter() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare d record; v_key text; v_txt text; v_req bigint;
begin
  begin
    for d in select * from public.demande_reponse
              where room_id = new.room_id and destinataire_id = new.sender_id
                and statut in ('attente', 'repondu') and new.created_at > envoye_le
              for update
    loop
      v_txt := regexp_replace(coalesce(new.body, ''), '\s+', ' ', 'g');
      if v_txt ~ '^(PHOTOS|VFB|INV|PROC)::' then v_txt := '(message automatique)'; end if;
      v_req := null;
      if d.notifie_le is null or new.created_at - d.notifie_le > interval '30 minutes' then
        select decrypted_secret into v_key from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY';
        if v_key is not null then
          v_req := net.http_post(
            url := 'https://dcb-portail-ae.vercel.app/api/push-ga',
            body := jsonb_build_object(
              'user_ids', jsonb_build_array(d.demandeur_id),
              'title', case when d.test then '[ESSAI] ' else '' end || d.titre_notif,
              'body', left(v_txt, 140) || case when length(v_txt) > 140 then '…' else '' end,
              'url', '/', 'urgent', true, 'tag', 'demande-' || d.id,
              'room_id', d.room_id, 'sender_name', coalesce(d.destinataire_nom, '')),
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
            timeout_milliseconds := 15000);
        end if;
      end if;
      update public.demande_reponse set
        statut = 'repondu',
        repondu_le = coalesce(repondu_le, new.created_at),
        reponse_message_id = new.id,
        reponse_extrait = left(v_txt, 500),
        nb_reponses = nb_reponses + 1,
        notifie_le = case when v_req is not null then now() else notifie_le end,
        nb_notifs = nb_notifs + case when v_req is not null then 1 else 0 end
      where id = d.id;
    end loop;
  exception when others then
    raise warning '[demande_reponse_detecter] %', sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.demande_reponse_detecter() from public, anon, authenticated;

drop trigger if exists demande_reponse_detecter on public.chat_messages;
create trigger demande_reponse_detecter after insert on public.chat_messages
  for each row when (new.deleted_at is null) execute function public.demande_reponse_detecter();
