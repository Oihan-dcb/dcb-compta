-- 570 — Politique d'annulation des résas DIRECTES / manuelles par bien (décision d'Oïhan, tableau du 23/10/2026) :
--   « les villas Stricte, les appartements Modérée ».
-- Réglage = bien_tarification cle 'annulation_contrat', canal 'tous', source 'powerhouse' (le même que la fiche
-- 💶 Tarification › « Annulation directe » ; lu par api/_direct.reglesBien, api/_resaManuelle.paiementParDefaut,
-- api/_paiementResa.paramsContratPour). Journal par bien automatique (trg_bien_tarification_journal, par = maj_par).
--
-- Périmètre : biens qui ont une fiche de vente directe (publiés, en essai ou préparés) + biens saisonniers sans fiche.
-- Règle : type_logement maison / villa → 'stricte' ; appartement, condominium, serviced_apartment, studio → 'moderee'.
-- Cas tranchés (type ambigu) :
--   · chambres de la Maison Maïté (BIXINTXO guesthouse, GAXUXA / IBANETA / PANTXIKA / TXOMIN bnb) → 'moderee' :
--     une chambre, séjours courts, relouée facilement ; la maison entière (M-MAITE) reste 'stricte'.
--   · ONGI (type non renseigné) → 'moderee' : annonce « Apartment close to the centre… ».
--   · GASQ (serviced_apartment), DUL2 / BGH (condominium) → 'moderee' (appartements).
-- Effet : nouveaux devis / contrats seulement. Un contrat existant garde sa politique (rental_contracts.politique_annulation,
-- relue par generate-contract à toute regénération, y compris la mise à jour automatique vers le modèle actif).
-- Idempotent : n'écrase JAMAIS un choix déjà saisi sur la fiche.

insert into public.bien_tarification (bien_id, cle, canal, source, texte, detail, maj_par)
select b.id, 'annulation_contrat', 'tous', 'powerhouse',
       case
         when b.code in ('BIXINTXO', 'GAXUXA', 'IBANETA', 'PANTXIKA', 'TXOMIN', 'ONGI') then 'moderee'
         when lower(coalesce(b.type_logement, '')) in ('maison', 'villa') then 'stricte'
         else 'moderee'
       end,
       'Règle du 23/10/2026 : villas et maisons Stricte, appartements Modérée',
       'oihan@destinationcotebasque.com (décision du 23/10/2026 appliquée par claude, migration 570)'
from public.bien b
where (exists (select 1 from public.bien_vente_directe v where v.bien_id = b.id)
       or (b.statut_location = 'saisonnier' and b.hors_mandat is not true))
  and (b.type_logement is not null or b.code = 'ONGI')
on conflict (bien_id, cle, canal, source) do nothing;
