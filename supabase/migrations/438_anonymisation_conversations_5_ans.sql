-- 438 — Anonymisation automatique des conversations voyageurs 5 ans après la fin du séjour (décision d'Oïhan 16/10/2026)
--
-- Remplace l'ancien mécanisme « anonymize_after_months » (migration 196 de dcb-planning) : réglage par agence à 12 mois,
-- appliqué chaque nuit par PowerHouse /api/ga-anonymize, qui ne couvrait que hospitable_messages / chat_llm_jobs /
-- ga_correction / ga_conversation et ne retirait que prénom + e-mail + téléphone (1 conversation anonymisée le 08/10/2026).
-- Le réglage est SUPPRIMÉ : la durée est une promesse de la politique de confidentialité (5 ans à compter de la fin du
-- séjour), pas un paramètre ; elle est fixée ici, à un seul endroit (anon_delai_conversations()).
--
-- Principe : on GARDE le texte et les métadonnées non personnelles (bien, canal, langue, sujet, montants, statut) pour les
-- statistiques et l'IA, on REMPLACE les données personnelles par des marqueurs neutres :
--   [nom] [email] [tel] [adresse] [iban] [carte] [code] [lieu] [photo] [ip] [date]
-- (dans les colonnes dédiées ET dans le texte libre : regex e-mail / téléphone FR + international / IBAN / carte (Luhn) /
--  codes d'accès et mots de passe / adresses postales ; noms et prénoms connus du voyageur remplacés dans le texte).
-- Les dates de séjour (arrivée / départ) sont arrondies au 1er du mois. Les horodatages des messages sont conservés
-- (ordre de la conversation, délais de réponse) : seuls, ils ne désignent personne.
--
-- Unité = une conversation (Hospitable conversation_id, ou la réservation / demande quand il n'y en a pas).
-- Échéance = (fin du séjour, ou date du dernier message si elle est postérieure ou s'il n'y a pas de séjour) + 5 ans.
--
-- NON TOUCHÉ (obligation comptable 10 ans, art. L123-22 C. com.) : reservation (dont guest_name / guest_email /
-- guest_phone / hospitable_raw, lignes rattachées à la ventilation et aux factures), ventilation, factures, journal_ops,
-- mouvements bancaires. devis_option mélange les deux : on garde montants, lignes, statut, identifiant de paiement Stripe
-- (justificatif de paiement) et on anonymise l'identité du voyageur (+ client / moyen de paiement Stripe, non comptables).
-- Contrats signés et pièces d'identité : traitements séparés (434 / 437). Avis (reservation_review) : hors périmètre,
-- décision à prendre. Invitations à laisser un avis (sms_queue / sms_logs) : 3 ans, durée « Avis et relation client »
-- de la politique.
--
-- Exécution : PowerHouse /api/ga-anonymize (cron Vercel 03h00 UTC) → anon_conversations_executer(jour, dry, limite).
-- Simulation : dry = true (rien n'est modifié, comptes seulement). Journal non personnel : anonymisation_journal.

-- ───────────────────────────── 0. Réglage supprimé, ancien mécanisme retiré ─────────────────────────────
drop function if exists public.ga_scrub(text, text);
alter table public.ga_agency_config drop column if exists anonymize_after_months;

create or replace function public.anon_delai_conversations() returns interval language sql immutable as $$ select interval '5 years' $$;
create or replace function public.anon_delai_avis() returns interval language sql immutable as $$ select interval '3 years' $$;

-- ───────────────────────────── 1. Indicateurs « anonymisé le » ─────────────────────────────
alter table public.hospitable_messages      add column if not exists anonymise_le timestamptz;
alter table public.guest_thread             add column if not exists anonymise_le timestamptz;
alter table public.guest_thread_note        add column if not exists anonymise_le timestamptz;
alter table public.guest_thread_action      add column if not exists anonymise_le timestamptz;
alter table public.guest_reply_log          add column if not exists anonymise_le timestamptz;
alter table public.guest_inquiry            add column if not exists anonymise_le timestamptz;
alter table public.guest_scheduled_cache    add column if not exists anonymise_le timestamptz;
alter table public.guest_campaign_recipient add column if not exists anonymise_le timestamptz;
alter table public.ga_replay_result         add column if not exists anonymise_le timestamptz;
alter table public.ga_fact_claim            add column if not exists anonymise_le timestamptz;
alter table public.devis_option             add column if not exists anonymise_le timestamptz;
alter table public.direct_demande           add column if not exists anonymise_le timestamptz;
alter table public.sejour_note              add column if not exists anonymise_le timestamptz;
alter table public.signalements             add column if not exists anonymise_le timestamptz;
alter table public.email_jobs               add column if not exists anonymise_le timestamptz;
alter table public.mail_messages            add column if not exists anonymise_le timestamptz;
alter table public.mail_ai_analysis         add column if not exists anonymise_le timestamptz;
alter table public.webhook_log              add column if not exists anonymise_le timestamptz;
alter table public.sms_queue                add column if not exists anonymise_le timestamptz;
alter table public.sms_logs                 add column if not exists anonymise_le timestamptz;
-- ga_conversation, chat_llm_jobs, ga_correction : colonne anonymized_at existante (193).

-- ───────────────────────────── 2. Journal non personnel ─────────────────────────────
create table if not exists public.anonymisation_journal (
  id          bigserial primary key,
  run_at      timestamptz not null default now(),
  jour        date not null,
  simulation  boolean not null,
  regle       text not null,            -- 'conversation_5_ans' | 'devis_5_ans' | ... | 'avis_sms_3_ans'
  table_name  text not null,
  nb_lignes   integer not null,
  nb_unites   integer                   -- conversations / dossiers traités (pas d'identifiant)
);
create index if not exists anonymisation_journal_run_idx on public.anonymisation_journal (run_at desc);
alter table public.anonymisation_journal enable row level security;
drop policy if exists anonymisation_journal_staff_lecture on public.anonymisation_journal;
create policy anonymisation_journal_staff_lecture on public.anonymisation_journal
  for select to authenticated using (exists (select 1 from public.staff_users s where s.auth_user_id = auth.uid()));
comment on table public.anonymisation_journal is 'Comptes (sans aucune donnée personnelle) des anonymisations de conversations voyageurs (438). Écrit par anon_conversations_executer().';

-- ───────────────────────────── 3. Fonctions d'anonymisation (pures) ─────────────────────────────
create or replace function public.anon_luhn(p_chiffres text) returns boolean language plpgsql immutable as $$
declare s int := 0; d int; i int; n int := length(p_chiffres); alt boolean := false;
begin
  if p_chiffres !~ '^[0-9]{13,19}$' then return false; end if;
  for i in reverse n..1 loop
    d := substr(p_chiffres, i, 1)::int;
    if alt then d := d * 2; if d > 9 then d := d - 9; end if; end if;
    s := s + d; alt := not alt;
  end loop;
  return s % 10 = 0;
end $$;

-- Noms connus → liste de motifs (nom complet, mots, parties de noms composés), du plus long au plus court.
create or replace function public.anon_noms(p_noms text[]) returns text[] language sql immutable as $$
  select coalesce(array_agg(n order by length(n) desc, n), '{}'::text[])
    from (
      select distinct trim(n) as n
        from (
          select x as n from unnest(coalesce(p_noms, '{}'::text[])) x
          union all select t from unnest(coalesce(p_noms, '{}'::text[])) x, regexp_split_to_table(x, '[[:space:],/()&+]+') t
          union all select t from unnest(coalesce(p_noms, '{}'::text[])) x, regexp_split_to_table(x, '[[:space:],/()&+.-]+') t
        ) a
       where n is not null
    ) b
   where length(n) >= 3
     and n !~ '[0-9@\[\]]'
     and lower(n) not in ('les','des','del','della','van','von','der','den','dos','das','the','and','et','mme','mlle','mr','mrs','ms',
                          'monsieur','madame','mademoiselle','famille','family','familia','guest','voyageur','airbnb','booking',
                          'nom','email','tel','code','adresse','iban','carte','lieu','photo','anonymisé','anonymise','prénom','prenom')
$$;

-- Texte libre : remplace les données personnelles par des marqueurs ; garde le reste.
create or replace function public.anon_texte(p_texte text, p_noms text[] default '{}') returns text
language plpgsql stable set search_path = public, extensions as $$
declare
  r text := p_texte; m text[]; n text; v text; pat text;
  rues constant text := '(?:[Rr]ue|[Aa]venue|[Aa]v\.|[Bb]oulevard|[Bb]d|[Cc]hemin|[Aa]ll[ée]e|[Ii]mpasse|[Pp]lace|[Rr]oute|[Qq]uai|[Cc]ours|[Ss]quare|[Ll]otissement|[Rr][ée]sidence|[Cc]it[ée]|[Ss]treet|[Rr]oad|[Ll]ane|[Dd]rive|[Aa]venida|[Cc]alle|[Cc]arrer|[Rr]ua|[Ss]tra(?:ss|ß)e)';
begin
  if r is null or r = '' then return r; end if;
  -- e-mails
  r := regexp_replace(r, '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}', '[email]', 'g');
  -- IBAN (majuscules, groupes de 4)
  r := regexp_replace(r, '\m[A-Z]{2}[0-9]{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\M', '[iban]', 'g');
  -- cartes bancaires (13-19 chiffres, contrôle de Luhn)
  for m in select regexp_matches(r, '(\m[0-9]{4}(?:[ -]?[0-9]{4}){2}[ -]?[0-9]{1,7}\M)', 'g') loop
    if anon_luhn(regexp_replace(m[1], '[^0-9]', '', 'g')) then r := replace(r, m[1], '[carte]'); end if;
  end loop;
  -- téléphones France (+33 / 0033 / 0X)
  r := regexp_replace(r, '(?:\+|\m00)33[ .-]?(?:\(0\)[ .-]?)?[1-9](?:[ .-]?[0-9]{2}){4}', '[tel]', 'g');
  r := regexp_replace(r, '\m0[1-9](?:[ .-]?[0-9]{2}){4}\M', '[tel]', 'g');
  -- téléphones internationaux (+XX … / 00XX …), au moins 8 chiffres
  for m in select regexp_matches(r, '((?:\+|\m00)[1-9][0-9]{0,3}(?:[ .-]?\(?[0-9]{1,5}\)?){2,6})', 'g') loop
    if length(regexp_replace(m[1], '[^0-9]', '', 'g')) >= 8 then r := replace(r, m[1], '[tel]'); end if;
  end loop;
  -- formats nationaux courants sans indicatif : 415 555 0132 / (415) 555-0132 ; mobiles ES 612 345 678
  r := regexp_replace(r, '\(?\m[0-9]{3}\)?[ .-][0-9]{3}[ .-][0-9]{4}\M', '[tel]', 'g');
  r := regexp_replace(r, '\m[6-9][0-9]{2}[ .][0-9]{3}[ .][0-9]{3}\M', '[tel]', 'g');
  -- codes d'accès (libellé conservé, valeur remplacée)
  r := regexp_replace(r,
    '(\m(?:codes?|digicode|interphone|cadenas|keybox|lockbox|key ?safe|pin|c[oó]digo|clave|combinaison|combination|bo[iî]te (?:à|a|aux) cl[ée]s?)\M)((?:[^0-9\n]{0,24}[^0-9A-Za-z\n])?)([0-9][0-9#* ]{1,10}[0-9#*]|[0-9#*][0-9A-Za-z#*]{2,11}|[A-Za-z]{1,3}[0-9][0-9A-Za-z#*]{1,10})',
    '\1\2[code]', 'gi');
  r := regexp_replace(r,
    '(\m(?:mot de passe|mdp|password|passwd|pwd|contrase[nñ]a|cl[ée] wi-?fi|wi-?fi key)\M)((?: (?:du|de|of the|for the|del))?(?: wi-?fi)?[[:space:]]*(?::|=|-|est|is|es)?[[:space:]]*)([^[:space:],;]{4,40})',
    '\1\2[code]', 'gi');
  -- adresses postales : « 12 bis rue des Lilas », « 64200 Biarritz »
  r := regexp_replace(r,
    '\m[0-9]{1,4}(?: ?(?:bis|ter|[A-Da-d]))?,? +' || rues || '\M(?: +(?:de|du|des|la|le|les|of|the|del|[dDlL]''[^ ,;.!?\n]+|[A-ZÀ-Ý0-9][^ ,;.!?\n]*)){1,6}',
    '[adresse]', 'g');
  -- ordre anglais « 221 Baker Street », allemand « Hauptstraße 12 », espagnol « Calle Mayor 12 »
  r := regexp_replace(r, '\m[0-9]{1,5} +(?:[A-Z][a-z]+ +){1,3}(?:Street|St\.?|Road|Rd\.?|Avenue|Ave\.?|Lane|Drive|Dr\.?|Boulevard|Blvd\.?|Way|Court|Place|Terrace|Close|Crescent)\M', '[adresse]', 'g');
  r := regexp_replace(r, '\m[A-ZÄÖÜ][a-zäöüß]+(?:straße|strasse|weg|gasse|platz|allee) +[0-9]{1,4}[a-z]?\M', '[adresse]', 'g');
  r := regexp_replace(r, '\m(?:[Cc]alle|[Aa]venida|[Cc]arrer|[Rr]ua|[Pp]aseo|[Pp]laza) +(?:(?:de|del|la|los|las) +)*[A-ZÁÉÍÓÚÑ][^ ,;.!?\n]*(?: +[A-ZÁÉÍÓÚÑ][^ ,;.!?\n]*){0,3},? *(?:n[º°o]\.? *)?[0-9]{1,4}\M', '[adresse]', 'g');
  r := regexp_replace(r, '\m(?:F-)?[0-9]{5} +[A-ZÀ-Ý][A-Za-zÀ-ÿ''-]+(?: +[A-ZÀ-Ý][A-Za-zÀ-ÿ''-]+){0,3}', '[adresse]', 'g');
  -- noms et prénoms connus du voyageur (avec et sans accents)
  foreach n in array anon_noms(p_noms) loop
    foreach v in array array[n, unaccent(n)] loop
      pat := '\m' || regexp_replace(v, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '\M';
      r := regexp_replace(r, pat, '[nom]', 'gi');
    end loop;
  end loop;
  return r;
end $$;

-- JSON : clés personnelles → marqueur ; toutes les chaînes passent par anon_texte.
create or replace function public.anon_jsonb(p_json jsonb, p_noms text[] default '{}') returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare res jsonb; k text; v jsonb; mk text;
begin
  if p_json is null then return null; end if;
  case jsonb_typeof(p_json)
    when 'object' then
      res := '{}'::jsonb;
      for k, v in select * from jsonb_each(p_json) loop
        mk := case
          when v = 'null'::jsonb then null
          when k ~* '^(e_?mail|emails|email_address|guest_email)$' then '[email]'
          when k ~* '^(phone|phones|phone_numbers?|telephone|tel|mobile|guest_phone)$' then '[tel]'
          when k ~* '^(first_?name|last_?name|full_?name|guest_?name|display_?name|surname|given_?name|family_?name|nom|prenom|prénom)$' then '[nom]'
          when k ~* '^(address|address_?line[0-9]?|street|postal_?code|zip(_?code)?|adresse)$' then '[adresse]'
          when k ~* '^(location|city|hometown|ville)$' then '[lieu]'
          when k ~* '^(picture|picture_url|photo|photo_url|avatar|avatar_url|profile_?picture|thumbnail|guest_photo)$' then '[photo]'
          when k ~* '^(iban|bic|card_?number|account_?number)$' then '[iban]'
          when k ~* '^(ip|ip_address|ip_adresse|ip_hash)$' then '[ip]'
          when k ~* '^(birth_?date|date_of_birth|birthday|date_naissance)$' then '[date]'
        end;
        res := res || jsonb_build_object(k, case when mk is not null then to_jsonb(mk) else anon_jsonb(v, p_noms) end);
      end loop;
      return res;
    when 'array' then
      select coalesce(jsonb_agg(anon_jsonb(e, p_noms) order by i), '[]'::jsonb) into res
        from jsonb_array_elements(p_json) with ordinality as a(e, i);
      return res;
    when 'string' then
      return to_jsonb(anon_texte(p_json #>> '{}', p_noms));
    else
      return p_json;
  end case;
end $$;

-- Arrondi d'une date au 1er du mois.
create or replace function public.anon_mois(d date) returns date language sql immutable as $$ select date_trunc('month', d)::date $$;

-- ───────────────────────────── 4. Conversations échues ─────────────────────────────
-- Une ligne par conversation dont l'échéance (fin + 5 ans) est atteinte au jour p_jour. Lecture seule.
create or replace function public.anon_conversations_candidats(p_jour date default current_date, p_limite int default 100)
returns table (cle text, conversation_id text, reservation_ids text[], fin date, echeance date)
language sql stable security definer set search_path = public as $$
  with carte as (
    select distinct reservation_id as res, conversation_id as conv from hospitable_messages
     where reservation_id is not null and conversation_id is not null
    union
    select distinct hospitable_reservation_id, conversation_id from guest_thread
     where hospitable_reservation_id is not null and conversation_id is not null
  ), src as (
    select conversation_id as conv, reservation_id as res, created_at as ts from hospitable_messages where anonymise_le is null
    union all select conversation_id, hospitable_reservation_id, last_message_at from guest_thread where anonymise_le is null
    union all select hospitable_conversation_id, reservation_id, last_guest_message_at from ga_conversation where anonymized_at is null
    union all select id, null, inquiry_date from guest_inquiry where anonymise_le is null
    union all select conversation_id, hospitable_reservation_id, sent_at from guest_reply_log where anonymise_le is null
    union all select conversation_id, hospitable_reservation_id, created_at from guest_thread_note where anonymise_le is null
    union all select conversation_id, hospitable_reservation_id, created_at from guest_thread_action where anonymise_le is null
    union all select null, hospitable_reservation_id, null::timestamptz from guest_scheduled_cache where anonymise_le is null   -- date de mise en cache ≠ date de message
    union all select null, hospitable_id, coalesce(sent_at, created_at) from guest_campaign_recipient where anonymise_le is null
  ), res_conv as (
    select coalesce(nullif(s.conv, ''), (select c.conv from carte c where c.res = s.res limit 1)) as conv, nullif(s.res, '') as res, s.ts
      from src s
  ), u as (
    select coalesce(conv, 'res:' || res) as cle, max(conv) as conv,
           array_remove(array_agg(distinct res), null) as res_ids, max(ts)::date as dernier
      from res_conv where coalesce(conv, res) is not null
     group by 1
  ), u2 as (
    select u.cle, u.conv,
           array(select distinct x from unnest(u.res_ids || coalesce((select array_agg(c.res) from carte c where c.conv = u.conv), '{}')) x) as res_ids,
           u.dernier
      from u
  ), f as (
    select u2.*,
           greatest(u2.dernier,
                    (select max(r.departure_date) from reservation r where r.hospitable_id = any(u2.res_ids)),
                    (select max(g.departure_date) from ga_conversation g where g.reservation_id = any(u2.res_ids)),
                    (select max(i.departure_date) from guest_inquiry i where i.id = u2.conv)) as fin
      from u2
  )
  select cle, conv, res_ids, fin, (fin + anon_delai_conversations())::date + 1 as echeance
    from f
   where fin is not null and (fin + anon_delai_conversations())::date + 1 <= p_jour
   order by fin, cle
   limit p_limite;
$$;

-- Noms connus du voyageur pour une conversation (réservation, IA, demande, devis, invitations).
create or replace function public.anon_noms_conversation(p_conv text, p_res text[]) returns text[]
language sql stable security definer set search_path = public as $$
  select array_remove(array_agg(distinct n), null) from (
    select guest_name n from reservation where hospitable_id = any(p_res)
    union all select guest_email from reservation where hospitable_id = any(p_res)
    union all select guest_name from ga_conversation where reservation_id = any(p_res) or (p_conv is not null and hospitable_conversation_id = p_conv)
    union all select hospitable_guest_name from chat_llm_jobs where hospitable_reservation_id = any(p_res)
    union all select guest_name from guest_inquiry where id = p_conv
    union all select voyageur_prenom from devis_option where reservation_hospitable_id = any(p_res)
    union all select voyageur_nom from devis_option where reservation_hospitable_id = any(p_res)
    union all select guest_name from sms_queue where hospitable_reservation_id = any(p_res)
    union all select guest_name from guest_campaign_recipient where hospitable_id = any(p_res)
  ) s where n is not null and n !~ '@' and n !~ '^\[';
$$;

-- E-mail lié à un voyageur ? (plateformes de réservation / Hospitable, ou adresse d'un voyageur connu)
create or replace function public.anon_mail_voyageur(p_from text, p_to jsonb, p_cc jsonb) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(p_from, '') ~* '@([a-z0-9-]+\.)*(airbnb\.[a-z.]+|booking\.com|hospitable\.com|vrbo\.com|abritel\.fr|homeaway\.[a-z.]+|expediapartnercentral\.com)$'
      or coalesce(p_to::text, '') || coalesce(p_cc::text, '') ~* '@([a-z0-9-]+\.)*(airbnb\.[a-z.]+|booking\.com|hospitable\.com|vrbo\.com|abritel\.fr|homeaway\.[a-z.]+)'
      or exists (select 1 from reservation r where r.guest_email is not null and r.guest_email <> ''
                   and (lower(r.guest_email) = lower(p_from) or position(lower(r.guest_email) in lower(coalesce(p_to::text, '') || coalesce(p_cc::text, ''))) > 0))
      or exists (select 1 from devis_option d where d.voyageur_email is not null and lower(d.voyageur_email) = lower(p_from))
      or exists (select 1 from direct_demande d where d.voyageur_email is not null and lower(d.voyageur_email) = lower(p_from));
$$;

-- ───────────────────────────── 5. Exécution (ou simulation) ─────────────────────────────
create or replace function public.anon_conversations_executer(p_jour date default current_date, p_dry boolean default true, p_limite int default 100)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  c record; noms text[]; ga_ids uuid[]; job_ids uuid[]; nb int; units int := 0;
  cpt jsonb := '{}'::jsonb; now_ts timestamptz := now();
  d5 interval := anon_delai_conversations(); d3 interval := anon_delai_avis();
  autres jsonb := '{}'::jsonb;
begin
  if not p_dry and p_jour > current_date then
    raise exception 'anonymisation réelle impossible pour une date future (%), simulation seulement', p_jour;
  end if;
  -- Neutralise le recalcul des fils (trg_guest_thread_a_recalculer) pendant l'anonymisation.
  perform set_config('dcb.anonymisation', '1', true);

  -- ── 5.1 Conversations ──
  for c in select * from anon_conversations_candidats(p_jour, p_limite) loop
    units := units + 1;
    noms := anon_noms_conversation(c.conversation_id, c.reservation_ids);
    select array_agg(id) into ga_ids from ga_conversation
     where anonymized_at is null and (reservation_id = any(c.reservation_ids) or (c.conversation_id is not null and hospitable_conversation_id = c.conversation_id));
    select array_agg(id) into job_ids from chat_llm_jobs
     where conversation_id = any(coalesce(ga_ids, '{}')) or hospitable_reservation_id = any(c.reservation_ids);

    if p_dry then
      select count(*) into nb from hospitable_messages where anonymise_le is null and (conversation_id = c.conversation_id or reservation_id = any(c.reservation_ids));
      cpt := jsonb_set(cpt, '{hospitable_messages}', to_jsonb(coalesce((cpt->>'hospitable_messages')::int, 0) + nb));
      select count(*) into nb from guest_thread where anonymise_le is null and (conversation_id = c.conversation_id or hospitable_reservation_id = any(c.reservation_ids));
      cpt := jsonb_set(cpt, '{guest_thread}', to_jsonb(coalesce((cpt->>'guest_thread')::int, 0) + nb));
      select count(*) into nb from chat_llm_jobs where id = any(coalesce(job_ids, '{}')) and anonymized_at is null;
      cpt := jsonb_set(cpt, '{chat_llm_jobs}', to_jsonb(coalesce((cpt->>'chat_llm_jobs')::int, 0) + nb));
      cpt := jsonb_set(cpt, '{ga_conversation}', to_jsonb(coalesce((cpt->>'ga_conversation')::int, 0) + coalesce(array_length(ga_ids, 1), 0)));
      continue;
    end if;

    update hospitable_messages set body = anon_texte(body, noms), raw = anon_jsonb(raw, noms), anonymise_le = now_ts
     where anonymise_le is null and (conversation_id = c.conversation_id or reservation_id = any(c.reservation_ids));
    get diagnostics nb = row_count; cpt := jsonb_set(cpt, '{hospitable_messages}', to_jsonb(coalesce((cpt->>'hospitable_messages')::int, 0) + nb));

    update guest_thread set last_message_preview = anon_texte(last_message_preview, noms), attend_humain_motif = anon_texte(attend_humain_motif, noms),
           guest_photo = null, anonymise_le = now_ts
     where anonymise_le is null and (conversation_id = c.conversation_id or hospitable_reservation_id = any(c.reservation_ids));
    get diagnostics nb = row_count; cpt := jsonb_set(cpt, '{guest_thread}', to_jsonb(coalesce((cpt->>'guest_thread')::int, 0) + nb));

    update guest_thread_note set body = anon_texte(body, noms), anonymise_le = now_ts
     where anonymise_le is null and (conversation_id = c.conversation_id or hospitable_reservation_id = any(c.reservation_ids));
    get diagnostics nb = row_count; cpt := jsonb_set(cpt, '{guest_thread_note}', to_jsonb(coalesce((cpt->>'guest_thread_note')::int, 0) + nb));

    update guest_thread_action set citation = anon_texte(citation, noms), titre = anon_texte(titre, noms), anonymise_le = now_ts
     where anonymise_le is null and (conversation_id = c.conversation_id or hospitable_reservation_id = any(c.reservation_ids));
    get diagnostics nb = row_count; cpt := jsonb_set(cpt, '{guest_thread_action}', to_jsonb(coalesce((cpt->>'guest_thread_action')::int, 0) + nb));

    update guest_reply_log set body = anon_texte(body, noms), anonymise_le = now_ts
     where anonymise_le is null and (conversation_id = c.conversation_id or hospitable_reservation_id = any(c.reservation_ids));
    get diagnostics nb = row_count; cpt := jsonb_set(cpt, '{guest_reply_log}', to_jsonb(coalesce((cpt->>'guest_reply_log')::int, 0) + nb));

    update guest_inquiry set guest_name = '[nom]', arrival_date = anon_mois(arrival_date), departure_date = anon_mois(departure_date), anonymise_le = now_ts
     where anonymise_le is null and id = c.conversation_id;
    get diagnostics nb = row_count; cpt := jsonb_set(cpt, '{guest_inquiry}', to_jsonb(coalesce((cpt->>'guest_inquiry')::int, 0) + nb));

    update guest_scheduled_cache set data = anon_jsonb(data, noms), anonymise_le = now_ts
     where anonymise_le is null and hospitable_reservation_id = any(c.reservation_ids);
    get diagnostics nb = row_count; cpt := jsonb_set(cpt, '{guest_scheduled_cache}', to_jsonb(coalesce((cpt->>'guest_scheduled_cache')::int, 0) + nb));

    update guest_campaign_recipient set guest_name = '[nom]', message_rendu = anon_texte(message_rendu, noms), error = anon_texte(error, noms), anonymise_le = now_ts
     where anonymise_le is null and hospitable_id = any(c.reservation_ids);
    get diagnostics nb = row_count; cpt := jsonb_set(cpt, '{guest_campaign_recipient}', to_jsonb(coalesce((cpt->>'guest_campaign_recipient')::int, 0) + nb));

    update chat_llm_jobs set hospitable_guest_name = '[nom]', hospitable_message_body = anon_texte(hospitable_message_body, noms),
           final_reply = anon_texte(final_reply, noms), summary = anon_texte(summary, noms), rejection_reason = anon_texte(rejection_reason, noms),
           llm_response = anon_jsonb(llm_response, noms), proposed_action_data = anon_jsonb(proposed_action_data, noms), anonymized_at = now_ts
     where id = any(coalesce(job_ids, '{}')) and anonymized_at is null;
    get diagnostics nb = row_count; cpt := jsonb_set(cpt, '{chat_llm_jobs}', to_jsonb(coalesce((cpt->>'chat_llm_jobs')::int, 0) + nb));

    update ga_correction set ai_reply = anon_texte(ai_reply, noms), final_reply = anon_texte(final_reply, noms), diff = anon_texte(diff, noms),
           reason = anon_texte(reason, noms), guest_message = anon_texte(guest_message, noms), anonymized_at = now_ts
     where anonymized_at is null and (conversation_id = any(coalesce(ga_ids, '{}')) or job_id = any(coalesce(job_ids, '{}')));
    get diagnostics nb = row_count; cpt := jsonb_set(cpt, '{ga_correction}', to_jsonb(coalesce((cpt->>'ga_correction')::int, 0) + nb));

    update ga_replay_result set guest_message = anon_texte(guest_message, noms), real_reply = anon_texte(real_reply, noms),
           generated = anon_texte(generated, noms), system_text = anon_texte(system_text, noms), judge = anon_jsonb(judge, noms), anonymise_le = now_ts
     where anonymise_le is null and job_id = any(coalesce(job_ids, '{}'));
    get diagnostics nb = row_count; cpt := jsonb_set(cpt, '{ga_replay_result}', to_jsonb(coalesce((cpt->>'ga_replay_result')::int, 0) + nb));

    update ga_fact_claim set claim = anon_texte(claim, noms), anonymise_le = now_ts
     where anonymise_le is null and job_id = any(coalesce(job_ids, '{}'));
    get diagnostics nb = row_count; cpt := jsonb_set(cpt, '{ga_fact_claim}', to_jsonb(coalesce((cpt->>'ga_fact_claim')::int, 0) + nb));

    update ga_conversation set guest_name = '[nom]', arrival_date = anon_mois(arrival_date), departure_date = anon_mois(departure_date),
           anonymized_at = now_ts, updated_at = now_ts
     where id = any(coalesce(ga_ids, '{}'));
    get diagnostics nb = row_count; cpt := jsonb_set(cpt, '{ga_conversation}', to_jsonb(coalesce((cpt->>'ga_conversation')::int, 0) + nb));
  end loop;

  if units > 0 and p_jour <= current_date then   -- projections (jour futur) non journalisées
    insert into anonymisation_journal (jour, simulation, regle, table_name, nb_lignes, nb_unites)
    select p_jour, p_dry, 'conversation_5_ans', k, v::int, units from jsonb_each_text(cpt) as e(k, v) where v::int > 0;
    if not exists (select 1 from jsonb_each_text(cpt) e(k, v) where v::int > 0) then
      insert into anonymisation_journal (jour, simulation, regle, table_name, nb_lignes, nb_unites) values (p_jour, p_dry, 'conversation_5_ans', '-', 0, units);
    end if;
  end if;
  cpt := jsonb_build_object('conversations', units, 'lignes', cpt);

  -- ── 5.2 Dossiers hors conversation (une règle par table, par lots de p_limite) ──
  -- Devis / options (vente directe) : identité du voyageur ; montants, lignes, statut, identifiant de paiement Stripe gardés.
  select count(*) into nb from (select 1 from devis_option where anonymise_le is null
     and (greatest(depart, created_at::date, updated_at::date) + d5)::date + 1 <= p_jour limit p_limite) s;
  if not p_dry and nb > 0 then
    update devis_option d set
      voyageur_prenom = case when voyageur_prenom is null then null else '[nom]' end,
      voyageur_nom = case when voyageur_nom is null then null else '[nom]' end,
      voyageur_email = case when voyageur_email is null then null else '[email]' end,
      voyageur_telephone = case when voyageur_telephone is null then null else '[tel]' end,
      envoye_a = case when envoye_a is null then null else '[email]' end,
      note_blocage = anon_texte(note_blocage, array[voyageur_prenom, voyageur_nom]),
      motif_fin = anon_texte(motif_fin, array[voyageur_prenom, voyageur_nom]),
      conversion_erreur = anon_texte(conversion_erreur, array[voyageur_prenom, voyageur_nom]),
      consentement = anon_jsonb(consentement, array[voyageur_prenom, voyageur_nom]),
      paiement = anon_jsonb(paiement, array[voyageur_prenom, voyageur_nom]),
      stripe_customer_id = null, stripe_payment_method_id = null,
      arrivee = anon_mois(arrivee), depart = anon_mois(depart), anonymise_le = now_ts
     where id in (select id from devis_option where anonymise_le is null
                    and (greatest(depart, created_at::date, updated_at::date) + d5)::date + 1 <= p_jour
                  order by created_at limit p_limite);
    get diagnostics nb = row_count;
  end if;
  if nb > 0 then insert into anonymisation_journal (jour, simulation, regle, table_name, nb_lignes) select * from (values (p_jour, p_dry, 'devis_5_ans', 'devis_option', nb)) v where p_jour <= current_date; end if;
  autres := autres || jsonb_build_object('devis_option', nb);

  -- Demandes de réservation (pages Réserver).
  select count(*) into nb from (select 1 from direct_demande where anonymise_le is null
     and (greatest(depart, cree_le::date, traite_le::date) + d5)::date + 1 <= p_jour limit p_limite) s;
  if not p_dry and nb > 0 then
    update direct_demande set
      voyageur_prenom = case when voyageur_prenom is null then null else '[nom]' end,
      voyageur_nom = case when voyageur_nom is null then null else '[nom]' end,
      voyageur_email = case when voyageur_email is null then null else '[email]' end,
      voyageur_telephone = case when voyageur_telephone is null then null else '[tel]' end,
      message = anon_texte(message, array[voyageur_prenom, voyageur_nom]),
      note_bureau = anon_texte(note_bureau, array[voyageur_prenom, voyageur_nom]),
      motif_demande = anon_texte(motif_demande, array[voyageur_prenom, voyageur_nom]),
      consentement = anon_jsonb(consentement, array[voyageur_prenom, voyageur_nom]),
      ip_hash = null, arrivee = anon_mois(arrivee), depart = anon_mois(depart), anonymise_le = now_ts
     where id in (select id from direct_demande where anonymise_le is null
                    and (greatest(depart, cree_le::date, traite_le::date) + d5)::date + 1 <= p_jour
                  order by cree_le limit p_limite);
    get diagnostics nb = row_count;
  end if;
  if nb > 0 then insert into anonymisation_journal (jour, simulation, regle, table_name, nb_lignes) select * from (values (p_jour, p_dry, 'demande_5_ans', 'direct_demande', nb)) v where p_jour <= current_date; end if;
  autres := autres || jsonb_build_object('direct_demande', nb);

  -- Notes de séjour.
  select count(*) into nb from (select 1 from sejour_note n where anonymise_le is null
     and (greatest(n.created_at::date, (select r.departure_date from reservation r where r.id = n.reservation_id)) + d5)::date + 1 <= p_jour limit p_limite) s;
  if not p_dry and nb > 0 then
    update sejour_note n set texte = anon_texte(texte, array[(select r.guest_name from reservation r where r.id = n.reservation_id)]), anonymise_le = now_ts
     where id in (select id from sejour_note n2 where anonymise_le is null
                    and (greatest(n2.created_at::date, (select r.departure_date from reservation r where r.id = n2.reservation_id)) + d5)::date + 1 <= p_jour
                  order by created_at limit p_limite);
    get diagnostics nb = row_count;
  end if;
  if nb > 0 then insert into anonymisation_journal (jour, simulation, regle, table_name, nb_lignes) select * from (values (p_jour, p_dry, 'conversation_5_ans', 'sejour_note', nb)) v where p_jour <= current_date; end if;
  autres := autres || jsonb_build_object('sejour_note', nb);

  -- Signalements (dégâts / réclamations) : le dossier reste, le nom du client et ses coordonnées partent.
  select count(*) into nb from (select 1 from signalements where anonymise_le is null
     and (greatest(checkout_date, created_at::date) + d5)::date + 1 <= p_jour limit p_limite) s;
  if not p_dry and nb > 0 then
    update signalements set client_name = case when client_name is null then null else '[nom]' end,
      description = anon_texte(description, array[client_name]), notes = anon_texte(notes, array[client_name]),
      checkout_date = anon_mois(checkout_date), anonymise_le = now_ts
     where id in (select id from signalements where anonymise_le is null
                    and (greatest(checkout_date, created_at::date) + d5)::date + 1 <= p_jour order by created_at limit p_limite);
    get diagnostics nb = row_count;
  end if;
  if nb > 0 then insert into anonymisation_journal (jour, simulation, regle, table_name, nb_lignes) select * from (values (p_jour, p_dry, 'conversation_5_ans', 'signalements', nb)) v where p_jour <= current_date; end if;
  autres := autres || jsonb_build_object('signalements', nb);

  -- E-mails analysés par l'IA (voyageurs : hors fournisseurs).
  select count(*) into nb from (select 1 from email_jobs where anonymise_le is null and action_type is distinct from 'supplier'
     and (coalesce(received_at, created_at)::date + d5)::date + 1 <= p_jour limit p_limite) s;
  if not p_dry and nb > 0 then
    update email_jobs set from_email = case when from_email is null then null else '[email]' end,
      from_name = case when from_name is null then null else '[nom]' end,
      subject = anon_texte(subject, array[from_name]), body_text = anon_texte(body_text, array[from_name]),
      draft_subject = anon_texte(draft_subject, array[from_name]), draft_body = anon_texte(draft_body, array[from_name]),
      hospitable_data = anon_jsonb(hospitable_data, array[from_name]), anonymise_le = now_ts
     where id in (select id from email_jobs where anonymise_le is null and action_type is distinct from 'supplier'
                    and (coalesce(received_at, created_at)::date + d5)::date + 1 <= p_jour order by created_at limit p_limite);
    get diagnostics nb = row_count;
  end if;
  if nb > 0 then insert into anonymisation_journal (jour, simulation, regle, table_name, nb_lignes) select * from (values (p_jour, p_dry, 'conversation_5_ans', 'email_jobs', nb)) v where p_jour <= current_date; end if;
  autres := autres || jsonb_build_object('email_jobs', nb);

  -- Messagerie e-mail : seulement les messages liés à des voyageurs (plateformes de réservation, Hospitable,
  -- ou adresse d'un voyageur connu). Les e-mails propriétaires / fournisseurs ne sont pas concernés.
  select count(*) into nb from (select 1 from mail_messages m where anonymise_le is null and (m.date::date + d5)::date + 1 <= p_jour
     and anon_mail_voyageur(m.from_email, m.to_json, m.cc_json) limit p_limite) s;
  if not p_dry and nb > 0 then
    with cand as (
      select id from mail_messages m where anonymise_le is null and (m.date::date + d5)::date + 1 <= p_jour
         and anon_mail_voyageur(m.from_email, m.to_json, m.cc_json) order by m.date limit p_limite
    ), maj as (
      update mail_messages m set
        from_name = case when from_email ~* '@(mail\.)?(destinationcotebasque\.com|lauian[a-z.-]*)$' then from_name when from_name is null then null else '[nom]' end,
        from_email = case when from_email ~* '@(mail\.)?(destinationcotebasque\.com|lauian[a-z.-]*)$' then from_email when from_email is null then null else '[email]' end,
        to_json = anon_jsonb(to_json, array[from_name]), cc_json = anon_jsonb(cc_json, array[from_name]),
        subject = anon_texte(subject, array[from_name]), text_body = anon_texte(text_body, array[from_name]),
        html_body = anon_texte(html_body, array[from_name]), snippet = anon_texte(snippet, array[from_name]), anonymise_le = now_ts
       where m.id in (select id from cand) returning m.id
    ), ana as (
      update mail_ai_analysis a set summary = anon_texte(summary), suggested_reply = anon_texte(suggested_reply),
        detected_entities_json = anon_jsonb(detected_entities_json), suggested_actions_json = anon_jsonb(suggested_actions_json), anonymise_le = now_ts
       where a.message_id in (select id from maj) returning 1
    ) select count(*) into nb from maj;
  end if;
  if nb > 0 then insert into anonymisation_journal (jour, simulation, regle, table_name, nb_lignes) select * from (values (p_jour, p_dry, 'conversation_5_ans', 'mail_messages', nb)) v where p_jour <= current_date; end if;
  autres := autres || jsonb_build_object('mail_messages', nb);

  -- Journal des webhooks Hospitable (copies brutes des messages / réservations).
  select count(*) into nb from (select 1 from webhook_log w where anonymise_le is null
     and (greatest(w.received_at::date, (select max(r.departure_date) from reservation r where r.hospitable_id = w.data_id)) + d5)::date + 1 <= p_jour limit p_limite) s;
  if not p_dry and nb > 0 then
    update webhook_log w set
      payload = anon_jsonb(payload, (select array_agg(r.guest_name) from reservation r where r.hospitable_id = w.data_id)),
      message = anon_texte(message, (select array_agg(r.guest_name) from reservation r where r.hospitable_id = w.data_id)),
      anonymise_le = now_ts
     where id in (select id from webhook_log w2 where anonymise_le is null
                    and (greatest(w2.received_at::date, (select max(r.departure_date) from reservation r where r.hospitable_id = w2.data_id)) + d5)::date + 1 <= p_jour
                  order by received_at limit p_limite);
    get diagnostics nb = row_count;
  end if;
  if nb > 0 then insert into anonymisation_journal (jour, simulation, regle, table_name, nb_lignes) select * from (values (p_jour, p_dry, 'conversation_5_ans', 'webhook_log', nb)) v where p_jour <= current_date; end if;
  autres := autres || jsonb_build_object('webhook_log', nb);

  -- Invitations à laisser un avis (SMS) : 3 ans (« Avis et relation client »).
  select count(*) into nb from (select 1 from sms_queue q where anonymise_le is null
     and (greatest(q.created_at::date, q.send_at::date, (select max(r.departure_date) from reservation r where r.hospitable_id = q.hospitable_reservation_id)) + d3)::date + 1 <= p_jour limit p_limite) s;
  if not p_dry and nb > 0 then
    update sms_queue set guest_name = case when guest_name is null then null else '[nom]' end,
      guest_phone = case when guest_phone is null then null else '[tel]' end,
      comment = anon_texte(comment, array[guest_name]), preview_body = anon_texte(preview_body, array[guest_name]),
      error_message = anon_texte(error_message, array[guest_name]), anonymise_le = now_ts
     where id in (select id from sms_queue q where anonymise_le is null
                    and (greatest(q.created_at::date, q.send_at::date, (select max(r.departure_date) from reservation r where r.hospitable_id = q.hospitable_reservation_id)) + d3)::date + 1 <= p_jour
                  order by created_at limit p_limite);
    get diagnostics nb = row_count;
  end if;
  if nb > 0 then insert into anonymisation_journal (jour, simulation, regle, table_name, nb_lignes) select * from (values (p_jour, p_dry, 'avis_sms_3_ans', 'sms_queue', nb)) v where p_jour <= current_date; end if;
  autres := autres || jsonb_build_object('sms_queue', nb);

  select count(*) into nb from (select 1 from sms_logs l where anonymise_le is null
     and (greatest(l.created_at::date, l.sent_at::date, (select max(r.departure_date) from reservation r where r.hospitable_id = l.hospitable_reservation_id)) + d3)::date + 1 <= p_jour limit p_limite) s;
  if not p_dry and nb > 0 then
    update sms_logs set client_name = case when client_name is null then null else '[nom]' end,
      guest_name = case when guest_name is null then null else '[nom]' end,
      client_phone = case when client_phone is null then null else '[tel]' end,
      guest_phone = case when guest_phone is null then null else '[tel]' end,
      message_sent = anon_texte(message_sent, array[guest_name, client_name]), sms_body = anon_texte(sms_body, array[guest_name, client_name]),
      error_message = anon_texte(error_message, array[guest_name, client_name]), anonymise_le = now_ts
     where id in (select id from sms_logs l where anonymise_le is null
                    and (greatest(l.created_at::date, l.sent_at::date, (select max(r.departure_date) from reservation r where r.hospitable_id = l.hospitable_reservation_id)) + d3)::date + 1 <= p_jour
                  order by created_at limit p_limite);
    get diagnostics nb = row_count;
  end if;
  if nb > 0 then insert into anonymisation_journal (jour, simulation, regle, table_name, nb_lignes) select * from (values (p_jour, p_dry, 'avis_sms_3_ans', 'sms_logs', nb)) v where p_jour <= current_date; end if;
  autres := autres || jsonb_build_object('sms_logs', nb);

  return jsonb_build_object('jour', p_jour, 'simulation', p_dry) || cpt || jsonb_build_object('autres', autres);
end $$;
alter function public.anon_conversations_executer(date, boolean, int) set statement_timeout = '280s';

revoke all on function public.anon_conversations_executer(date, boolean, int) from public, anon, authenticated;
grant execute on function public.anon_conversations_executer(date, boolean, int) to service_role;
revoke all on function public.anon_conversations_candidats(date, int) from public, anon, authenticated;
grant execute on function public.anon_conversations_candidats(date, int) to service_role;
revoke all on function public.anon_noms_conversation(text, text[]) from public, anon, authenticated;
grant execute on function public.anon_noms_conversation(text, text[]) to service_role;
comment on function public.anon_conversations_executer(date, boolean, int) is
  'Anonymisation des conversations voyageurs échues (fin du séjour / dernier message + 5 ans ; invitations à un avis : 3 ans). p_dry = simulation. Appelée chaque nuit par PowerHouse /api/ga-anonymize (438).';
comment on function public.anon_texte(text, text[]) is 'Remplace e-mails, téléphones, IBAN, cartes (Luhn), codes d''accès, mots de passe, adresses postales et noms connus par des marqueurs neutres (438).';

-- ───────────────────────────── 6. Pas de recalcul des fils pendant l'anonymisation ─────────────────────────────
create or replace function public.trg_guest_thread_a_recalculer()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if new.conversation_id is null or new.conversation_id = '' then return new; end if;
  if current_setting('dcb.anonymisation', true) = '1' then return new; end if;   -- 438 : anonymisation, pas un nouveau message
  if tg_op = 'UPDATE' then
    if new.created_at is not distinct from old.created_at
       and new.sender_type is not distinct from old.sender_type
       and new.source is not distinct from old.source
       and new.body is not distinct from old.body
       and new.reservation_id is not distinct from old.reservation_id
       and (new.raw->>'sent_reference_id') is not distinct from (old.raw->>'sent_reference_id') then
      return new;
    end if;
  end if;
  insert into public.guest_thread_recalcul (conversation_id, marque_at) values (new.conversation_id, now())
  on conflict (conversation_id) do update set marque_at = excluded.marque_at;
  return new;
end $function$;

-- Compatibilité : l'ancien point d'entrée (appelé par /api/ga-anonymize avant son déploiement) applique la nouvelle règle.
create or replace function public.ga_anonymize_due() returns integer language sql security definer set search_path = public as $$
  select (public.anon_conversations_executer(current_date, false, 100)->>'conversations')::int
$$;
revoke all on function public.ga_anonymize_due() from public, anon, authenticated;
grant execute on function public.ga_anonymize_due() to service_role;
