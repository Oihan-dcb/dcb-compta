-- 471 — OPTIONS DU PORTAIL : VENTILATION IMMÉDIATE + CONTRÔLE À LA CLÔTURE (17/10/2026, Oïhan « oui »). Suite de 463 / 468.
--
-- Trou fermé : une option payée (ou remboursée) n'entrait en compta qu'au recalcul de NUIT ; si le mois du séjour était
-- figé entre-temps, elle restait hors compta.
--   1. À LA SOURCE : dès qu'une option change reservation.options_portail (paiement / remboursement), le trigger 463 demande
--      tout de suite le recalcul du mois du séjour à la fonction ventilation-auto (pg_net, même moteur, même verrou par
--      bien, idempotent) — seulement si le mois n'est pas figé pour le bien (sinon c'est la régularisation 468).
--   2. TÉMOIN : reservation.options_compta_centimes = montant TTC des options du portail contenu dans la ventilation du
--      séjour, mis à jour à chaque écriture du moteur (ligne calcul_source 'auto') et par les ajouts ci-dessous.
--   3. CONTRÔLE À LA CLÔTURE (cloture_bien activée, clôture comptable ventilation / facturation de l'agence, facture
--      honoraires envoyée) : pour chaque séjour du mois, manquant = options payées non remboursées − témoin − régularisations
--      468 déjà posées. ≠ 0 → ligne PVOY « Options du portail (ajout à la clôture) » posée DANS le mois concerné, AVANT le
--      gel (trigger BEFORE) ; si le mois est déjà gelé (verrou COM, cloture_bien) → régularisation 468 dans le premier mois
--      ouvert. Les deux sont tracées dans portail_option_regul (sens « cloture ») → alerte Accueil › À faire › Vérifier.
-- Aucun effet sur HON / LOY / VIRProprio : uniquement des lignes PVOY (part agence).

alter table public.reservation add column if not exists options_compta_centimes integer not null default 0;
comment on column public.reservation.options_compta_centimes is '471 : montant TTC des options du portail contenu dans la ventilation du séjour (témoin pour le contrôle à la clôture).';

alter table public.portail_option_regul drop constraint if exists portail_option_regul_sens_check;
alter table public.portail_option_regul add constraint portail_option_regul_sens_check check (sens in ('paiement', 'remboursement', 'cloture'));

create or replace function public.options_portail_somme(p_opts jsonb) returns integer language sql immutable as $$
  select coalesce(sum((o->>'montant')::int), 0)::int from jsonb_array_elements(coalesce(p_opts, '[]'::jsonb)) o
$$;

-- ── 2. Témoin mis à jour par le moteur ────────────────────────────────────────────────────────────────────────────
create or replace function public.trg_ventilation_temoin_options() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.calcul_source = 'auto' and new.reservation_id is not null then
    update reservation set options_compta_centimes = options_portail_somme(options_portail)
     where id = new.reservation_id and options_compta_centimes is distinct from options_portail_somme(options_portail);
  end if;
  return null;
end $$;
drop trigger if exists trg_ventilation_temoin_options on public.ventilation;
create trigger trg_ventilation_temoin_options after insert on public.ventilation for each row execute function public.trg_ventilation_temoin_options();

-- ── 1. Recalcul immédiat (pg_net → ventilation-auto, mois du séjour) ──────────────────────────────────────────────
create or replace function public.ventilation_demander_mois(p_mois text, p_agence text) returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare v_url text; v_key text;
begin
  if p_mois is null then return null; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'SUPABASE_URL';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY';
  if v_url is null or v_key is null then return null; end if;
  return net.http_post(url := v_url || '/functions/v1/ventilation-auto', body := jsonb_build_object('mois', p_mois, 'agence', coalesce(p_agence, 'dcb')),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key), timeout_milliseconds := 30000);
end $$;
revoke all on function public.ventilation_demander_mois(text, text) from public, anon, authenticated;

-- ── 3. Contrôle à la clôture ──────────────────────────────────────────────────────────────────────────────────────
-- p_dans_mois : true = le gel n'est pas encore posé (trigger BEFORE) → ajout dans le mois ; repli régularisation si refusé.
create or replace function public.portail_options_controle_cloture(p_bien uuid, p_mois text, p_source text) returns integer
language plpgsql security definer set search_path = public as $$
declare r record; v_manque int; v_regul int; v_m text; v_vid uuid; v_err text; n int := 0; v_lib text; v_ligne int;
begin
  for r in select rr.id, rr.code, rr.bien_id, rr.mois_comptable, rr.options_portail, rr.options_compta_centimes, b.proprietaire_id
             from reservation rr join bien b on b.id = rr.bien_id
            where rr.bien_id = p_bien and rr.mois_comptable = p_mois and not coalesce(rr.ventilation_manuelle, false)
              and (rr.options_portail is not null or rr.options_compta_centimes <> 0)
  loop
    select coalesce(sum(montant_centimes), 0) into v_regul from portail_option_regul where reservation_id = r.id and ventilation_id is not null and mois_regul is distinct from p_mois;
    v_manque := options_portail_somme(r.options_portail) - r.options_compta_centimes - v_regul;
    if v_manque = 0 then continue; end if;
    v_vid := null; v_err := null; v_m := p_mois;
    v_lib := left('Options du portail (ajout à la clôture, ' || p_source || ') : ' || coalesce((select string_agg(o->>'libelle', ', ') from jsonb_array_elements(r.options_portail) o), 'remboursement'), 200);
    begin
      insert into ventilation (reservation_id, bien_id, proprietaire_id, code, libelle, montant_ht, taux_tva, montant_tva, montant_ttc, mois_comptable, calcul_source, note)
      values (r.id, r.bien_id, r.proprietaire_id, 'PVOY', v_lib, round(v_manque / 1.2)::int, 20, v_manque - round(v_manque / 1.2)::int, v_manque, p_mois, 'manual', 'Contrôle à la clôture 471')
      returning id into v_vid;
    exception when others then
      -- mois déjà gelé (verrou COM / cloture_bien) → premier mois ouvert (468)
      v_m := mois_ouvert_regul(r.bien_id, greatest(to_char(now() at time zone 'Europe/Paris', 'YYYY-MM'), p_mois));
      if v_m is null or v_m = p_mois then v_err := 'aucun mois ouvert : ' || sqlerrm; v_m := null;
      else
        begin
          insert into ventilation (reservation_id, bien_id, proprietaire_id, code, libelle, montant_ht, taux_tva, montant_tva, montant_ttc, mois_comptable, calcul_source, note)
          values (r.id, r.bien_id, r.proprietaire_id, 'PVOY', left('Régularisation portail — ' || v_lib || ' (séjour ' || coalesce(r.code, '') || ' de ' || p_mois || ')', 200),
                  round(v_manque / 1.2)::int, 20, v_manque - round(v_manque / 1.2)::int, v_manque, v_m, 'manual', 'Contrôle à la clôture 471 → régularisation')
          returning id into v_vid;
        exception when others then v_err := sqlerrm; v_m := null;
        end;
      end if;
    end;
    if v_vid is not null and v_m = p_mois then
      update reservation set options_compta_centimes = options_compta_centimes + v_manque where id = r.id;
    end if;
    select coalesce(max(ligne), -1) + 1 into v_ligne from portail_option_regul where commande_id = r.id and sens = 'cloture';
    insert into portail_option_regul (commande_id, ligne, sens, reservation_id, bien_id, libelle, montant_centimes, mois_sejour, mois_regul, ventilation_id, erreur)
    values (r.id, v_ligne, 'cloture', r.id, r.bien_id, v_lib, v_manque, p_mois, v_m, v_vid, v_err);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.portail_options_controle_cloture(uuid, text, text) from public, anon, authenticated;

-- Déclencheurs de clôture (BEFORE : le gel n'est pas encore en base quand on ajoute la ligne).
create or replace function public.trg_cloture_bien_options() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.active and (tg_op = 'INSERT' or not coalesce(old.active, false)) and new.bien_id is not null then
    perform portail_options_controle_cloture(new.bien_id, new.mois, 'clôture du bien');
  end if;
  return new;
end $$;
drop trigger if exists trg_cloture_bien_options on public.cloture_bien;
create trigger trg_cloture_bien_options before insert or update of active on public.cloture_bien for each row execute function public.trg_cloture_bien_options();

create or replace function public.trg_cloture_comptable_options() returns trigger language plpgsql security definer set search_path = public as $$
declare b record;
begin
  if (new.cloture_ventil is not null and (tg_op = 'INSERT' or old.cloture_ventil is null))
     or (new.cloture_facturat is not null and (tg_op = 'INSERT' or old.cloture_facturat is null)) then
    for b in select distinct r.bien_id from reservation r join bien bb on bb.id = r.bien_id
              where r.mois_comptable = new.mois and coalesce(bb.agence, 'dcb') = new.agence and (r.options_portail is not null or r.options_compta_centimes <> 0)
    loop perform portail_options_controle_cloture(b.bien_id, new.mois, 'clôture comptable'); end loop;
  end if;
  return new;
end $$;
drop trigger if exists trg_cloture_comptable_options on public.cloture_comptable;
create trigger trg_cloture_comptable_options before insert or update of cloture_ventil, cloture_facturat on public.cloture_comptable for each row execute function public.trg_cloture_comptable_options();

create or replace function public.trg_facture_honoraires_options() returns trigger language plpgsql security definer set search_path = public as $$
declare b record;
begin
  if new.type_facture = 'honoraires' and new.statut = 'envoye_evoliz' and (tg_op = 'INSERT' or old.statut is distinct from 'envoye_evoliz') then
    for b in select distinct r.bien_id from reservation r join bien bb on bb.id = r.bien_id
              where r.mois_comptable = new.mois and (r.options_portail is not null or r.options_compta_centimes <> 0)
                and (bb.id = new.bien_id
                     or (new.bien_id is null and bb.proprietaire_id = new.proprietaire_id)
                     or (bb.groupe_facturation is not null and exists (select 1 from bien g where g.id = new.bien_id and g.proprietaire_id = bb.proprietaire_id and g.groupe_facturation = bb.groupe_facturation)))
    loop perform portail_options_controle_cloture(b.bien_id, new.mois, 'facture honoraires envoyée'); end loop;
  end if;
  return new;
end $$;
drop trigger if exists trg_facture_honoraires_options on public.facture_evoliz;
create trigger trg_facture_honoraires_options before insert or update of statut on public.facture_evoliz for each row execute function public.trg_facture_honoraires_options();

-- ── Trigger 463/468 : + recalcul immédiat quand les options changent (mois non figé) ───────────────────────────────
create or replace function public.portail_commande_vers_reservation() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_resa uuid := coalesce(new.reservation_id, old.reservation_id);
  v_opts jsonb;
  payes text[] := array['payee', 'a_verifier', 'remboursee_partiel', 'remboursee', 'effet_en_cours'];
  i int;
  nl jsonb; ol jsonb;
  etait_paye boolean; est_paye boolean;
  r record;
begin
  if v_resa is null then return null; end if;
  select jsonb_agg(jsonb_build_object('libelle', coalesce(l->>'libelle', 'Option voyageur'), 'montant', (l->>'montant_centimes')::int, 'commande_id', c.id) order by c.cree_le, l->>'libelle')
    into v_opts
    from public.portail_voyageur_commande c, jsonb_array_elements(c.lignes) l
   where c.reservation_id = v_resa and c.essai = false and c.paiement_mode = 'stripe'
     and c.statut in ('payee', 'a_verifier', 'remboursee_partiel', 'effet_en_cours')
     and coalesce((l->>'montant_centimes')::int, 0) > 0 and (l->>'rembourse_le') is null;
  update public.reservation set options_portail = v_opts, ventilation_calculee = false
   where id = v_resa and options_portail is distinct from v_opts
   returning id, bien_id, mois_comptable into r;
  -- 471 : recalcul immédiat du mois du séjour (sinon la nuit) — seulement s'il n'est pas figé pour le bien.
  if r.id is not null and r.mois_comptable is not null and not bien_mois_fige(r.bien_id, r.mois_comptable) then
    begin perform ventilation_demander_mois(r.mois_comptable, (select coalesce(agence, 'dcb') from bien where id = r.bien_id));
    exception when others then null; end;
  end if;
  -- 468 : régularisation après clôture (paiement / remboursement de CHAQUE ligne, une seule fois).
  if tg_op <> 'DELETE' and new.essai = false and new.paiement_mode = 'stripe' then
    est_paye := new.statut = any(payes);
    etait_paye := tg_op = 'UPDATE' and old.essai = false and old.paiement_mode = 'stripe' and old.statut = any(payes);
    for i in 0 .. coalesce(jsonb_array_length(new.lignes), 0) - 1 loop
      nl := new.lignes -> i;
      ol := case when tg_op = 'UPDATE' then old.lignes -> i end;
      if coalesce((nl->>'montant_centimes')::int, 0) <= 0 then continue; end if;
      if est_paye and not etait_paye then
        perform portail_option_regulariser(new, i, 'paiement', coalesce(new.paye_le, now()));
      end if;
      if (nl->>'rembourse_le') is not null and (ol is null or (ol->>'rembourse_le') is null) then
        perform portail_option_regulariser(new, i, 'remboursement', coalesce((nl->>'rembourse_le')::timestamptz, now()));
      end if;
    end loop;
  end if;
  return null;
end $$;
