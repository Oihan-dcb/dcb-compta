-- 471 — COMPTA DES PÉNALITÉS DE DÉPART TARDIF NON AUTORISÉ (17/10/2026, décision d'Oïhan : « revenu de l'AGENCE, sous COM »).
-- Suite de 470 (table penalite_depart, bouton de la fiche du séjour PowerHouse).
--
-- 1. Encaissement : penalite_depart.encaisse_centimes / encaisse_le ; statut 'encaissee' (réclamation Airbnb / Booking payée,
--    ou encaissement à la main d'une directe sans carte) ; un débit réussi de la carte de garantie (statut 'debitee') pose
--    encaisse_centimes = total (PowerHouse api/penalite-depart.js).
-- 2. reservation.penalites_depart = [{libelle, montant (centimes TTC encaissés), penalite_id}] tenu par trigger (comme
--    options_portail, 463) + ventilation_calculee = false → ventilationCore ajoute une ligne COM dédiée « Pénalité départ
--    tardif non autorisé » (TVA 20 %) sur le séjour, mois du séjour → facture COM du mois (client CLI-RESA-WEB-<agence>).
--    Jamais dans MEN / HON / LOY / VIRProprio ; les rapports propriétaires ne lisent pas COM.
-- 3. Mois du séjour FIGÉ (bien_mois_fige, 468) au moment de l'encaissement / de son annulation : la ventilation de ce mois ne
--    se recalcule plus → régularisation automatique, même logique que 468 : ligne de ventilation COM (± écart, TVA 20 %,
--    calcul_source manual) sur le SÉJOUR dans le PREMIER MOIS OUVERT du bien (mois_ouvert_regul) à partir du mois de
--    l'encaissement, + trace penalite_depart_regul → alerte PowerHouse (Accueil › À faire › Vérifier) jusqu'à « vu ».
--    Écart calculé entre l'ancienne et la nouvelle valeur comptée (UPDATE) : jamais de double comptage.

alter table public.penalite_depart add column if not exists encaisse_centimes integer not null default 0 check (encaisse_centimes >= 0);
alter table public.penalite_depart add column if not exists encaisse_le timestamptz;
alter table public.penalite_depart add column if not exists encaisse_par_label text;
alter table public.penalite_depart drop constraint if exists penalite_depart_statut_check;
alter table public.penalite_depart add constraint penalite_depart_statut_check
  check (statut in ('enregistree', 'debit_en_cours', 'debitee', 'debit_echec', 'reclamation_preparee', 'encaissee', 'annulee'));
update public.penalite_depart set compta_statut = 'agence' where compta_statut = 'en_attente_decision';
alter table public.penalite_depart alter column compta_statut set default 'agence';
comment on column public.penalite_depart.encaisse_centimes is '471 : montant TTC réellement encaissé par l''agence (débit carte, réclamation plateforme payée, encaissement manuel) → COM dédiée.';

alter table public.reservation add column if not exists penalites_depart jsonb;
comment on column public.reservation.penalites_depart is '471 : pénalités de départ tardif encaissées [{libelle, montant (centimes TTC), penalite_id}] (trigger depuis penalite_depart) → ligne COM « Pénalité départ tardif non autorisé » (ventilationCore).';

create table if not exists public.penalite_depart_regul (
  id uuid primary key default gen_random_uuid(),
  penalite_id uuid not null references public.penalite_depart(id) on delete cascade,
  reservation_id uuid references public.reservation(id) on delete cascade,
  bien_id uuid references public.bien(id) on delete set null,
  montant_centimes integer not null,          -- TTC signé (+ encaissement, − annulation d'encaissement)
  mois_sejour text,
  mois_regul text,
  ventilation_id uuid,
  erreur text,
  cree_le timestamptz not null default now(),
  vu_le timestamptz,
  vu_par text
);
create index if not exists penalite_depart_regul_pen_idx on public.penalite_depart_regul (penalite_id);
alter table public.penalite_depart_regul enable row level security;
drop policy if exists penalite_depart_regul_lecture on public.penalite_depart_regul;
create policy penalite_depart_regul_lecture on public.penalite_depart_regul for select to authenticated using (auth_user_is_staff());
comment on table public.penalite_depart_regul is '471 : régularisations COM des pénalités de départ tardif encaissées / annulées alors que le mois du séjour était figé (alerte Accueil › À faire › Vérifier jusqu''à « vu »).';

create or replace function public.penalite_depart_vers_reservation() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_resa uuid := coalesce(new.reservation_id, old.reservation_id);
  v_list jsonb;
  comptes text[] := array['debitee', 'encaissee'];
  v_new int := 0; v_old int := 0; v_delta int;
  r record; v_m text; v_vid uuid; v_err text; v_le timestamptz; v_rid uuid := gen_random_uuid();
begin
  select jsonb_agg(jsonb_build_object('libelle', 'Pénalité départ tardif non autorisé', 'montant', p.encaisse_centimes, 'penalite_id', p.id) order by p.cree_le)
    into v_list
    from penalite_depart p
   where p.reservation_id = v_resa and p.statut = any(comptes) and p.encaisse_centimes > 0;
  update reservation set penalites_depart = v_list, ventilation_calculee = false
   where id = v_resa and penalites_depart is distinct from v_list;

  -- Régularisation si le mois du séjour est figé : écart entre ce qui était compté et ce qui l'est maintenant.
  if tg_op in ('INSERT', 'UPDATE') and new.statut = any(comptes) then v_new := coalesce(new.encaisse_centimes, 0); end if;
  if tg_op in ('UPDATE', 'DELETE') and old.statut = any(comptes) then v_old := coalesce(old.encaisse_centimes, 0); end if;
  v_delta := v_new - v_old;
  if v_delta = 0 or tg_op = 'DELETE' then return null; end if;
  select id, bien_id, mois_comptable, code into r from reservation where id = v_resa;
  if r.id is null or r.mois_comptable is null or not bien_mois_fige(r.bien_id, r.mois_comptable) then return null; end if;
  v_le := coalesce(new.encaisse_le, now());
  v_m := mois_ouvert_regul(r.bien_id, greatest(to_char(v_le at time zone 'Europe/Paris', 'YYYY-MM'), r.mois_comptable));
  if v_m is not null then
    begin
      insert into ventilation (reservation_id, bien_id, proprietaire_id, code, libelle, montant_ht, taux_tva, montant_tva, montant_ttc, mois_comptable, calcul_source, note)
      select r.id, r.bien_id, b.proprietaire_id, 'COM',
             -- libellé unique (contrainte ventilation_resa_code_libelle_unique) : date + référence de la régularisation
             left('Régularisation : pénalité départ tardif non autorisé' || case when v_new = 0 then ' (annulée)' when v_delta < 0 then ' (correction)' else '' end
                  || ' — séjour ' || coalesce(r.code, '') || ' de ' || r.mois_comptable || ', le ' || to_char(v_le at time zone 'Europe/Paris', 'DD/MM/YYYY')
                  || ' (réf. ' || left(v_rid::text, 8) || ')', 200),
             round(v_delta / 1.2)::int, 20, v_delta - round(v_delta / 1.2)::int, v_delta, v_m, 'manual',
             'Régularisation automatique 471 (pénalité ' || left(new.id::text, 8) || ')'
        from bien b where b.id = r.bien_id
      returning id into v_vid;
    exception when others then v_err := sqlerrm;
    end;
  else v_err := 'aucun mois ouvert trouvé';
  end if;
  insert into penalite_depart_regul (id, penalite_id, reservation_id, bien_id, montant_centimes, mois_sejour, mois_regul, ventilation_id, erreur)
  values (v_rid, new.id, r.id, r.bien_id, v_delta, r.mois_comptable, case when v_vid is not null then v_m end, v_vid, v_err);
  return null;
end $$;
revoke all on function public.penalite_depart_vers_reservation() from public, anon, authenticated;

drop trigger if exists trg_penalite_depart_vers_reservation on public.penalite_depart;
create trigger trg_penalite_depart_vers_reservation
  after insert or update of statut, encaisse_centimes or delete on public.penalite_depart
  for each row execute function public.penalite_depart_vers_reservation();
