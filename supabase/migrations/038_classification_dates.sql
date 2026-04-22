-- Migration 038 : dates de classement meublés de tourisme
-- Ajout classification_date et classification_fin sur bien
-- Source : tableur CLASSEMENT APPARTS (mise à jour avril 2026)

ALTER TABLE bien
  ADD COLUMN IF NOT EXISTS classification_date date,
  ADD COLUMN IF NOT EXISTS classification_fin date;

-- ============================================================
-- Mise à jour des biens déjà classés (IDs connus depuis 037)
-- ============================================================

-- 1★
UPDATE bien SET classification_date = '2023-05-16', classification_fin = '2028-05-16'
  WHERE hospitable_id = '584b70e0-d939-4151-af56-70ae9baacd63'; -- 416 Harea

UPDATE bien SET classification_date = '2024-04-11', classification_fin = '2029-04-11'
  WHERE hospitable_id = '785e19ce-18b5-469c-b446-07de57641eed'; -- 602 Horizonte

UPDATE bien SET classification_date = '2025-06-23', classification_fin = '2030-06-23'
  WHERE hospitable_id = '36a44e1b-198f-4202-831b-2e23b0e10084'; -- Aïta

UPDATE bien SET classification_date = '2023-05-30', classification_fin = '2028-05-30'
  WHERE hospitable_id = '85b5e645-4358-4dd5-ab0f-3dd1d8837eb4'; -- Askida

UPDATE bien SET classification_date = '2025-04-03', classification_fin = '2030-04-03'
  WHERE hospitable_id = '990250bb-71b9-4c5d-afac-ee947b4fe26a'; -- Ekia

UPDATE bien SET classification_date = '2024-04-11', classification_fin = '2029-04-11'
  WHERE hospitable_id = '151c7c91-1ce3-425f-8194-8f14c826dabf'; -- Lagréou

UPDATE bien SET classification_date = '2023-05-12', classification_fin = '2028-05-12'
  WHERE hospitable_id = '55932450-d681-413a-a2be-f4ca9187c748'; -- Zurbiac

UPDATE bien SET classification_fin = '2031-03-19'
  WHERE hospitable_id = 'dd9c282a-f388-47d0-b33e-49d8b492aaf8'; -- Alaïa (date début inconnue)

-- 2★ → reste 2★ pour Vicky, ajout dates
UPDATE bien SET classification_date = '2025-04-03', classification_fin = '2030-04-03'
  WHERE hospitable_id = 'f3c3fc01-4efe-4da1-ab4d-13da24a2424b'; -- Vicky

-- DUL2 passe 2★ → 3★ + dates
UPDATE bien SET classification = '3_etoiles', classification_date = '2025-04-09', classification_fin = '2030-04-09'
  WHERE hospitable_id = '8b0c8624-eeb7-4755-92c3-f5d3419f6bbc'; -- DUL2 Maitasuna

-- 3★
UPDATE bien SET classification_date = '2025-04-03', classification_fin = '2030-04-03'
  WHERE hospitable_id = '6e2c1986-473c-4d77-8102-03a4ee71ec46'; -- MOB Mendi

UPDATE bien SET classification_date = '2025-12-18', classification_fin = '2025-12-18'
  WHERE hospitable_id = 'ba6e29a4-5574-4019-b05e-45dd35925745'; -- Patxi (expiré)

UPDATE bien SET classification_fin = '2031-03-19'
  WHERE hospitable_id = 'fd53c6e0-0d49-4c0b-a438-27b9527c7d35'; -- Munduz

-- 4★
UPDATE bien SET classification_date = '2022-04-04', classification_fin = '2027-04-04'
  WHERE hospitable_id = '52771fa8-57fd-4d60-ba86-eb289a94de7e'; -- Ceres

-- Maison Maïté 5★
UPDATE bien SET classification_date = '2025-04-04', classification_fin = '2030-04-04'
  WHERE hospitable_id = '8cb4f313-ecad-4d49-a6ad-58eff2607df0'; -- Maison Maïté

-- ============================================================
-- Nouveaux biens classés (IDs inconnus → matching par nom)
-- ============================================================

-- Etxea 1★
UPDATE bien SET classification = '1_etoile', classification_date = '2025-07-01', classification_fin = '2030-07-01'
  WHERE hospitable_name ILIKE '%Etxea%' OR code ILIKE 'ETXEA';

-- Mira Marvel 2★
UPDATE bien SET classification = '2_etoiles', classification_date = '2025-07-15', classification_fin = '2030-07-15'
  WHERE hospitable_name ILIKE '%Mira Marvel%' OR code ILIKE '%MIRA%';

-- Eneko 2★ (dates inconnues)
UPDATE bien SET classification = '2_etoiles'
  WHERE hospitable_name ILIKE '%Eneko%' OR code ILIKE 'ENEKO';

-- Lagun 3★
UPDATE bien SET classification = '3_etoiles', classification_date = '2025-03-19', classification_fin = '2030-03-19'
  WHERE hospitable_name ILIKE '%Lagun%' OR code ILIKE 'LAGUN';

-- Amaïa - Gascogne Bis 3★
UPDATE bien SET classification = '3_etoiles', classification_date = '2025-05-21', classification_fin = '2030-05-21'
  WHERE hospitable_name ILIKE '%Amaïa%' OR hospitable_name ILIKE '%Amaia%' OR hospitable_name ILIKE '%Gascogne%';

-- Egoa 3★ (expiré 07/05/2025)
UPDATE bien SET classification = '3_etoiles', classification_date = '2025-05-07', classification_fin = '2025-05-07'
  WHERE hospitable_name ILIKE '%Egoa%' OR code ILIKE 'EGOA';

-- Villa Silvana 3★
UPDATE bien SET classification = '3_etoiles', classification_date = '2025-03-28', classification_fin = '2030-03-28'
  WHERE hospitable_name ILIKE '%Silvana%' OR code ILIKE '%SILVANA%';

-- Villa Arossa 4★
UPDATE bien SET classification = '4_etoiles', classification_date = '2025-07-03', classification_fin = '2030-07-03'
  WHERE hospitable_name ILIKE '%Arossa%' OR code ILIKE '%AROSSA%';

-- Villa Augusta 5★
UPDATE bien SET classification = '5_etoiles', classification_date = '2025-04-09', classification_fin = '2030-04-09'
  WHERE hospitable_name ILIKE '%Augusta%' OR code ILIKE '%AUGUSTA%';

-- Villa Txoria 3★ (dates inconnues)
UPDATE bien SET classification = '3_etoiles'
  WHERE hospitable_name ILIKE '%Txoria%' OR code ILIKE '%TXORIA%';

-- Villa berdea 4★ (dates inconnues)
UPDATE bien SET classification = '4_etoiles'
  WHERE hospitable_name ILIKE '%berdea%' OR hospitable_name ILIKE '%Berdea%' OR code ILIKE '%BERDEA%';
