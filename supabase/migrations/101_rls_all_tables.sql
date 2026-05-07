-- Migration 101 : activer RLS sur toutes les tables publiques — dcb-compta
-- À appliquer dans Supabase Dashboard → SQL Editor (sandbox ET prod)

do $$
declare t text;
begin
  foreach t in array array[
    'bien','proprietaire','reservation','auto_entrepreneur',
    'ventilation','mouvement_bancaire','mission_menage',
    'facture_ae','facture_evoliz','facture_evoliz_ligne','facture_achat',
    'encaissement_allocation','encaissement_anomalie',
    'agency_config','bien_toolbox',
    'caution_suivi','mandat_gestion','virement_proprio_suivi',
    'chat_groups','chat_group_members','chat_rooms','chat_room_members',
    'chat_room_state','chat_messages','chat_message_reads',
    'chat_message_files','chat_llm_jobs','hospitable_messages',
    'email_jobs','email_templates',
    'etudiant','etudiant_document',
    'fournisseur_recurrent',
    'lld_log','lld_mouvement_bancaire','loyer_suivi',
    'mail_ai_analysis','mail_messages',
    'powerhouse_imap_accounts','processed_emails',
    'push_subscriptions','sms_logs','sms_queue',
    'staff_heures_jour','staff_rdv',
    'taxe_sejour_config',
    'laura_facture'
  ] loop
    if exists (select 1 from pg_tables where schemaname='public' and tablename=t) then
      execute format('alter table %I enable row level security', t);
      execute format('drop policy if exists "anon_all_%s" on %I', t, t);
      execute format('create policy "anon_all_%s" on %I for all using (true) with check (true)', t, t);
    end if;
  end loop;
end $$;

-- Vérification : tables encore sans RLS
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
