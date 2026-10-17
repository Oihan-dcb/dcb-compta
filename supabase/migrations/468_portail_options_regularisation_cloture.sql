-- 468 — OPTIONS DU PORTAIL PAYÉES / REMBOURSÉES APRÈS CLÔTURE : régularisation PVOY automatique (17/10/2026, Oïhan,
-- « alternative A »). Suite de 463 / 467.
--
-- Cas : le séjour est rattaché au mois M (mois_comptable = mois d'arrivée). Si M est FIGÉ pour le bien au moment où une
-- option du portail est payée (ou remboursée), la ventilation de M ne se recalcule plus (verrou facture / clôture) : la
-- ligne PVOY n'y entrerait jamais. Alors, au moment même du paiement / remboursement :
--   - une ligne de ventilation PVOY « Régularisation portail » (+ montant payé / − montant remboursé, TVA 20 %) est créée
--     sur le SÉJOUR (reservation_id) dans le PREMIER MOIS OUVERT du bien à partir du mois du paiement (jamais avant M) :
--     elle part sur la facture COM de ce mois (ligne « Prestations voyageurs »), comme toute PVOY ;
--   - une ligne portail_option_regul la trace (une par commande × ligne × sens, idempotent) → alerte dans PowerHouse
--     (Accueil › À faire › Vérifier) jusqu'à « vu ».
-- Aucun effet sur LOY / VIRProprio / rapports propriétaires : seule une ligne PVOY (part agence) est ajoutée — les rapports
-- propriétaires ne lisent pas PVOY (buildRapportData : HON, LOY, VIR, FMEN, AUTO, MEN, HAOWNER).
-- Mois FIGÉ (même règle que api/ventiler.js biensVerrouilles + verrou COM I-132) : cloture_bien active, OU facture
-- honoraires envoyée qui couvre le bien (son bien_id, son groupe de facturation, ou facture sans bien du propriétaire),
-- OU clôture comptable de l'agence (ventilation ou facturation COM). Mois OUVERT pour la régularisation : ni cloture_bien
-- active, ni clôture comptable (ventilation / facturation) de l'agence.

create or replace function public.bien_mois_fige(p_bien uuid, p_mois text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_mois is not null and (
    exists (select 1 from cloture_bien c where c.bien_id = p_bien and c.mois = p_mois and c.active)
    or exists (select 1 from facture_evoliz f join bien b on b.id = p_bien
                where f.mois = p_mois and f.type_facture = 'honoraires' and f.statut = 'envoye_evoliz'
                  and (f.bien_id = p_bien
                       or (f.bien_id is null and f.proprietaire_id = b.proprietaire_id)
                       or (b.groupe_facturation is not null and exists (select 1 from bien g where g.id = f.bien_id and g.proprietaire_id = b.proprietaire_id and g.groupe_facturation = b.groupe_facturation))))
    or exists (select 1 from cloture_comptable cc join bien b on b.id = p_bien
                where cc.mois = p_mois and cc.agence = coalesce(b.agence, 'dcb') and (cc.cloture_ventil is not null or cc.cloture_facturat is not null)))
$$;

create or replace function public.mois_ouvert_regul(p_bien uuid, p_depuis text) returns text
language plpgsql stable security definer set search_path = public as $$
declare i int; m text; ag text;
begin
  select coalesce(agence, 'dcb') into ag from bien where id = p_bien;
  for i in 0..36 loop
    m := to_char((p_depuis || '-01')::date + make_interval(months => i), 'YYYY-MM');
    if not exists (select 1 from cloture_bien c where c.bien_id = p_bien and c.mois = m and c.active)
       and not exists (select 1 from cloture_comptable cc where cc.mois = m and cc.agence = ag and (cc.cloture_ventil is not null or cc.cloture_facturat is not null)) then
      return m;
    end if;
  end loop;
  return null;
end $$;

create table if not exists public.portail_option_regul (
  id uuid primary key default gen_random_uuid(),
  commande_id uuid not null,
  ligne integer not null,
  sens text not null check (sens in ('paiement', 'remboursement')),
  reservation_id uuid references public.reservation(id) on delete cascade,
  bien_id uuid references public.bien(id) on delete set null,
  libelle text,
  montant_centimes integer not null,          -- TTC signé (+ paiement, − remboursement)
  mois_sejour text,                            -- mois figé du séjour
  mois_regul text,                             -- mois ouvert qui porte la ligne PVOY
  ventilation_id uuid,
  erreur text,
  cree_le timestamptz not null default now(),
  vu_le timestamptz,
  vu_par text,
  unique (commande_id, ligne, sens)
);
alter table public.portail_option_regul enable row level security;
comment on table public.portail_option_regul is '468 : régularisations PVOY des options du portail payées / remboursées alors que le mois du séjour était figé (alerte Accueil › À faire › Vérifier jusqu''à « vu »).';

create or replace function public.portail_option_regulariser(p_cmd public.portail_voyageur_commande, p_ligne int, p_sens text, p_le timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare r record; l jsonb := p_cmd.lignes -> p_ligne; v_ttc int; v_m text; v_lib text; v_vid uuid; v_err text;
begin
  select id, bien_id, mois_comptable, code into r from reservation where id = p_cmd.reservation_id;
  if r.id is null or r.mois_comptable is null or not bien_mois_fige(r.bien_id, r.mois_comptable) then return; end if;
  v_ttc := coalesce((l ->> 'montant_centimes')::int, 0) * case when p_sens = 'remboursement' then -1 else 1 end;
  if v_ttc = 0 then return; end if;
  v_m := mois_ouvert_regul(r.bien_id, greatest(to_char(p_le at time zone 'Europe/Paris', 'YYYY-MM'), r.mois_comptable));
  v_lib := left('Régularisation portail : ' || coalesce(l ->> 'libelle', 'Option voyageur') || case when p_sens = 'remboursement' then ' (remboursée le ' else ' (payée le ' end
           || to_char(p_le at time zone 'Europe/Paris', 'DD/MM/YYYY') || ', séjour ' || coalesce(r.code, '') || ' de ' || r.mois_comptable || ')', 200);
  if exists (select 1 from portail_option_regul x where x.commande_id = p_cmd.id and x.ligne = p_ligne and x.sens = p_sens) then return; end if;
  if v_m is not null then
    begin
      insert into ventilation (reservation_id, bien_id, proprietaire_id, code, libelle, montant_ht, taux_tva, montant_tva, montant_ttc, mois_comptable, calcul_source, note)
      select r.id, r.bien_id, b.proprietaire_id, 'PVOY', v_lib, round(v_ttc / 1.2)::int, 20, v_ttc - round(v_ttc / 1.2)::int, v_ttc, v_m, 'manual',
             'Régularisation automatique 468 (commande ' || left(p_cmd.id::text, 8) || ')'
        from bien b where b.id = r.bien_id
      returning id into v_vid;
    exception when others then v_err := sqlerrm;
    end;
  else v_err := 'aucun mois ouvert trouvé';
  end if;
  insert into portail_option_regul (commande_id, ligne, sens, reservation_id, bien_id, libelle, montant_centimes, mois_sejour, mois_regul, ventilation_id, erreur)
  values (p_cmd.id, p_ligne, p_sens, r.id, r.bien_id, l ->> 'libelle', v_ttc, r.mois_comptable, case when v_vid is not null then v_m end, v_vid, v_err)
  on conflict (commande_id, ligne, sens) do nothing;
end $$;
revoke all on function public.portail_option_regulariser(public.portail_voyageur_commande, int, text, timestamptz) from public, anon, authenticated;

-- Trigger 463 étendu : options payées → reservation.options_portail (inchangé) + régularisations si le mois est figé.
create or replace function public.portail_commande_vers_reservation() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_resa uuid := coalesce(new.reservation_id, old.reservation_id);
  v_opts jsonb;
  payes text[] := array['payee', 'a_verifier', 'remboursee_partiel', 'remboursee', 'effet_en_cours'];
  i int;
  nl jsonb; ol jsonb;
  etait_paye boolean; est_paye boolean;
begin
  if v_resa is null then return null; end if;
  select jsonb_agg(jsonb_build_object('libelle', coalesce(l->>'libelle', 'Option voyageur'), 'montant', (l->>'montant_centimes')::int, 'commande_id', c.id) order by c.cree_le, l->>'libelle')
    into v_opts
    from public.portail_voyageur_commande c, jsonb_array_elements(c.lignes) l
   where c.reservation_id = v_resa and c.essai = false and c.paiement_mode = 'stripe'
     and c.statut in ('payee', 'a_verifier', 'remboursee_partiel', 'effet_en_cours')
     and coalesce((l->>'montant_centimes')::int, 0) > 0 and (l->>'rembourse_le') is null;
  update public.reservation set options_portail = v_opts, ventilation_calculee = false
   where id = v_resa and options_portail is distinct from v_opts;
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
