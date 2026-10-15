-- 428 — Source de savoir de l'IA voyageurs réglée PAR BIEN (15/10/2026, feu vert Oïhan « ok B »).
-- 'ancienne' (défaut) : Knowledge Hub miroité + extraits minés (comportement d'avant) ; le Savoir est seulement comparé.
-- 'savoir'            : le 📚 Savoir (bien_savoir) fait foi ; l'ancienne source ne sert qu'en repli pour les
--                       catégories non couvertes ou ayant des éléments « à relire ».
-- 'les_deux'          : Savoir prioritaire + toute l'ancienne source en complément.
-- Modifiable dans PowerHouse › fiche bien › 📚 Savoir (bureau). Lu par api/ga-process-message.js.
alter table public.bien
  add column if not exists source_ia text not null default 'ancienne',
  add column if not exists source_ia_maj_at timestamptz,
  add column if not exists source_ia_maj_par uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'bien_source_ia_chk') then
    alter table public.bien add constraint bien_source_ia_chk check (source_ia in ('ancienne','savoir','les_deux'));
  end if;
end $$;
comment on column public.bien.source_ia is 'Source de savoir de l''IA voyageurs : ancienne (Hub Hospitable, défaut) / savoir (bien_savoir fait foi, repli Hub par catégorie) / les_deux (Savoir prioritaire + Hub en complément). Migration 428.';

-- Journal de comparaison : source effective et garde-fous appliqués.
alter table public.ga_savoir_comparaison
  add column if not exists source_ia text,
  add column if not exists acces_hors_fenetre int,
  add column if not exists a_relire_exclus int,
  add column if not exists repli_nb int;
