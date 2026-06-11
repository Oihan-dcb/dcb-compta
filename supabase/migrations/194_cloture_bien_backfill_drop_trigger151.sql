-- Bascule du verrou de facturation : per-proprio (trigger 151) -> per-bien (cloture_bien + RLS 193).
-- 1. Backfill cloture_bien depuis les factures deja envoyees (AVANT de retirer 151).
--    INSERT unique avec UNION + distinct on -> pas de doublon entre mono-bien et groupe.
insert into cloture_bien (agence, bien_id, mois, facture_id, closed_by)
select distinct on (bien_id, mois) agence, bien_id, mois, facture_id, closed_by
from (
  -- a) factures mono-bien
  select f.agence as agence, f.bien_id as bien_id, f.mois as mois, f.id as facture_id, 'backfill_151' as closed_by
  from facture_evoliz f
  where f.statut in ('envoye_evoliz','payee') and f.type_facture <> 'com' and f.bien_id is not null
  union all
  -- b) factures de groupe (bien_id null = Maite) -> tous les biens du proprietaire
  select f.agence, b.id, f.mois, f.id, 'backfill_151_grp'
  from facture_evoliz f join bien b on b.proprietaire_id = f.proprietaire_id
  where f.statut in ('envoye_evoliz','payee') and f.type_facture <> 'com' and f.bien_id is null
) s
where not exists (select 1 from cloture_bien c where c.bien_id = s.bien_id and c.mois = s.mois and c.active)
order by bien_id, mois;

-- 2. Retrait du trigger per-proprio (sur-verrouille) -> remplace par cloture_bien per-bien + RLS 193
drop trigger if exists prestation_invoice_lock on prestation_hors_forfait;
drop function if exists block_prestation_after_invoice_sent();
