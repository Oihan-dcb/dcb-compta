-- Migration 042 : locataires Lauian 2025-2026
-- 9 locataires : 2 étudiants, 2 mobilités, 5 habitations

-- ── 1. Propriétaire manquant ────────────────────────────────────────────────
INSERT INTO proprietaire (agence, nom, prenom) VALUES
  ('lauian', 'ETCHETO', 'Agnès')
ON CONFLICT DO NOTHING;

-- ── 2. Biens LLD déjà créés manuellement (hospitable_id requis not-null)
-- ST-CHARLES, CIRAUQUI-F, CIRAUQUI-P, HAISPOURE, DEMEURES-GOLF, AV-SURPRISE

-- ── 3. Locataires ────────────────────────────────────────────────────────────

-- 3a. MONTEIRO Anaïs — bail étudiant — Folle Brise — août 2025
INSERT INTO etudiant (
  agence, nom, prenom, email, telephone,
  bien_id, proprietaire_id,
  adresse_complete, date_entree, date_sortie_prevue,
  loyer_nu, supplement_loyer, charges_copro,
  honoraires_dcb, caution, jour_paiement_attendu,
  statut, type_bail
) VALUES (
  'lauian', 'Monteiro', 'Anaïs', 'anais.monteiro65@gmail.com', '+33768859456',
  (SELECT id FROM bien WHERE agence='lauian' AND code='FOLLE'),
  (SELECT id FROM proprietaire WHERE agence='lauian' AND nom='LOPEZ QUESADA'),
  '38 avenue de l''impératrice, 64200 BIARRITZ',
  '2025-08-30', '2026-05-30',
  51480, 9500, 5500,
  0, 121960, 5,
  'actif', 'etudiant'
);

-- 3b. BOISSY Yasmine — bail étudiant — St Charles — octobre 2025
INSERT INTO etudiant (
  agence, nom, prenom, telephone,
  bien_id, proprietaire_id,
  adresse_complete, date_entree, date_sortie_prevue,
  loyer_nu, charges_copro,
  honoraires_dcb, caution, jour_paiement_attendu,
  statut, type_bail
) VALUES (
  'lauian', 'Boissy', 'Yasmine', '0769724089',
  (SELECT id FROM bien WHERE agence='lauian' AND code='ST-CHARLES'),
  (SELECT id FROM proprietaire WHERE agence='lauian' AND nom='AIA BIARRITZ'),
  '18 rue Albert 1er, 1er étage porte droite, 64200 BIARRITZ',
  '2025-10-10', '2026-07-10',
  62500, 2500,
  0, 125000, 5,
  'actif', 'etudiant'
);

-- 3c. MAINGUENAUD Inès — bail mobilité — Folle Brise — avril 2026
INSERT INTO etudiant (
  agence, nom, prenom,
  bien_id, proprietaire_id,
  adresse_complete, date_entree, date_sortie_prevue,
  loyer_nu, charges_copro,
  honoraires_dcb, caution, jour_paiement_attendu,
  statut, type_bail
) VALUES (
  'lauian', 'Mainguenaud', 'Inès',
  (SELECT id FROM bien WHERE agence='lauian' AND code='FOLLE'),
  (SELECT id FROM proprietaire WHERE agence='lauian' AND nom='LOPEZ QUESADA'),
  '38 avenue de l''impératrice, 64200 BIARRITZ',
  '2026-04-01', '2026-06-15',
  51480, 5500,
  0, 0, 5,
  'actif', 'mobilite'
);

-- 3d. ROYER-DOUGUET Maïwen + ARRAMON Justine — bail mobilité — PAITOU — avril 2026 (colocation)
INSERT INTO etudiant (
  agence, nom, prenom,
  bien_id, proprietaire_id,
  adresse_complete, date_entree, date_sortie_prevue,
  loyer_nu, charges_eau, charges_copro,
  honoraires_dcb, caution, jour_paiement_attendu,
  statut, type_bail
) VALUES (
  'lauian', 'Royer-Douguet / Arramon', 'Maïwen / Justine',
  (SELECT id FROM bien WHERE id='97837ecf-4d36-4f41-9ed0-5ba00df99c6d'), -- PAITOU DCB
  (SELECT id FROM proprietaire WHERE id='2674144b-4188-43d6-b4f8-8d4683d9f297'), -- GUEDJ DCB
  '18 Rue des Petites Soeurs des Pauvres, 64200 BIARRITZ',
  '2026-04-04', '2026-06-20',
  64500, 1500, 1500,
  0, 0, 5,
  'actif', 'mobilite'
);

-- 3e. FREDOU Jean Claude + Anne Marie — bail habitation — 29 Av du Golf — sept 2025
INSERT INTO etudiant (
  agence, nom, prenom,
  bien_id, proprietaire_id,
  adresse_complete, date_entree, date_sortie_prevue,
  loyer_nu, charges_copro,
  honoraires_dcb, caution, jour_paiement_attendu,
  statut, type_bail
) VALUES (
  'lauian', 'Fredou', 'Jean-Claude et Anne-Marie',
  (SELECT id FROM bien WHERE agence='lauian' AND code='CIRAUQUI-F'),
  (SELECT id FROM proprietaire WHERE agence='lauian' AND nom='CIRAUQUI'),
  '29 avenue du Golf, étage 1 côté rue, 64200 BIARRITZ',
  '2025-09-10', NULL,
  143000, 0,
  0, 143000, 5,
  'actif', 'habitation'
);

-- 3f. POISSON Christophe + Fatima — bail habitation — 29 Av du Golf — mai 2025
INSERT INTO etudiant (
  agence, nom, prenom,
  bien_id, proprietaire_id,
  adresse_complete, date_entree, date_sortie_prevue,
  loyer_nu, charges_copro,
  honoraires_dcb, caution, jour_paiement_attendu,
  statut, type_bail
) VALUES (
  'lauian', 'Poisson', 'Christophe et Fatima',
  (SELECT id FROM bien WHERE agence='lauian' AND code='CIRAUQUI-P'),
  (SELECT id FROM proprietaire WHERE agence='lauian' AND nom='CIRAUQUI'),
  '29 avenue du Golf, 64200 BIARRITZ',
  '2025-05-01', NULL,
  120350, 15000,
  0, 120350, 5,
  'actif', 'habitation'
);

-- 3g. CALABRESE Adrien — bail habitation — Haispoure Guéthary — mai 2025
INSERT INTO etudiant (
  agence, nom, prenom,
  bien_id, proprietaire_id,
  adresse_complete, date_entree, date_sortie_prevue,
  loyer_nu, charges_copro,
  honoraires_dcb, caution, jour_paiement_attendu,
  statut, type_bail
) VALUES (
  'lauian', 'Calabrese', 'Adrien',
  (SELECT id FROM bien WHERE agence='lauian' AND code='HAISPOURE'),
  (SELECT id FROM proprietaire WHERE agence='lauian' AND nom='LAMAIGNERE'),
  '100 Chemin d''Haispoure, Villa Ene-Phartea, 64210 GUETHARY',
  '2025-05-29', '2028-05-29',
  110000, 0,
  0, 110000, 5,
  'actif', 'habitation'
);

-- 3h. HEYBERGER Clément — bail habitation — Demeures du Golf — mai 2025
INSERT INTO etudiant (
  agence, nom, prenom,
  bien_id, proprietaire_id,
  adresse_complete, date_entree, date_sortie_prevue,
  loyer_nu, charges_copro,
  honoraires_dcb, caution, jour_paiement_attendu,
  statut, type_bail
) VALUES (
  'lauian', 'Heyberger', 'Clément',
  (SELECT id FROM bien WHERE agence='lauian' AND code='DEMEURES-GOLF'),
  (SELECT id FROM proprietaire WHERE agence='lauian' AND nom='MUGNAI'),
  '22 boulevard Saint-Madeleine, Bat A1 n°133, Demeures du Golf, 64200 BIARRITZ',
  '2025-05-01', NULL,
  69500, 2500,
  0, 69500, 5,
  'actif', 'habitation'
);

-- 3i. SAKON Alexandre + GINOSSAR Noam — bail habitation — Av de Surprise — oct 2023
INSERT INTO etudiant (
  agence, nom, prenom, email, telephone,
  bien_id, proprietaire_id,
  adresse_complete, date_entree, date_sortie_prevue,
  loyer_nu, charges_copro,
  honoraires_dcb, caution, jour_paiement_attendu,
  statut, type_bail
) VALUES (
  'lauian', 'Sakon / Ginossar', 'Alexandre / Noam', 'alexsakon@yahoo.com', '0762136946',
  (SELECT id FROM bien WHERE agence='lauian' AND code='AV-SURPRISE'),
  (SELECT id FROM proprietaire WHERE agence='lauian' AND nom='ETCHETO'),
  '34 avenue de Surprise, 64200 BIARRITZ',
  '2023-10-05', NULL,
  180000, 0,
  0, 180000, 5,
  'actif', 'habitation'
);

-- ── 4. Caution suivi ─────────────────────────────────────────────────────────
INSERT INTO caution_suivi (agence, etudiant_id, statut)
SELECT 'lauian', id, 'en_cours' FROM etudiant
WHERE agence = 'lauian'
AND nom IN (
  'Monteiro','Boissy','Mainguenaud','Royer-Douguet / Arramon',
  'Fredou','Poisson','Calabrese','Heyberger','Sakon / Ginossar'
);

-- ── 5. Loyers mensuels ───────────────────────────────────────────────────────
-- Générer pour chaque locataire de la date_entree au mois en cours ou date_sortie_prevue

INSERT INTO loyer_suivi (agence, etudiant_id, mois, statut)
SELECT
  'lauian',
  e.id,
  to_char(m, 'YYYY-MM'),
  'attendu'
FROM etudiant e
CROSS JOIN LATERAL generate_series(
  date_trunc('month', e.date_entree),
  LEAST(
    date_trunc('month', COALESCE(e.date_sortie_prevue, current_date + interval '1 month')),
    date_trunc('month', current_date + interval '1 month')
  ),
  interval '1 month'
) AS m
WHERE e.agence = 'lauian'
AND e.nom IN (
  'Monteiro','Boissy','Mainguenaud','Royer-Douguet / Arramon',
  'Fredou','Poisson','Calabrese','Heyberger','Sakon / Ginossar'
)
ON CONFLICT DO NOTHING;

-- ── 6. Marquer SAKON payés jan 2025 → nov 2025 ──────────────────────────────
UPDATE loyer_suivi SET
  statut = 'recu',
  montant_recu = 180000,
  date_reception = (mois || '-05')::date
WHERE etudiant_id = (SELECT id FROM etudiant WHERE agence='lauian' AND nom='Sakon / Ginossar')
AND mois >= '2023-10' AND mois <= '2025-11';

-- ── 7. Vérification ──────────────────────────────────────────────────────────
SELECT nom, prenom, type_bail, date_entree,
       (SELECT COUNT(*) FROM loyer_suivi l WHERE l.etudiant_id = e.id) AS nb_loyers
FROM etudiant e WHERE agence = 'lauian' ORDER BY date_entree;
