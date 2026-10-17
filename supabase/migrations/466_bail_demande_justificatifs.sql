-- 466 — Justificatif du motif OBLIGATOIRE dans la demande en ligne de bail mobilité (17/10/2026, décision d'Oïhan :
-- « plutôt dès le début, on ne va pas évaluer une demande qui ne fonctionne pas ; suppression des docs lorsque la demande
-- est refusée »). Suite de 462.
-- Fichiers : bucket PRIVÉ « bail-demandes » (10 Mo, PDF / JPG / PNG / HEIC), noms aléatoires, dépôt direct par URL
-- d'envoi signée émise par api/direct.js (action bail_televersement, jeton du formulaire, limites anti-abus), type réel
-- contrôlé côté serveur (signature binaire) à l'envoi de la demande ; lecture équipe par URL signée 5 min
-- (api/bail-demandes.js). Jamais public, jamais transmis à une IA. Pas de pièce d'identité demandée.
-- Suppression DÉFINITIVE (objet + ligne) : au refus (immédiat), à l'expiration d'une demande non traitée, à la purge
-- 6 mois ; fichiers déposés mais jamais rattachés à une demande : supprimés après 24 h. « Créer le bail » : fichiers
-- copiés dans le dossier du bail (bucket baux, <agence>/<contrat>/) → règle du bail (fin + 5 ans, 440), puis retirés ici.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bail-demandes', 'bail-demandes', false, 10485760, array['application/pdf','image/jpeg','image/png','image/heic','image/heif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table if not exists bail_demande_fichier (
  id          uuid primary key default gen_random_uuid(),
  demande_id  uuid not null references bail_demande(id) on delete cascade,
  bucket      text not null default 'bail-demandes' check (bucket in ('bail-demandes','baux')),
  chemin      text not null,
  type        text not null check (type in ('application/pdf','image/jpeg','image/png','image/heic')),
  taille      integer not null check (taille > 0 and taille <= 10485760),
  sha256      text,
  cree_le     timestamptz not null default now()
);
create index if not exists bail_demande_fichier_demande_idx on bail_demande_fichier (demande_id);
create unique index if not exists bail_demande_fichier_chemin_idx on bail_demande_fichier (bucket, chemin);
alter table bail_demande_fichier enable row level security;
revoke all on bail_demande_fichier from anon, authenticated;
comment on table bail_demande_fichier is 'Justificatifs du motif joints aux demandes de bail mobilité (466). Fichiers dans le bucket privé bail-demandes, ou baux après « Créer le bail ».';

-- Fichiers à supprimer (objet Storage puis ligne, par api/cron-purge-identite.js) : demandes refusées / expirées, et
-- demandes ouvertes que la purge va expirer ce jour (bail_demande_purge est appelée juste avant, hors simulation).
create or replace function bail_demande_fichiers_a_supprimer(p_jour date default current_date)
returns table (fichier_id uuid, demande_id uuid, chemin text, statut text)
language sql stable security definer set search_path = public as $$
  select f.id, d.id, f.chemin, d.statut
    from bail_demande_fichier f join bail_demande d on d.id = f.demande_id
   where f.bucket = 'bail-demandes'
     and (d.statut in ('refusee','expiree')
          or (d.statut in ('nouvelle','en_cours') and (d.date_entree < p_jour or d.cree_le < p_jour - interval '6 months')))
   order by d.id, f.cree_le;
$$;

-- Objets du bucket jamais rattachés à une demande (formulaire abandonné, demande test supprimée) depuis plus de 24 h.
create or replace function bail_demande_orphelins(p_avant timestamptz default now() - interval '24 hours')
returns table (chemin text, cree_le timestamptz)
language sql stable security definer set search_path = public, storage as $$
  select o.name, o.created_at from storage.objects o
   where o.bucket_id = 'bail-demandes' and o.created_at < p_avant
     and not exists (select 1 from public.bail_demande_fichier f where f.bucket = 'bail-demandes' and f.chemin = o.name)
   order by o.created_at
   limit 500;
$$;

-- Purge 462 : à l'anonymisation, les lignes de fichiers restantes (métadonnées des pièces passées au bail) sont retirées ;
-- les fichiers du bucket bail-demandes ont déjà été supprimés par le cron (refus / expiration).
create or replace function bail_demande_purge(p_jour date default current_date, p_dry boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_exp int; v_anon int; v_test int;
  v_limite timestamptz := (p_jour - interval '6 months');
begin
  select count(*) into v_exp from bail_demande
   where statut in ('nouvelle','en_cours') and (date_entree < p_jour or cree_le < v_limite);
  select count(*) into v_anon from bail_demande
   where anonymise_le is null and statut in ('acceptee','refusee','expiree') and coalesce(cloture_le, maj_le) < v_limite;
  select count(*) into v_test from bail_demande where test and cree_le < p_jour - interval '1 day';
  if not p_dry then
    update bail_demande set statut = 'expiree', cloture_le = now(), maj_le = now(), traite_par = coalesce(traite_par, 'auto')
     where statut in ('nouvelle','en_cours') and (date_entree < p_jour or cree_le < v_limite);
    delete from bail_demande_fichier f using bail_demande d
     where d.id = f.demande_id and f.bucket = 'baux'
       and d.anonymise_le is null and d.statut in ('acceptee','refusee','expiree') and coalesce(d.cloture_le, d.maj_le) < v_limite;
    update bail_demande set prenom = null, nom = null, email = null, telephone = null, motif_precision = null,
           message = null, note_equipe = null, motif_refus = null, ip_hash = null,
           consentement = jsonb_build_object('anonymise', true), anonymise_le = now(), maj_le = now()
     where anonymise_le is null and statut in ('acceptee','refusee','expiree') and coalesce(cloture_le, maj_le) < v_limite;
    delete from bail_demande where test and cree_le < p_jour - interval '1 day';
  end if;
  return jsonb_build_object('jour', p_jour, 'simulation', p_dry, 'expirees', v_exp, 'anonymisees', v_anon, 'tests_supprimes', v_test);
end;
$$;

revoke all on function bail_demande_fichiers_a_supprimer(date) from public, anon, authenticated;
revoke all on function bail_demande_orphelins(timestamptz) from public, anon, authenticated;
grant execute on function bail_demande_fichiers_a_supprimer(date) to service_role;
grant execute on function bail_demande_orphelins(timestamptz) to service_role;
revoke all on function bail_demande_purge(date, boolean) from public, anon, authenticated;
grant execute on function bail_demande_purge(date, boolean) to service_role;
