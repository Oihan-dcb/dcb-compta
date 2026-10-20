-- 511 — « ✏️ Modifier » une réservation DIRECTE / MANUELLE depuis PowerHouse (20/10/2026).
--
-- Demande d'Oïhan : « le calendrier PowerHouse ne permet pas de modifier des réservations directes et manuelles ».
-- 1. Droit explicite ph_droit 'modifier_resa' (périmètre 'tout' | 'agence:dcb' | 'agence:lauian'), même modèle que
--    'rembourser' (447) : Oïhan (toutes agences), Laura (Lauïan). Administrable dans Accueil › Droits des comptes.
-- 2. resa_modification : UNE ligne par modification (une résa peut être modifiée plusieurs fois, une seule modification
--    en cours à la fois) — avant / après FIGÉS à la confirmation, lignes de prix avant / après, écart, complément (lien de
--    paiement Stripe du compte de l'agence, jamais de débit automatique), trop-perçu (remboursement au clic seulement),
--    journal des étapes (reprise sans rien refaire deux fois). Écrite par le serveur (service role) ; lecture staff.
-- 3. dispo_action_log : actions 'resa_modifier', 'resa_complement_paye', 'resa_trop_percu_rembourse'.

-- ─── 1. Droit « modifier_resa » ───────────────────────────────────────────────────────────────────────────
alter table public.ph_droit drop constraint if exists ph_droit_droit_check;
alter table public.ph_droit add constraint ph_droit_droit_check check (droit in ('perf', 'honoraires', 'admin', 'rembourser', 'stock', 'stock_admin', 'modifier_resa'));

create or replace function public.ph_droit_definir(p_uid uuid, p_droit text, p_actif boolean, p_perimetre text default 'tout')
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not ph_est_admin() then raise exception 'acces_refuse'; end if;
  if p_droit not in ('perf', 'honoraires', 'admin', 'rembourser', 'stock', 'stock_admin', 'modifier_resa') then raise exception 'droit_inconnu'; end if;
  if p_droit in ('rembourser', 'modifier_resa') and coalesce(p_actif, false) and coalesce(nullif(p_perimetre, ''), 'tout') not in ('tout', 'agence:dcb', 'agence:lauian') then
    raise exception 'perimetre_invalide';
  end if;
  if p_droit = 'admin' and not coalesce(p_actif, false)
     and not exists (select 1 from ph_droit d where d.droit = 'admin' and d.auth_user_id <> p_uid) then
    raise exception 'dernier_admin';
  end if;
  if coalesce(p_actif, false) then
    insert into ph_droit (auth_user_id, droit, perimetre, accorde_par)
    values (p_uid, p_droit, case when p_droit in ('stock', 'stock_admin') then 'tout' else coalesce(nullif(p_perimetre, ''), 'tout') end, auth.uid())
    on conflict (auth_user_id, droit) do update
      set perimetre = excluded.perimetre, accorde_par = excluded.accorde_par, accorde_le = now();
  else
    delete from ph_droit where auth_user_id = p_uid and droit = p_droit;
  end if;
end $$;

create or replace function public.ph_mes_droits()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'uid', auth.uid(),
    'role', auth_user_powerhouse_role(),
    'bureau', auth_user_is_bureau(),
    'zones', to_jsonb(my_secteurs()),
    'admin', exists (select 1 from ph_droit d where d.auth_user_id = auth.uid() and d.droit = 'admin'),
    'perf', (select d.perimetre from ph_droit d where d.auth_user_id = auth.uid() and d.droit = 'perf'),
    'honoraires', exists (select 1 from ph_droit d where d.auth_user_id = auth.uid() and d.droit = 'honoraires'),
    'rembourser', (select d.perimetre from ph_droit d where d.auth_user_id = auth.uid() and d.droit = 'rembourser'),
    'modifier_resa', (select d.perimetre from ph_droit d where d.auth_user_id = auth.uid() and d.droit = 'modifier_resa'),
    'stock', stock_niveau()
  );
$$;

-- Même répartition que « rembourser » (décision d'Oïhan du 16/10/2026) : Oïhan (2 comptes) toutes agences, Laura Lauïan.
insert into public.ph_droit (auth_user_id, droit, perimetre)
select v.uid, 'modifier_resa', v.per
  from (values
    ('414218dc-b91b-454e-a0f2-9b4a3a0c5676'::uuid, 'tout'),
    ('62753152-5321-40ce-ac86-36a54c2de2aa'::uuid, 'tout'),
    ('e19b78dc-7507-41a2-926b-d32af02f79e9'::uuid, 'agence:lauian'),
    ('8cb18dc9-1366-47d2-b120-13b57a9630d5'::uuid, 'agence:lauian')
  ) as v(uid, per)
 where exists (select 1 from auth.users u where u.id = v.uid)
on conflict (auth_user_id, droit) do nothing;

-- ─── 2. Journal des modifications ─────────────────────────────────────────────────────────────────────────
create table if not exists public.resa_modification (
  id                    uuid primary key default gen_random_uuid(),
  reservation_id        uuid not null references public.reservation(id) on delete restrict,
  reservation_code      text,
  resa_hospitable_id    text,
  bien_id               uuid references public.bien(id) on delete set null,
  agence                text not null default 'dcb' check (agence in ('dcb', 'lauian')),
  portee                text not null default 'complete' check (portee in ('complete', 'partielle')),
  avant                 jsonb not null,               -- dates, voyageurs, identité, langue, horaires, note (figés)
  apres                 jsonb not null,
  lignes_avant          jsonb not null default '[]'::jsonb,
  lignes_apres          jsonb not null default '[]'::jsonb,
  prix_force            boolean not null default false,
  total_avant_centimes  integer not null default 0,
  total_apres_centimes  integer not null default 0,
  paye_centimes         integer not null default 0,    -- déjà encaissé (Stripe net + virements reçus) à la confirmation
  ecart_centimes        integer not null default 0,    -- total après − total avant
  complement            jsonb,                         -- { montant_centimes, token, statut, payment_intent, paye_le, … }
  trop_percu            jsonb,                         -- { montant_centimes, statut: 'a_decider'|'rembourse'|'garde', … }
  echeances             jsonb,                         -- échéances du contrat recalculées (avant / après)
  motif                 text,
  prevenir_voyageur     boolean not null default false,
  message_voyageur      text,
  mail                  jsonb,
  statut                text not null default 'en_cours' check (statut in ('en_cours', 'termine', 'partiel')),
  etapes                jsonb not null default '{}'::jsonb,
  verrou_le             timestamptz,
  cree_par              uuid,
  cree_par_label        text,
  cree_le               timestamptz not null default now(),
  termine_le            timestamptz,
  maj_le                timestamptz not null default now()
);
create index if not exists resa_modification_resa_idx on public.resa_modification (reservation_id, cree_le desc);
create unique index if not exists resa_modification_complement_token on public.resa_modification ((complement->>'token')) where complement ? 'token';
-- Une seule modification non terminée par réservation (deux fenêtres ouvertes ne peuvent pas modifier en même temps).
create unique index if not exists resa_modification_une_en_cours on public.resa_modification (reservation_id) where statut <> 'termine';
comment on table public.resa_modification is 'Modifications de résas directes / manuelles faites par le bouton PowerHouse « ✏️ Modifier » (511) : avant / après figés, prix, écart, complément / trop-perçu, étapes. Écriture serveur seulement.';

alter table public.resa_modification enable row level security;
drop policy if exists resa_modification_lecture on public.resa_modification;
create policy resa_modification_lecture on public.resa_modification for select to authenticated using (auth_user_is_staff());
revoke insert, update, delete on public.resa_modification from anon, authenticated;

-- ─── 3. Journal des actions ───────────────────────────────────────────────────────────────────────────────
alter table public.dispo_action_log drop constraint if exists dispo_action_log_action_check;
alter table public.dispo_action_log add constraint dispo_action_log_action_check check (action = any (array[
  'block', 'unblock', 'set_rules', 'create_direct_reservation', 'create_manual_reservation', 'devis_option', 'devis_prolonger',
  'devis_annuler', 'devis_convertir', 'devis_expire', 'sejour_hors_hospitable', 'sejour_hors_bloquer', 'sejour_hors_annuler',
  'sejour_hors_refacturation', 'contrat_brouillon', 'devis_envoyer', 'devis_paiement', 'devis_paye_converti', 'devis_rembourse',
  'resa_annuler_rembourser', 'portail_option_payee', 'portail_option_rembourse',
  'resa_modifier', 'resa_complement_paye', 'resa_trop_percu_rembourse']));

-- ─── 4. Temps réel (511b) : le Calendrier et la fiche se rafraîchissent quand une modification avance (complément payé…) ─
alter publication supabase_realtime add table public.resa_modification;
