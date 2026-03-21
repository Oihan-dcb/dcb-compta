# Règle de matching iCal → bien

## Principe
Le calendrier iCal Hospitable (par AE) contient des événements de ménage au format :
```
Cleaning (ChambreTxominMai0143)
Cleaning (416Harea0561)
Cleaning (Munduz0103)
```

Le **code iCal** d'un bien = la partie **texte** du code entre parenthèses, **sans les chiffres finaux** (qui sont le numéro de tâche).

## Extraction du code
```
"Cleaning (ChambreTxominMai0143)"  →  "ChambreTxominMai"
"Cleaning (416Harea0561)"          →  "416Harea"
"Cleaning (Munduz0103)"            →  "Munduz"
"Cleaning (CERES0477)"             →  "CERES"
```

Regex SQL : `REGEXP_REPLACE(SUBSTRING(titre_ical FROM '\\(([A-Za-z0-9]+)\\)'), '[0-9]+$', '')`

## Associations actuelles (bien.ical_code)
| Code bien | Nom bien | ical_code |
|---|---|---|
| 416 | 416 "Harea" | 416Harea |
| 602 | 602 "Horizonte" | 602Horizonte |
| BDX | BDX – LVH – Le bouscat | BDXLVHLebouscat |
| CERES | CERES | CERES |
| CHAMBRE | Chambre Gaxuxa – Maison Maïté | ChambreGaxuxaMai |
| CHAMBRE | Chambre Pantxika – Maison Maïté | ChambrePantxikaM |
| CHAMBRE | Chambre Txomin – Maison Maïté | ChambreTxominMai |
| PANORAMA | Le Panorama – BDX | LePanoramaBDX |
| MUNDUZ | Munduz | Munduz |
| XABADENIA | XABADENIA | XABADENIA |

## Biens sans ical_code (à compléter au fur et à mesure)
Les biens qui n'ont pas encore eu de mission dans l'iCal n'ont pas de code.
→ Renseigner manuellement dans la page Biens, colonne "Code iCal"
→ Le champ est en texte libre, sauvegarder avec Tab ou clic ailleurs

## SQL pour ajouter un nouveau bien
```sql
UPDATE bien SET ical_code = 'MonCodeICal'
WHERE hospitable_name ILIKE '%nom du bien%' AND agence = 'dcb';
```

## SQL pour re-matcher tous les biens depuis les missions
```sql
WITH codes AS (
  SELECT DISTINCT
    REGEXP_REPLACE(SUBSTRING(titre_ical FROM '\\(([A-Za-z0-9]+)\\)'), '[0-9]+$', '') as code_ical
  FROM mission_menage
  WHERE titre_ical ILIKE 'Cleaning%' AND titre_ical IS NOT NULL
),
matches AS (
  SELECT DISTINCT ON (b.id)
    b.id as bien_id,
    c.code_ical
  FROM bien b
  JOIN codes c ON (
    REPLACE(REPLACE(LOWER(b.hospitable_name), ' ', ''), '-', '')
      ILIKE '%' || LOWER(c.code_ical) || '%'
    OR LOWER(b.code) ILIKE '%' || LOWER(c.code_ical) || '%'
  )
  WHERE b.agence = 'dcb' AND b.listed = true
  ORDER BY b.id, LENGTH(c.code_ical) DESC
)
UPDATE bien b
SET ical_code = m.code_ical
FROM matches m
WHERE b.id = m.bien_id
  AND b.ical_code IS NULL; -- ne pas écraser les associations manuelles
```

## Cas particuliers
- **Biens Lauian** : apparaissent dans l'iCal d'Esteban (iCal partagé Hospitable) mais sont `hors_compta_dcb` si l'AE est externe → la sync les skippe automatiquement
- **Check-in** : les événements `Check-in (XXX)` dans l'iCal sont ignorés (filtre `ILIKE 'Cleaning%'`)
- **Séjours proprio** : ménage après séjour proprio = `debours_proprio` car pas de réservation voyageur à cette date
