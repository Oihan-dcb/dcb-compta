# DCB Compta — Règles métier

> **Statut** : Document d'audit — mars 2026
> **Source** : Code source (`ventilation.js` V1) + audit complet + relevés réels validés
> **Avertissement** : Ces règles décrivent le comportement **tel qu'il est implémenté dans `ventilation.js` V1**, la version de référence. `global-sync` V2 a été alignée avec V1 (session 07/04/2026) — les 4 corrections de formule (commissionableBase, ownerFees Direct, LOY Direct, menLabelsToExclude) sont désormais identiques dans les deux. `hospitable-webhook` V3 reste non auditée.

---

## TL;DR

La ventilation transforme les données brutes d'une réservation (Hospitable CSV ou API) en 8 codes comptables DCB. La logique varie selon la plateforme (Airbnb, Booking, Direct). Certaines réservations sont exclues de la ventilation. Toutes les règles ci-dessous sont extraites directement du code — aucune extrapolation.

---

## 1. Codes comptables DCB

Huit codes produits par la ventilation. Chacun est une ligne dans la table `ventilation`.

| Code | Libellé | TVA | Base de calcul | Confirmé |
|---|---|---|---|---|
| HON | Honoraires de gestion | 20% | `commissionableBase × tauxCom` | ✅ |
| FMEN | Forfait ménage DCB | 20% | `fmenBase − dueToOwner − AUTO` | ✅ |
| AUTO | Débours auto-entrepreneur | 0% | `bien.provision_ae_ref` (provision) ou `ventilation.montant_reel` (réel) — le réel remplace la provision quand renseigné | ✅ |
| LOY | Reversement propriétaire | 0% | Direct : `commissionableBase − HON_ttc + ownerFees`. Airbnb/Booking : balance depuis `fin_revenue` (voir §4) | ✅ |
| VIR | Virement propriétaire | 0% | `LOY + taxesTotal` | ✅ |
| TAXE | Taxe de séjour | 0% | Line items `fee_type='tax'` non remis | ✅ |
| MEN | Ménage brut voyageur | 0% | Somme des `guest_fees` dont le label n'est pas `'management fee'`, `'host service fee'` ni `'resort fee'`. Exemple : cleaning fee + community fee + pet fee. | ✅ |
| COM | Commission DCB directe | 20% | `managementFeeRaw` (directes uniquement) | ✅ |

**Note** : les codes MGT et AE existent dans le code de facturation mais ne sont jamais produits par la ventilation (leur `sumByCode` retourne toujours 0).

---

## 2. Constantes de calcul

Définies dans `ventilation.js` V1 uniquement. Absentes de global-sync V2 (→ NaN) et probablement de la webhook V3.

| Constante | Valeur | Usage |
|---|---|---|
| `TVA_RATE` | `0.20` (20%) | Division HT/TTC pour HON, FMEN, COM |
| `AIRBNB_LOY_RATE` | `0.1395` (13,95%) | Taux hôte Airbnb sur ménage brut → `dueToOwner` (FMEN et LOY indirectement) |
| `PLATFORM_CLEANING_RATES.airbnb` | `0.1395` (13,95%) | Taux Airbnb sur `fmenBase` — mesuré sur payout statement réel |
| ~~`PLATFORM_CLEANING_RATES.booking`~~ | ~~`0.1517`~~ | **Supprimé** session 10/04/2026 — Booking utilise désormais la même formule pro-rata qu'Airbnb et Direct (voir §4.3) |

---

## 3. Règles d'exclusion — réservations non ventilées

Ces réservations sont explicitement exclues ou court-circuitées :

| Condition | Comportement | Confirmé |
|---|---|---|
| `bien.gestion_loyer === false` | Exclue — le propriétaire gère son loyer lui-même | ✅ |
| `bien.agence !== 'dcb'` | Exclue — bien Lauian, comptabilité séparée | ✅ |
| `reservation.owner_stay === true` | Exclue — séjour propriétaire. Guard explicite dans `calculerVentilationResa` : `ventilation_calculee=true`, aucune ligne produite. La ventilation est saisie manuellement via `VentilationEdit` (codes FMEN + AUTO). | ✅ Session 10/04/2026 |
| `fin_revenue === 0` | Court-circuit — early return sans écriture | ✅ |
| `isDirect && isCancelled` | Suppression de la ventilation existante + `ventilation_calculee=true` — pas de nouvelles lignes | ✅ |
| `final_status IN STATUTS_NON_VENTILABLES` | Suppression de la ventilation + `ventilation_calculee=true` + `fin_revenue=0`. STATUTS_NON_VENTILABLES = `['cancelled','not_accepted','not accepted','declined','expired']` (commit `349ba88`) | ✅ Mars 2026 |
| `ventilation_calculee === true` | Non retraitée — ignorée par `calculerVentilationMois` | ✅ |

**Note** : depuis `349ba88`, toutes les réservations avec `final_status` dans `STATUTS_NON_VENTILABLES` sont exclues — y compris les réservations Airbnb/Booking annulées avec pénalités (`fin_revenue > 0`).

---

## 4. Règles de calcul par plateforme

### 4.1 Identification des fees par label

La ventilation identifie les fees par comparaison de label (`toLowerCase()`). ⚠ Ces labels ne doivent pas être considérés comme stables dans le temps (confirmé fournisseur).

| Fee recherché | Filtre appliqué | Usage |
|---|---|---|
| Cleaning fee (Airbnb) | `label === 'cleaning fee'` (égalité stricte) | `cleaningFeeAirbnb` — frais ménage facturés au voyageur sur Airbnb |
| Community fee | `label === 'community fee'` (égalité stricte) | `communityFeeRaw` — commission Airbnb sur l'hébergement (Airbnb) ou ménage direct (Hospitable) |
| Management fee | `label.includes('management')` | `managementFeeRaw` — frais de gestion sur réservations directes → code COM |
| Host Service Fee | `fee_type === 'host_fee'` (tous) | `hostServiceFee` (négatif) — commission plateforme retenue sur le revenu hôte |
| Taxes "remitted" | `label.includes('remitted')` | Taxes collectées et reversées directement par la plateforme au fisc — exclues du calcul LOY Airbnb, déduites de `fin_revenue` pour Booking avant calcul LOY |
| MEN exclusions | `label === 'management fee'`, `'host service fee'` ou `'resort fee'` | Exclus du code MEN. `host service fee` est un `host_fee` pas un `guest_fee` — exclusion défensive. `resort fee` est une taxe de lieu, pas un ménage (ajouté session 07/04/2026). |

### 4.2 Airbnb

```
commissionableBase = accommodation + hostServiceFee + discounts + extraGuestFee
                   = nuitées + commission_plateforme(négatif) + remises + EXTRA_GUEST_FEE
                   [extraGuestFee = Σ guest_fees dont label === 'extra_guest_fee' (case-insensitive)]
                   [validé BGH HMS2SR33WH : 103900 − 26022 + 20000 = 97878¢ = €978,78 ✓]
fmenBase           = cleaningFeeAirbnb + communityFeeRaw
                   [base brute ménage = fees ménage bruts voyageur, avant retrait de la part
                    plateforme (dueToOwner) et avant déduction de l'AUTO]
cleaningFeeNet     = bien.forfait_dcb_ref || cleaningFeeAirbnb
                   [⚠ variable définie dans V1 mais JAMAIS utilisée après sa définition —
                    elle n'entre pas dans le calcul de fmenBase ni de fmenTTC]
dueToOwner         = Math.ceil(fmenBase × 0.1621)
fmenTTC            = Math.max(0, fmenBase − dueToOwner − AUTO)
honTTC             = Math.round(commissionableBase × tauxCom)
honHT              = Math.round(honTTC / 1.20)
platformRemb       = Math.ceil((cleaningFeeAirbnb + communityFeeRaw) × 0.1621)
loyAmount          = commissionableBase − honTTC + platformRemb
virAmount          = loyAmount  [pas de taxes pass-through Airbnb]
taxesTotal         = 0  [Airbnb remit les taxes]
```

### 4.3 Booking

> ✅ Session 10/04/2026 : `dueToOwner` Booking passe en pro-rata (comme Airbnb et Direct) — remplace le taux fixe 0.1517.

```
commissionableBase = accommodation + hostServiceFee + discounts
                   [même formule qu'Airbnb]
fmenBase           = cleaningFeeAirbnb + communityFeeRaw
                   [même définition qu'Airbnb — base brute ménage avant retrait plateforme et AUTO]
totalFeesForOwnerRate = accommodation + Σ guestFees
dueToOwner         = Math.round(|hostServiceFee| × fmenBase / totalFeesForOwnerRate × (1 − tauxCom))
                   [pro-rata — même formule qu'Airbnb et Direct. Validé TXOMIN mars 2026 : MEN=68€, LOY=93€, VIR=108,25€ ✓]
fmenTTC            = Math.max(0, fmenBase − dueToOwner − AUTO)
honTTC             = Math.round(commissionableBase × tauxCom)
taxesTotal         = Σ taxes non-remitted
remittedTotal      = Σ taxes remitted (déduites du fin_revenue)
loyAmount          = (fin_revenue − remittedTotal) − honTTC − fmenTTC − AUTO − taxesTotal
                   [recalcul spécifique Booking depuis fin_revenue net]
virAmount          = loyAmount + taxesTotal
```

> **Note de validation** : le recalcul LOY Booking depuis `fin_revenue_net` est la règle **implémentée actuelle** dans V1. Elle diffère de la formule Airbnb (`commissionableBase − honTTC + platformRemb`). La justification métier : Booking raisonne depuis le fin_revenue total moins les déductions.

### 4.4 Direct + Manual (Hospitable)

> ✅ Refonte session 07/04/2026 : formule `commissionableBase` unifiée, `platformRemb` supprimé, `ownerFees` introduit, validé sur HOST-9HAQHD (Ibaneta, mars 2026).
> ✅ Fix session 04/05/2026 : `platform='manual'` traité comme `'direct'` (`isDirect = platform === 'direct' || platform === 'manual'`). Les réservations manuelles Hospitable utilisent la même structure de fees que les directes — la différence est qu'Hospitable ne prélève pas de Host Service Fee sur les manuelles (hostServiceFee = 0, donc ownerFees = 0).

**Règle isDirect :** `isDirect = resa.platform === 'direct' || resa.platform === 'manual'`
- Utilise la formule LOY directe : `loyAmount = commissionableBase − honTTC + ownerFees`
- `honTTC` utilise `Math.floor` (pas `Math.round`)
- `COM` = managementFeeRaw (management fee brut)
- Pour les manuelles : ownerFees = 0 car hostServiceFee = 0 → LOY = commissionableBase − honTTC

```
commissionableBase = accommodation + hostServiceFee + discountsTotal
                   [même formule qu'Airbnb/Booking — prouvé : 304 + (−4,53) = 299,47 ✓]

honTTC             = Math.floor(commissionableBase × tauxCom)  [Math.floor, pas round]
honHT              = Math.round(honTTC / 1.20)

fmenBase           = cleaningFeeAirbnb + communityFeeRaw
                   [managementFeeRaw → code COM séparé. Hospitable Direct ne retient pas sur le ménage → dueToOwner = 0]
fmenTTC            = Math.max(0, fmenBase − aeAmount)

comAmount          = managementFeeRaw  [management fee brut → code COM]
comHT              = Math.round(comAmount / 1.20)

totalFeesForOwnerRate = accommodation + Σ guestFees
ownerFees          = Σ_i Math.round(|hostServiceFee| × fee_i / totalFeesForOwnerRate × (1 − tauxCom))
                   [portion de la platform fee Hospitable reversée pro-rata chaque guest fee, nette de commission DCB]
                   [Vérifié HOST-9HAQHD : management(24) + community(76) + resort(2) = 102¢ = 1,02€ ✓]

loyAmount          = commissionableBase − honTTC + ownerFees
virAmount          = loyAmount + taxesTotal
```

**Note** : `Math.floor` est utilisé pour `honTTC` des directes (au lieu de `Math.round` pour les autres plateformes) — choix explicite pour correspondre exactement au statement Hospitable.

**Note ownerFees** : Ce concept correspond au champ "Total owner fees" du statement Hospitable. Ce n'est pas un pourcentage fixe mais un effet de répartition de la `hostServiceFee` (platform fee) au prorata de chaque guest fee, avec la déduction de la commission DCB. L'ancienne approche `/1.0077` a été abandonnée.

---

## 5. Règle de taux de commission

Priorité résolue au moment du calcul, dans cet ordre :

```
1. bien.taux_commission_override          (ratio, ex: 0.20)   → priorité absolue
2. proprietaire.taux_commission / 100     (ex: 25 → 0.25)     → si override null
3. 0.25 (25%)                                                  → défaut hardcodé
```

**Règle critique** : le taux est gelé au moment de la ventilation. Modifier le taux d'un bien ou d'un propriétaire n'affecte pas les réservations déjà ventilées (`ventilation_calculee = true`).

---

## 6. Règle AUTO (provision AE)

```
aeAmount = isCancelled ? 0 : (bien.provision_ae_ref || 0)
```

- Annulation → `aeAmount = 0` (pas de provision AE sur une résa annulée)
- Réservation normale → `bien.provision_ae_ref` en centimes
- Si `provision_ae_ref` est null → `aeAmount = 0`

`aeAmount` est soustrait de `fmenBase` pour calculer `fmenTTC` et entre dans `loyAmount` via `fmenTTC`.

> **Montant réel AE** : lorsque `ventilation.montant_reel` est renseigné (saisi par l'AE depuis le portail), il remplace la provision dans le calcul effectif. La gestion de l'écart entre le réel et la provision (`AUTO réel > provision`) est une règle métier configurable — voir section 12.

### 6.1 Routage AUTO dans la facturation (implémenté mars 2026)

Le montant AUTO effectif dans `genererFactureProprietaire` et `genererFactureDebours` utilise `COALESCE(montant_reel, montant_ht)` — le réel remplace la provision si renseigné.

Le routage est calculé **bien par bien**. Un bien ne peut pas absorber le surplus AUTO d'un autre bien du même propriétaire.

```
Pour chaque bien du propriétaire :
  autoBien = COALESCE(montant_reel, montant_ht) des lignes ventilation code='AUTO' du bien

  si bien.mode_encaissement = 'dcb' :
    loyBienDisponible = max(0, LOY_bien − prest_bien − haownerBienTTC − fraisDeduireBien)
    autoAbsorbableBien = min(autoBien, loyBienDisponible)
    autoSurplusBien    = max(0, autoBien − autoAbsorbableBien)
    → autoAbsorbableBien déduit du reversement global (genererFactureProprietaire)
    → autoSurplusBien → genererFactureDebours (si > 0)

  si bien.mode_encaissement = 'proprio' :
    → totalité de autoBien → genererFactureDebours
```

**Invariant de cloisonnement** : `autoAbsorbableBien = min(autoBien, loyBienDisponible)` garantit qu'un bien ne couvre jamais le déficit d'un autre. Le LOY utilisé pour l'absorption est celui du bien seul, pas le LOY agrégé du propriétaire.

**Optimisation N+1 (commit `27afd2dd`)** : `genererFactureDebours` pré-charge ventilation AUTO+LOY et prestations en 2 batchs (`ventilByBien`, `prestByBien`). Filtre mémoire AUTO dans `genererFactureProprietaire`. Logs `[AUTO-PROPRIO]` et `[AUTO-DEBOURS]`.

---

## 7. Règle platformRembourseMenage / ownerFees

### 7.1 Airbnb et Booking — platformRemb implicite

Pour Airbnb et Booking, le remboursement plateforme sur les fees ménage est **implicite dans le calcul LOY par balance**. Airbnb/Booking retiennent un pourcentage sur le ménage (`dueToOwner`) — cela réduit `fmenTTC`, ce qui augmente mécaniquement `loyAmount` (calculé par balance depuis `fin_revenue`). Il n'y a pas de ligne `platformRemb` explicite.

```
dueToOwner (impact sur FMEN et LOY par balance) :
  Airbnb  : Math.round(fmenBase × 0.1395)
  Booking : Math.round(fmenBase × 0.1517)
```

### 7.2 Direct (Hospitable) — ownerFees

> ✅ Session 07/04/2026 — remplace l'ancienne approche `/1.0077`

Pour les réservations directes Hospitable, le concept équivalent est les **ownerFees** : la platform fee (`hostServiceFee`) est partiellement reversée au propriétaire, au prorata de chaque guest fee et nette de commission DCB. Ce montant correspond exactement au champ "Total owner fees" du statement Hospitable.

```
ownerFees = Σ_i Math.round(|hostServiceFee| × fee_i / (accommodation + Σ guestFees) × (1 − tauxCom))
```

L'ancienne formule `platformRemb = feesDirectBruts − Math.round(feesDirectBruts / 1.0077)` a été abandonnée car elle ne correspondait pas aux statements réels Hospitable.

---

## 8. Règle TAXE / VIR

- **Airbnb** : `taxesTotal = 0` — Airbnb remit les taxes directement, pas de pass-through
- **Booking** : taxes non-remitted seulement → `taxesTotal = Σ taxes WHERE !isRemitted`
- **Direct** : toutes les taxes → `taxesTotal = Σ taxes`
- `VIR = LOY + taxesTotal`
- Les taxes "remitted" Booking sont déduites de `fin_revenue` avant calcul LOY

---

## 9. Règle forfait_dcb_ref *(historique / optionnelle — non utilisée dans le modèle réel)*

La logique `forfait_dcb_ref` est **présente dans le code V1** mais `cleaningFeeNet` — la variable qu'elle alimente — n'est **jamais utilisée après sa définition**. C'est une variable morte dans l'implémentation actuelle.

```
cleaningFeeNet = bien.forfait_dcb_ref || menageBrut  (Airbnb/Booking)
cleaningFeeNet = bien.forfait_dcb_ref || Math.max(0, feesDirectNets − managementFeeRaw)  (Direct)
```

`fmenBase` est calculé indépendamment (`cleaningFeeAirbnb + communityFeeRaw`) et n'utilise pas `cleaningFeeNet`.

> Cette règle doit être considérée comme **historique / optionnelle**. Elle ne doit pas être utilisée comme règle métier active sans décision explicite. La vraie base ménage métier dans le calcul courant est `fmenBase`, pas `cleaningFeeNet`.

---

## 10. Règles implicites détectées

Ces règles ne sont pas documentées explicitement mais sont observées dans le code :

| Règle implicite | Observée dans | Statut |
|---|---|---|
| `fin_revenue === 0` → pas de ventilation | `calculerVentilationResa` ligne 108-109 | ✅ Confirmé |
| `loyAmount <= 0` → ligne LOY non créée | condition `if (loyAmount > 0)` ligne 348 | ✅ Confirmé |
| `fmenTTC <= 0` → ligne FMEN non créée | condition `if (fmenHT > 0)` ligne 337 | ✅ Confirmé |
| Booking : LOY recalculé depuis `fin_revenue` (pas depuis `commissionableBase`) | lignes 311-315 | ✅ Confirmé |
| Direct annulée : ventilation supprimée, flag `ventilation_calculee=true` quand même | lignes 177-181 | ✅ Confirmé |
| Airbnb taxesTotal = 0 toujours | ligne 221 | ✅ Confirmé |
| Discounts (négatifs dans `hospitable_raw`) sont ajoutés à `commissionableBase` | `+ discountsTotal` | ✅ Confirmé |

---

## 11. Contradictions et risques identifiés

| Problème | Nature | Impact |
|---|---|---|
| Labels fees instables (confirmé fournisseur) | Si Hospitable change "Cleaning fee" → `cleaningFeeAirbnb = 0` silencieusement | FMEN et LOY faux |
| 3 versions de la logique de ventilation | Corrections dans V1 non propagées à V2/V3 | Divergence selon déclencheur |
| `forfait_dcb_ref` écrase le fee réel | Un forfait mal configuré peut déformer FMEN sans avertissement | FMEN faux |
| `provision_ae_ref = null` → AUTO = 0 | Bien sans provision configurée → AUTO non ventilé | Balance AE faussée |
| Booking : LOY = `fin_revenue_net − honTTC − fmenTTC − AUTO − taxes` | Si `fin_revenue` incorrect (CSV mal parsé), LOY est faux par propagation | Reversement faux |

---

## 11bis. Règles de rapprochement (refactorisé 12/04/2026 — Flux 1 pur)

### 11bis.0 Deux flux distincts — ne jamais confondre

| Flux | Description | Tables concernées |
|---|---|---|
| **Flux 1 — Rapprochement** | VIRSEPA distributeur (Airbnb, Booking, Stripe) OU voyageur direct → DCB. Vérifie que DCB a bien été payée. | `mouvement_bancaire` ↔ `payout_hospitable` ↔ `payout_reservation` ↔ `reservation` |
| **Flux 2 — Reversement** | VIR = montant DCB → Propriétaire après déductions. Calculé depuis la ventilation (LOY + taxes). | `ventilation.code='VIR'`, `facture_evoliz` |

**Règle absolue** : le moteur de rapprochement (Flux 1) ne touche **jamais** `ventilation.mouvement_id` et ne crée **jamais** de lignes VIR. Ces deux objets appartiennent au Flux 2 et sont produits exclusivement par `ventilation.js`.

### 11bis.1 Montant de référence

Le montant de référence pour le rapprochement est **`reservation.fin_revenue`** (ce qu'Airbnb/la plateforme verse réellement à DCB), pas `ventilation.montant_ttc` du code VIR (qui correspond au LOY = reversement propriétaire).

### 11bis.2 Chaîne de rapprochement — `_lierViaPayout`

Fonction centrale du moteur. Pour chaque mouvement rapproché :

```
_lierViaPayout(mouvementId, resaIds, mouv) :
  1. mouvement_bancaire.statut_matching = 'rapproche'
  2. reservation.rapprochee = true  (pour chaque resaId)
  3. INSERT reservation_paiement (traçabilité)
  — ventilation.mouvement_id : jamais modifié
  — VIR ventilation : jamais créés
```

`resaIds` proviennent de :
- **Airbnb/Booking** : `payout_hospitable → payout_reservation → reservation`
- **Stripe** : `stripe_payout_line.reservation_code → reservation.code`
- **Manuel** : VIR sélectionnés par l'utilisateur → `ventilation.reservation_id`

### 11bis.3 Annulation de rapprochement

```
annulerRapprochement(mouvementId) :
  resaIds = payout_hospitable → payout_reservation + reservation_paiement
  reservation.rapprochee = false
  payout_hospitable.mouvement_id = null
  reservation_paiement supprimés
  mouvement_bancaire.statut_matching = 'en_attente'
  — ventilation.mouvement_id : jamais modifié
```

### 11bis.4 Matching Stripe

Les virements Stripe (`mouvement_bancaire.canal='stripe'`) correspondent à des réservations `platform='direct'`. L'identification se fait via `stripe_payout_line.reservation_code → reservation.code` (lookup direct, pas via VIR ventilation).

---

## 11ter. Règles CSV-first — calculs depuis données importées (session 10/04/2026)

### 11ter.1 gross_revenue par plateforme (buildRapportData.js)

Le "Brut voyageur" affiché dans les rapports propriétaires suit la règle suivante :

```
Direct  : fin_gross_revenue (total_price CSV) — valeur exacte Hospitable
Airbnb  : fin_accommodation + Σ guest_fees
          [guest_service_fee EXCLUS — fee payé à Airbnb, pas reversé à DCB]
Booking : fin_accommodation + Σ guest_fees + Σ taxes non-remitted
          [pass_through_taxes incluses — collectées par Booking, reversées à DCB]
```

⚠ **Piège** : le filtre `!f.label?.toLowerCase().includes('remitted')` requiert que `label` soit sélectionné dans la requête `reservation_fee`. Sans lui, le filtre s'applique sur `undefined` → `includes` échoue silencieusement → toutes les taxes passent, Brut Booking gonflé.

### 11ter.2 discountsTotal — fallback CSV

```js
const discountsRaw   = resa.hospitable_raw?.financials?.host?.discounts || []
const discountsFromApi = discountsRaw.reduce((s, d) => s + (d.amount || 0), 0)
const discountsTotal   = discountsFromApi !== 0
  ? discountsFromApi          // API (négatif)
  : -(resa.fin_discount || 0) // CSV (centimes positifs → négatif pour commissionableBase)
```

Priorité : `hospitable_raw` (API) si non nul → `fin_discount` (CSV) sinon. Évite les doubles déductions si les deux sources sont présentes.

### 11ter.3 Mapping colonnes CSV Hospitable → base

| Colonne CSV | Champ DB | Signe | Notes |
|---|---|---|---|
| `total_price` | `fin_gross_revenue` | positif | Brut voyageur direct |
| `guest_discount` | `fin_discount` | positif | Remise voyageur en centimes |
| `adjusted_amount` | `fin_adjusted` | positif | Ajustements/remboursements |
| `host_service_fee` | `fin_host_service_fee` | **négatif** | Importé comme `-Math.abs(...)` |
| `guest_service_fee` | `reservation_fee` | — | `fee_type='guest_fee'`, label distinct |

---

## 12. Règles métier manquantes / à intégrer

Ces règles **ne sont pas implémentées dans `ventilation.js` V1**. Elles constituent des écarts entre le modèle comptable réel DCB et le code actuel. Elles doivent être définies et implémentées explicitement.

### 12.1 Gestion de l'écart AUTO réel > provision

> ✅ Implémenté commit `00436d3` — session 21/04/2026 : CAS DCB

**Règle** : AUTO (provision ou réel) est toujours déduit du MEN pour donner FMEN. Il ne touche jamais le LOY du propriétaire pour `mode_encaissement='dcb'`.

```
autoCouvertMen = min(autoBien, menBien)   → payé par DCB depuis FMEN
autoNetMen     = max(0, autoBien - menBien) → seul ce surplus va sur LOY/DEB_AE
```

- Si `autoBien ≤ menBien` → `autoNetMen = 0` → pas d'absorption LOY, pas de DEB_AE
- Si `autoBien > menBien` → le surplus est absorbé sur LOY ou génère DEB_AE
- `mode_encaissement='proprio'` → totalité AUTO → DEB_AE (DCB ne perçoit pas le MEN)

**FMEN réel** : quand `montant_reel` est mis à jour via `update-ventilation-auto`, la ligne FMEN est aussi mise à jour :
```
FMEN.montant_reel = FMEN.montant_ttc + AUTO.provision - AUTO.réel
```

**Avant** (comportement incorrect supprimé) : AUTO absorbait du LOY même quand MEN le couvrait → DEB_AE fantôme et double-déduction du proprio.

### 12.2 Prestations hors forfait validées (code EXTRA)

Les prestations validées (`prestation_hors_forfait.statut = 'valide'`) doivent produire une écriture dans la ventilation sous le code **EXTRA**. Selon le `type_imputation`, elles doivent impacter le LOY, la facture propriétaire, ou constituer un débit DCB.

**État actuel** : ✅ Largement implémenté. `deduction_loy` : déduit du reversement ✅. `haowner` : ligne TVA 20% dans la facture principale ✅. `debours_proprio` : absorption sur LOY (après AUTO) + ligne DEBP négative dans la facture honoraires + ligne DEBP positive dans la facture débours si surplus ✅ (session 30 mars 2026). `dcb_direct` : log interne uniquement (`log.dcbDirectTotal/Count`), non facturé au propriétaire ✅. Reste non implémenté : code EXTRA dans `ventilation.js`.

### 12.3 Achats DCB pour compte propriétaire (HAOWNER)

Les achats réalisés par DCB pour le compte d'un propriétaire (fournitures, interventions…) sont refacturés via une prestation `type_imputation='haowner'` dans `prestation_hors_forfait`.

**État actuel** : ✅ Implémenté (commit 2c5f9d15). Ligne `code='HAOWNER'` TVA 20% dans la facture principale. `montantReversement = max(0, LOY − deduction_loy − haownerTTC)`. Pas de code HAOWNER dans `ventilation.js` — la prestation est lue directement depuis `prestation_hors_forfait.type_imputation = 'haowner'`.

---

## 13. Règles de facturation propriétaire (implémentées mars 2026)

### 13.1 Facture honoraires (`type_facture = 'honoraires'`)

> ✅ Commit `214872e` : `type_facture: 'honoraires'` explicite dans `factureData` + filtre lookup.


Produite par `genererFactureProprietaire`. Lignes : HON, FMEN, DIV, HAOWNER (si présent), FRAIS (frais deduire_loyer, transparent), PREST (une ligne par prestation, montant négatif).

```
montantReversement = max(0, LOY_global − totalPrestations − haownerTTC − fraisDeduireTTC − autoAbsorbableTotal − deboursPropAbsorbTotal)
resteAPayer = max(0, (totalPrestations + haownerTTC) − LOY_global) + autoSurplusTotal + deboursPropSurplusTotal
```

`fraisDeduireTTC` = somme des `frais_proprietaire.montant_ttc` avec `mode_traitement='deduire_loyer'`, `mode_encaissement='dcb'`, `statut='a_facturer'` sur le mois. Ces frais sont marqués `statut='facture'` après insertion des lignes dans Evoliz.

**Ligne PREST — TVA selon type AE (commit `654d102`) :**

```
ae.type = 'ae'    → taux_tva=0,  montant_ht=montant,  montant_ttc=montant
ae.type = 'staff' → taux_tva=20, montant_ht=montant,  montant_ttc=round(montant*1.20)
```

`totalPrestations` et `prestBien` utilisent le TTC (staff : ×1.20, AE : inchangé). Une ligne PREST par prestation — libellé = `p.description || p.prestation_type.nom || fallback`. Le SELECT `prestationsDeduction` joint `ae:ae_id(type)` et `prestation_type:prestation_type_id(nom)`.

**Ligne DEBP — débours proprio absorbés sur LOY (session 30 mars 2026) :**

Requête séparée `prestationsDeboursProprio` (`type_imputation='debours_proprio'`). Pour chaque bien `mode_encaissement='dcb'` :

```
loyApresAuto       = max(0, loyBienDisponible − autoAbsorbableBien)
deboursPropAbsorb  = min(deboursPropBien, loyApresAuto)
deboursPropSurplus = max(0, deboursPropBien − deboursPropAbsorb)
```

Ligne DEBP dans la facture honoraires = `−deboursPropBien` (TVA 0% si `ae.type='ae'`, 20% si `ae.type='staff'`). `deboursPropAbsorbTotal` réduit `montantReversement`. `deboursPropSurplusTotal` augmente `resteAPayer` et produit une ligne DEBP positive dans la facture débours.

`resteAPayer` est calculé à la volée, accumulé dans `log.resteAPayer`, affiché comme alerte warning non bloquante dans PageFactures. **Non stocké. Non comptable. UI uniquement. Ne pas utiliser comme base de rapprochement ou d'écriture comptable.**

### 13.2 Facture débours AE (`type_facture = 'debours'`)

Produite par `genererFactureDebours` si au moins un bien du propriétaire a de l'AUTO ou du `debours_proprio` à facturer séparément, ou des frais `facturer_direct`. Lignes : `DEB_AE` + `DEBP` par bien concerné + `FRAIS` par frais direct.

```
code:        'DEB_AE'          (ménage AE — surplus AUTO non absorbable sur LOY)
taux_tva:    0
montant_reversement: null  ← non applicable à une créance

code:        'DEBP'            (débours proprio — surplus non absorbable sur LOY après AUTO)
taux_tva:    0 si ae.type='ae', 20 si ae.type='staff'
montant:     debPropSurplus (TTC)

code:        'FRAIS'           (frais propriétaire facturer_direct)
taux_tva:    0
libelle:     frais.libelle
```

Déclenchement AUTO :
- Bien `mode_encaissement = 'proprio'` : `montantAFacturer = autoBien` (totalité)
- Bien `mode_encaissement = 'dcb'` avec surplus : `montantAFacturer = max(0, autoBien − autoAbsorbableBien)`

Déclenchement DEBP : bien `mode_encaissement = 'dcb'` uniquement, quand `debPropSurplus > 0`. Si toutes les prestations debours_proprio du bien ont `ae.type='staff'` → TVA 20%, sinon 0%.

Déclenchement FRAIS : `frais_proprietaire` avec `mode_traitement='facturer_direct'`, `mode_encaissement='dcb'`, `statut='a_facturer'`. Ajoutés comme lignes séparées — **ne modifient pas `montantAFacturer`** (réservé à AUTO). Marqués `statut='facture'` uniquement si la facture est effectivement créée ou mise à jour (jamais dans le chemin skipped).

`vatRate` dans le push Evoliz : `l.taux_tva ?? 20` — respecte `taux_tva = 0` pour DEB_AE et FRAIS.

### 13.3 Coexistence HAOWNER dans la facture principale

HAOWNER peut coexister avec HON et FMEN. Ce n'est pas un débours — c'est une ligne de facturation TVA 20%. Il réduit le reversement sur une base TTC :

```
loyBienDisponible = max(0, LOY_bien − prest_bien − haownerBienTTC − fraisDeduireBien)
```

Si `haownerTTC > LOY_bien_disponible` : `montantReversement = 0`. La ligne HAOWNER reste dans la facture — le propriétaire règle le solde directement. Comportement non bloquant.

---

## 14. Règles des frais propriétaire (implémentées mars 2026)

> ✅ Commit `360b959` : table `frais_proprietaire`, service CRUD, intégration facturation.

### 14.1 Saisie et statuts

Les frais sont saisis manuellement dans l'UI `/frais-proprietaire`. Workflow :

```
brouillon  →  a_facturer  →  facture
  (saisie)    (UI action)    (auto — lors génération facture)
```

Seuls les frais `statut='a_facturer'` participent à la facturation. La transition `a_facturer → facture` est irréversible via l'UI — elle est effectuée automatiquement par `genererFactureProprietaire` ou `genererFactureDebours`.

### 14.2 Mode `deduire_loyer` + `mode_encaissement='dcb'`

Le frais a été avancé par DCB. Il est récupéré en réduisant le reversement au propriétaire.

- Réduit `loyBienDisponible` bien par bien (symétrique avec HAOWNER et prestations)
- Réduit `montantReversement` global via `fraisDeduireTTC`
- Produit **aucune ligne** dans la facture Evoliz (c'est une déduction silencieuse du reversement)
- Marqué `statut='facture'` après insertion des lignes Evoliz

### 14.3 Mode `facturer_direct` + `mode_encaissement='dcb'`

Le frais a été avancé par DCB. Il est refacturé au propriétaire via la facture débours.

- Produit une ligne `code='FRAIS'`, TVA 0%, libellé = `frais.libelle`, dans `genererFactureDebours`
- **N'impacte pas `montantAFacturer`** — réservé exclusivement au calcul AUTO/DEB_AE
- Marqué `statut='facture'` uniquement si la facture débours est effectivement créée ou mise à jour (jamais dans le chemin skipped)

### 14.4 Cas non encore intégrés

| Mode | Encaissement | Statut |
|---|---|---|
| `deduire_loyer` | `proprio` | ⚠ Non intégré — le proprio a déjà payé, pas de déduction à calculer |
| `facturer_direct` | `proprio` | ⚠ Non intégré — le proprio a déjà payé, pas de refacturation à émettre |
| `remboursement` | — | Pas de mode_encaissement (DCB rembourse directement via le reversement) |

---

---

## 15. Règles rapport mensuel propriétaire (implémentées avril 2026)

> ✅ Session 08/04/2026 — source unique : `src/services/buildRapportData.js`
> Ces règles s'appliquent à toutes les surfaces : UI (PageRapports), PDF (rapportProprietaire.js), Statement (rapportStatement.js), Factures (facturesEvoliz.js).

### 15.1 gross_revenue et base_comm

```
gross_revenue = fin_accommodation + Σ reservation_fee WHERE fee_type='guest_fee'
              [valeur brute Hospitable exacte — total voyageur hors taxe de séjour]

base_comm     = fin_accommodation + fin_host_service_fee - fin_discount
              [= commissionableBase de ventilation.js — net de la commission plateforme et des remises]
              [fin_host_service_fee est négatif, fin_discount est positif en base (à soustraire)]
              [ex Airbnb: 201.00 + (-40.42) - 40.20 = 120.38€ ✓]
```

Ni `fin_revenue`, ni le code VIR (LOY+taxes) ne sont utilisés pour ces colonnes.

### 15.2 fraisDeductionLoy — règle complète

Inclut `deduire_loyer` (positif) ET `remboursement` (négatif) :

```
mode_traitement='deduire_loyer' :
  si statut='facture' && statut_deduction ≠ 'en_attente' → + montant_deduit_loy
  si statut='facture' && statut_deduction = 'en_attente'  → + montant_ttc  (fallback)
  si statut='a_facturer'                                  → + montant_ttc
  sinon                                                   → 0 (ignoré)

mode_traitement='remboursement' :
  si statut ≠ 'brouillon'                                 → − montant_ttc
  [réduit la déduction = augmente le reversement]
```

**Remboursement** : montant HT (= TTC, pas de TVA). Saisi en positif, traité comme négatif dans `fraisDeductionLoy`. Visible en vert `+ montant` dans le statement PDF (section Reversement, entre VIR et Débours).

### 15.3 virementNet — double branche

```
BRANCHE 1 (facture confirmée) :
  si facture.montant_reversement > 0
     && facture.statut ∉ ['brouillon', 'calcul_en_cours']
  → virementNet = facture.montant_reversement
  [le montant gelé à la génération est la vérité]

BRANCHE 2 (estimation en temps réel) :
  → virementNet = max(0, virTotal − totalDebours − totalHaowner
                         − fraisDeductionLoy − ownerStayMenageTotal)
  [virTotal = Σ VIR.montant_ht ventilation ; totalDebours, totalHaowner depuis prestation_hors_forfait]
```

La BRANCHE 1 court-circuite le recalcul dès qu'une facture validée existe. Le bypass `brouillon`/`calcul_en_cours` est intentionnel — ces statuts sont transitoires et ne reflètent pas un montant gelé.

### 15.4 Séjour propriétaire — facturation du ménage

**Principe** : `fin_revenue` d'une résa `owner_stay=true` = montant total du ménage à facturer au propriétaire.

**Calcul automatique** : `calculerVentilationResa` gère le cas `owner_stay=true` :
- AUTO = `bien.provision_ae_ref`
- FMEN TTC = `max(0, fin_revenue - AUTO)`
- Déclenché par le batch ⚡ Ventiler (filtre `owner_stay=false` supprimé) ET via ModalResa
- `VentilationEdit` reste disponible pour correction manuelle si besoin

**Absorption dans `genererFactureGroupe` (per-bien, en priorité après deboursProp) :**

```
loyApresDeboursProp → osAutoAbsorb = min(osAutoHT, loyApresDeboursProp)
                    → osAutoSurplus = max(0, osAutoHT - osAutoAbsorb)
loyApresOsAuto     → osFmenAbsorb  = min(osFmenTTC, loyApresOsAuto)
                    → osFmenSurplus = max(0, osFmenTTC - osFmenAbsorb)

ownerStayAbsorbTotal += osAutoAbsorb + osFmenAbsorb
```

- La part absorbée (`ownerStayAbsorbTotal`) réduit `montant_reversement` (LOY restituable).
- Le FMEN surplus → ligne `"Ménage séjour propriétaire"` (FMEN, TVA 20%) dans la facture honoraires.
- L'AUTO surplus → ligne `DEB_AE` dans `genererFactureDebours`.
- `sumByCode('FMEN')` exclut les owner stay resas (filtre `reservation_id`) pour éviter le double-comptage avec le FMEN normal.

**Dans buildRapportData.js** : `ownerStayMenageTotal` = global FMEN.TTC + AUTO.HT de toutes les owner_stay resas — déduit du `virementNet` BRANCHE 2 (note : BRANCHE 2 n'a pas la logique per-bien ; si surplus facturé séparément, un léger écart peut exister dans la BRANCHE 2 — toujours préférer BRANCHE 1 facture validée).

Affiché comme liste `ownerStayList` dans le bloc "Débours et achats" des 3 surfaces (couleur `#4A3728`, label "Ménage proprio").

### 15.5 honTotal KPIs

```
honTotal = facture.total_ttc  si facture présente (montant réel facturé)
         = Σ ventilation HON.montant_ttc  sinon (estimation)
```

## 16. Contrôle trésorerie — matrice PageFactures (avril 2026)

### 16.1 Source des encaissements

Les encaissements prouvés sont lus depuis `reservation_mouvement` (vue métier, source de vérité). Le champ `credit_retenu_centimes` représente le montant réel par réservation :
- **payout_hospitable** : `mouvement_bancaire.credit` (total payout Airbnb — un seul mouvement pour N réservations)
- **stripe_payout_line** : `stripe_payout_line.montant_net` (montant net Stripe par réservation)
- **booking_payout_line** : `booking_payout_line.amount_cents` (montant par réservation Booking)
- **reservation_paiement / ventilation** : montant spécifique au paiement

### 16.2 Déduplication dans PageFactures

Pour `payout_hospitable` uniquement : déduplication par `mouvement_bancaire_id` au niveau du bien (un seul mb.credit comptabilisé même si N réservations partagent le payout).

Pour `stripe_payout_line`, `booking_payout_line`, `ventilation`, `reservation_paiement` : sommation directe sans déduplication (le montant est déjà par réservation).

### 16.3 Calcul VIR trésorerie

Le VIR affiché dans la matrice de contrôle trésorerie est un **résiduel**, pas la ventilation VIR :

```
VIR_trésorerie = max(0, creditsProuves − HON_ttc − FMEN_ttc − AUTOREEL − COM_ttc − PREST − HAOWNER)
```

**Pourquoi** : les encaissements Stripe sont nets de frais de traitement bancaire (~1-2% selon le canal). Le VIR ventilation est calculé sur `fin_revenue` brut (Hospitable), créant un écart structurel. Le VIR trésorerie représente ce que DCB peut réellement virer au propriétaire après ses retenues, basé sur les fonds effectivement reçus.

**Solde trésorerie = 0** signifie : encaissements nets = VIR réel + toutes les retenues DCB. C'est l'état sain.

### 16.4 Exclusions

- Réservations `owner_stay = true` : exclues de la requête ventilation (pas d'encaissement, pas d'emplois)
- Factures `type_facture = 'debours'` : pas de bloc trésorerie ni de badge

### 16.5 Chargement automatique

L'Edge Function `allocate-encaissements` est déclenchée automatiquement à chaque visite de la page Factures (en arrière-plan). Le badge trésorerie (Tréso ✓ / Tréso ⚠ / Non prouvé) s'affiche dans l'en-tête de chaque facture dès que le calcul est disponible.

*Fichier généré dans le cadre de l'audit structurel DCB Compta — mars 2026.*
*Mis à jour avril 2026 — ne pas modifier sans relecture de `src/services/ventilation.js` V1, `src/services/facturesEvoliz.js`, `src/services/buildRapportData.js` et `src/pages/PageFactures.jsx`.*
