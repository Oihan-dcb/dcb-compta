-- Phase 1 — Questionnaire d'onboarding propriétaire (rempli à la 1ère connexion du portail owner).
-- Stockage brut des réponses (JSONB par champ) + 3 documents (Storage). DCB exploite ensuite pour le mandat.

create table if not exists proprietaire_onboarding (
  id                 uuid primary key default gen_random_uuid(),
  proprietaire_id    uuid not null references proprietaire(id) on delete cascade,
  reponses           jsonb not null default '{}'::jsonb,
  doc_titre_path     text,
  doc_assurance_path text,
  doc_identite_path  text,
  complete_le        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists proprietaire_onboarding_uq on proprietaire_onboarding(proprietaire_id);

alter table proprietaire_onboarding enable row level security;

-- Lecture : staff (dcb-compta / PowerHouse) OU le propriétaire pour le(s) sien(s)
create policy onboarding_select on proprietaire_onboarding for select to authenticated
  using ( auth_user_is_staff() or proprietaire_id in (select my_proprietaire_ids()) );

-- Le propriétaire crée/met à jour SON onboarding
create policy onboarding_owner_insert on proprietaire_onboarding for insert to authenticated
  with check ( proprietaire_id in (select my_proprietaire_ids()) );
create policy onboarding_owner_update on proprietaire_onboarding for update to authenticated
  using ( proprietaire_id in (select my_proprietaire_ids()) )
  with check ( proprietaire_id in (select my_proprietaire_ids()) );

-- Le staff peut tout faire (édition/suppression admin)
create policy onboarding_staff_all on proprietaire_onboarding for all to authenticated
  using ( auth_user_is_staff() ) with check ( auth_user_is_staff() );

-- ── Storage : documents d'onboarding (titre propriété / assurance / CNI) ──────
insert into storage.buckets (id, name, public)
values ('owner-onboarding', 'owner-onboarding', false)
on conflict (id) do nothing;

-- Chemin = <proprietaire_id>/<type>-<timestamp>.<ext>
create policy onb_obj_select on storage.objects for select to authenticated
  using ( bucket_id = 'owner-onboarding' and (
    auth_user_is_staff() or (storage.foldername(name))[1] in (select my_proprietaire_ids()::text)
  ));
create policy onb_obj_insert on storage.objects for insert to authenticated
  with check ( bucket_id = 'owner-onboarding' and (
    auth_user_is_staff() or (storage.foldername(name))[1] in (select my_proprietaire_ids()::text)
  ));
create policy onb_obj_update on storage.objects for update to authenticated
  using ( bucket_id = 'owner-onboarding' and (
    auth_user_is_staff() or (storage.foldername(name))[1] in (select my_proprietaire_ids()::text)
  ));
