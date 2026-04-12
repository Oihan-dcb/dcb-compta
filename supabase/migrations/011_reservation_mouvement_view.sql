-- Migration 011 : Vue métier reservation_mouvement
-- Lecture simple : quelle transaction bancaire réelle est rapprochée à quelle réservation
-- Source : encaissement_allocation (table technique inchangée)
-- Filtre : mouvement_bancaire_id IS NOT NULL → uniquement les encaissements prouvés par la banque

CREATE OR REPLACE VIEW reservation_mouvement AS
SELECT
  reservation_id,
  mouvement_bancaire_id,
  bien_id,
  mois_comptable,
  montant_alloue          AS credit_retenu_centimes,
  source_type             AS source_rapprochement,
  created_at,
  updated_at
FROM encaissement_allocation
WHERE mouvement_bancaire_id IS NOT NULL;

-- Note : les index de performance sont sur la table source encaissement_allocation :
--   idx_encaiss_alloc_mois_bien   → (mois_comptable, bien_id)    ← couvre les requêtes par mois/bien
--   idx_encaiss_alloc_reservation → (reservation_id)              ← couvre les lookups par résa
--   idx_encaiss_alloc_mouvement   → (mouvement_bancaire_id)       ← couvre les lookups par mouvement
-- Ces index bénéficient directement à la vue — aucun index supplémentaire nécessaire.
