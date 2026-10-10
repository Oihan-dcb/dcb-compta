-- 386 — Index reservation(departure_date) et reservation(code) (10/10/2026) : la table est lourde (hospitable_raw),
-- un parcours complet coûte ~0,5 s ; mission_ecarts() (Lot 3a hub des tâches, 384-385) et les alertes « séjour
-- sans ménage » filtrent par date de départ, la règle « ménage sans séjour » cherche la résa par code.
-- mission_ecart_v : 1,4 s → 0,17 s. Additif, aucun effet métier.
create index if not exists idx_reservation_departure_date on public.reservation (departure_date);
create index if not exists idx_reservation_code on public.reservation (code);
