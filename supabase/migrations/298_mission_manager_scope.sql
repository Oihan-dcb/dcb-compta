-- 298 — mission_menage : un manager de chat scopé (secteurs non NULL) ne voit que les missions de son
-- périmètre (02/10/2026). Avant : mission_manager_select_all = tout manager de chat voit les 1 575
-- missions du parc → Léa (Bordeaux/Bassin) voyait tout le Pays Basque. my_secteurs() est NULL pour
-- staff_users et tout compte sans secteur → Oïhan/Laura/Clémence inchangés. Exige aussi actif.

drop policy if exists mission_manager_select_all on public.mission_menage;
create policy mission_manager_select_all on public.mission_menage for select to authenticated using (
  exists (select 1 from auto_entrepreneur a where a.ae_user_id = auth.uid() and a.is_chat_manager and a.actif)
  and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids()))
);
