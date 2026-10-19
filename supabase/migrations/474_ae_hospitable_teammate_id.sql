-- 474 — Lien explicite AE ↔ teammate Hospitable (19/10/2026).
-- api/hospitable-task-create.js (PowerHouse) retrouvait le teammate de l'AE uniquement par e-mail ;
-- Esteban et Léa ont un e-mail Hospitable différent de leur e-mail PowerHouse (le bon, décision
-- Oïhan) → tâches créées non assignées. L'API Hospitable ne permet pas de modifier les teammates.
-- Désormais : hospitable_teammate_id d'abord, l'e-mail en repli (et l'id trouvé est mémorisé).
-- Le teammate « TECHNIQUE Clément » (faux compte maintenance, e-mail de Laura) n'est relié à personne.

alter table public.auto_entrepreneur add column if not exists hospitable_teammate_id text;
comment on column public.auto_entrepreneur.hospitable_teammate_id is
  'UUID du teammate Hospitable (/v2/teammates) de cet AE/staff. Prioritaire sur l''e-mail pour assigner les tâches créées depuis PowerHouse. Réglable depuis la fiche Staff.';

create unique index if not exists auto_entrepreneur_hospitable_teammate_id_uniq
  on public.auto_entrepreneur (hospitable_teammate_id) where hospitable_teammate_id is not null;

-- Liens vérifiés via GET /v2/teammates le 19/10/2026 (AE actifs).
-- E-mail identique (insensible à la casse) :
update public.auto_entrepreneur set hospitable_teammate_id = v.tm
from (values
  ('cam.chatelain@hotmail.fr', '7b84d8f8-1318-4bce-9068-2ef140b149ff'), -- Camille Chatelain
  ('c.ploquin@icloud.com',     '6ae4b6cc-00d5-4768-a3b9-5078fe14d4b1'), -- Clémence Ploquin
  ('katkeys33@gmail.com',      '0372a0b9-d5a7-48b4-8f58-cadd13e45d40'), -- Kathy Lerot
  ('lauracoursan@hotmail.fr',  '5d42179c-0f66-4295-baf1-0f0a04b361ae'), -- Laura Coursan
  ('oihan64@gmail.com',        '838a84d7-6077-4513-b1ad-23151eb4086a'), -- Oïhan Campandegui
  ('xanelarzabal@gmail.com',   '387a990e-1362-4e31-ad13-be55ea551ad3'), -- Xane Larzabal
  -- E-mails différents, lien décidé par Oïhan :
  ('garridonet.services@gmail.com', 'd2dd6180-b794-494f-9a77-2f083d10055e'), -- Esteban Garrido (Hospitable esteban.2002.eg@icloud.com)
  ('lea@destinationbordeaux.com',   'a0ff8efe-fcfe-4dd5-96cb-c1e7bbdcca2b')  -- Léa Escudier (Hospitable lea.escudier@gmail.com)
) as v(email, tm)
where lower(trim(auto_entrepreneur.email)) = v.email
  and auto_entrepreneur.actif = true
  and auto_entrepreneur.hospitable_teammate_id is null;
