-- 413 — Fiche bien PowerHouse, lots 4-6 (14/10/2026) : 🧹 Terrain (consignes AE + suggestions des AE),
-- 💬 Messages (relevé des règles Hospitable, lecture seule), 🕘 Historique (journal unique du bien).
--
-- Décisions d'Oïhan : les consignes AE sont rédigées par le bureau ; les AE peuvent en PROPOSER depuis
-- Ma journée (portail AE), le bureau valide (→ la consigne est publiée : bien_particularite, lue dans
-- Ma journée) ou refuse (motif) ; l'AE voit le résultat.
--
--   1. bien_consigne_suggestion (modèle préparé en 411) : vu_par_ae_at (l'AE a vu la décision).
--   2. consigne_proposer(mission, texte, medias)      — AE, SECURITY DEFINER : la mission doit être la sienne ;
--      bien / AE déduits de la mission (rien de falsifiable).
--   3. consigne_traiter(id, decision, …)              — bureau (auth_user_peut_editer_fiches), SECURITY INVOKER :
--      la RLS de bien_particularite / bien_consigne_suggestion (périmètre secteur) s'applique telle quelle.
--   4. consigne_marquer_vue(ids)                       — AE : décision vue (bandeau Ma journée).
--   5. Journal des fiches : bien_toolbox (fiche AE) et bien_particularite tracés dans fiche_historique,
--      AVEC les champs sensibles masqués (codes, mot de passe, lien d'arrivée, texte libre des consignes).
--   6. hospitable_regle_message : dernier relevé des règles de messages Hospitable (noms, déclencheur,
--      canaux, biens, balises — pas les textes). Repli quand l'API n'est pas joignable.
--   7. bien_historique(bien, depuis, limite) : toutes les sources du journal d'un bien, service_role seul
--      (l'endpoint PowerHouse vérifie le staff + le périmètre avant d'appeler).

-- ── 1. Suggestions : décision vue par l'AE ────────────────────────────────────────────────────────────
alter table public.bien_consigne_suggestion add column if not exists vu_par_ae_at timestamptz;

-- ── 2. Proposer (AE, depuis Ma journée) ───────────────────────────────────────────────────────────────
create or replace function public.consigne_proposer(p_mission_id uuid, p_texte text, p_medias jsonb default '[]'::jsonb)
returns public.bien_consigne_suggestion
language plpgsql security definer set search_path = public as $$
declare m mission_menage; s bien_consigne_suggestion; t text := btrim(coalesce(p_texte, ''));
begin
  select * into m from mission_menage where id = p_mission_id;
  if m.id is null then raise exception 'mission_introuvable'; end if;
  if m.bien_id is null then raise exception 'mission_sans_bien'; end if;
  if not auth_user_owns_ae(m.ae_id) then raise exception 'acces_refuse'; end if;
  if length(t) < 5 then raise exception 'texte_trop_court'; end if;
  if length(t) > 2000 then t := left(t, 2000); end if;
  if jsonb_typeof(coalesce(p_medias, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_medias, '[]'::jsonb)) > 6 then
    raise exception 'medias_invalides';
  end if;
  -- Même texte déjà proposé (en attente) sur ce bien : on ne double pas.
  select * into s from bien_consigne_suggestion
   where bien_id = m.bien_id and statut = 'proposee' and lower(btrim(texte)) = lower(t) limit 1;
  if s.id is not null then return s; end if;
  insert into bien_consigne_suggestion (bien_id, ae_id, mission_id, texte, medias, statut, created_by)
  values (m.bien_id, m.ae_id, m.id, t, coalesce(p_medias, '[]'::jsonb), 'proposee', auth.uid())
  returning * into s;
  return s;
end $$;
revoke all on function public.consigne_proposer(uuid, text, jsonb) from public, anon;
grant execute on function public.consigne_proposer(uuid, text, jsonb) to authenticated;

-- ── 3. Valider / refuser (bureau) ─────────────────────────────────────────────────────────────────────
create or replace function public.consigne_traiter(p_id uuid, p_decision text, p_titre text default null,
  p_contenu text default null, p_categorie text default 'autre', p_importance text default 'info', p_motif text default null)
returns public.bien_consigne_suggestion
language plpgsql security invoker set search_path = public as $$
declare s bien_consigne_suggestion; p bien_particularite;
begin
  if not auth_user_peut_editer_fiches() then raise exception 'acces_refuse'; end if;
  if p_decision not in ('valider', 'refuser') then raise exception 'decision_requise'; end if;
  select * into s from bien_consigne_suggestion where id = p_id for update;
  if s.id is null then raise exception 'suggestion_introuvable'; end if;   -- hors périmètre = invisible (RLS)
  if s.statut <> 'proposee' then raise exception 'deja_traitee'; end if;
  if p_decision = 'valider' then
    if coalesce(btrim(p_titre), '') = '' then raise exception 'titre_requis'; end if;
    insert into bien_particularite (bien_id, categorie, titre, contenu, medias, importance, origine)
    values (s.bien_id, coalesce(nullif(p_categorie, ''), 'autre'), btrim(p_titre),
            nullif(btrim(coalesce(p_contenu, s.texte)), ''), s.medias,
            case when p_importance in ('info', 'important', 'critique') then p_importance else 'info' end, 'suggestion_ae')
    returning * into p;
    update bien_consigne_suggestion set statut = 'validee', particularite_id = p.id, traite_par = auth.uid(), traite_at = now(), motif_refus = null
     where id = p_id returning * into s;
  else
    update bien_consigne_suggestion set statut = 'refusee', traite_par = auth.uid(), traite_at = now(),
           motif_refus = nullif(btrim(coalesce(p_motif, '')), '')
     where id = p_id returning * into s;
  end if;
  if s.id is null then raise exception 'acces_refuse'; end if;
  return s;
end $$;
revoke all on function public.consigne_traiter(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.consigne_traiter(uuid, text, text, text, text, text, text) to authenticated;

-- ── 4. Décision vue par l'AE ──────────────────────────────────────────────────────────────────────────
create or replace function public.consigne_marquer_vue(p_ids uuid[])
returns integer language sql security definer set search_path = public as $$
  with u as (
    update bien_consigne_suggestion set vu_par_ae_at = now()
     where id = any(p_ids) and created_by = auth.uid() and statut <> 'proposee' and vu_par_ae_at is null
    returning 1)
  select count(*)::int from u;
$$;
revoke all on function public.consigne_marquer_vue(uuid[]) from public, anon;
grant execute on function public.consigne_marquer_vue(uuid[]) to authenticated;

-- ── 5. Journal des fiches, champs sensibles masqués ───────────────────────────────────────────────────
-- Même principe que trace_fiche_historique (bien, proprietaire) : seules les colonnes modifiées ; les
-- colonnes passées en argument du trigger sont enregistrées « •••• » (on sait qu'elles ont changé, pas leur valeur).
create or replace function public.trace_fiche_historique_masque()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  n jsonb := to_jsonb(new);
  av jsonb := '{}'::jsonb; ap jsonb := '{}'::jsonb; k text;
  masques text[] := coalesce(tg_argv::text[], '{}');
  ignorees text[] := array['updated_at', 'updated_by', 'created_at', 'created_by', 'id', 'ordre'];
  m text := '••••';
begin
  for k in select jsonb_object_keys(n) loop
    if k = any(ignorees) then continue; end if;
    if (o -> k) is distinct from (n -> k) then
      if tg_op = 'INSERT' and (n -> k) in ('null'::jsonb, '[]'::jsonb, '""'::jsonb) then continue; end if;
      if tg_op <> 'INSERT' then av := av || jsonb_build_object(k, case when k = any(masques) and (o -> k) is not null and (o -> k) <> 'null'::jsonb then to_jsonb(m) else o -> k end); end if;
      ap := ap || jsonb_build_object(k, case when k = any(masques) and (n -> k) <> 'null'::jsonb then to_jsonb(m) else n -> k end);
    end if;
  end loop;
  if ap <> '{}'::jsonb then
    insert into fiche_historique (table_nom, fiche_id, avant, apres, auteur_id, auteur_email)
    values (tg_table_name, new.id, av, ap, auth.uid(),   -- avant = {} à la création
            nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email');
  end if;
  return new;
end $$;

drop trigger if exists trg_historique_bien_toolbox on public.bien_toolbox;
create trigger trg_historique_bien_toolbox after insert or update on public.bien_toolbox
  for each row execute function public.trace_fiche_historique_masque('code_entree', 'code_coffre', 'mdp_arrivee', 'lien_arrivee');
drop trigger if exists trg_historique_bien_particularite on public.bien_particularite;
create trigger trg_historique_bien_particularite after insert or update on public.bien_particularite
  for each row execute function public.trace_fiche_historique_masque('contenu', 'medias');

-- ── 6. Relevé des règles de messages Hospitable (lecture seule, sans les textes) ──────────────────────
create table if not exists public.hospitable_regle_message (
  id text primary key,                      -- UUID Hospitable
  nom text not null,
  actif boolean not null,
  evenement text not null,                  -- inquiry, accepted, checkin, checkout, review…
  delai text,                               -- timing_description (anglais, traduit à l'affichage)
  portee jsonb not null default '{}'::jsonb, -- scoping {all_properties, property_ids, all_platforms, platform_ids}
  balises text[] not null default '{}',     -- %%…%% utilisées dans les modèles (toutes langues)
  maj_hospitable timestamptz,
  releve_le timestamptz not null default now(),
  source text not null default 'api'        -- 'api' (PowerHouse) | 'mcp' (relevé manuel)
);
alter table public.hospitable_regle_message enable row level security;   -- service_role seul (aucune policy)

-- ── 7. Journal unique d'un bien ───────────────────────────────────────────────────────────────────────
-- Sources brutes ; le libellé est fait côté PowerHouse (api/bien-fiche-onglets.js). Jamais de valeur de code :
-- bien_custom_code_journal et bien_code_consultation ne stockent que la clé ; bien_toolbox masqué (§5).
create or replace function public.bien_historique(p_bien_id uuid, p_depuis timestamptz default now() - interval '12 months', p_limite integer default 600)
returns table (at timestamptz, source text, type text, cle text, avant jsonb, apres jsonb, texte text, par text, ref text)
language sql stable security definer set search_path = public as $$
  with tbx as (select id from bien_toolbox where bien_id = p_bien_id),
  ev as (
    -- Fiche du bien (PowerHouse ou synchro Hospitable)
    select fh.created_at as at, 'fiche_bien'::text as source, 'modification'::text as type, null::text as cle,
           fh.avant, fh.apres, null::text as texte,
           coalesce(split_part(fh.auteur_email, '@', 1), _nom_auth_user(fh.auteur_id), 'synchro') as par, fh.id::text as ref
      from fiche_historique fh where fh.table_nom = 'bien' and fh.fiche_id = p_bien_id and fh.created_at >= p_depuis
    union all
    select fh.created_at, 'fiche_ae', case when fh.avant = '{}'::jsonb then 'creation' else 'modification' end, null,
           fh.avant, fh.apres, null, coalesce(split_part(fh.auteur_email, '@', 1), _nom_auth_user(fh.auteur_id), 'système'), fh.id::text
      from fiche_historique fh where fh.table_nom = 'bien_toolbox' and fh.fiche_id in (select id from tbx) and fh.created_at >= p_depuis
    union all
    select fh.created_at, 'consigne', case when fh.avant = '{}'::jsonb then 'creation' else 'modification' end, null,
           fh.avant, fh.apres, bp.titre, coalesce(split_part(fh.auteur_email, '@', 1), _nom_auth_user(fh.auteur_id), 'système'), fh.id::text
      from fiche_historique fh join bien_particularite bp on bp.id = fh.fiche_id
     where fh.table_nom = 'bien_particularite' and bp.bien_id = p_bien_id and fh.created_at >= p_depuis
    union all
    -- Suggestions des AE (proposée, puis validée / refusée)
    select s.created_at, 'suggestion', 'proposee', null, null, null, left(s.texte, 300), coalesce(nullif(trim(a.prenom), ''), 'AE'), s.id::text
      from bien_consigne_suggestion s left join auto_entrepreneur a on a.id = s.ae_id
     where s.bien_id = p_bien_id and s.created_at >= p_depuis
    union all
    select s.traite_at, 'suggestion', s.statut, null, null, jsonb_build_object('motif', s.motif_refus), left(s.texte, 300), _nom_auth_user(s.traite_par), s.id::text
      from bien_consigne_suggestion s where s.bien_id = p_bien_id and s.traite_at is not null and s.traite_at >= p_depuis
    union all
    -- Tarification, frais, taxe, tags, réglages en masse
    select j.le, 'tarifs', j.operation, j.cle || coalesce('|' || j.canal, ''), j.avant, j.apres, j.lot_libelle, coalesce(split_part(j.par, '@', 1), 'système'), j.id::text
      from bien_tarification_journal j where j.bien_id = p_bien_id and j.le >= p_depuis
    union all
    -- Savoir
    select j.at, 'savoir', j.action, null, null, null, coalesce(j.apres ->> 'titre', left(j.apres ->> 'contenu_fr', 120), left(j.avant ->> 'contenu_fr', 120)),
           coalesce(_nom_auth_user(j.par), 'système'), j.id::text
      from bien_savoir_journal j where j.bien_id = p_bien_id and j.at >= p_depuis
    union all
    -- Codes Hospitable : changement vu par la synchro (clé seulement) et affichages dans PowerHouse
    select j.at, 'codes', j.action, j.code_key, null, null, null, 'synchro Hospitable', j.id::text
      from bien_custom_code_journal j where j.bien_id = p_bien_id and j.at >= p_depuis
    union all
    select c.at, 'code_affiche', 'affichage', c.code_key, null, null, null, coalesce(_nom_auth_user(c.par), '?'), c.id::text
      from bien_code_consultation c where c.bien_id = p_bien_id and c.at >= p_depuis
    union all
    -- Tickets techniques (ouverture / résolution) et signalements voyageurs
    select t.created_at, 'ticket', 'ouvert', t.priority, null, null, t.title, coalesce(t.reported_by, 'staff'), t.id::text
      from tech_issues t where t.bien_id = p_bien_id and t.created_at >= p_depuis
    union all
    select (t.resolved_at::timestamp + time '12:00') at time zone 'Europe/Paris', 'ticket', 'resolu', t.priority, null, null, t.title, coalesce(t.assigned_to, 'staff'), t.id::text
      from tech_issues t where t.bien_id = p_bien_id and t.resolved_at is not null and t.resolved_at >= p_depuis::date
    union all
    select sg.created_at, 'signalement', sg.type, sg.status, null, null, left(sg.description, 200), coalesce(sg.created_by_name, 'staff'), sg.id::text
      from signalements sg where sg.bien_id in (select id from tbx) and sg.created_at >= p_depuis
    union all
    -- Missions : gestes du bureau (vérification, réattribution, durée validée…) et contrôles « à reprendre »
    select j.created_at, 'mission', j.type, (select mm.date_mission::text from mission_menage mm where mm.id = j.mission_id), j.avant, j.apres, j.texte,
           coalesce(j.auteur_nom, _nom_auth_user(j.auteur_id), 'système'), j.id::text
      from mission_journal j where j.bien_id = p_bien_id and j.created_at >= p_depuis and j.type not in ('ecart_ignore')
    union all
    select mt.controle_at, 'controle', mt.controle_statut, mm.date_mission::text, null, null, mt.controle_note,
           coalesce(_nom_auth_user(mt.controle_par), 'bureau'), mt.mission_id::text
      from mission_terrain mt join mission_menage mm on mm.id = mt.mission_id
     where mt.bien_id = p_bien_id and mt.controle_statut = 'a_reprendre' and mt.controle_at >= p_depuis
       and not exists (select 1 from mission_journal j where j.mission_id = mt.mission_id and j.type = 'verification')
    union all
    -- Mandat de gestion (par bien) et lien d'onboarding
    select ms.created_at, 'mandat', 'cree', ms.numero, null, null, null, 'bureau', ms.id::text from mandat_signature ms where ms.bien_id = p_bien_id and ms.created_at >= p_depuis
    union all
    select ms.sent_at, 'mandat', 'envoye', ms.numero, null, null, null, 'bureau', ms.id::text from mandat_signature ms where ms.bien_id = p_bien_id and ms.sent_at >= p_depuis
    union all
    select ms.signed_at, 'mandat', 'signe', ms.numero, null, null, null, 'propriétaire', ms.id::text from mandat_signature ms where ms.bien_id = p_bien_id and ms.signed_at >= p_depuis
    union all
    select ms.refused_at, 'mandat', 'refuse', ms.numero, null, null, null, 'propriétaire', ms.id::text from mandat_signature ms where ms.bien_id = p_bien_id and ms.refused_at >= p_depuis
    union all
    select ml.sent_at, 'mandat_lien', 'envoye', null, null, null, null, coalesce(_nom_auth_user(ml.created_by), 'bureau'), ml.id::text from mandat_lien ml where ml.bien_id = p_bien_id and ml.sent_at >= p_depuis
    union all
    select ml.completed_at, 'mandat_lien', 'complete', null, null, null, null, 'propriétaire', ml.id::text from mandat_lien ml where ml.bien_id = p_bien_id and ml.completed_at >= p_depuis
    union all
    -- Calendrier : blocages / déblocages faits depuis PowerHouse
    select d.created_at, 'calendrier', d.action, d.date_debut::text || '|' || coalesce(d.date_fin::text, ''), null, null, d.motif, coalesce(d.acteur_label, _nom_auth_user(d.acteur), 'staff'), d.id::text
      from dispo_action_log d where d.bien_id = p_bien_id and d.created_at >= p_depuis and coalesce(d.ok, true)
  )
  select * from ev where at is not null order by at desc limit greatest(1, least(coalesce(p_limite, 600), 2000));
$$;
revoke all on function public.bien_historique(uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.bien_historique(uuid, timestamptz, integer) to service_role;
