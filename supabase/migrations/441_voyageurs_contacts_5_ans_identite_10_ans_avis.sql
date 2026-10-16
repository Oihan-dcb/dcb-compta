-- 441 — Données voyageurs des réservations et avis (décisions d'Oïhan 16/10/2026), branchées sur l'anonymisation
-- nocturne existante (PowerHouse /api/ga-anonymize, 438) : nouvelle fonction anon_voyageurs_executer(jour, dry, limite)
-- appelée juste après anon_conversations_executer ; même journal (anonymisation_journal), mêmes marqueurs.
--
-- A. Réservations (table comptable `reservation`, source de la fiche / de l'historique voyageur de PowerHouse) :
--    • « Même voyageur » = même e-mail (insensible à la casse) OU même téléphone (9 derniers chiffres) — le critère de
--      l'historique voyageur (PowerHouse api/guest-context.js) — et, pour la règle des 10 ans (une fois e-mail et
--      téléphone effacés), même nom complet (au moins deux mots, sans accents ni casse).
--    • Dernier séjour = la plus tardive des dates de départ des réservations du voyageur (hors annulées / refusées) ;
--      le compteur repart à chaque nouveau séjour.
--    • Dernier séjour + 5 ans → e-mail et téléphone effacés (guest_email, guest_phone, et dans hospitable_raw :
--      guest.email, guest.phone_numbers, guest.profile_picture, user.email) ; contact_efface_le.
--    • Dernier séjour + 10 ans → nom remplacé par « Voyageur », ville effacée, objet guest de hospitable_raw retiré
--      (langue et pays gardés pour les statistiques), nom retiré des lignes de versement (Airbnb / Booking / Stripe) et
--      des réservations d'équipement et des messages du journal des opérations ; identite_anonymisee_le.
--    • Ne changent JAMAIS : id, code, hospitable_id, dates, logement, montants, statuts, ventilation, factures,
--      rapprochements (reservation_paiement / mouvements). Séjours propriétaires (owner_stay) : hors périmètre.
-- B. Avis (`reservation_review`) : fin du séjour (à défaut date de l'avis) + 5 ans → nom de l'auteur « Voyageur »,
--    retour privé supprimé, commentaire public et réponse gardés mais passés par anon_texte (noms, e-mails,
--    téléphones…) ; note, notes détaillées, date, logement, plateforme conservés sans limite ; anonymise_le.
-- Garde-fous : un déclencheur empêche une resynchronisation (webhook Hospitable, sync-reviews) de réécrire les données
-- effacées. Simulation : p_dry = true (comptes seulement). Journal : anonymisation_journal (comptes, aucune donnée).

create or replace function public.anon_delai_contact_voyageur() returns interval language sql immutable as $$ select interval '5 years' $$;
create or replace function public.anon_delai_identite_voyageur() returns interval language sql immutable as $$ select interval '10 years' $$;
create or replace function public.anon_delai_avis_identite() returns interval language sql immutable as $$ select interval '5 years' $$;

alter table public.reservation add column if not exists contact_efface_le timestamptz;
alter table public.reservation add column if not exists identite_anonymisee_le timestamptz;
alter table public.reservation_review add column if not exists anonymise_le timestamptz;
alter table public.airbnb_payout_line add column if not exists anonymise_le timestamptz;
alter table public.booking_payout_line add column if not exists anonymise_le timestamptz;
alter table public.stripe_payout_line add column if not exists anonymise_le timestamptz;
alter table public.equipment_bookings add column if not exists anonymise_le timestamptz;

-- Clés de rapprochement (normalisées).
create or replace function public.voyageur_cle_email(p text) returns text language sql immutable as $$
  select nullif(lower(trim(p)), '') where p ~ '@'
$$;
create or replace function public.voyageur_cle_tel(p text) returns text language sql immutable as $$
  select case when length(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g')) >= 8
              then right(regexp_replace(p, '[^0-9]', '', 'g'), 9) end
$$;
create or replace function public.voyageur_cle_nom(p text) returns text language sql stable set search_path = public, extensions as $$
  select case when p is not null and lower(trim(p)) <> 'voyageur' and array_length(regexp_split_to_array(trim(p), '\s+'), 1) >= 2
              then lower(unaccent(regexp_replace(trim(p), '\s+', ' ', 'g'))) end
$$;

-- Dernier séjour de chaque réservation voyageur (au sens « même voyageur » ci-dessus).
create or replace function public.voyageur_derniers_sejours()
returns table (reservation_id uuid, dernier_contact date, dernier_identite date)
language sql stable security definer set search_path = public, extensions as $$
  with r as (
    select id, departure_date as dep,
           voyageur_cle_email(guest_email) as ce, voyageur_cle_tel(guest_phone) as ct, voyageur_cle_nom(guest_name) as cn,
           coalesce(final_status, '') !~* '(cancel|not accepted|declined|expired|deleted|voided)' as sejour
      from reservation
     where not coalesce(owner_stay, false) and departure_date is not null
  ),
  par_email as (select ce, max(dep) as d from r where sejour and ce is not null group by ce),
  par_tel   as (select ct, max(dep) as d from r where sejour and ct is not null group by ct),
  par_nom   as (select cn, max(dep) as d from r where sejour and cn is not null group by cn)
  select r.id,
         greatest(r.dep, coalesce(pe.d, r.dep), coalesce(pt.d, r.dep)),
         greatest(r.dep, coalesce(pe.d, r.dep), coalesce(pt.d, r.dep), coalesce(pn.d, r.dep))
    from r
    left join par_email pe on pe.ce = r.ce
    left join par_tel pt on pt.ct = r.ct
    left join par_nom pn on pn.cn = r.cn;
$$;

-- Garde-fous contre la resynchronisation.
create or replace function public.trg_reservation_anonymisee() returns trigger language plpgsql as $$
begin
  if old.contact_efface_le is not null then
    new.contact_efface_le := old.contact_efface_le;
    new.guest_email := null; new.guest_phone := null;
    if new.hospitable_raw is not null then
      new.hospitable_raw := new.hospitable_raw #- '{guest,email}' #- '{guest,phone_numbers}' #- '{guest,phone}' #- '{guest,profile_picture}' #- '{user,email}';
    end if;
  end if;
  if old.identite_anonymisee_le is not null then
    new.identite_anonymisee_le := old.identite_anonymisee_le;
    new.guest_name := 'Voyageur'; new.guest_city := null;
    if new.hospitable_raw is not null then new.hospitable_raw := new.hospitable_raw #- '{guest}' #- '{user}'; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_reservation_anonymisee on public.reservation;
create trigger trg_reservation_anonymisee before update on public.reservation
  for each row when (old.contact_efface_le is not null or old.identite_anonymisee_le is not null)
  execute function public.trg_reservation_anonymisee();

create or replace function public.trg_review_anonymise() returns trigger language plpgsql set search_path = public, extensions as $$
begin
  new.anonymise_le := old.anonymise_le;
  new.reviewer_name := 'Voyageur';
  new.private_feedback := null;
  new.comment := old.comment;
  new.reponse := case when new.reponse is distinct from old.reponse and new.reponse is not null
                      then anon_texte(new.reponse, '{}') else old.reponse end;
  return new;
end $$;
drop trigger if exists trg_review_anonymise on public.reservation_review;
create trigger trg_review_anonymise before update on public.reservation_review
  for each row when (old.anonymise_le is not null) execute function public.trg_review_anonymise();

-- Exécution (ou simulation). Lots de p_limite lignes par règle.
create or replace function public.anon_voyageurs_executer(p_jour date default current_date, p_dry boolean default true, p_limite int default 1000)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  nb int; out jsonb := jsonb_build_object('jour', p_jour, 'simulation', p_dry);
  d5 interval := anon_delai_contact_voyageur(); d10 interval := anon_delai_identite_voyageur(); da interval := anon_delai_avis_identite();
  ids uuid[];
begin
  if not p_dry and p_jour > current_date then
    raise exception 'anonymisation réelle impossible pour une date future (%), simulation seulement', p_jour;
  end if;
  perform set_config('dcb.anonymisation', '1', true);

  -- ── A1. Contacts (e-mail, téléphone) : dernier séjour + 5 ans ──
  select coalesce(array_agg(id), '{}') into ids from (
    select r.id from reservation r join voyageur_derniers_sejours() d on d.reservation_id = r.id
     where r.contact_efface_le is null and not coalesce(r.owner_stay, false)
       and (d.dernier_contact + d5)::date < p_jour
       and (nullif(trim(r.guest_email), '') is not null or nullif(trim(r.guest_phone), '') is not null
            or r.hospitable_raw ? 'guest' or r.hospitable_raw ? 'user')
     order by d.dernier_contact, r.id limit p_limite) x;
  nb := coalesce(array_length(ids, 1), 0);
  if not p_dry and nb > 0 then
    update reservation set guest_email = null, guest_phone = null, contact_efface_le = now(),
           hospitable_raw = case when hospitable_raw is null then null else
             hospitable_raw #- '{guest,email}' #- '{guest,phone_numbers}' #- '{guest,phone}' #- '{guest,profile_picture}' #- '{user,email}' end
     where id = any(ids);
  end if;
  if nb > 0 and p_jour <= current_date then
    insert into anonymisation_journal (jour, simulation, regle, table_name, nb_lignes) values (p_jour, p_dry, 'voyageur_contact_5_ans', 'reservation', nb);
  end if;
  out := out || jsonb_build_object('contacts_effaces', nb);

  -- ── A2. Identité (nom, ville, objet guest) : dernier séjour + 10 ans ──
  select coalesce(array_agg(id), '{}') into ids from (
    select r.id from reservation r join voyageur_derniers_sejours() d on d.reservation_id = r.id
     where r.identite_anonymisee_le is null and not coalesce(r.owner_stay, false)
       and (d.dernier_identite + d10)::date < p_jour
     order by d.dernier_identite, r.id limit p_limite) x;
  nb := coalesce(array_length(ids, 1), 0);
  if not p_dry and nb > 0 then
    -- Journal des opérations : « Réservation créée : <code> — <nom> » → nom retiré (le reste du journal est inchangé).
    update journal_ops j set message = replace(j.message, r.guest_name, 'Voyageur')
      from reservation r
     where r.id = any(ids) and j.reservation_id = r.id and length(coalesce(r.guest_name, '')) >= 2
       and strpos(j.message, r.guest_name) > 0;
    update reservation set guest_name = 'Voyageur', guest_city = null, guest_email = null, guest_phone = null,
           contact_efface_le = coalesce(contact_efface_le, now()), identite_anonymisee_le = now(),
           hospitable_raw = case when hospitable_raw is null then null else hospitable_raw #- '{guest}' #- '{user}' end
     where id = any(ids);
  end if;
  if nb > 0 and p_jour <= current_date then
    insert into anonymisation_journal (jour, simulation, regle, table_name, nb_lignes) values (p_jour, p_dry, 'voyageur_identite_10_ans', 'reservation', nb);
  end if;
  out := out || jsonb_build_object('identites_anonymisees', nb);

  -- Lignes de versement et réservations d'équipement : nom retiré quand la réservation liée est anonymisée
  -- (ou, sans réservation retrouvée, 10 ans après le séjour / le versement).
  if p_dry then
    select count(*) into nb from airbnb_payout_line l where l.anonymise_le is null and nullif(l.guest_name, '') is not null
       and (exists (select 1 from reservation r where r.code = l.confirmation_code and r.identite_anonymisee_le is not null)
            or (not exists (select 1 from reservation r where r.code = l.confirmation_code)
                and (coalesce(l.checkout, l.payout_date, l.created_at::date) + d10)::date < p_jour));
  else
    update airbnb_payout_line l set guest_name = 'Voyageur', anonymise_le = now()
     where l.anonymise_le is null and nullif(l.guest_name, '') is not null
       and (exists (select 1 from reservation r where r.code = l.confirmation_code and r.identite_anonymisee_le is not null)
            or (not exists (select 1 from reservation r where r.code = l.confirmation_code)
                and (coalesce(l.checkout, l.payout_date, l.created_at::date) + d10)::date < p_jour));
    get diagnostics nb = row_count;
  end if;
  if nb > 0 and p_jour <= current_date then insert into anonymisation_journal (jour, simulation, regle, table_name, nb_lignes) values (p_jour, p_dry, 'voyageur_identite_10_ans', 'airbnb_payout_line', nb); end if;
  out := out || jsonb_build_object('versements_airbnb', nb);

  if p_dry then
    select count(*) into nb from booking_payout_line l where l.anonymise_le is null and nullif(l.guest_name, '') is not null
       and (exists (select 1 from reservation r where r.code = l.booking_ref and r.identite_anonymisee_le is not null)
            or (not exists (select 1 from reservation r where r.code = l.booking_ref)
                and (coalesce(l.checkout, l.payout_date, l.inserted_at::date) + d10)::date < p_jour));
  else
    update booking_payout_line l set guest_name = 'Voyageur', anonymise_le = now()
     where l.anonymise_le is null and nullif(l.guest_name, '') is not null
       and (exists (select 1 from reservation r where r.code = l.booking_ref and r.identite_anonymisee_le is not null)
            or (not exists (select 1 from reservation r where r.code = l.booking_ref)
                and (coalesce(l.checkout, l.payout_date, l.inserted_at::date) + d10)::date < p_jour));
    get diagnostics nb = row_count;
  end if;
  if nb > 0 and p_jour <= current_date then insert into anonymisation_journal (jour, simulation, regle, table_name, nb_lignes) values (p_jour, p_dry, 'voyageur_identite_10_ans', 'booking_payout_line', nb); end if;
  out := out || jsonb_build_object('versements_booking', nb);

  if p_dry then
    select count(*) into nb from stripe_payout_line l where l.anonymise_le is null and nullif(l.guest_name, '') is not null
       and (exists (select 1 from reservation r where r.code = l.reservation_code and r.identite_anonymisee_le is not null)
            or (not exists (select 1 from reservation r where r.code = l.reservation_code)
                and (l.created_at::date + d10)::date < p_jour));
  else
    update stripe_payout_line l set guest_name = 'Voyageur', anonymise_le = now()
     where l.anonymise_le is null and nullif(l.guest_name, '') is not null
       and (exists (select 1 from reservation r where r.code = l.reservation_code and r.identite_anonymisee_le is not null)
            or (not exists (select 1 from reservation r where r.code = l.reservation_code)
                and (l.created_at::date + d10)::date < p_jour));
    get diagnostics nb = row_count;
  end if;
  if nb > 0 and p_jour <= current_date then insert into anonymisation_journal (jour, simulation, regle, table_name, nb_lignes) values (p_jour, p_dry, 'voyageur_identite_10_ans', 'stripe_payout_line', nb); end if;
  out := out || jsonb_build_object('versements_stripe', nb);

  if p_dry then
    select count(*) into nb from equipment_bookings e where e.anonymise_le is null and nullif(e.guest_name, '') is not null
       and (exists (select 1 from reservation r where r.hospitable_id = e.hospitable_resa_id and r.identite_anonymisee_le is not null)
            or (e.hospitable_resa_id is null and (e.date_fin + d10)::date < p_jour));
  else
    update equipment_bookings e set guest_name = 'Voyageur', anonymise_le = now()
     where e.anonymise_le is null and nullif(e.guest_name, '') is not null
       and (exists (select 1 from reservation r where r.hospitable_id = e.hospitable_resa_id and r.identite_anonymisee_le is not null)
            or (e.hospitable_resa_id is null and (e.date_fin + d10)::date < p_jour));
    get diagnostics nb = row_count;
  end if;
  if nb > 0 and p_jour <= current_date then insert into anonymisation_journal (jour, simulation, regle, table_name, nb_lignes) values (p_jour, p_dry, 'voyageur_identite_10_ans', 'equipment_bookings', nb); end if;
  out := out || jsonb_build_object('equipements', nb);

  -- ── B. Avis : fin du séjour (à défaut date de l'avis) + 5 ans ──
  select coalesce(array_agg(id), '{}') into ids from (
    select v.id from reservation_review v left join reservation r on r.id = v.reservation_id
     where v.anonymise_le is null
       and (coalesce(r.departure_date, v.submitted_at::date, v.created_at::date) + da)::date < p_jour
     order by coalesce(r.departure_date, v.submitted_at::date, v.created_at::date), v.id limit p_limite) x;
  nb := coalesce(array_length(ids, 1), 0);
  if not p_dry and nb > 0 then
    update reservation_review v set
           comment  = anon_texte(v.comment, array_remove(array[v.reviewer_name, r.guest_name], null)),
           reponse  = anon_texte(v.reponse, array_remove(array[v.reviewer_name, r.guest_name], null)),
           reviewer_name = 'Voyageur', private_feedback = null, anonymise_le = now()
      from (select v2.id, r2.guest_name from reservation_review v2 left join reservation r2 on r2.id = v2.reservation_id where v2.id = any(ids)) r
     where v.id = r.id;
  end if;
  if nb > 0 and p_jour <= current_date then
    insert into anonymisation_journal (jour, simulation, regle, table_name, nb_lignes) values (p_jour, p_dry, 'avis_identite_5_ans', 'reservation_review', nb);
  end if;
  out := out || jsonb_build_object('avis_anonymises', nb);

  return out;
end $$;
alter function public.anon_voyageurs_executer(date, boolean, int) set statement_timeout = '280s';

do $$
declare f text;
begin
  foreach f in array array['anon_voyageurs_executer(date,boolean,integer)', 'voyageur_derniers_sejours()']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
comment on function public.anon_voyageurs_executer(date, boolean, int) is
  'Voyageurs : e-mail/téléphone effacés 5 ans après le dernier séjour, nom anonymisé 10 ans après ; avis : nom + retour privé retirés 5 ans après le séjour (441). Appelée chaque nuit par PowerHouse /api/ga-anonymize après anon_conversations_executer.';
