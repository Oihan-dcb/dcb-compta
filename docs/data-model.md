# DCB Compta — Modèle de données

> **Statut** : Document d'audit — mars 2026
> **Source** : Code source, migrations SQL, Edge Functions
> **Avertissement** : Certains champs sont déduits du code (pas de dump Postgres disponible). Les types marqués ❓ sont inférés.

---

## Convention

- **Centimes** : tous les montants financiers sont stockés en centimes (integer). Ex: 27125 = 271,25 €.
- **mois** : format `YYYY-MM` (text). Ex: `2026-03`.
- **uuid** : identifiants générés par `gen_random_uuid()` côté Postgres.
- ⚠ = champ avec incohérence ou risque identifié dans l'audit.
- ❓ = champ inféré du code, non confirmé par migration SQL.

---

## Architecture des données — CSV-first

> **Note d'architecture (mars 2026)**
> La majorité des données de réservation et des fees détaillés sont désormais alimentées par le **CSV Hospitable**, qui constitue la source principale de référence pour la comptabilité mensuelle.
>
> L'API Hospitable et les webhooks peuvent enrichir ou corriger ces données (mise à jour d'un `fin_revenue`, ajustement de fees), mais ne sont plus la source principale. Ils ne doivent pas invalider une clôture déjà réalisée sans intervention explicite.
>
> Conséquence sur la lecture du modèle : les champs comme `fin_revenue` ou `reservation_fee.amount` sont alimentés en priorité par le CSV. Les valeurs issues de l'API sont des enrichissements secondaires stockés dans les mêmes champs — aucune colonne ne distingue l'origine de la donnée.

---

## Tables principales

---

### `bien`

Référentiel central. Chaque ligne représente un logement géré par DCB ou Lauian. Pilote la ventilation et la facturation.

| Champ | Type | Description | Notes |
|---|---|---|---|
| `id` | uuid PK | Identifiant interne | |
| `hospitable_id` | text UNIQUE | ID dans Hospitable | Clé de sync |
| `hospitable_name` | text | Nom tel qu'affiché dans Hospitable | |
| `code` | text | Code court (ex: CERES, 416) | Utilisé dans les matching iCal |
| `proprietaire_id` | uuid FK → proprietaire | Propriétaire lié | Null si non configuré → bien "à configurer" |
| `provision_ae_ref` | integer | Provision ménage AE en centimes | Alimente le code AUTO dans la ventilation |
| `forfait_dcb_ref` | integer | Forfait ménage DCB en centimes | ⚠ **Non utilisé dans le modèle actuel**. La règle réelle est : FMEN = ménage brut − AUTO (provision ou réel). |
| `forfait_menage_proprio` | integer | Forfait ménage facturé au propriétaire | ❓ Usage exact non confirmé |
| `taux_commission_override` | numeric | Taux de commission sur ce bien (ratio, ex: 0.25) | Priorité sur proprietaire.taux_commission |
| `airbnb_account` | text | Compte Airbnb titulaire (ex: BURGY, DCB) | Critique pour le matching Airbnb |
| `ical_code` | text | Code iCal extrait du calendrier Hospitable | Matching missions AE |
| `gestion_loyer` | boolean | DCB gère-t-il le reversement du loyer ? | Si false → bien exclu de la ventilation. ⚠ Le comportement réel dépend du canal (Airbnb, direct, etc.) et du flux de paiement — ne pas interpréter comme un booléen universel. |
| `mode_encaissement` | text | Mode d'encaissement des paiements voyageurs | `NOT NULL DEFAULT 'dcb'`. `CHECK IN ('dcb', 'proprio')`. Contrainte `bien_mode_encaissement_check`. `'dcb'` : DCB encaisse, AUTO absorbable sur reversement. `'proprio'` : propriétaire encaisse directement, AUTO → facture débours. Qualifié mars 2026 : 24 biens `dcb`, 13 biens `proprio`. |
| `agence` | text | 'dcb' ou 'lauian' | Filtre majeur dans ventilation, rapprochement, factures |
| `has_ae` | boolean | Un AE est-il rattaché à ce bien ? | Filtre UI historique dans PageBiens "À configurer". ⚠ Non pertinent si les AE travaillent sur tous les biens — ne pas utiliser comme règle métier. |
| `listed` | boolean | Bien actif dans Hospitable | Filtre getBiens (listed=true uniquement) |
| `adresse` | text | Adresse physique | ❓ |
| `ville` | text | Ville (Biarritz, Bidart, Anglet…) | |
| `hospitable_raw` | jsonb | Données brutes Hospitable | ❓ |
| `derniere_sync` | timestamptz | Date dernière synchronisation | |
| `created_at` | timestamptz | | |

**Relations** : `bien` → `proprietaire` (FK), `bien` ← `reservation` (FK), `bien` ← `ventilation` (FK)

**Champ critique** : `taux_commission_override` — priorité absolue sur `proprietaire.taux_commission`. Toute modification impacte immédiatement les prochaines ventilations de ce bien.

---

### `proprietaire`

Propriétaires des biens. Source de synchronisation : Evoliz (clients facturés).

| Champ | Type | Description | Notes |
|---|---|---|---|
| `id` | uuid PK | | |
| `nom` | text | Nom affiché | |
| `email` | text | Email de contact | |
| `taux_commission` | numeric | Taux par défaut pour tous ses biens | Écrasé par `bien.taux_commission_override` |
| `evoliz_id` | text | ID client dans Evoliz | Mis à jour lors du push ou sync Evoliz |
| `actif` | boolean | Propriétaire actif | ❓ Filtre non appliqué dans genererFacturesMois (CF-F8) |
| `created_at` | timestamptz | | |

---

### `reservation`

Données brutes des réservations Hospitable. Table centrale du flux mensuel.

| Champ | Type | Description | Notes |
|---|---|---|---|
| `id` | uuid PK | | |
| `hospitable_id` | text UNIQUE | ID Hospitable — clé de sync | onConflict dans upsert |
| `bien_id` | uuid FK → bien | | |
| `code` | text | Code réservation (ex: HOST-J323DH) | |
| `platform` | text | 'airbnb', 'booking', 'direct', 'manual' | |
| `platform_id` | text | ID sur la plateforme externe | ❓ |
| `arrival_date` | date | Date d'arrivée | Détermine `mois_comptable` |
| `departure_date` | date | Date de départ | |
| `nights` | integer | Nombre de nuits | |
| `guest_name` | text | Nom du voyageur | Non écrasé si null lors de sync |
| `guest_count` | integer | Nombre de voyageurs | |
| `stay_type` | text | 'guest', 'owner' | |
| `owner_stay` | boolean | Séjour propriétaire | Exclut de la ventilation et du rapprochement |
| `final_status` | text | 'accepted', 'cancelled', 'not_accepted' | ⚠ Fallback 'accepted' si API ne retourne pas le statut |
| `reservation_status` | jsonb | Statut complet Hospitable | |
| `fin_revenue` | integer | Revenu net en centimes (= payout attendu) | Source primaire de la ventilation |
| `fin_accommodation` | integer | Montant nuitées seules en centimes | |
| `fin_host_service_fee` | integer | Commission plateforme en centimes (négatif) | |
| `fin_taxes_total` | integer | Total taxes en centimes | |
| `fin_currency` | text | Devise (EUR) | |
| `mois_comptable` | text | Format YYYY-MM — mois du check-in | Filtre principal dans toutes les requêtes |
| `ventilation_calculee` | boolean | La ventilation a-t-elle été calculée ? | Une fois true → ne sera plus recalculée automatiquement |
| `rapprochee` | boolean | Un mouvement bancaire a-t-il été associé ? | ⚠ Reste true si mouvement supprimé sans nettoyage (CF-BQ1) |
| `hospitable_raw` | jsonb | Payload brut Hospitable | Fallback pour fees si reservation_fee vide |
| `synced_at` | timestamptz | Dernière sync | |
| `created_at` | timestamptz | | |

**Champ critique** : `fin_revenue` — source de vérité de la ventilation. Toute modification (sync API) écrase la valeur précédente.

**Champ critique** : `ventilation_calculee` — une fois à true, la réservation ne sera plus reventilée automatiquement. Corriger un taux ou une provision ne reventile pas les réservations passées.

---

### `reservation_fee`

Détail des fees Hospitable par réservation. Source prioritaire pour la ventilation.

| Champ | Type | Description | Notes |
|---|---|---|---|
| `id` | uuid PK | | |
| `reservation_id` | uuid FK → reservation | | ON DELETE CASCADE |
| `fee_type` | text | 'guest_fee', 'host_fee', 'tax', 'accommodation_night', 'adjustment' | |
| `label` | text | Libellé exact Hospitable (ex: "Cleaning fee", "Community fee") | ⚠ **Ne pas considérer comme stable dans le temps** — ✅ confirmé fournisseur. La ventilation identifie les fees par comparaison de ce label : tout changement côté Hospitable casse silencieusement le calcul. |
| `category` | text | Catégorie Hospitable | ⚠ **Ne pas considérer comme stable dans le temps** — ✅ confirmé fournisseur. |
| `amount` | integer | Montant en centimes | **Peut être positif ou négatif** — ✅ confirmé fournisseur : des line items mixtes sont normaux et attendus. Les `host_fee` sont systématiquement négatifs. `fin_revenue` lui-même peut être négatif. Important : `reduce((s, f) => s + f.amount)` sur les host_fees donne un total négatif, utilisé tel quel dans la ventilation. |
| `formatted` | text | Montant formaté (ex: "€ 45,00") | |
| `nuit_date` | text | Date pour les accommodation_night | ❓ |
| `currency` | text | Devise | |
| `created_at` | timestamptz | | |

**Champ critique** : `label` et `category` — ✅ confirmé fournisseur : ces valeurs **ne doivent pas être considérées comme stables dans le temps**. La logique de ventilation identifie les fees par comparaison de label (`toLowerCase().includes('cleaning')`, etc.). Si Hospitable modifie ses libellés, la ventilation produira des résultats incorrects sans erreur visible. Cette dépendance est une fragilité structurelle à corriger.

⚠ **Cycle de vie dangereux** : DELETE + INSERT à chaque sync (syncReservations, global-sync, webhook). Pas de transaction → perte définitive si crash entre DELETE et INSERT (CF-I2).

---

### `ventilation`

Table centrale des codes comptables. Calculée par `ventilation.js` (V1). Pilote directement les factures.

| Champ | Type | Description | Notes |
|---|---|---|---|
| `id` | uuid PK | | |
| `reservation_id` | uuid FK → reservation | | |
| `bien_id` | uuid FK → bien | | |
| `proprietaire_id` | uuid FK → proprietaire | | |
| `code` | text | HON, FMEN, AUTO, LOY, VIR, TAXE, MEN, COM | Codes comptables DCB |
| `libelle` | text | Description de la ligne | |
| `montant_ht` | integer | Montant HT en centimes | ⚠ Peut être NaN si calculé par global-sync (CF-C2) |
| `taux_tva` | integer | Taux TVA appliqué (0 ou 20) | |
| `montant_tva` | integer | Montant TVA en centimes | ⚠ Peut être NaN (CF-C2) |
| `montant_ttc` | integer | Montant TTC en centimes | ⚠ Peut être NaN (CF-C2) |
| `montant_reel` | integer | Montant réel saisi par l'AE (portail) | Utilisé pour le code AUTO uniquement — null si non saisi |
| `mois_comptable` | text | Format YYYY-MM | |
| `calcul_source` | text | 'auto' (calculé) ou 'manuel' | |
| `taux_calcule` | numeric | Taux de commission appliqué (HON uniquement) | |
| `mouvement_id` | uuid FK → mouvement_bancaire | Lien avec le rapprochement bancaire | Null si non rapproché — ⚠ reste renseigné si mouvement supprimé sans nettoyage |
| `created_at` | timestamptz | | |

**Codes comptables DCB** :

| Code | Libellé | TVA | Description |
|---|---|---|---|
| HON | Honoraires de gestion | 20% | Commission DCB sur la base commissionable |
| FMEN | Forfait ménage | 20% | Fees ménage bruts − AUTO (provision ou réel) |
| AUTO | Débours auto-entrepreneur | 0% | Provision AE ou montant réel saisi (`montant_reel`) — le réel remplace la provision quand renseigné |
| LOY | Reversement propriétaire | 0% | Base − HON + remboursement plateforme. Le "remboursement plateforme" correspond à la compensation des frais retenus par la plateforme (Airbnb, etc.) sur les fees ménage — ce mécanisme permet de réintégrer ces montants dans le calcul du LOY. |
| VIR | Virement propriétaire | 0% | LOY + taxes pass-through |
| TAXE | Taxe de séjour | 0% | Taxes non remises par la plateforme |
| MEN | Ménage brut voyageur | 0% | Total guest fees (hors management) |
| COM | Commission DCB directe | 20% | Management fee sur réservations directes |
| EXTRA | Prestation hors forfait | ❓ | ⚠ **Non implémenté** — état cible : écriture produite par une prestation validée (`prestation_hors_forfait`) |

⚠ **Risque critique** : trois versions de la logique de calcul coexistent. La même réservation peut avoir des valeurs différentes selon le déclencheur (V1 frontend, V2 global-sync, V3 webhook).

> **Règle de référence** : `ventilation.js` (V1, `src/services/ventilation.js`) est la **seule implémentation à considérer comme référence** pour le calcul des codes comptables. Les deux autres implémentations (V2 dans `global-sync/index.ts`, V3 dans `hospitable-webhook/index.ts`) doivent être considérées comme **non fiables** : V2 produit des NaN (constantes manquantes), V3 appelle une RPC probablement inexistante. Toute correction ou évolution de la logique de ventilation doit partir de V1 et être propagée aux autres versions.

### Gestion des écarts AUTO réel vs provision

Lorsque `ventilation.montant_reel` (AUTO réel) est renseigné, il remplace toujours la provision `bien.provision_ae_ref`. Le cas où AUTO réel dépasse la provision introduit un écart qui doit être traité explicitement — son traitement est une **règle métier configurable**, non implicite.

**CAS 1 — Écart supporté par le propriétaire**

```
différence = AUTO réel − provision
```

La différence est ajoutée dans la ventilation sous forme de ligne **EXTRA** (cf. code EXTRA). Elle réduit le LOY ou augmente la facture propriétaire. Le propriétaire supporte le surcoût.

**CAS 2 — Écart supporté par DCB**

```
différence = AUTO réel − provision
```

La différence est absorbée dans **FMEN**, ce qui réduit la marge DCB sans impacter le propriétaire.

> **Clarifications** :
> - AUTO réel remplace toujours la provision — il n'y a pas de cumul.
> - La règle de traitement de l'écart (CAS 1 ou CAS 2) est une décision métier configurable — elle doit être définie explicitement avant implémentation.
> - En l'absence de règle définie, l'écart doit être signalé comme anomalie, pas absorbé silencieusement.

---

### `mouvement_bancaire`

Mouvements du relevé Caisse d'Épargne importés manuellement. Base du rapprochement.

| Champ | Type | Description | Notes |
|---|---|---|---|
| `id` | uuid PK | | |
| `date_operation` | date | Date du virement | |
| `libelle` | text | Libellé brut (ex: VIR SEPA AIRBNB PAYMENTS LUXEMB) | |
| `detail` | text | Détail complémentaire (ex: NO.ref/ID.propertyId) | Utilisé pour extraire la référence Booking |
| `credit` | integer | Montant entrant en centimes | Null si débit |
| `debit` | integer | Montant sortant en centimes | Null si crédit |
| `canal` | text | 'airbnb', 'booking', 'stripe', 'sepa_manuel', 'non_identifie' | Détecté automatiquement à l'import |
| `statut_matching` | text | 'en_attente', 'matche_auto', 'matche_manuel', 'rapproche', 'non_identifie' | ⚠ PageBanque affiche 'en_attente' pour tous les statuts sauf 'rapproche' |
| `note_matching` | text | Note libre sur le matching | |
| `mois_releve` | text | Format YYYY-MM | Filtre principal |
| `source` | text | 'CaisseEpargne', 'csv', 'BudgetBakers' | ⚠ 'csv' ne peut pas être supprimé via le bouton dédié (CF-BQ3) |
| `created_at` | timestamptz | | |

⚠ **Suppression dangereuse** : DELETE brut sans nettoyage de `ventilation.mouvement_id`, `reservation.rapprochee`, `payout_hospitable.mouvement_id`, `reservation_paiement` (CF-BQ1/BQ2).

---

### `payout_hospitable`

Payouts Hospitable — lien entre les virements bancaires et les réservations.

| Champ | Type | Description | Notes |
|---|---|---|---|
| `id` | uuid PK | | |
| `hospitable_id` | text UNIQUE | ID payout dans Hospitable | Clé de conflit upsert |
| `platform` | text | 'airbnb', 'booking', 'direct', 'stripe', 'manual' | |
| `platform_id` | text | ID plateforme | ❓ |
| `reference` | text | Référence payout (Booking) | Utilisée pour matcher le libellé CE |
| `amount` | integer | Montant en centimes | ✅ Confirmé fournisseur : **peut être nul ou négatif** (ajustement, remboursement, compensation). |
| `date_payout` | date | Date de virement Hospitable | ⚠ La signification dépend du canal : Airbnb → proche du check-in, direct/Stripe → agrégation mensuelle. Ne pas traiter ce champ comme homogène entre canaux. |
| `bank_account` | text | Compte bancaire destination | ❓ |
| `mois_comptable` | text | Format YYYY-MM | ⚠ **Conflit actif** : global-sync insère avec `mois_payout` — ce champ reste null pour ces lignes |
| `statut_matching` | text | 'en_attente', 'matche_auto' | Null si inséré par global-sync (introuvable par matching frontend) |
| `mouvement_id` | uuid FK → mouvement_bancaire | Lien avec le mouvement bancaire | |
| `created_at` | timestamptz | | |

⚠ **Conflit de schéma** : deux voies d'insertion avec des champs différents. Les payouts insérés par `global-sync` (`mois_payout`, `canal:'airbnb'` hardcodé, `statut_matching` null) ne sont jamais trouvés par les requêtes du matching frontend qui filtrent sur `mois_comptable` et `statut_matching = 'en_attente'`.

> ✅ Confirmé fournisseur : **il n'existe pas de relation 1:1 garantie entre une réservation et un payout**. Un payout peut couvrir plusieurs réservations, et son montant peut être ajusté, nul ou négatif. Le payout Airbnb synthétique créé par `syncReservations.js` (`amount = fin_revenue`) est donc une approximation, pas une vérité. Par ailleurs, **les webhooks ne sont pas garantis** — un fallback de sync périodique reste obligatoire pour maintenir `payout_hospitable` à jour.

---

### `payout_reservation`

Table de liaison entre payouts et réservations (un payout peut couvrir plusieurs réservations).

| Champ | Type | Description | Notes |
|---|---|---|---|
| `id` | uuid PK | | |
| `payout_id` | uuid FK → payout_hospitable | | UNIQUE(payout_id, reservation_id) |
| `reservation_id` | uuid FK → reservation | | |
| `created_at` | timestamptz | | |

⚠ Non migrée par `fusionnerDoublons` — les doublons fusionnés perdent leurs liens payout.

---

### `reservation_paiement`

Acomptes et soldes associés à un virement bancaire. Créée lors du rapprochement manuel ou import Booking/Stripe.

| Champ | Type | Description | Notes |
|---|---|---|---|
| `id` | uuid PK | | |
| `mouvement_id` | uuid FK → mouvement_bancaire | | |
| `reservation_id` | uuid FK → reservation | | |
| `type_paiement` | text | 'acompte', 'solde', 'total' | ❓ |
| `montant_net` | integer | Montant en centimes | |
| `description` | text | Libellé | ❓ |
| `reservation_code` | text | Code réservation (dénormalisé) | ❓ |
| `guest_name` | text | Nom voyageur (dénormalisé) | ❓ |
| `created_at` | timestamptz | | |

⚠ Supprimée par `annulerRapprochement` (DELETE). Non migrée par `fusionnerDoublons`.

---

### `booking_payout_line` / `stripe_payout_line`

Tables de liaison importées via CSV Booking / sync Stripe. Utilisées dans l'enrichissement des mouvements (passe 3 de `getMouvementsMois`).

| Champ commun | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `mouvement_id` | uuid FK → mouvement_bancaire | |
| `reservation_id` | uuid FK → reservation | ❓ |
| `montant_net` | integer | |
| `reservation_code` | text | |
| `guest_name` | text | |
| `description` | text | |

⚠ `mouvement_id` non nettoyé lors de `annulerRapprochement` → orphelins possibles.

---

### `facture_evoliz`

Factures DCB → Propriétaires. Générées dans l'application, poussées vers Evoliz.

| Champ | Type | Description | Notes |
|---|---|---|---|
| `id` | uuid PK | | |
| `mois_facturation` | text | Format YYYY-MM | ⚠ **Conflit actif** : la migration SQL utilise `mois_facturation`, le service utilise `mois` |
| `proprietaire_id` | uuid FK → proprietaire | | |
| `numero_facture` | text | Numéro Evoliz | ❓ |
| `date_facture` | date | | |
| `montant_ht` | integer | Total HT en centimes | |
| `montant_tva` | integer | TVA en centimes | |
| `montant_ttc` | integer | Total TTC en centimes | |
| `montant_reversement` | integer | Montant à reverser au propriétaire en centimes | ⚠ **Gelé à la génération** — périmé si reventilation sans régénération. `null` pour les factures `type_facture='debours'` — non applicable à une créance. |
| `type_facture` | text | Type de facture : `'honoraires'` ou `'debours'` | `NOT NULL DEFAULT 'honoraires'`. `CHECK IN ('honoraires', 'debours')`. Contrainte `facture_evoliz_type_check`. |
| `statut` | text | 'brouillon', 'valide', 'envoyee' | |
| `evoliz_id` | text | ID de la facture dans Evoliz | Renseigné après push |
| `evoliz_url` | text | URL de la facture Evoliz | |
| `notes` | text | Notes internes | |
| `created_at` | timestamptz | | |
| `updated_at` | timestamptz | | |

✅ **Contrainte UNIQUE + lookup sécurisé (mars 2026)** — lookup filtre `.eq('type_facture', 'honoraires')` (commit `214872e`). Ancienne contrainte `UNIQUE(proprietaire_id, mois)` remplacée par `UNIQUE(proprietaire_id, mois, type_facture)` (`facture_evoliz_proprietaire_id_mois_type_key`). Permet la coexistence d'une facture `'honoraires'` et d'une facture `'debours'` pour le même propriétaire et le même mois.

✅ **Champ `mois` corrigé (CF-F1)** : le service `facturesEvoliz.js` utilise le champ `mois` — l'incohérence initiale avec `mois_facturation` est résolue.

---

### `facture_evoliz_ligne`

Lignes de détail des factures propriétaires.

| Champ | Type | Description | Notes |
|---|---|---|---|
| `id` | uuid PK | | |
| `facture_id` | uuid FK → facture_evoliz | | ON DELETE CASCADE |
| `code` | text | HON, FMEN, DIV, HAOWNER, PREST, DEB_AE | Codes présents dans les factures. `DEB_AE` : débours AE TVA 0%, uniquement dans `type_facture='debours'` — **poussé dans Evoliz**. `HAOWNER` : frais avancés refacturés TVA 20%, dans la facture honoraires — **poussé dans Evoliz**. `PREST` : mémo déduction_loy (montant négatif) — **local uniquement, non poussé dans Evoliz** (filtré par `montant_ht > 0` dans `evoliz.js`). |
| `libelle` | text | Description | |
| `quantite` | integer | Toujours 1 | |
| `montant_ht` | integer | en centimes | |
| `montant_tva` | integer | en centimes | |
| `montant_ttc` | integer | en centimes | |
| `reservation_id` | uuid FK → reservation | Lien optionnel | |
| `created_at` | timestamptz | | |

⚠ DELETE + INSERT à chaque régénération de facture.

---

### `facture_ae`

Factures auto-entrepreneurs. Référencée dans `facturesEvoliz.js` mais localisation de création non identifiée dans le code audité.

| Champ | Type | Description | Notes |
|---|---|---|---|
| `id` | uuid PK | | |
| `mois` | text | | |
| `ae_id` | uuid | FK → auto_entrepreneur ❓ | |
| `bien_id` | uuid FK → bien | | |
| `libelle` | text | | |
| `montant_ht` | integer | | |
| `montant_ttc` | integer | | |
| `statut` | text | 'brouillon' par défaut | |
| `date_facture` | date | | |
| `numero_facture` | text | | |
| `created_at` | timestamptz | | |
| `updated_at` | timestamptz | | |

❓ Usage réel dans le flux non entièrement confirmé — lue par `facturesEvoliz.js` (SELECT par bien+mois) mais jamais insérée dans le code audité. ⚠ **Non utilisée dans le modèle actuel** : il n'y a pas de facturation AE dans Evoliz. Cette table est conservée à des fins théoriques ou futures uniquement.

---

### `auto_entrepreneur`

Prestataires ménage. Partagée entre DCB Compta et le Portail AE.

| Champ | Type | Description | Notes |
|---|---|---|---|
| `id` | uuid PK | | |
| `nom` | text | | |
| `prenom` | text | | |
| `email` | text UNIQUE | Identifiant de connexion portail | |
| `siret` | text | Numéro SIRET | |
| `adresse` | text | | |
| `code_postal` | text | | |
| `ville` | text | | |
| `telephone` | text | | |
| `iban` | text | Pour les virements | |
| `ical_url` | text | URL calendrier Hospitable | Indispensable pour la sync missions |
| `taux_horaire` | integer | En centimes (2500 = 25,00 €/h) | |
| `ae_user_id` | uuid | UUID Supabase Auth — lien compte portail | ⚠ Mis à jour par create-ae-user uniquement |
| `mdp_temporaire` | text | Mot de passe temporaire | ⚠ **Jamais sauvegardé** — toujours null (CF-PAE1) |
| `note` | text | Note interne DCB | |
| `actif` | boolean | AE actif | ❓ Présence en base non confirmée — utilisé dans le code comme filtre |
| `type` | text | 'ae' ou 'staff_dcb' | |
| `created_at` | timestamptz | | |

⚠ **Rupture de chaîne** : `mdp_temporaire` jamais sauvegardé + `reset-ae-password` inexistante → accès portail inutilisable sans intervention Supabase Dashboard.

---

### `mission_menage`

Missions de ménage créées depuis le calendrier iCal Hospitable de chaque AE.

| Champ | Type | Description | Notes |
|---|---|---|---|
| `id` | uuid PK | | |
| `ae_id` | uuid FK → auto_entrepreneur | | |
| `bien_id` | uuid FK → bien | | Null si ical_code non trouvé |
| `date_mission` | date | Date de la mission | |
| `titre_ical` | text | Titre de l'événement iCal (ex: "Cleaning (CERES0394)") | |
| `ical_uid` | text UNIQUE | UID de l'événement iCal | Clé de conflit pour l'upsert |
| `mois` | text | Format YYYY-MM | |
| `statut` | text | 'planifie' | ❓ Autres valeurs possibles ? |
| `type_mission` | text | 'cleaning', 'checkin' | Déduit du titre iCal |
| `created_at` | timestamptz | | |

---

### `prestation_hors_forfait`

Prestations extras soumises par les AEs via le portail. Validées dans DCB Compta.

| Champ | Type | Description | Notes |
|---|---|---|---|
| `id` | uuid PK | | |
| `ae_id` | uuid FK → auto_entrepreneur | | |
| `bien_id` | uuid FK → bien | | |
| `mission_id` | uuid FK → mission_menage | | Optionnel |
| `prestation_type_id` | uuid FK → prestation_type | | |
| `mois` | text | Format YYYY-MM | ⚠ Non mis à jour si date_prestation change de mois (CF-P3) |
| `date_prestation` | date | | |
| `duree_minutes` | integer | Durée en minutes | |
| `montant` | integer | Montant en centimes | |
| `description` | text | Description détaillée de la prestation | |
| `type_imputation` | text | `'deduction_loy'`, `'haowner'`, `'debours_proprio'`, `'dcb_direct'` | `deduction_loy` : lu par `genererFactureProprietaire` — déduit du reversement ✅. `haowner` : lu par `genererFactureProprietaire` — ligne TVA 20% dans la facture principale ✅. `debours_proprio` et `dcb_direct` : toujours sans impact comptable ⚠. |
| `statut` | text | 'en_attente', 'valide', 'annule' | |
| `valide_par` | text | 'DCB' | |
| `valide_at` | timestamptz | Date de validation | |
| `created_at` | timestamptz | | |

⚠ **Module partiellement intégré** : `deduction_loy` et `haowner` ont un effet sur la facturation ✅. `debours_proprio` et `dcb_direct` restent sans effet comptable ⚠. Aucune écriture dans `ventilation.js` (code EXTRA absent).

> **État cible** : les prestations validées doivent produire une écriture dans la ventilation (code **EXTRA**) et impacter la facturation et/ou le LOY selon le `type_imputation`. Ce code n'existe pas encore dans la ventilation — son absence est le bug CF-P1.

---

### `prestation_type`

Catalogue des types de prestations hors forfait.

| Champ | Type | Description | Notes |
|---|---|---|---|
| `id` | uuid PK | | |
| `nom` | text | Ex: 'Pick-up & Drop', 'Vitres', 'Lingerie' | |
| `description` | text | | |
| `taux_defaut` | integer | Taux horaire par défaut en centimes | ⚠ Bug CF-AE5 : création initialise à 250 000 centimes (2 500 €/h) au lieu de 2 500 (25 €/h) |
| `unite` | text | 'heure' | |
| `created_at` | timestamptz | | |

---

### HAOWNER (implémenté mars 2026)

> **HAOWNER** désigne les achats réalisés par DCB pour le compte du propriétaire (fournitures, équipements, interventions…) qui sont refacturés via une prestation `type_imputation='haowner'` dans `prestation_hors_forfait`.

**Comportement implémenté** : lu par `genererFactureProprietaire` — produit une ligne `code='HAOWNER'`, TVA 20%, dans la facture honoraires. Réduit le reversement sur une base TTC. Si `haownerTTC > LOY_bien_disponible`, `montantReversement = 0` — la ligne reste dans la facture, le propriétaire règle le solde directement. Pas de code HAOWNER dans `ventilation.js`.
>
> Ce concept n'a pas encore de table dédiée ni de code comptable dans la ventilation. Son implémentation est un besoin métier identifié mais non couvert dans le modèle actuel.

---

### `journal_ops`

Journal des opérations. Quasi-inopérant actuellement.

| Champ | Type | Description | Notes |
|---|---|---|---|
| `id` | uuid PK | | |
| `type_operation` | text | Ex: 'rapprochement_annule' | |
| `categorie` | text | Ex: 'rapprochement' | |
| `statut` | text | 'ok', 'warning', 'error' | |
| `details` | jsonb | Données de l'opération | |
| `mois_comptable` | text | Format YYYY-MM | ⚠ **Toujours null** — jamais passé dans le seul appel logOp (CF-J1) |
| `mouvement_id` | uuid FK → mouvement_bancaire | | |
| `reservation_id` | uuid FK → reservation | ❓ | |
| `proprietaire_id` | uuid FK → proprietaire | | |
| `created_at` | timestamptz | | |

⚠ `logOp` n'est appelé qu'une seule fois dans tout le projet (annulerRapprochement). Les 19 autres opérations métier ne loguent rien.

---

### `import_log` / `webhook_log`

Tables de log non exposées dans l'UI.

| Champ | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `type` | text | Type d'import / événement webhook |
| `mois_concerne` | text | Mois concerné |
| `statut` | text | 'success', 'error' |
| `nb_lignes_traitees` | integer | |
| `nb_lignes_creees` | integer | |
| `nb_lignes_mises_a_jour` | integer | |
| `message` | text | |
| `created_at` | timestamptz | |

⚠ Ces tables contiennent des informations opérationnelles utiles (syncs, webhooks) mais ne sont jamais lues par PageJournal.

---

## Tables critiques

Les quatre tables suivantes sont les plus sensibles du système. Toute opération d'écriture sur ces tables doit être effectuée avec précaution — une erreur se propage silencieusement jusqu'aux factures et aux reversements propriétaires.

| Table | Sensibilité | Raison |
|---|---|---|
| `ventilation` | **MAXIMUM** | Source de vérité des codes comptables — pilote directement les factures et les reversements. Peut contenir des NaN (CF-C2). Trois voies d'écriture avec des logiques différentes. Toute lecture doit vérifier l'absence de NaN. |
| `reservation_fee` | **ÉLEVÉE** | Source des données brutes pour le calcul de ventilation. DELETE+INSERT sans transaction à chaque sync — perte définitive possible si crash. Les montants peuvent être négatifs (host_fees). La logique de ventilation repose sur la correspondance exacte des labels. |
| `mouvement_bancaire` | **ÉLEVÉE** | Base du rapprochement bancaire. Suppression sans nettoyage des tables liées génère des orphelins définitifs. Les statuts de matching sont partiellement mal interprétés par l'UI. |
| `facture_evoliz` | **ÉLEVÉE** | Contient les montants gelés à la génération. Le champ `montant_reversement` peut devenir périmé après reventilation. Incohérence de champ (`mois` vs `mois_facturation`) bloque la navigation temporelle. Push vers Evoliz irréversible — doublon possible. |

**Règle générale** : avant toute opération de correction sur ces tables, vérifier l'état des tables dépendantes (cf. section Contraintes d'intégrité).

---

## Contraintes d'intégrité

États impossibles que le système ne doit jamais atteindre. Plusieurs de ces contraintes sont actuellement violées en raison de bugs identifiés.

### Contrainte globale — intégrité des montants financiers

> Aucune valeur financière (`montant_ht`, `montant_tva`, `montant_ttc`) ne doit être NaN, null ou non numérique dans aucune table utilisée pour la facturation (`ventilation`, `facture_evoliz`, `facture_evoliz_ligne`). Toute présence de NaN ou null dans ces champs doit être considérée comme une **corruption de données critique** — elle se propage silencieusement jusqu'aux factures et aux reversements propriétaires sans déclencher d'erreur visible.

### Contrainte globale — cohérence facture ↔ ventilation

> Toute facture doit être reconstruisable à partir de la ventilation et des données source. Toute divergence entre `facture_evoliz` et la ventilation correspondante doit être considérée comme une anomalie. En particulier : `facture_evoliz.montant_reversement` est dérivé de la ventilation (notamment du code LOY) au moment de la génération — il représente le montant à reverser au propriétaire, mais ne constitue pas une ligne de facturation DCB. Si ce montant diverge de la ventilation actuelle, les factures doivent être régénérées avant tout push vers Evoliz.

### Contraintes sur `reservation`

| Contrainte | État attendu | Violation connue |
|---|---|---|
| Une réservation `rapprochee=true` doit avoir au moins un `ventilation.mouvement_id` non null | Toujours vrai | ⚠ Violée si mouvement supprimé sans nettoyage (CF-BQ1) |
| Une réservation `ventilation_calculee=true` doit avoir des lignes dans `ventilation` | Toujours vrai | ⚠ Violée si ventilation supprimée manuellement sans reset du flag |
| `fin_revenue` ne doit pas être null pour une réservation confirmée non-annulée | Toujours vrai | 🔶 Possible si sync incomplète |

### Contraintes sur `ventilation`

| Contrainte | État attendu | Violation connue |
|---|---|---|
| `montant_ht`, `montant_tva`, `montant_ttc` ne doivent jamais être NaN ni null | Toujours vrai | ⚠ **Violée activement** via global-sync (CF-C2) |
| Une réservation ventilée doit avoir au minimum les codes HON, LOY, AUTO (si bien avec AE) | Toujours vrai | 🔶 Possible si ventilation partielle ou interrompue |
| `mouvement_id` renseigné implique que le mouvement existe en base | Toujours vrai | ⚠ Violée si mouvement supprimé sans nettoyage (CF-BQ1) |
| `montant_ht > 0` pour HON, FMEN — `montant_ht >= 0` pour LOY, AUTO | Toujours vrai | ⚠ Non garanti si NaN en base |

### Contraintes sur `facture_evoliz`

| Contrainte | État attendu | Violation connue |
|---|---|---|
| Une facture avec `statut='envoyee'` doit avoir un `evoliz_id` non null | Toujours vrai | ⚠ Possible si push Evoliz réussit mais update Supabase échoue (CF-F2) |
| Une facture doit avoir au moins une ligne dans `facture_evoliz_ligne` | Toujours vrai | 🔶 Possible si génération interrompue |
| `montant_reversement` est dérivé de la ventilation (code LOY) et représente le reversement propriétaire — il ne constitue pas une ligne de facturation DCB. Il doit être cohérent avec la ventilation au moment de la génération | Vrai à la génération | ⚠ Devient faux si reventilation après génération sans régénération |

### Contraintes sur `mouvement_bancaire`

| Contrainte | État attendu | Violation connue |
|---|---|---|
| Un mouvement `statut='rapproche'` doit avoir au moins une réservation liée via `ventilation.mouvement_id` | Toujours vrai | ⚠ Violée si annulation de rapprochement partielle |
| `credit` ou `debit` doit être non null (pas les deux simultanément) | Toujours vrai | ❓ Non vérifié dans le code d'import |

### Contraintes sur `prestation_hors_forfait`

| Contrainte | État attendu | Violation connue |
|---|---|---|
| Une prestation `statut='valide'` doit impacter la comptabilité (LOY, facture, ou débit DCB) | Toujours vrai | ⚠ **Violée systématiquement** — aucun impact comptable actuel (CF-P1) |
| Une prestation hors forfait validée doit produire une écriture dans la ventilation (code EXTRA) | Toujours vrai | ⚠ **Violée systématiquement** — code EXTRA non implémenté. L'absence de cette écriture constitue une incohérence comptable. |

### Contraintes sur HAOWNER

| Contrainte | État attendu | Violation connue |
|---|---|---|
| Tout achat réalisé par DCB pour le compte du propriétaire (HAOWNER) doit produire une ligne de facturation explicite | Toujours vrai | ✅ **Implémenté** — ligne HAOWNER TVA 20% dans la facture principale (commit 2c5f9d15). |

---

## Relations principales

```
proprietaire ──────────────────── bien (1:N)
                                    │
                              reservation (1:N)
                                    │
                        ┌───────────┤
                        │           │
               reservation_fee    ventilation ──── mouvement_bancaire
                               (HON/FMEN/AUTO/LOY/VIR/TAXE)
                                    │
                              facture_evoliz ──── facture_evoliz_ligne
                                    │
                                 Evoliz (push légal)

payout_hospitable ──── payout_reservation ──── reservation
        │
mouvement_bancaire

auto_entrepreneur ──── mission_menage
        │
prestation_hors_forfait ──── prestation_type
        │
[⚠ aucun lien vers ventilation ou facture_evoliz]
```

---

## Champs critiques — résumé

| Champ | Table | Risque |
|---|---|---|
| `fin_revenue` | `reservation` | Source primaire de toute la ventilation — écrasé à chaque sync |
| `ventilation_calculee` | `reservation` | Une fois true → jamais recalculé automatiquement |
| `rapprochee` | `reservation` | Reste true si mouvement supprimé sans nettoyage |
| `montant_ht/tva/ttc` | `ventilation` | Peut être NaN si calculé par global-sync |
| `montant_reel` | `ventilation` | Null si AE non connecté — factures utilisent provision à la place |
| `mouvement_id` | `ventilation` | Reste renseigné si mouvement supprimé sans nettoyage |
| `mois_facturation` vs `mois` | `facture_evoliz` | Incohérence schéma/code — navigation temporelle cassée |
| `montant_reversement` | `facture_evoliz` | Gelé à la génération — périmé si reventilation après |
| `mdp_temporaire` | `auto_entrepreneur` | Jamais sauvegardé — portail inutilisable |
| `type_imputation` | `prestation_hors_forfait` | Jamais lu — aucun effet comptable |
| `mois_comptable` | `payout_hospitable` | Null si inséré par global-sync — payout introuvable par matching |
| `label` | `reservation_fee` | Matching par substring — fragile si Hospitable change ses libellés |

---

*Fichier généré dans le cadre de l'audit structurel DCB Compta — mars 2026.*
*Ne pas modifier sans relecture du code source.*
