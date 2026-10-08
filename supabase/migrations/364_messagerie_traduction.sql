-- 363 — Messagerie voyageurs PowerHouse : traduction automatique (08/10/2026).
--
-- 1) staff_langue_pref : réglage PAR MEMBRE de l'équipe (clé = auth.users.id, pas staff_users :
--    les gérantes/assistantes PowerHouse sont des fiches auto_entrepreneur, pas des lignes
--    staff_users — une colonne sur staff_users aurait laissé Kathy/Léa/Manon sans réglage).
--    langues      : langues que la personne lit/écrit (défaut {fr} ; ex. Oïhan {fr,es}).
--    traduire_auto: pré-coche « Traduire et envoyer » quand le texte n'est pas dans la langue du voyageur.
--    RLS : chacun ne lit/écrit que SA ligne.
-- 2) traduction_cache : traductions Haiku mises en cache (message voyageur → FR, proposition IA → FR),
--    clé « msg:<hospitable_messages.id>:<cible> » / « job:<chat_llm_jobs.id>:<cible> ». Écrite et lue
--    uniquement par api/guest-translate.js (service_role, périmètre vérifié) — RLS sans policy.

create table if not exists public.staff_langue_pref (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  langues text[] not null default '{fr}',
  traduire_auto boolean not null default false,
  updated_at timestamptz not null default now()
);
comment on table public.staff_langue_pref is 'Messagerie PowerHouse : langues comprises par membre de l''équipe + pré-choix traduction avant envoi';
alter table public.staff_langue_pref enable row level security;
drop policy if exists staff_langue_pref_own on public.staff_langue_pref;
create policy staff_langue_pref_own on public.staff_langue_pref
  for all to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

create table if not exists public.traduction_cache (
  cle text primary key,
  langue_source text,
  langue_cible text not null,
  texte text,
  modele text,
  cout_usd numeric,
  created_at timestamptz not null default now()
);
comment on table public.traduction_cache is 'Cache des traductions Haiku de la Messagerie (api/guest-translate.js) — service_role uniquement';
alter table public.traduction_cache enable row level security;

-- Oïhan lit le français et l'espagnol (demande du 08/10/2026).
insert into public.staff_langue_pref (auth_user_id, langues)
select su.auth_user_id, '{fr,es}'
from public.staff_users su
where su.email = 'oihan@destinationcotebasque.com' and su.auth_user_id is not null
on conflict (auth_user_id) do nothing;

-- 363b (appliquée à part le même jour) — langues de l'équipe précisées par Oïhan :
-- Oïhan fr/es/en, Clémence fr/en, Laura fr (ses deux comptes) ; tous les autres : fr par défaut.
insert into public.staff_langue_pref (auth_user_id, langues)
select u.id, v.langues::text[]
from (values ('oihan@destinationcotebasque.com','{fr,es,en}'),
             ('c.ploquin@icloud.com','{fr,en}'),
             ('laura@destinationcotebasque.com','{fr}'),
             ('lauracoursan@hotmail.fr','{fr}')) v(email, langues)
join auth.users u on lower(u.email) = v.email
on conflict (auth_user_id) do update set langues = excluded.langues, updated_at = now();
