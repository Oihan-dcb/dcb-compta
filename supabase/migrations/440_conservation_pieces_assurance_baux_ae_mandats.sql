-- 440 — Durées de conservation des pièces justificatives (décisions d'Oïhan 16/10/2026), appliquées par la purge
-- quotidienne existante (PowerHouse api/cron-purge-identite.js, étendue — pas de second cron).
--
--   1. Attestations d'assurance des voyageurs (contract_sign_sessions.assurance_url, bucket contracts-identity)
--        → fin du séjour + 1 an. Les PDF signés qui l'intègrent en image (signés depuis le 07/06/2026) sont d'abord
--          remplacés par une version expurgée (dcb-contrats api/pdf-expurge.js, motif « assurance »).
--   2. Pièces des baux mobilité (bucket baux : pièces d'identité, justificatif du motif, pouvoir, procuration)
--        → fin du bail + 5 ans (fin = bail_data.conditions.date_fin, à défaut sejour_snapshot.date_depart).
--          PDF signé (pièces en annexe) → version expurgée scellée d'abord (PowerHouse bail-mobilite.expurgerBail).
--   3. Pièces des auto-entrepreneurs (bucket ae-onboarding : identité, Kbis/attestation, RIB, carte Vitale)
--        → fin de collaboration + 5 ans. Fin de collaboration = AE désactivé (actif = false) ET date connue :
--          la plus tardive de auto_entrepreneur.date_fin et de la dernière mission passée. Sans date : rien, signalé.
--          (Le PDF du contrat AE n'intègre aucune pièce : rien à expurger.)
--   4. Pièces des propriétaires / mandats (bucket mandats : CNI, selfie, assurance habitation, RIB, acte de
--      propriété, autres annexes, brouillons et PDF « partiel » qui les intègrent ; bucket owner-onboarding)
--        → fin du mandat + 10 ans. Nouvelle colonne mandat_signature.date_fin, posée automatiquement :
--          statut → remplacé / annulé / refusé / expiré, bien passé « hors mandat », propriétaire désactivé
--          (et retirée si la situation est annulée). Saisissable aussi à la main (résiliation datée).
--          Tant que date_fin est vide : rien. PDF signé → version expurgée scellée d'abord (generate-mandat.expurgerMandat).
--          Pièces de l'onboarding propriétaire : quand plus aucun mandat du propriétaire n'est actif → la plus tardive
--          des date_fin + 10 ans ; propriétaire sans aucun mandat : rien, signalé.
--
-- Fonctions en LECTURE SEULE (service_role) ; les fichiers sont supprimés par l'API Storage (jamais de DELETE SQL sur
-- storage.objects), puis les références vidées par purge_vider_chemin() ; journal non personnel identite_purge_journal
-- (date_fin_sejour = date de fin du séjour / bail / collaboration / mandat selon dossier_type).

-- ── Journal : nouvelles pièces ───────────────────────────────────────────────
alter table public.identite_purge_journal drop constraint if exists identite_purge_journal_piece_check;
alter table public.identite_purge_journal add constraint identite_purge_journal_piece_check check (piece in (
  'selfie', 'piece_identite', 'pdf_signe', 'assurance',
  'piece_bail', 'pdf_bail', 'piece_ae', 'piece_mandat', 'pdf_mandat', 'piece_onboarding_proprio'));
comment on column public.identite_purge_journal.date_fin_sejour is
  'Date de fin de référence : séjour (contrat_voyageur), bail (bail_mobilite), collaboration (ae), mandat (mandat / proprietaire_onboarding).';

-- ── Fin de mandat ────────────────────────────────────────────────────────────
alter table public.mandat_signature add column if not exists date_fin date;
alter table public.mandat_signature add column if not exists date_fin_source text;
comment on column public.mandat_signature.date_fin is
  'Fin du mandat (résiliation, remplacement, sortie de gestion). Posée automatiquement (statut remplacé/annulé/refusé/expiré, bien hors mandat, propriétaire désactivé) ou à la main. Point de départ de la conservation des pièces : + 10 ans (440).';

create or replace function public.mandat_date_fin_statut() returns trigger language plpgsql as $$
begin
  if new.statut in ('remplace', 'annule', 'refuse', 'expire') and new.statut is distinct from old.statut and new.date_fin is null then
    new.date_fin := current_date; new.date_fin_source := 'statut_' || new.statut;
  elsif new.statut in ('brouillon', 'envoye', 'partiel', 'signe') and old.statut in ('remplace', 'annule', 'refuse', 'expire')
        and coalesce(new.date_fin_source, '') like 'statut\_%' then
    new.date_fin := null; new.date_fin_source := null;
  end if;
  return new;
end $$;
drop trigger if exists mandat_date_fin_statut on public.mandat_signature;
create trigger mandat_date_fin_statut before update of statut on public.mandat_signature
  for each row execute function public.mandat_date_fin_statut();

create or replace function public.mandat_date_fin_bien() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.hors_mandat then
    update mandat_signature set date_fin = current_date, date_fin_source = 'bien_hors_mandat'
     where bien_id = new.id and date_fin is null and statut in ('signe', 'partiel');
  else
    update mandat_signature set date_fin = null, date_fin_source = null
     where bien_id = new.id and date_fin_source = 'bien_hors_mandat';
  end if;
  return null;
end $$;
drop trigger if exists mandat_date_fin_bien on public.bien;
create trigger mandat_date_fin_bien after update of hors_mandat on public.bien
  for each row when (old.hors_mandat is distinct from new.hors_mandat) execute function public.mandat_date_fin_bien();

create or replace function public.mandat_date_fin_proprio() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.actif is false then
    update mandat_signature set date_fin = current_date, date_fin_source = 'proprietaire_inactif'
     where proprietaire_id = new.id and date_fin is null and statut in ('signe', 'partiel');
  else
    update mandat_signature set date_fin = null, date_fin_source = null
     where proprietaire_id = new.id and date_fin_source = 'proprietaire_inactif';
  end if;
  return null;
end $$;
drop trigger if exists mandat_date_fin_proprio on public.proprietaire;
create trigger mandat_date_fin_proprio after update of actif on public.proprietaire
  for each row when (old.actif is distinct from new.actif) execute function public.mandat_date_fin_proprio();

-- ── 1. Attestations d'assurance voyageurs ────────────────────────────────────
create or replace function public.assurance_purge_candidats(p_jour date default current_date)
returns table (dossier_id uuid, contract_id uuid, chemin text, date_fin_sejour date, echeance date)
language sql stable security definer set search_path to 'public' as $$
  with s as (
    select cs.id, cs.contract_id,
           coalesce((regexp_match(cs.assurance_url, 'contracts-identity/([^?]+)'))[1],
                    case when cs.assurance_url !~ '^https?:' then trim(cs.assurance_url) end) as chemin,
           nullif(rc.sejour_snapshot->>'date_depart', '')::date as dep
      from contract_sign_sessions cs join rental_contracts rc on rc.id = cs.contract_id
     where nullif(trim(cs.assurance_url), '') is not null
       and rc.sejour_snapshot->>'date_depart' ~ '^\d{4}-\d{2}-\d{2}$'
  )
  select id, contract_id, chemin, dep, (dep + interval '1 year')::date + 1
    from s where chemin is not null and dep < p_jour and (dep + interval '1 year')::date + 1 <= p_jour
   order by 5, 1;
$$;

-- PDF signés contenant l'attestation en image (annexe depuis le 07/06/2026 ; une attestation PDF n'y est que mentionnée),
-- dont l'échéance est atteinte, une fois la version expurgée « identité » faite (ou inutile).
create or replace function public.assurance_pdf_candidats(p_jour date default current_date)
returns table (contract_id uuid, dossier_id uuid, date_fin_sejour date, echeance date)
language sql stable security definer set search_path to 'public' as $$
  with c as (
    select rc.id, nullif(rc.sejour_snapshot->>'date_depart', '')::date as dep,
           (select cs.id from contract_sign_sessions cs where cs.contract_id = rc.id and cs.signature_canvas is not null
             order by cs.created_at desc limit 1) as sess
      from rental_contracts rc
     where rc.statut = 'signed' and nullif(trim(rc.pdf_signed_url), '') is not null
       and rc.sejour_snapshot->>'date_depart' ~ '^\d{4}-\d{2}-\d{2}$'
       and not exists (select 1 from contract_events e where e.contract_id = rc.id and e.event_type = 'pdf_expurge_assurance')
  )
  select c.id, c.sess, c.dep, (c.dep + interval '1 year')::date + 1
    from c join contract_sign_sessions cs on cs.id = c.sess
   where cs.assurance_choice = 'mrh' and cs.assurance_uploaded
     and coalesce(cs.signed_at, now()) >= '2026-06-07T12:19:06Z'
     and coalesce(cs.assurance_url, '') !~* 'assurance\.pdf'
     and c.dep < p_jour and (c.dep + interval '1 year')::date + 1 <= p_jour
     and not exists (select 1 from public.identite_pdf_candidats(p_jour) x where x.contract_id = c.id)
   order by 4, 1;
$$;

-- ── 2. Baux mobilité ─────────────────────────────────────────────────────────
create or replace function public.bail_fin(p_contract uuid) returns date
language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    case when rc.bail_data->'conditions'->>'date_fin' ~ '^\d{4}-\d{2}-\d{2}' then (rc.bail_data->'conditions'->>'date_fin')::date end,
    case when rc.sejour_snapshot->>'date_depart' ~ '^\d{4}-\d{2}-\d{2}$' then (rc.sejour_snapshot->>'date_depart')::date end)
  from rental_contracts rc where rc.id = p_contract;
$$;

create or replace function public.bail_pdf_candidats(p_jour date default current_date)
returns table (contract_id uuid, date_fin date, echeance date)
language sql stable security definer set search_path to 'public' as $$
  select rc.id, f.fin, (f.fin + interval '5 years')::date + 1
    from rental_contracts rc cross join lateral (select public.bail_fin(rc.id) as fin) f
   where rc.type_contrat = 'mobilite' and rc.statut = 'signed' and nullif(trim(rc.pdf_signed_url), '') is not null
     and f.fin is not null and f.fin < p_jour and (f.fin + interval '5 years')::date + 1 <= p_jour
     and not exists (select 1 from contract_events e where e.contract_id = rc.id and e.event_type = 'pdf_expurge_pieces')
   order by 3, 1;
$$;

-- Fichiers du dossier <agence>/<contrat>/ (le PDF signé, sous <agence>/signed/, est expurgé et non supprimé).
-- Uniquement quand le PDF signé n'intègre plus les pièces.
create or replace function public.bail_purge_candidats(p_jour date default current_date)
returns table (contract_id uuid, chemin text, date_fin date, echeance date)
language sql stable security definer set search_path to 'public' as $$
  select rc.id, o.name, f.fin, (f.fin + interval '5 years')::date + 1
    from rental_contracts rc cross join lateral (select public.bail_fin(rc.id) as fin) f
    join storage.objects o on o.bucket_id = 'baux' and o.name like rc.agence || '/' || rc.id::text || '/%'
   where rc.type_contrat = 'mobilite'
     and f.fin is not null and f.fin < p_jour and (f.fin + interval '5 years')::date + 1 <= p_jour
     and (rc.statut <> 'signed' or nullif(trim(rc.pdf_signed_url), '') is null
          or exists (select 1 from contract_events e where e.contract_id = rc.id and e.event_type = 'pdf_expurge_pieces'))
   order by 4, 1, 2;
$$;

-- ── 3. Auto-entrepreneurs ────────────────────────────────────────────────────
create or replace function public.ae_fin_collaboration(p_ae uuid, p_jour date default current_date) returns date
language sql stable security definer set search_path to 'public' as $$
  select case when a.actif is false then nullif(greatest(
           coalesce(a.date_fin, '-infinity'::date),
           coalesce((select max(h.date_mission) from mission_hub_v h where h.ae_id = a.id and h.date_mission <= p_jour), '-infinity'::date),
           coalesce((select max(m.date_mission) from mission_menage m where m.ae_id = a.id and m.date_mission <= p_jour), '-infinity'::date)
         ), '-infinity'::date) end
    from auto_entrepreneur a where a.id = p_ae;
$$;

create or replace function public.ae_purge_candidats(p_jour date default current_date)
returns table (ae_id uuid, chemin text, date_fin date, echeance date)
language sql stable security definer set search_path to 'public' as $$
  select a.id, o.name, f.fin, (f.fin + interval '5 years')::date + 1
    from auto_entrepreneur a cross join lateral (select public.ae_fin_collaboration(a.id, p_jour) as fin) f
    join storage.objects o on o.bucket_id = 'ae-onboarding' and o.name like a.id::text || '/%'
   where a.actif is false and f.fin is not null and f.fin < p_jour and (f.fin + interval '5 years')::date + 1 <= p_jour
   order by 4, 1, 2;
$$;

-- ── 4. Mandats et onboarding propriétaire ────────────────────────────────────
-- PDF signé (ou « partiel ») à remplacer par une version expurgée.
create or replace function public.mandat_pdf_candidats(p_jour date default current_date)
returns table (mandat_id uuid, numero text, date_fin date, echeance date)
language sql stable security definer set search_path to 'public' as $$
  select m.id, m.numero, m.date_fin, (m.date_fin + interval '10 years')::date + 1
    from mandat_signature m
   where m.date_fin is not null and m.date_fin < p_jour and (m.date_fin + interval '10 years')::date + 1 <= p_jour
     and nullif(trim(m.pdf_signed_url), '') is not null
     and not exists (select 1 from identite_purge_journal j where j.dossier_type = 'mandat' and j.dossier_id = m.id
                       and j.piece = 'pdf_mandat' and j.resultat = 'expurge')
   order by 4, 1;
$$;

-- Pièces et PDF intermédiaires (brouillon, partiel) : tout objet « …/<numéro>-* » du bucket + chemins référencés,
-- sauf le PDF signé lui-même. Uniquement quand le PDF signé est expurgé (ou absent).
create or replace function public.mandat_purge_candidats(p_jour date default current_date)
returns table (mandat_id uuid, numero text, chemin text, date_fin date, echeance date)
language sql stable security definer set search_path to 'public' as $$
  with m as (
    select m.*, (regexp_match(coalesce(m.pdf_signed_url, ''), '/mandats/([^?]+)'))[1] as chemin_signe
      from mandat_signature m
     where m.date_fin is not null and m.date_fin < p_jour and (m.date_fin + interval '10 years')::date + 1 <= p_jour
       and (nullif(trim(m.pdf_signed_url), '') is null
            or exists (select 1 from identite_purge_journal j where j.dossier_type = 'mandat' and j.dossier_id = m.id
                         and j.piece = 'pdf_mandat' and j.resultat = 'expurge'))
  ), f as (
    select m.id, m.numero, o.name as chemin, m.date_fin, m.chemin_signe
      from m join storage.objects o on o.bucket_id = 'mandats'
       and o.name ~ ('^[0-9a-f-]{36}/[0-9a-f-]{36}/' || m.numero || '-[A-Za-z0-9._-]+$')
    union
    select m.id, m.numero, x.p, m.date_fin, m.chemin_signe
      from m cross join lateral (values (m.identite_path), (m.selfie_path), (m.assurance_hab_path), (m.rib_path), (m.acte_propriete_path)) x(p)
     where nullif(trim(x.p), '') is not null and x.p !~ '^https?:'
    union
    select m.id, m.numero, coalesce(a->>'path', a #>> '{}'), m.date_fin, m.chemin_signe
      from m cross join lateral jsonb_array_elements(case when jsonb_typeof(m.config->'annexe_paths') = 'array' then m.config->'annexe_paths' else '[]'::jsonb end) a
  )
  select id, numero, chemin, date_fin, (date_fin + interval '10 years')::date + 1
    from f
   where chemin is not null and chemin is distinct from chemin_signe and chemin !~ '-signed\.pdf$'
   order by 5, 1, 3;
$$;

create or replace function public.proprio_onboarding_fin(p_proprio uuid) returns date
language sql stable security definer set search_path to 'public' as $$
  select case
    when not exists (select 1 from mandat_signature m where m.proprietaire_id = p_proprio) then null
    when exists (select 1 from mandat_signature m where m.proprietaire_id = p_proprio and m.date_fin is null
                   and m.statut in ('brouillon', 'envoye', 'partiel', 'signe')) then null
    else (select max(m.date_fin) from mandat_signature m where m.proprietaire_id = p_proprio)
  end;
$$;

create or replace function public.proprio_onboarding_purge_candidats(p_jour date default current_date)
returns table (proprietaire_id uuid, chemin text, date_fin date, echeance date)
language sql stable security definer set search_path to 'public' as $$
  with p as (
    select po.proprietaire_id as pid, public.proprio_onboarding_fin(po.proprietaire_id) as fin
      from proprietaire_onboarding po
  )
  select p.pid, o.name, p.fin, (p.fin + interval '10 years')::date + 1
    from p join storage.objects o on o.bucket_id = 'owner-onboarding' and o.name like p.pid::text || '/%'
   where p.fin is not null and p.fin < p_jour and (p.fin + interval '10 years')::date + 1 <= p_jour
   order by 4, 1, 2;
$$;

-- ── Vidage des références après suppression d'un fichier (condition : la colonne désigne ce fichier) ─────────
create or replace function public.purge_vider_chemin(p_type text, p_dossier uuid, p_chemin text) returns integer
language plpgsql security definer set search_path to 'public' as $$
declare n integer := 0; k integer;
begin
  if p_chemin is null or p_chemin = '' then return 0; end if;
  if p_type = 'assurance' then
    update contract_sign_sessions set assurance_url = null
     where id = p_dossier and (assurance_url = p_chemin or assurance_url like '%contracts-identity/' || p_chemin || '%');
    get diagnostics n = row_count;
  elsif p_type = 'bail_mobilite' then
    update bail_signataires set id_document_path = null where contract_id = p_dossier and id_document_path = p_chemin;
    get diagnostics k = row_count; n := n + k;
    update rental_contracts rc set bail_data = jsonb_set(rc.bail_data, '{docs}',
             coalesce((select jsonb_object_agg(e.key, case when e.value #>> '{}' = p_chemin then 'null'::jsonb else e.value end)
                         from jsonb_each(rc.bail_data->'docs') e), '{}'::jsonb))
     where rc.id = p_dossier and jsonb_typeof(rc.bail_data->'docs') = 'object'
       and exists (select 1 from jsonb_each(rc.bail_data->'docs') e where e.value #>> '{}' = p_chemin);
    get diagnostics k = row_count; n := n + k;
    update bail_lien bl set draft = (select jsonb_object_agg(e.key, case when e.value #>> '{}' = p_chemin then 'null'::jsonb else e.value end)
                                       from jsonb_each(bl.draft) e)
     where bl.contract_id = p_dossier and jsonb_typeof(bl.draft) = 'object'
       and exists (select 1 from jsonb_each(bl.draft) e where e.value #>> '{}' = p_chemin);
    get diagnostics k = row_count; n := n + k;
  elsif p_type = 'ae' then
    update ae_onboarding set
      doc_kbis_path      = nullif(doc_kbis_path, p_chemin),      doc_assurance_path = nullif(doc_assurance_path, p_chemin),
      doc_rib_path       = nullif(doc_rib_path, p_chemin),       doc_identite_path  = nullif(doc_identite_path, p_chemin),
      doc_vitale_path    = nullif(doc_vitale_path, p_chemin)
     where ae_id = p_dossier and p_chemin in (doc_kbis_path, doc_assurance_path, doc_rib_path, doc_identite_path, doc_vitale_path);
    get diagnostics n = row_count;
  elsif p_type = 'mandat' then
    update mandat_signature set
      identite_path = nullif(identite_path, p_chemin), selfie_path = nullif(selfie_path, p_chemin),
      assurance_hab_path = nullif(assurance_hab_path, p_chemin), rib_path = nullif(rib_path, p_chemin),
      acte_propriete_path = nullif(acte_propriete_path, p_chemin),
      pdf_draft_url = case when pdf_draft_url like '%/mandats/' || p_chemin || '%' then null else pdf_draft_url end,
      config = case when jsonb_typeof(config->'annexe_paths') = 'array' then jsonb_set(config, '{annexe_paths}',
                 coalesce((select jsonb_agg(a) from jsonb_array_elements(config->'annexe_paths') a
                            where coalesce(a->>'path', a #>> '{}') is distinct from p_chemin), '[]'::jsonb)) else config end
     where id = p_dossier;
    get diagnostics n = row_count;
  elsif p_type = 'proprietaire_onboarding' then
    update proprietaire_onboarding set
      doc_titre_path = nullif(doc_titre_path, p_chemin), doc_assurance_path = nullif(doc_assurance_path, p_chemin),
      doc_identite_path = nullif(doc_identite_path, p_chemin), doc_selfie_path = nullif(doc_selfie_path, p_chemin)
     where proprietaire_id = p_dossier and p_chemin in (doc_titre_path, doc_assurance_path, doc_identite_path, doc_selfie_path);
    get diagnostics n = row_count;
  else
    raise exception 'type de dossier inconnu : %', p_type;
  end if;
  return n;
end $$;

-- ── Signalements (rien n'est purgé faute de date fiable) — chiffres seulement, aucune donnée personnelle ──────
create or replace function public.pieces_conservation_signalements(p_jour date default current_date)
returns table (categorie text, motif text, nb bigint)
language sql stable security definer set search_path to 'public' as $$
  select 'ae', 'AE désactivé avec pièces, sans date de fin ni mission passée (non purgé)', count(*)
    from auto_entrepreneur a
   where a.actif is false and public.ae_fin_collaboration(a.id, p_jour) is null
     and exists (select 1 from storage.objects o where o.bucket_id = 'ae-onboarding' and o.name like a.id::text || '/%')
  union all
  select 'ae', 'AE désactivé avec des missions planifiées après aujourd''hui (fin de collaboration à confirmer)', count(*)
    from auto_entrepreneur a
   where a.actif is false and exists (select 1 from mission_menage m where m.ae_id = a.id and m.date_mission > p_jour)
  union all
  select 'proprietaire_onboarding', 'Pièces d''onboarding d''un propriétaire sans aucun mandat (non purgé)', count(*)
    from proprietaire_onboarding po
   where not exists (select 1 from mandat_signature m where m.proprietaire_id = po.proprietaire_id)
     and exists (select 1 from storage.objects o where o.bucket_id = 'owner-onboarding' and o.name like po.proprietaire_id::text || '/%')
  union all
  select 'mandat', 'Mandat signé sans date de fin dont le bien n''est plus en ligne (sortie de gestion à confirmer)', count(*)
    from mandat_signature m join bien b on b.id = m.bien_id
   where m.statut = 'signe' and m.date_fin is null and (b.listed is false or b.hospitable_etat in ('archive', 'archived', 'supprime', 'deleted'))
  union all
  select 'mandat', 'Mandat signé sans texte signé enregistré (version expurgée impossible à l''échéance)', count(*)
    from mandat_signature m where m.statut = 'signe' and m.contenu_html_rendered is null
  union all
  select 'bail_mobilite', 'Bail mobilité sans date de fin (non purgé)', count(*)
    from rental_contracts rc where rc.type_contrat = 'mobilite' and public.bail_fin(rc.id) is null
  union all
  select 'mandats_bucket', 'Fichiers du bucket mandats rattachés à aucun mandat', count(*)
    from storage.objects o
   where o.bucket_id = 'mandats'
     and not exists (select 1 from mandat_signature m where o.name ~ ('/' || m.numero || '-'))
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'assurance_purge_candidats(date)', 'assurance_pdf_candidats(date)', 'bail_fin(uuid)', 'bail_pdf_candidats(date)',
    'bail_purge_candidats(date)', 'ae_fin_collaboration(uuid,date)', 'ae_purge_candidats(date)', 'mandat_pdf_candidats(date)',
    'mandat_purge_candidats(date)', 'proprio_onboarding_fin(uuid)', 'proprio_onboarding_purge_candidats(date)',
    'purge_vider_chemin(text,uuid,text)', 'pieces_conservation_signalements(date)', 'mandat_date_fin_bien()', 'mandat_date_fin_proprio()']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
