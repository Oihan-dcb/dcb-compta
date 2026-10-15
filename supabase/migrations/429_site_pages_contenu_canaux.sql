-- 429 — Module WordPress « Logement DCB » + contenu par canal (15/10/2026, dcb-planning).
--
-- 1. site_page : correspondance page du site WordPress ↔ bien PowerHouse (URL et post_id WordPress conservés,
--    identifiant numérique du widget Hospitable, gabarit « réservable » / « vitrine », reprise du contenu actuel
--    de la page lue dans l'export WordPress du 15/10/2026 : texte, points forts, numéro d'enregistrement, photos).
--    Lecture publique UNIQUEMENT via api/direct-page (vue=contenu, clé service) ; aucune donnée personnelle.
-- 2. bien_contenu_canal : variantes de contenu par distributeur (« channel manager de contenu ») : base, site,
--    airbnb, booking. Même forme que bien_vente_directe.contenu ({titre:{fr,en,es}, description, points_forts,
--    quartier, photos:[url], _trad}). Champ vide = hérite (site → base → direct → reprise WordPress → annonce).
--    Le canal « direct » reste bien_vente_directe.contenu (pas de doublon). Airbnb / Booking : PRÉPARATION seulement
--    (colonne envoi, statut « prepare ») — aucune écriture Hospitable sans demande explicite d'Oïhan.
-- Réversible : drop table public.bien_contenu_canal, public.site_page (aucune autre table modifiée).

create table if not exists public.site_page (
  id                    uuid primary key default gen_random_uuid(),
  site                  text not null default 'destinationcotebasque.com' check (site ~ '^[a-z0-9.-]+$'),
  wp_post_id            int,
  url                   text not null unique check (url ~ '^https://[^\s]+/$'),
  slug                  text not null,
  titre_wp              text,
  bien_id               uuid references public.bien(id) on delete set null,
  hospitable_widget_id  text check (hospitable_widget_id is null or hospitable_widget_id ~ '^[0-9]{3,9}$'),
  gabarit               text not null default 'auto' check (gabarit in ('auto', 'reservable', 'vitrine')),
  reprise               jsonb not null default '{}'::jsonb check (jsonb_typeof(reprise) = 'object'),
  module_installe       boolean not null default false,
  purge_demandee_le     timestamptz,
  maj_le                timestamptz not null default now(),
  maj_par               text,
  unique (site, wp_post_id)
);
create index if not exists site_page_bien_idx on public.site_page (bien_id);
comment on table public.site_page is
  'Pages logements du site WordPress ↔ bien PowerHouse (429). reprise = contenu actuel de la page (export WordPress 15/10/2026) : {texte, points:[…], numero, photos:[{id,src,w,h,srcset,alt}], widget_ids:[…]}. gabarit auto = réservable si le bien est saisonnier, sinon vitrine. module_installe = shortcode [dcb_logement] posé sur la page.';
alter table public.site_page enable row level security;
drop policy if exists site_page_staff on public.site_page;
create policy site_page_staff on public.site_page for all to authenticated
  using (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
  with check (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));
revoke all on public.site_page from anon;

create table if not exists public.bien_contenu_canal (
  bien_id    uuid not null references public.bien(id) on delete cascade,
  canal      text not null check (canal in ('base', 'site', 'airbnb', 'booking')),
  contenu    jsonb not null default '{}'::jsonb check (jsonb_typeof(contenu) = 'object'),
  envoi      jsonb check (envoi is null or jsonb_typeof(envoi) = 'object'),
  maj_le     timestamptz not null default now(),
  maj_par    text,
  primary key (bien_id, canal)
);
comment on table public.bien_contenu_canal is
  'Contenu par distributeur (429) : base (commun) + variantes site / airbnb / booking ; vide = hérite de base. Le Direct reste bien_vente_directe.contenu. envoi = préparation de l''envoi vers la plateforme (jamais exécuté sans demande explicite).';
alter table public.bien_contenu_canal enable row level security;
drop policy if exists bien_contenu_canal_staff on public.bien_contenu_canal;
create policy bien_contenu_canal_staff on public.bien_contenu_canal for all to authenticated
  using (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
  with check (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));
revoke all on public.bien_contenu_canal from anon;

-- Journal (même table que la Tarification / Vente directe) : qui a changé quel canal.
create or replace function public.trg_bien_contenu_canal_journal()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_par text := coalesce(auth.email(), 'système');
begin
  if tg_op = 'INSERT' then
    insert into bien_tarification_journal (bien_id, cle, canal, operation, apres, par) values (new.bien_id, 'contenu_canal', new.canal, 'ajout', new.contenu, coalesce(new.maj_par, v_par));
  elsif tg_op = 'UPDATE' then
    if old.contenu is distinct from new.contenu then
      insert into bien_tarification_journal (bien_id, cle, canal, operation, avant, apres, par) values (new.bien_id, 'contenu_canal', new.canal, 'modification', old.contenu, new.contenu, coalesce(new.maj_par, v_par));
    end if;
  else
    insert into bien_tarification_journal (bien_id, cle, canal, operation, avant, par) values (old.bien_id, 'contenu_canal', old.canal, 'suppression', old.contenu, v_par);
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_bien_contenu_canal_journal on public.bien_contenu_canal;
create trigger trg_bien_contenu_canal_journal after insert or update or delete on public.bien_contenu_canal
  for each row execute function public.trg_bien_contenu_canal_journal();
