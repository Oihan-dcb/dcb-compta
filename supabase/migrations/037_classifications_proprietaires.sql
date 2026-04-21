-- Migration 037 : mise à jour classification des biens + propriétaires manquants
-- Source : tableur CLASSEMENT APPARTS / Numbers (lecture avril 2026)

-- === CLASSIFICATIONS ===

-- 1★
UPDATE bien SET classification = '1_etoile' WHERE hospitable_id IN (
  '584b70e0-d939-4151-af56-70ae9baacd63', -- 416 "Harea"
  '785e19ce-18b5-469c-b446-07de57641eed', -- 602 "Horizonte"
  '36a44e1b-198f-4202-831b-2e23b0e10084', -- Aïta
  '85b5e645-4358-4dd5-ab0f-3dd1d8837eb4', -- ASKIDA
  '990250bb-71b9-4c5d-afac-ee947b4fe26a', -- EKIA
  '151c7c91-1ce3-425f-8194-8f14c826dabf', -- LAGREOU
  '55932450-d681-413a-a2be-f4ca9187c748', -- ZURBIAC
  'dd9c282a-f388-47d0-b33e-49d8b492aaf8'  -- Alaïa - Ilbarritz
);

-- 2★
UPDATE bien SET classification = '2_etoiles' WHERE hospitable_id IN (
  'f3c3fc01-4efe-4da1-ab4d-13da24a2424b', -- VIKY
  '8b0c8624-eeb7-4755-92c3-f5d3419f6bbc'  -- DUL2 "Maitasuna"
);

-- 3★
UPDATE bien SET classification = '3_etoiles' WHERE hospitable_id IN (
  '6e2c1986-473c-4d77-8102-03a4ee71ec46', -- MOB "Mendi"
  'ba6e29a4-5574-4019-b05e-45dd35925745', -- PATXI (classement expiré 18/12/2025 - à renouveler)
  'fd53c6e0-0d49-4c0b-a438-27b9527c7d35'  -- Munduz
);

-- 4★
UPDATE bien SET classification = '4_etoiles' WHERE hospitable_id IN (
  '52771fa8-57fd-4d60-ba86-eb289a94de7e', -- CERES
  '484893f7-d9eb-45dd-9427-433b9262635e'  -- Villa Belezia (PDF "4 étoiles" 03/05/2024)
);

-- 5★
UPDATE bien SET classification = '5_etoiles' WHERE hospitable_id IN (
  '8cb4f313-ecad-4d49-a6ad-58eff2607df0'  -- Maison MAÏTÉ
);

-- === PROPRIÉTAIRES MANQUANTS ===
-- Les 3 biens suivants n'ont pas de proprietaire_id :
-- bc19a284 = "Maison au calme d'Ahetze"
-- 006c52ae = "Studio avec balcon à deux pas des plages"
-- bbd4ab9b = "Villa Ontzi" (Anglet)
-- À compléter manuellement via l'UI ou après confirmation des propriétaires.
