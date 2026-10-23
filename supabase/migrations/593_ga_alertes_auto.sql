-- 593 : alertes automatiques de l'IA voyageurs par agence (décision d'Oïhan du 23/10/2026)
-- alertes_auto = false : une urgence détectée par l'IA n'envoie RIEN automatiquement (ni SMS, ni appel Twilio, ni push
-- « 🚨 URGENCE » / « contradiction ») ; elle apparaît seulement dans PowerHouse (Messagerie : fil « réponse humaine
-- attendue » + À faire › Répondre, ligne rouge « 🚨 Urgence signalée »). Lauïan : false. DCB : inchangé (true).
alter table public.ga_agency_config add column if not exists alertes_auto boolean not null default true;
comment on column public.ga_agency_config.alertes_auto is
  'false = aucune alerte automatique (SMS/appel/push) sur urgence IA : affichage PowerHouse seulement (593, Lauïan 23/10/2026)';
update public.ga_agency_config set alertes_auto = false where agence = 'lauian';
