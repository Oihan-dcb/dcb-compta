-- 337 — com_rattrapage.bien_id (06/10/2026) : rattache chaque rattrapage à un bien (donc à un
-- propriétaire) pour le détail par propriétaire du justificatif séquestre — un rattrapage peut ne
-- viser aucune résa unique (annulation COM ASKIDA août 2026 : 3 résas).
alter table public.com_rattrapage add column if not exists bien_id uuid references public.bien(id) on delete set null;
update public.com_rattrapage c set bien_id = r.bien_id from public.reservation r where r.id = c.reservation_id and c.bien_id is null;
update public.com_rattrapage c set bien_id = b.id from public.bien b where b.code = 'ASKIDA' and b.agence = 'dcb' and c.bien_id is null and c.libelle ilike '%ASKIDA%';
