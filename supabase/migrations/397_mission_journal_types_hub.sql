-- 397 — mission_journal : 3 nouveaux gestes du hub (10/10/2026)
--   duree_validee  : « Valider la durée » (RPC terrain_valider_duree_bureau, 396)
--   heure_changee  : « Changer l'heure » (api/mission-hub, mission + tâche Hospitable)
--   message_staff  : « 💬 Message staff » (api/mission-hub → RPC terrain_message_staff + 1 notification)
-- + libellés lisibles dans l'Historique (mission_historique, 389/393b) : la définition en place est relue et
--   seule la ligne des libellés est complétée (pas de recopie du corps entier).
alter table public.mission_journal drop constraint if exists mission_journal_type_check;
alter table public.mission_journal add constraint mission_journal_type_check check (type = any (array[
  'verification', 'relance', 'reattribution', 'boucle_fait', 'boucle_non_faite', 'note', 'reglage', 'ecart_ignore',
  'extra_regle_hors_circuit', 'duree_validee', 'heure_changee', 'message_staff']));

do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.mission_historique'::regproc);
  n := replace(d, $a$when 'extra_regle_hors_circuit' then 'Extra réglé hors circuit' else 'Note' end$a$,
               $a$when 'extra_regle_hors_circuit' then 'Extra réglé hors circuit' when 'duree_validee' then 'Durée validée'
                     when 'heure_changee' then 'Heure changée' when 'message_staff' then 'Message du bureau' else 'Note' end$a$);
  n := replace(n, $a$when j.type in ('relance') then 'rappels' else 'bureau' end$a$,
               $a$when j.type in ('relance', 'message_staff') then 'rappels' else 'bureau' end$a$);
  if n = d then raise exception 'mission_historique : libellés introuvables, rien modifié'; end if;
  execute n;
end $$;
