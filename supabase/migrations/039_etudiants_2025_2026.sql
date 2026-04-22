-- Migration 039 : Peuplement étudiants/mobilité 2025-2026
-- Source : PDF "Etudiants:Mobilité DCB 2025-2026" (avril 2026)
-- 9 baux étudiants + 3 bails mobilité
-- Montants en centimes

-- ============================================================
-- SECTION 1 : ÉTUDIANTS
-- ============================================================

INSERT INTO etudiant (agence, nom, prenom, bien_id, proprietaire_id, date_entree, date_sortie_prevue, date_sortie_reelle, loyer_nu, honoraires_dcb, caution, jour_paiement_attendu, statut)
VALUES

-- Ninon BERTHOUMIEUX — LAGREOU — étudiant 01/09/25→29/06/26 — DCB 0% (proprio reçoit tout)
('dcb', 'Berthoumieux', 'Ninon',
  (SELECT id FROM bien WHERE code = 'LAGREOU' LIMIT 1),
  (SELECT proprietaire_id FROM bien WHERE code = 'LAGREOU' LIMIT 1),
  '2025-09-01', '2026-06-29', NULL,
  67050, 0, 122100, 1, 'actif'),

-- Mathilde ROUCH — 506P — étudiant 07/09/25→05/06/26 — Mandat 33
('dcb', 'Rouch', 'Mathilde',
  (SELECT id FROM bien WHERE code = '506' OR hospitable_name ILIKE '%506%' LIMIT 1),
  (SELECT proprietaire_id FROM bien WHERE code = '506' OR hospitable_name ILIKE '%506%' LIMIT 1),
  '2025-09-07', '2026-06-05', NULL,
  79000, 7900, 148000, 5, 'actif'),

-- Solène COTTRELLE — 408P — étudiant 29/09/25→30/06/26 — Mandat 32
('dcb', 'Cottrelle', 'Solène',
  (SELECT id FROM bien WHERE code = '408' OR hospitable_name ILIKE '%408%' LIMIT 1),
  (SELECT proprietaire_id FROM bien WHERE code = '408' OR hospitable_name ILIKE '%408%' LIMIT 1),
  '2025-09-29', '2026-06-30', NULL,
  79000, 7900, 148000, 1, 'actif'),

-- Mariana — PATXI — étudiant 01/09/25→30/06/26 — Mandat 34 (nom complet inconnu)
('dcb', 'Mariana', NULL,
  (SELECT id FROM bien WHERE code = 'PATXI' LIMIT 1),
  (SELECT proprietaire_id FROM bien WHERE code = 'PATXI' LIMIT 1),
  '2025-09-01', '2026-06-30', NULL,
  96000, 9600, 97000, 1, 'actif'),

-- Léa MAGNON — Aguerre Palais — étudiant 06/09/25→06/06/26 — DCB 0%
('dcb', 'Magnon', 'Léa',
  (SELECT id FROM bien WHERE hospitable_name ILIKE '%Aguerre%' OR hospitable_name ILIKE '%Palais%' LIMIT 1),
  (SELECT proprietaire_id FROM bien WHERE hospitable_name ILIKE '%Aguerre%' OR hospitable_name ILIKE '%Palais%' LIMIT 1),
  '2025-09-06', '2026-06-06', NULL,
  37100, 0, 29100, 1, 'actif'),

-- Lilou LALÈS — DUL2 — étudiant 20/09/25→20/06/26
('dcb', 'Lalès', 'Lilou',
  (SELECT id FROM bien WHERE code = 'DUL2' LIMIT 1),
  (SELECT proprietaire_id FROM bien WHERE code = 'DUL2' LIMIT 1),
  '2025-09-20', '2026-06-20', NULL,
  84000, 8400, 144000, 1, 'actif'),

-- Adrien THÈSE — NICOLLE — étudiant 06/09/25→30/06/26
('dcb', 'Thèse', 'Adrien',
  (SELECT id FROM bien WHERE code ILIKE '%NICOL%' OR hospitable_name ILIKE '%Nicol%' LIMIT 1),
  (SELECT proprietaire_id FROM bien WHERE code ILIKE '%NICOL%' OR hospitable_name ILIKE '%Nicol%' LIMIT 1),
  '2025-09-06', '2026-06-30', NULL,
  61190, 6119, 93380, 5, 'actif'),

-- Inès LECINA — FOCH — étudiant depuis 27/09/25 (fin inconnue)
('dcb', 'Lecina', 'Inès',
  (SELECT id FROM bien WHERE code = 'FOCH' OR hospitable_name ILIKE '%Foch%' LIMIT 1),
  (SELECT proprietaire_id FROM bien WHERE code = 'FOCH' OR hospitable_name ILIKE '%Foch%' LIMIT 1),
  '2025-09-27', NULL, NULL,
  60300, 6030, 108800, 1, 'actif'),

-- Baptiste PAITOU — PAITOU — étudiant depuis 22/12/25
('dcb', 'Paitou', 'Baptiste',
  (SELECT id FROM bien WHERE code ILIKE 'PAITOU' OR hospitable_name ILIKE '%Paitou%' LIMIT 1),
  (SELECT proprietaire_id FROM bien WHERE code ILIKE 'PAITOU' OR hospitable_name ILIKE '%Paitou%' LIMIT 1),
  '2025-12-22', NULL, NULL,
  70500, 7050, 64500, 1, 'actif'),

-- Thomas MORANDIÈRE — PAITOU — mobilité 10/04/25→10/09/25 (PARTI)
('dcb', 'Morandière', 'Thomas',
  (SELECT id FROM bien WHERE code ILIKE 'PAITOU' OR hospitable_name ILIKE '%Paitou%' LIMIT 1),
  (SELECT proprietaire_id FROM bien WHERE code ILIKE 'PAITOU' OR hospitable_name ILIKE '%Paitou%' LIMIT 1),
  '2025-04-10', '2025-09-10', '2025-09-10',
  95000, 9500, 0, 10, 'parti'),

-- Emma — PAITOU — mobilité (PARTIE ~20/11/25)
('dcb', 'Emma', NULL,
  (SELECT id FROM bien WHERE code ILIKE 'PAITOU' OR hospitable_name ILIKE '%Paitou%' LIMIT 1),
  (SELECT proprietaire_id FROM bien WHERE code ILIKE 'PAITOU' OR hospitable_name ILIKE '%Paitou%' LIMIT 1),
  '2025-10-01', '2025-11-20', '2025-11-20',
  76500, 7650, 0, 1, 'parti'),

-- Ebony — ASKIDA — mobilité (active, caution 900€)
('dcb', 'Ebony', NULL,
  (SELECT id FROM bien WHERE code = 'ASKIDA' LIMIT 1),
  (SELECT proprietaire_id FROM bien WHERE code = 'ASKIDA' LIMIT 1),
  '2025-10-01', NULL, NULL,
  90000, 0, 90000, 1, 'actif');

-- ============================================================
-- SECTION 2 : CAUTION SUIVI
-- ============================================================

INSERT INTO caution_suivi (etudiant_id, agence, statut)
SELECT
  e.id,
  'dcb',
  CASE
    WHEN e.statut = 'parti' AND e.caution = 0 THEN 'rendue'
    WHEN e.statut = 'parti' THEN 'a_rendre'
    ELSE 'en_cours'
  END
FROM etudiant e
WHERE e.agence = 'dcb'
  AND e.nom IN ('Berthoumieux','Rouch','Cottrelle','Mariana','Magnon','Lalès',
                'Thèse','Lecina','Paitou','Morandière','Emma','Ebony')
ON CONFLICT (etudiant_id) DO NOTHING;

-- ============================================================
-- SECTION 3 : LOYER_SUIVI — génération mois (statut attendu)
-- ============================================================

INSERT INTO loyer_suivi (etudiant_id, agence, mois, statut)
SELECT
  e.id,
  'dcb',
  to_char(gs, 'YYYY-MM'),
  'attendu'
FROM etudiant e
CROSS JOIN LATERAL generate_series(
  date_trunc('month', e.date_entree),
  date_trunc('month', COALESCE(e.date_sortie_reelle, e.date_sortie_prevue, '2026-06-01'::date)),
  '1 month'::interval
) AS gs
WHERE e.agence = 'dcb'
  AND e.nom IN ('Berthoumieux','Rouch','Cottrelle','Mariana','Magnon','Lalès',
                'Thèse','Lecina','Paitou','Morandière','Emma','Ebony')
ON CONFLICT (etudiant_id, mois) DO NOTHING;

-- ============================================================
-- SECTION 4 : LOYER_SUIVI — mise à jour reçus Sep–Déc 2025
-- ============================================================

-- Helper : identifie etudiant_id par nom/prénom pour les UPDATEs ci-dessous

-- SEPTEMBRE 2025
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-09-01', montant_recu=67050
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Berthoumieux' AND ls.mois='2025-09';
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-09-18', montant_recu=63200
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Rouch' AND ls.mois='2025-09';
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-09-29', montant_recu=5300
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Cottrelle' AND ls.mois='2025-09';
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-09-19', montant_recu=96000
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Mariana' AND ls.mois='2025-09';
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-09-19', montant_recu=29680
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Magnon' AND ls.mois='2025-09';
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-09-23', montant_recu=44800
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Lalès' AND ls.mois='2025-09';
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-09-08', montant_recu=50991
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Thèse' AND ls.mois='2025-09';
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-09-26', montant_recu=8040
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Lecina' AND ls.mois='2025-09';
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-09-03', montant_recu=31600
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Morandière' AND ls.mois='2025-09';

-- OCTOBRE 2025
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-10-02', montant_recu=67050
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Berthoumieux' AND ls.mois='2025-10';
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-10-06', montant_recu=79000
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Rouch' AND ls.mois='2025-10';
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-10-06', montant_recu=79000
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Cottrelle' AND ls.mois='2025-10';
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-10-02', montant_recu=96000
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Mariana' AND ls.mois='2025-10';
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-10-03', montant_recu=37100
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Magnon' AND ls.mois='2025-10';
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-10-01', montant_recu=84000
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Lalès' AND ls.mois='2025-10';
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-10-06', montant_recu=61190
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Thèse' AND ls.mois='2025-10';
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-10-01', montant_recu=60300
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Lecina' AND ls.mois='2025-10';
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-10-03', montant_recu=76500
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Emma' AND ls.mois='2025-10';
-- Ebony Oct payé le 14/11 (en retard)
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-11-14', montant_recu=102400
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Ebony' AND ls.mois='2025-10';

-- NOVEMBRE 2025
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-11-03', montant_recu=67050
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Berthoumieux' AND ls.mois='2025-11';
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-11-06', montant_recu=79000
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Rouch' AND ls.mois='2025-11';
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-11-03', montant_recu=79000
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Cottrelle' AND ls.mois='2025-11';
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-11-04', montant_recu=96000
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Mariana' AND ls.mois='2025-11';
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-11-03', montant_recu=37100
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Magnon' AND ls.mois='2025-11';
-- Lilou Nov payé le 29/10 (en avance)
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-10-29', montant_recu=84000
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Lalès' AND ls.mois='2025-11';
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-11-06', montant_recu=61190
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Thèse' AND ls.mois='2025-11';
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-11-03', montant_recu=60300
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Lecina' AND ls.mois='2025-11';
-- Emma : mois partiel (départ ~20/11), 510€
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-11-03', montant_recu=51000
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Emma' AND ls.mois='2025-11';
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-11-29', montant_recu=103700
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Ebony' AND ls.mois='2025-11';

-- DÉCEMBRE 2025
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-12-02', montant_recu=67050
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Berthoumieux' AND ls.mois='2025-12';
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-12-02', montant_recu=79000
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Rouch' AND ls.mois='2025-12';
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-12-02', montant_recu=79000
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Cottrelle' AND ls.mois='2025-12';
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-12-02', montant_recu=96000
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Mariana' AND ls.mois='2025-12';
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-12-02', montant_recu=37100
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Magnon' AND ls.mois='2025-12';
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-12-01', montant_recu=84000
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Lalès' AND ls.mois='2025-12';
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-12-08', montant_recu=61190
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Thèse' AND ls.mois='2025-12';
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-12-08', montant_recu=60300
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Lecina' AND ls.mois='2025-12';
-- Baptiste : 1er mois proraté 22/12 → 31/12 = 227.42€
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-12-22', montant_recu=22742
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Paitou' AND ls.mois='2025-12';
UPDATE loyer_suivi ls SET statut='recu', date_reception='2025-12-22', montant_recu=90000
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Ebony' AND ls.mois='2025-12';

-- Thomas : Apr–Août 2025 marqués reçus (bail terminé, données non disponibles)
UPDATE loyer_suivi ls SET statut='recu'
  FROM etudiant e WHERE ls.etudiant_id=e.id AND e.nom='Morandière'
  AND ls.mois IN ('2025-04','2025-05','2025-06','2025-07','2025-08');

-- ============================================================
-- SECTION 5 : VIREMENT PROPRIO — historique Sep–Déc 2025
-- ============================================================

-- SEPTEMBRE 2025 virements propriétaires
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-09', 'vire', '2025-09-15', 67050
  FROM etudiant e WHERE e.nom='Berthoumieux';
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-09', 'vire', '2025-09-19', 56880
  FROM etudiant e WHERE e.nom='Rouch';
-- Solène Sep viré en décembre
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-09', 'vire', '2025-12-23', 4770
  FROM etudiant e WHERE e.nom='Cottrelle';
-- Mariana : 864 - 125 facture artisan = 739
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-09', 'vire', '2025-09-10', 73900
  FROM etudiant e WHERE e.nom='Mariana';
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-09', 'vire', '2025-09-20', 29680
  FROM etudiant e WHERE e.nom='Magnon';
-- Lilou Sep viré en décembre
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-09', 'vire', '2025-12-23', 40320
  FROM etudiant e WHERE e.nom='Lalès';
-- Adrien Sep viré en décembre
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-09', 'vire', '2025-12-23', 45892
  FROM etudiant e WHERE e.nom='Thèse';
-- Inès Sep viré en décembre
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-09', 'vire', '2025-12-23', 7236
  FROM etudiant e WHERE e.nom='Lecina';
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-09', 'vire', '2025-09-05', 28440
  FROM etudiant e WHERE e.nom='Morandière';

-- OCTOBRE 2025 virements propriétaires
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-10', 'vire', '2025-10-09', 67050 FROM etudiant e WHERE e.nom='Berthoumieux';
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-10', 'vire', '2025-10-09', 71100 FROM etudiant e WHERE e.nom='Rouch';
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-10', 'vire', '2025-10-09', 71100 FROM etudiant e WHERE e.nom='Cottrelle';
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-10', 'vire', '2025-10-09', 86400 FROM etudiant e WHERE e.nom='Mariana';
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-10', 'vire', '2025-10-09', 37100 FROM etudiant e WHERE e.nom='Magnon';
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-10', 'vire', '2025-10-09', 75600 FROM etudiant e WHERE e.nom='Lalès';
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-10', 'vire', '2025-10-09', 55071 FROM etudiant e WHERE e.nom='Thèse';
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-10', 'vire', '2025-10-09', 54270 FROM etudiant e WHERE e.nom='Lecina';
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-10', 'vire', '2025-10-08', 68850 FROM etudiant e WHERE e.nom='Emma';
-- Ebony Oct viré le 01/12
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-10', 'vire', '2025-12-01', 102400 FROM etudiant e WHERE e.nom='Ebony';

-- NOVEMBRE 2025 virements propriétaires
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-11', 'vire', '2025-11-07', 67050 FROM etudiant e WHERE e.nom='Berthoumieux';
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-11', 'vire', '2025-11-07', 71100 FROM etudiant e WHERE e.nom='Rouch';
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-11', 'vire', '2025-11-07', 71100 FROM etudiant e WHERE e.nom='Cottrelle';
-- Mariana Nov : 864 - 100 artisan = 764
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-11', 'vire', '2025-11-07', 76400 FROM etudiant e WHERE e.nom='Mariana';
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-11', 'vire', '2025-11-07', 37100 FROM etudiant e WHERE e.nom='Magnon';
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-11', 'vire', '2025-11-07', 75600 FROM etudiant e WHERE e.nom='Lalès';
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-11', 'vire', '2025-11-07', 55071 FROM etudiant e WHERE e.nom='Thèse';
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-11', 'vire', '2025-11-07', 54270 FROM etudiant e WHERE e.nom='Lecina';
-- Emma Nov : départ le 20 → 510€ loyer, 239€ proprio (après déduction 220 artisan)
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-11', 'vire', '2025-11-07', 23900 FROM etudiant e WHERE e.nom='Emma';
-- Ebony Nov viré le 01/12
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-11', 'vire', '2025-12-01', 103700 FROM etudiant e WHERE e.nom='Ebony';

-- DÉCEMBRE 2025 virements propriétaires
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-12', 'vire', '2025-12-08', 67050 FROM etudiant e WHERE e.nom='Berthoumieux';
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-12', 'vire', '2025-12-08', 71100 FROM etudiant e WHERE e.nom='Rouch';
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-12', 'vire', '2025-12-08', 71100 FROM etudiant e WHERE e.nom='Cottrelle';
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-12', 'vire', '2025-12-08', 86400 FROM etudiant e WHERE e.nom='Mariana';
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-12', 'vire', '2025-12-08', 37100 FROM etudiant e WHERE e.nom='Magnon';
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-12', 'vire', '2025-12-08', 75600 FROM etudiant e WHERE e.nom='Lalès';
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-12', 'vire', '2025-12-08', 55071 FROM etudiant e WHERE e.nom='Thèse';
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-12', 'vire', '2025-12-08', 54270 FROM etudiant e WHERE e.nom='Lecina';
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-12', 'vire', '2025-12-23', 20468 FROM etudiant e WHERE e.nom='Paitou';
INSERT INTO virement_proprio_suivi (etudiant_id, agence, mois, statut, date_virement, montant)
SELECT e.id, 'dcb', '2025-12', 'vire', '2025-12-23', 90000 FROM etudiant e WHERE e.nom='Ebony';

-- Thomas Sep virement déjà inséré ci-dessus (section Sep)
