-- 336 — Rattrapages de commission COM (06/10/2026).
-- Une commission voyageur encaissée au séquestre mais non ventilée en COM sur une résa d'un mois
-- dont la facture COM est déjà envoyée/validée dans Evoliz (mois verrouillé, réouverture impossible
-- sans avoir). Le rattrapage est facturé sur la facture COM d'un mois ultérieur (mois_facturation)
-- et compté dans la part agence du mois d'origine par le justificatif du séquestre.
-- 1er cas : PATXI HOST-L2K15B (août 2026), « Extra guest fee » 350 € rangé à tort dans MEN
-- (bug label extra guest fee, corrigé) → décision Oïhan : commission DCB, facture COM d'octobre.
create table if not exists public.com_rattrapage (
  id uuid primary key default gen_random_uuid(),
  agence text not null default 'dcb',
  reservation_id uuid references public.reservation(id) on delete set null,
  mois_origine text not null check (mois_origine ~ '^\d{4}-\d{2}$'),
  mois_facturation text not null check (mois_facturation ~ '^\d{4}-\d{2}$'),
  montant_ttc integer not null check (montant_ttc <> 0),
  libelle text not null,
  cree_par text,
  created_at timestamptz not null default now()
);
create index if not exists com_rattrapage_fact_idx on public.com_rattrapage (agence, mois_facturation);
create index if not exists com_rattrapage_orig_idx on public.com_rattrapage (agence, mois_origine);

alter table public.com_rattrapage enable row level security;
drop policy if exists com_rattrapage_bureau on public.com_rattrapage;
create policy com_rattrapage_bureau on public.com_rattrapage
  for all to authenticated using (public.auth_user_is_bureau()) with check (public.auth_user_is_bureau());

insert into public.com_rattrapage (agence, reservation_id, mois_origine, mois_facturation, montant_ttc, libelle, cree_par)
select 'dcb', r.id, '2026-08', '2026-10', 35000,
  'Commission voyageur supplémentaire — résa ' || r.code || ' (PATXI, août 2026), non ventilée en août',
  'oihan@destinationcotebasque.com'
from public.reservation r
where r.id = 'e78d45bf-7e9b-441a-90cc-90be35045007'
  and not exists (select 1 from public.com_rattrapage c where c.reservation_id = r.id);
