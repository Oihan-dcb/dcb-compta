-- 480 — Inventaire : réparation des lignes rangées sous bien.id au lieu de bien_toolbox.id
--
-- CAUSE RACINE (19/10/2026)
--   Les tables d'inventaire (inventaire_bien_config, inventaire_bien_stock, inventaire_mouvements,
--   inventaire_missions) sont indexées par bien_toolbox.id, mais AUCUNE clé étrangère ne l'imposait.
--   Le 26/05/2026 à 21:17 et 21:28 UTC, la pré-population « tous les biens actifs » (commit portail
--   1a52c30) a été lancée une première fois avec bien.id : 33 articles plaqués sur 64 biens sans tri
--   (produits piscine, charbon, piment… partout), 2 112 lignes config + 2 112 lignes stock, toutes
--   « à vérifier ». Elle a été relancée correctement (bien_toolbox.id, sélection par type de bien)
--   à 21:39 et 21:54 UTC, mais la première passe n'a jamais été retirée. Côté code, le portail
--   (PageInventaire) retombait en plus sur l'identifiant reçu tel quel quand il ne trouvait pas la
--   fiche (`|| bienIdFocus`), ce qui pouvait réécrire sous bien.id.
--
-- RÉPARATION
--   * Les 64 biens visés ont TOUS reçu la bonne pré-population (29 à 50 articles chacun) : déplacer
--     les lignes fautives créerait des doublons (682 config / 595 stock déjà présents) ou ajouterait
--     des articles que la 2e passe avait volontairement écartés (piscine sur 57 biens sans piscine…).
--     Aucune de ces lignes n'a été touchée depuis le 26/05 (statut « à vérifier », pas de quantité).
--   * Donc : sauvegarde intégrale dans inventaire_reparation_480 (ligne d'origine en jsonb, fiche
--     cible, doublon ou non), puis retrait des tables vivantes. Restauration possible par
--     `insert ... select (jsonb_populate_record(null::inventaire_bien_config, ligne)).*`.
--   * Les 4 missions inventaire « en attente » du 26/05 (602, doublons de celle terminée le
--     27/05/2026) passent en « annulee » avec motif.
--   * Garde-fou à la source : clés étrangères vers bien_toolbox(id) sur les 4 tables.

begin;

create table if not exists public.inventaire_reparation_480 (
  id            bigserial primary key,
  table_source  text not null,
  ligne_id      uuid not null,
  ligne         jsonb not null,
  bien_id_errone uuid not null,
  bien_toolbox_cible uuid,
  deja_present_cible boolean not null,
  motif         text not null,
  retire_at     timestamptz not null default now()
);
alter table public.inventaire_reparation_480 enable row level security;
-- lecture bureau seulement (aucune policy pour anon/authenticated : service_role et SQL uniquement)

insert into public.inventaire_reparation_480 (table_source, ligne_id, ligne, bien_id_errone, bien_toolbox_cible, deja_present_cible, motif)
select 'inventaire_bien_config', c.id, to_jsonb(c), c.bien_id, bt.id,
       exists (select 1 from inventaire_bien_config g where g.bien_id = bt.id and g.item_id = c.item_id),
       'pré-population 26/05/2026 sous bien.id (première passe abandonnée)'
from inventaire_bien_config c
left join bien_toolbox bt on bt.bien_id = c.bien_id
where not exists (select 1 from bien_toolbox x where x.id = c.bien_id);

insert into public.inventaire_reparation_480 (table_source, ligne_id, ligne, bien_id_errone, bien_toolbox_cible, deja_present_cible, motif)
select 'inventaire_bien_stock', s.id, to_jsonb(s), s.bien_id, bt.id,
       exists (select 1 from inventaire_bien_stock g where g.bien_id = bt.id and g.item_id = s.item_id),
       'pré-population 26/05/2026 sous bien.id (première passe abandonnée)'
from inventaire_bien_stock s
left join bien_toolbox bt on bt.bien_id = s.bien_id
where not exists (select 1 from bien_toolbox x where x.id = s.bien_id);

-- Contrôle : la sauvegarde doit couvrir exactement les lignes à retirer, sinon on annule tout.
do $$
declare n_cfg int; n_stk int; s_cfg int; s_stk int;
begin
  select count(*) into n_cfg from inventaire_bien_config c where not exists (select 1 from bien_toolbox x where x.id = c.bien_id);
  select count(*) into n_stk from inventaire_bien_stock s where not exists (select 1 from bien_toolbox x where x.id = s.bien_id);
  select count(*) into s_cfg from inventaire_reparation_480 where table_source = 'inventaire_bien_config';
  select count(*) into s_stk from inventaire_reparation_480 where table_source = 'inventaire_bien_stock';
  if n_cfg <> s_cfg or n_stk <> s_stk then
    raise exception 'Sauvegarde incomplète (config % / %, stock % / %)', n_cfg, s_cfg, n_stk, s_stk;
  end if;
  -- Sécurité : aucune ligne fautive ne doit avoir été modifiée par le terrain depuis l'import.
  if exists (select 1 from inventaire_bien_stock s
             where not exists (select 1 from bien_toolbox x where x.id = s.bien_id)
               and (s.statut <> 'a_verifier' or s.derniere_maj_par is not null or s.derniere_maj_at > '2026-05-27')) then
    raise exception 'Ligne de stock fautive modifiée après l''import : réparation manuelle requise';
  end if;
end $$;

delete from inventaire_bien_config c using inventaire_reparation_480 r
 where r.table_source = 'inventaire_bien_config' and r.ligne_id = c.id;
delete from inventaire_bien_stock s using inventaire_reparation_480 r
 where r.table_source = 'inventaire_bien_stock' and r.ligne_id = s.id;

-- Missions inventaire de mai restées en attente (doublons) → annulées, avec motif.
alter table public.inventaire_missions drop constraint if exists inventaire_missions_statut_check;
alter table public.inventaire_missions add constraint inventaire_missions_statut_check
  check (statut = any (array['en_attente','en_cours','complete','annulee']));
update public.inventaire_missions
   set statut = 'annulee',
       note = coalesce(note || ' — ', '') || 'Annulée le 19/10/2026 : doublon de la mission inventaire 602 terminée le 27/05/2026 (migration 480).'
 where statut = 'en_attente' and created_at < '2026-05-27';

-- Garde-fou à la source : l'inventaire ne peut plus être rangé sous autre chose qu'une fiche bien_toolbox.
alter table public.inventaire_bien_config  add constraint inventaire_bien_config_bien_toolbox_fkey
  foreign key (bien_id) references public.bien_toolbox(id);
alter table public.inventaire_bien_stock   add constraint inventaire_bien_stock_bien_toolbox_fkey
  foreign key (bien_id) references public.bien_toolbox(id);
alter table public.inventaire_mouvements   add constraint inventaire_mouvements_bien_toolbox_fkey
  foreign key (bien_id) references public.bien_toolbox(id);
alter table public.inventaire_missions     add constraint inventaire_missions_bien_toolbox_fkey
  foreign key (bien_id) references public.bien_toolbox(id);

comment on table public.inventaire_reparation_480 is
  'Sauvegarde des 4 224 lignes d''inventaire retirées le 19/10/2026 (pré-population du 26/05/2026 rangée sous bien.id). Voir migration 480.';

commit;
