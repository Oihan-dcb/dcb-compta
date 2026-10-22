-- 538 — demande_reponse (537) : plusieurs questions en attente dans la MÊME conversation pour le même destinataire
-- (ex. Laura : couchages Aitzina / dates Arrosa + mail lauian-immo.com, 22/10/2026) → un message de réponse marque
-- toutes les questions « repondu » mais n'envoie qu'UNE notification par demandeur (titres réunis par « + »).
-- Règle inchangée : rafale = 1 push, nouveau push seulement si le précédent date de plus de 30 minutes.
create or replace function public.demande_reponse_detecter() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare g record; v_key text; v_txt text;
begin
  begin
    v_txt := regexp_replace(coalesce(new.body, ''), '\s+', ' ', 'g');
    if v_txt ~ '^(PHOTOS|VFB|INV|PROC)::' then v_txt := '(message automatique)'; end if;
    for g in
      select demandeur_id,
             array_agg(id) ids,
             bool_or(notifie_le is null or new.created_at - notifie_le > interval '30 minutes') a_notifier,
             bool_and(test) test,
             string_agg(distinct titre_notif, ' + ') titre,
             max(destinataire_nom) nom
        from (select * from public.demande_reponse
               where room_id = new.room_id and destinataire_id = new.sender_id
                 and statut in ('attente', 'repondu') and new.created_at > envoye_le
               for update) x
       group by demandeur_id
    loop
      if g.a_notifier then
        if v_key is null then select decrypted_secret into v_key from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY'; end if;
        if v_key is not null then
          perform net.http_post(
            url := 'https://dcb-portail-ae.vercel.app/api/push-ga',
            body := jsonb_build_object(
              'user_ids', jsonb_build_array(g.demandeur_id),
              'title', left(case when g.test then '[ESSAI] ' else '' end || g.titre, 120),
              'body', left(v_txt, 140) || case when length(v_txt) > 140 then '…' else '' end,
              'url', '/', 'urgent', true, 'tag', 'demande-' || new.room_id || '-' || g.demandeur_id,
              'room_id', new.room_id, 'sender_name', coalesce(g.nom, '')),
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
            timeout_milliseconds := 15000);
        else
          g.a_notifier := false;
        end if;
      end if;
      update public.demande_reponse set
        statut = 'repondu',
        repondu_le = coalesce(repondu_le, new.created_at),
        reponse_message_id = new.id,
        reponse_extrait = left(v_txt, 500),
        nb_reponses = nb_reponses + 1,
        notifie_le = case when g.a_notifier then now() else notifie_le end,
        nb_notifs = nb_notifs + case when g.a_notifier then 1 else 0 end
      where id = any (g.ids);
    end loop;
  exception when others then
    raise warning '[demande_reponse_detecter] %', sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.demande_reponse_detecter() from public, anon, authenticated;
