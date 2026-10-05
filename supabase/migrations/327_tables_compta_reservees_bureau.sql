-- 327 — Tables compta / bureau réservées au bureau (05/10/2026, décision Oïhan « scope Léa »).
-- auth_user_is_staff() inclut les comptes PowerHouse scopés (acces_powerhouse, ex. Léa
-- Bordeaux/Bassin) : ils lisaient banque, ventilation, séquestre, factures Evoliz, config
-- agence (IBAN), SMS, journal… de toutes les agences. Ces 68 tables ne sont lues par AUCUN
-- écran client de PowerHouse ni du portail AE (vérifié par grep : uniquement dcb-compta,
-- dont tous les utilisateurs sont bureau, et des API/edge functions en service_role).
-- → auth_user_is_staff() remplacé par auth_user_is_bureau() dans leurs politiques.
alter policy staff_all_agency_config on public.agency_config using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_airbnb_payout_line on public.airbnb_payout_line using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy bail_lien_staff_all on public.bail_lien using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy bail_signataires_staff_all on public.bail_signataires using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_booking_payout_line on public.booking_payout_line using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_chat_room_state on public.chat_room_state using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_cloture_audit on public.cloture_audit using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_cloture_comptable on public.cloture_comptable using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy contract_avenants_staff_all on public.contract_avenants using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_select_contract_templates on public.contract_templates using (auth_user_is_bureau());
alter policy staff_all_email_jobs on public.email_jobs using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_email_templates on public.email_templates using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_encaissement_allocation on public.encaissement_allocation using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_encaissement_anomalie on public.encaissement_anomalie using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_etudiant_payeur on public.etudiant_payeur using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_expense on public.expense using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy facture_evoliz_staff_all on public.facture_evoliz using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_facture_evoliz_ligne on public.facture_evoliz_ligne using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_fournisseur_recurrent on public.fournisseur_recurrent using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_select_ga_agency_config on public.ga_agency_config using (auth_user_is_bureau());
alter policy staff_select_ga_conversation on public.ga_conversation using (auth_user_is_bureau());
alter policy staff_select_ga_correction on public.ga_correction using (auth_user_is_bureau());
alter policy guest_reply_log_read_staff on public.guest_reply_log using (auth_user_is_bureau());
alter policy guest_thread_read_staff on public.guest_thread using (auth_user_is_bureau());
alter policy staff_all_ical_annotations on public.ical_annotations using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_import_log on public.import_log using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_journal_ops on public.journal_ops using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_laura_facture on public.laura_facture using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_mail_ai_analysis on public.mail_ai_analysis using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_mail_messages on public.mail_messages using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_mandat_gestion on public.mandat_gestion using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy mouvement_bancaire_staff_all on public.mouvement_bancaire using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy paiement_contrat_staff_all on public.paiement_contrat using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_payout_hospitable on public.payout_hospitable using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_payout_reservation on public.payout_reservation using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_pennylane_categorie_compte on public.pennylane_categorie_compte using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_powerhouse_imap_accounts on public.powerhouse_imap_accounts using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_processed_emails on public.processed_emails using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_property_tech on public.property_tech using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_reservation_fee on public.reservation_fee using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_reservation_paiement on public.reservation_paiement using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_reversement_fait on public.reversement_fait using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_roadmap_logs on public.roadmap_logs using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_roadmap_schedule on public.roadmap_schedule using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy sct_export_staff on public.sct_export using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_secteur_branding on public.secteur_branding using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_sequestre_affectation on public.sequestre_affectation using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_sequestre_alias on public.sequestre_alias using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_sequestre_bilan on public.sequestre_bilan using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_sequestre_cloture on public.sequestre_cloture_mensuelle using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_sequestre_compte on public.sequestre_compte using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_sequestre_ecriture on public.sequestre_ecriture using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_sequestre_exercice on public.sequestre_exercice using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_sequestre_journal on public.sequestre_journal using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_sequestre_justificatif on public.sequestre_justificatif using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_sequestre_perimetre_mensuel on public.sequestre_perimetre_mensuel using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_sequestre_rapport_item on public.sequestre_rapport_item using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_sequestre_releve_proprio on public.sequestre_releve_proprio using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_sequestre_shine_mensuel on public.sequestre_shine_mensuel using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_sms_logs on public.sms_logs using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_sms_queue on public.sms_queue using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_staff_rdv on public.staff_rdv using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_stripe_payout_line on public.stripe_payout_line using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_taux_ae_prestation on public.taux_ae_prestation using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_taxe_sejour_config on public.taxe_sejour_config using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy ventilation_staff_all on public.ventilation using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_webhook_log on public.webhook_log using (auth_user_is_bureau()) with check (auth_user_is_bureau());
alter policy staff_all_webhook_pending on public.webhook_pending using (auth_user_is_bureau()) with check (auth_user_is_bureau());
