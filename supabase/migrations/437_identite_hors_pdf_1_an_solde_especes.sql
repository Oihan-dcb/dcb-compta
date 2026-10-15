-- 437 — Pièces d'identité voyageurs : 1 an dans toutes les langues, PDF signés sans pièces, solde en espèces
--       (décisions d'Oïhan 15/10/2026)
--
-- 1. Modèles saisonniers actifs EN / ES (dcb, lauian) — §9.3 aligné sur le FR : « photo conservée pendant le séjour puis
--    supprimée dans un délai de 30 jours » → selfie ET pièce d'identité conservés 1 an après la fin du séjour, puis supprimés.
--    Les contrats déjà signés gardent LEUR texte (contenu_html_rendered figé) : la purge applique toujours le délai signé.
-- 2. Solde payé en espèces à l'arrivée (cb_50_cash, virement_50_cash) : le contrat ne promet plus un « prélèvement
--    automatique par carte » du solde (FR : encart carte + ligne du tableau ; EN / ES : avis « paiements prélevés
--    automatiquement » masqué, avis espèces corrigé pour le virement, date d'arrivée indiquée).
--    Rendu vérifié (scratchpad contrats/rendre_1an.js) : 6 modèles × 6 politiques × 13 paiements × options = 780 rendus,
--    hors espèces seul §9.3 EN/ES change (FR identique) ; espèces : seul le passage du solde change.
-- 3. identite_purge_candidats : reconnaît les nouveaux textes EN / ES « 1 year » / « 1 año ».
-- 4. identite_pdf_candidats(jour) : PDF signés contenant encore selfie / pièce (générés avant le 15/10/2026) dont
--    l'échéance est passée → version expurgée (dcb-contrats api/pdf-expurge.js, appelé par PowerHouse
--    api/cron-purge-identite.js). Journal : pièce 'pdf_signe', résultat 'expurge', empreintes SHA-256 d'origine / nouvelle.
-- Sauvegarde avant modification : table contract_templates_backup_437 + scratchpad contrats/sauvegarde_1an/.

create table if not exists public.contract_templates_backup_437 as
  select * from public.contract_templates where type_contrat = 'saisonnier' and is_active;
alter table public.contract_templates_backup_437 enable row level security;

do $$
declare n int; total int := 0;
begin
  update contract_templates set contenu_html = replace(contenu_html, $r$<td>Solde ({{solde_pourcentage}}%) — dû au plus tard le {{date_solde}}</td>$r$, $r$<td>Solde ({{solde_pourcentage}}%) — {{#has_solde_cash}}payable en espèces à l'arrivée, le {{date_arrivee_longue}}{{/has_solde_cash}}{{^has_solde_cash}}dû au plus tard le {{date_solde}}{{/has_solde_cash}}</td>$r$), updated_at = now()
   where type_contrat = 'saisonnier' and is_active and langue = 'fr' and strpos(contenu_html, $r$<td>Solde ({{solde_pourcentage}}%) — dû au plus tard le {{date_solde}}</td>$r$) > 0;
  get diagnostics n = row_count; total := total + n; raise notice 'fr : % modèle(s)', n;

  update contract_templates set contenu_html = replace(contenu_html, $r$💳 <strong>Modalités de règlement par carte bancaire :</strong>$r$, $r$💳 <strong>Modalités de règlement{{^is_cb_50_cash}} par carte bancaire{{/is_cb_50_cash}} :</strong>$r$), updated_at = now()
   where type_contrat = 'saisonnier' and is_active and langue = 'fr' and strpos(contenu_html, $r$💳 <strong>Modalités de règlement par carte bancaire :</strong>$r$) > 0;
  get diagnostics n = row_count; total := total + n; raise notice 'fr : % modèle(s)', n;

  update contract_templates set contenu_html = replace(contenu_html, $r${{#has_solde}}• <strong>Solde de {{solde_montant_eur}} ({{solde_pourcentage}}%)</strong> — prélevé automatiquement par carte bancaire le <strong>{{date_solde}}</strong> ({{date_solde_motif}}).{{/has_solde}}<br>$r$, $r${{#has_solde_stripe}}• <strong>Solde de {{solde_montant_eur}} ({{solde_pourcentage}}%)</strong> — prélevé automatiquement par carte bancaire le <strong>{{date_solde}}</strong> ({{date_solde_motif}}).{{/has_solde_stripe}}{{#has_solde_cash}}• <strong>Solde de {{solde_montant_eur}} ({{solde_pourcentage}}%)</strong> — payable en espèces à l'arrivée, le <strong>{{date_arrivee_longue}}</strong>, remis à l'agence ou à son représentant lors de l'entrée dans les lieux (aucun prélèvement sur la carte).{{/has_solde_cash}}<br>$r$), updated_at = now()
   where type_contrat = 'saisonnier' and is_active and langue = 'fr' and strpos(contenu_html, $r${{#has_solde}}• <strong>Solde de {{solde_montant_eur}} ({{solde_pourcentage}}%)</strong> — prélevé automatiquement par carte bancaire le <strong>{{date_solde}}</strong> ({{date_solde_motif}}).{{/has_solde}}<br>$r$) > 0;
  get diagnostics n = row_count; total := total + n; raise notice 'fr : % modèle(s)', n;

  update contract_templates set contenu_html = replace(contenu_html, $r$The identity photo is kept for the duration of the stay and deleted within 30 days.$r$, $r$The identity documents (verification photo and identity document) are kept for <strong>1 year</strong> from the end of the stay, then permanently deleted.$r$), updated_at = now()
   where type_contrat = 'saisonnier' and is_active and langue = 'en' and strpos(contenu_html, $r$The identity photo is kept for the duration of the stay and deleted within 30 days.$r$) > 0;
  get diagnostics n = row_count; total := total + n; raise notice 'en : % modèle(s)', n;

  update contract_templates set contenu_html = replace(contenu_html, $r$<td>Balance ({{solde_pourcentage}}%) — payable on arrival</td>$r$, $r$<td>Balance ({{solde_pourcentage}}%) — payable in cash on arrival, {{date_arrivee_longue}}</td>$r$), updated_at = now()
   where type_contrat = 'saisonnier' and is_active and langue = 'en' and strpos(contenu_html, $r$<td>Balance ({{solde_pourcentage}}%) — payable on arrival</td>$r$) > 0;
  get diagnostics n = row_count; total := total + n; raise notice 'en : % modèle(s)', n;

  update contract_templates set contenu_html = replace(contenu_html, $r${{#is_stripe_contract}}
  <div class="notice" style="margin-top:12px">
    ⚠️ Payments are automatically charged to the bank card registered at signing. In case of failure, the tenant will be contacted to settle the payment.
  </div>
  {{/is_stripe_contract}}$r$, $r${{#is_stripe_contract}}{{^is_cb_50_cash}}
  <div class="notice" style="margin-top:12px">
    ⚠️ Payments are automatically charged to the bank card registered at signing. In case of failure, the tenant will be contacted to settle the payment.
  </div>
  {{/is_cb_50_cash}}{{/is_stripe_contract}}$r$), updated_at = now()
   where type_contrat = 'saisonnier' and is_active and langue = 'en' and strpos(contenu_html, $r${{#is_stripe_contract}}
  <div class="notice" style="margin-top:12px">
    ⚠️ Payments are automatically charged to the bank card registered at signing. In case of failure, the tenant will be contacted to settle the payment.
  </div>
  {{/is_stripe_contract}}$r$) > 0;
  get diagnostics n = row_count; total := total + n; raise notice 'en : % modèle(s)', n;

  update contract_templates set contenu_html = replace(contenu_html, $r$⚠️ The deposit is charged to the card at signing. The balance in cash must be handed to the agency or representative upon check-in.$r$, $r$⚠️ {{#is_cb}}The deposit is charged to the card at signing.{{/is_cb}}{{#is_bank_transfer}}The deposit is paid by bank transfer at signing.{{/is_bank_transfer}} The balance of {{solde_montant_eur}} is payable in cash, handed to the agency or its representative upon check-in on {{date_arrivee_longue}}; it is not charged to the card.$r$), updated_at = now()
   where type_contrat = 'saisonnier' and is_active and langue = 'en' and strpos(contenu_html, $r$⚠️ The deposit is charged to the card at signing. The balance in cash must be handed to the agency or representative upon check-in.$r$) > 0;
  get diagnostics n = row_count; total := total + n; raise notice 'en : % modèle(s)', n;

  update contract_templates set contenu_html = replace(contenu_html, $r$La fotografía de identidad se conserva durante la duración de la estancia y se elimina en un plazo de 30 días.$r$, $r$Los documentos de identidad (fotografía de verificación y documento de identidad) se conservan durante <strong>1 año</strong> a partir del fin de la estancia y después se eliminan definitivamente.$r$), updated_at = now()
   where type_contrat = 'saisonnier' and is_active and langue = 'es' and strpos(contenu_html, $r$La fotografía de identidad se conserva durante la duración de la estancia y se elimina en un plazo de 30 días.$r$) > 0;
  get diagnostics n = row_count; total := total + n; raise notice 'es : % modèle(s)', n;

  update contract_templates set contenu_html = replace(contenu_html, $r$<td>Saldo ({{solde_pourcentage}}%) — pagado a la llegada</td>$r$, $r$<td>Saldo ({{solde_pourcentage}}%) — pagadero en efectivo a la llegada, {{date_arrivee_longue}}</td>$r$), updated_at = now()
   where type_contrat = 'saisonnier' and is_active and langue = 'es' and strpos(contenu_html, $r$<td>Saldo ({{solde_pourcentage}}%) — pagado a la llegada</td>$r$) > 0;
  get diagnostics n = row_count; total := total + n; raise notice 'es : % modèle(s)', n;

  update contract_templates set contenu_html = replace(contenu_html, $r${{#is_stripe_contract}}
  <div class="notice" style="margin-top:12px">
    ⚠️ Los cargos se realizan automáticamente en la tarjeta bancaria registrada en la firma. En caso de fallo, se contactará al arrendatario para regularizar.
  </div>
  {{/is_stripe_contract}}$r$, $r${{#is_stripe_contract}}{{^is_cb_50_cash}}
  <div class="notice" style="margin-top:12px">
    ⚠️ Los cargos se realizan automáticamente en la tarjeta bancaria registrada en la firma. En caso de fallo, se contactará al arrendatario para regularizar.
  </div>
  {{/is_cb_50_cash}}{{/is_stripe_contract}}$r$), updated_at = now()
   where type_contrat = 'saisonnier' and is_active and langue = 'es' and strpos(contenu_html, $r${{#is_stripe_contract}}
  <div class="notice" style="margin-top:12px">
    ⚠️ Los cargos se realizan automáticamente en la tarjeta bancaria registrada en la firma. En caso de fallo, se contactará al arrendatario para regularizar.
  </div>
  {{/is_stripe_contract}}$r$) > 0;
  get diagnostics n = row_count; total := total + n; raise notice 'es : % modèle(s)', n;

  update contract_templates set contenu_html = replace(contenu_html, $r$⚠️ El depósito se carga en tarjeta en la firma. El saldo en efectivo debe entregarse a la agencia o representante al entrar en el inmueble.$r$, $r$⚠️ {{#is_cb}}El depósito se carga en tarjeta en la firma.{{/is_cb}}{{#is_bank_transfer}}El depósito se paga por transferencia bancaria en la firma.{{/is_bank_transfer}} El saldo de {{solde_montant_eur}} se paga en efectivo, entregado a la agencia o a su representante al entrar en el inmueble el {{date_arrivee_longue}}; no se carga en la tarjeta.$r$), updated_at = now()
   where type_contrat = 'saisonnier' and is_active and langue = 'es' and strpos(contenu_html, $r$⚠️ El depósito se carga en tarjeta en la firma. El saldo en efectivo debe entregarse a la agencia o representante al entrar en el inmueble.$r$) > 0;
  get diagnostics n = row_count; total := total + n; raise notice 'es : % modèle(s)', n;

  if total <> 22 then raise exception '437 : % remplacement(s) au lieu de 22 (6 FR + 8 EN + 8 ES)', total; end if;
end $$;

-- ── Journal : PDF expurgés ───────────────────────────────────────────────────────────────────────────────────────────
alter table public.identite_purge_journal add column if not exists pdf_hash_origine text;
alter table public.identite_purge_journal add column if not exists pdf_hash_nouveau text;
alter table public.identite_purge_journal drop constraint if exists identite_purge_journal_piece_check;
alter table public.identite_purge_journal add constraint identite_purge_journal_piece_check check (piece in ('selfie', 'piece_identite', 'pdf_signe'));
alter table public.identite_purge_journal drop constraint if exists identite_purge_journal_resultat_check;
alter table public.identite_purge_journal add constraint identite_purge_journal_resultat_check check (resultat in ('supprime', 'fichier_absent', 'erreur', 'expurge'));
comment on column public.identite_purge_journal.pdf_hash_origine is 'SHA-256 du PDF signé d''origine (avec pièces) remplacé par la version expurgée (437).';

-- ── Promesse lue dans le texte signé : FR / EN / ES « 1 an » ─────────────────────────────────────────────────────────
create or replace function public.identite_promesse(p_html text)
returns text language sql immutable as $$
  select case
    when p_html ~ '(conservés pendant <strong>1 an</strong> à compter de la fin du séjour|kept for <strong>1 year</strong> from the end of the stay|durante <strong>1 año</strong> a partir del fin de la estancia)' then '1an'
    when p_html ~ '(supprimée dans un délai de 30 jours|deleted within 30 days|se elimina en un plazo de 30 d)' then '30j'
    else 'aucun'
  end;
$$;

create or replace function public.identite_purge_candidats(p_jour date default current_date)
returns table (dossier_id uuid, contract_id uuid, piece text, chemin text, regle text, date_fin_sejour date, echeance date)
language sql stable security definer set search_path to 'public' as $$
  with s as (
    select cs.id, cs.contract_id, cs.identity_photo_url, cs.id_document_url,
           nullif(rc.sejour_snapshot->>'date_depart', '')::date as dep,
           public.identite_promesse(rc.contenu_html_rendered) as promesse
      from contract_sign_sessions cs
      join rental_contracts rc on rc.id = cs.contract_id
     where (nullif(trim(cs.identity_photo_url), '') is not null or nullif(trim(cs.id_document_url), '') is not null)
       and rc.sejour_snapshot->>'date_depart' ~ '^\d{4}-\d{2}-\d{2}$'
  ), l as (
    select id, contract_id, 'selfie'::text as piece, trim(identity_photo_url) as chemin, dep,
           case promesse when '1an' then 'contrat_1_an' when '30j' then 'contrat_30_jours' else 'defaut_1_an' end as regle,
           case when promesse = '30j' then dep + 30 else (dep + interval '1 year')::date + 1 end as echeance
      from s where nullif(trim(identity_photo_url), '') is not null
    union all
    select id, contract_id, 'piece_identite', trim(id_document_url), dep,
           case promesse when '1an' then 'contrat_1_an' else 'defaut_1_an' end,
           (dep + interval '1 year')::date + 1
      from s where nullif(trim(id_document_url), '') is not null
  )
  select id, contract_id, piece, chemin, regle, dep, echeance
    from l
   where dep < p_jour
     and echeance <= p_jour
   order by echeance, id;
$$;

-- PDF signés à expurger au jour donné (lecture seule). Échéance = la plus proche promise pour une pièce contenue dans le
-- PDF : 30 jours après le départ si le texte signé promet 30 jours pour la photo, sinon 1 an + 1 jour.
-- Exclus : PDF générés sans pièce (événement pdf_signed_created.identite_dans_pdf = false, depuis le 15/10/2026) et PDF
-- déjà expurgés (événement pdf_expurge_identite).
create or replace function public.identite_pdf_candidats(p_jour date default current_date)
returns table (contract_id uuid, dossier_id uuid, regle text, date_fin_sejour date, echeance date)
language sql stable security definer set search_path to 'public' as $$
  with c as (
    select rc.id, nullif(rc.sejour_snapshot->>'date_depart', '')::date as dep,
           public.identite_promesse(rc.contenu_html_rendered) as promesse,
           (select cs.id from contract_sign_sessions cs where cs.contract_id = rc.id and cs.signature_canvas is not null
             order by cs.created_at desc limit 1) as sess
      from rental_contracts rc
     where rc.statut = 'signed'
       and nullif(trim(rc.pdf_signed_url), '') is not null
       and rc.sejour_snapshot->>'date_depart' ~ '^\d{4}-\d{2}-\d{2}$'
       and not exists (select 1 from contract_events e where e.contract_id = rc.id and e.event_type = 'pdf_expurge_identite')
       and not exists (select 1 from contract_events e where e.contract_id = rc.id and e.event_type = 'pdf_signed_created'
                         and e.metadata->>'identite_dans_pdf' = 'false')
       and (exists (select 1 from contract_sign_sessions cs where cs.contract_id = rc.id
                      and (cs.identity_verified or nullif(trim(cs.identity_photo_url), '') is not null or nullif(trim(cs.id_document_url), '') is not null))
            or exists (select 1 from identite_purge_journal j where j.contract_id = rc.id and j.piece in ('selfie', 'piece_identite')))
  ), l as (
    select id, sess, dep,
           case promesse when '1an' then 'contrat_1_an' when '30j' then 'contrat_30_jours' else 'defaut_1_an' end as regle,
           case when promesse = '30j' then dep + 30 else (dep + interval '1 year')::date + 1 end as echeance
      from c where sess is not null
  )
  select id, sess, regle, dep, echeance from l
   where dep < p_jour and echeance <= p_jour
   order by echeance, id;
$$;
revoke all on function public.identite_pdf_candidats(date) from public, anon, authenticated;
grant execute on function public.identite_pdf_candidats(date) to service_role;
revoke all on function public.identite_purge_candidats(date) from public, anon, authenticated;
grant execute on function public.identite_purge_candidats(date) to service_role;
comment on function public.identite_pdf_candidats(date) is 'PDF signés contenant encore selfie / pièce d''identité dont l''échéance promise est passée (437). Lecture seule.';
