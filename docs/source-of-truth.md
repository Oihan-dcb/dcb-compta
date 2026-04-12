# DCB Compta — Sources de vérité

> **Statut** : Document d'audit — mars 2026
> **Source** : Code source + audit complet
> **Avertissement** : Ce document décrit les sources de vérité **telles qu'elles fonctionnent réellement**, incluant les conflits actifs. Il ne décrit pas un état idéal.

---

## Principe général

Dans DCB Compta, la notion de "source de vérité" n'est pas uniforme. Elle dépend du **stade d'avancement du flux mensuel**.

**Hiérarchie des sources (architecture CSV-first)** — quatre niveaux distincts :
- **Source brute principale** : CSV Hospitable — photo mensuelle de référence pour la clôture. C'est la source qui fait foi pour la comptabilité mensuelle.
- **Source brute secondaire** : Hospitable API / webhook — enrichissement et mise à jour en temps réel. Utile pour le suivi continu, non bloquant pour la cohérence comptable.
- **Source de calcul métier** : `ventilation.js` V1 — transforme les données brutes (CSV ou API) en codes comptables DCB (HON, FMEN, AUTO, LOY, VIR). C'est ici que le revenu net métier est calculé, quelle que soit la source d'entrée.
- **Source légale finale** : Evoliz (après push) — irréversible, fait foi pour la comptabilité légale.

> **Règle critique** : Le CSV constitue la photographie de référence du mois pour la comptabilité. Toute divergence avec les données issues de l'API ou des webhooks doit être analysée, mais ne doit pas modifier une clôture déjà validée sans intervention explicite.

En amont du flux pour la correction : `CSV Hospitable (référence clôture) > Hospitable API (enrichissement) > ventilation.js V1 (calcul métier) > ajustements métier (AUTO réel, EXTRAS, HAOWNER) > Evoliz (légal)`.

**Ajustements métier** :
- Le montant réel des auto-entrepreneurs (`ventilation.montant_reel`) corrige la ventilation initiale en remplaçant la provision AUTO.
- Les prestations hors forfait validées doivent produire des écritures comptables (EXTRAS) dans la ventilation.
- Les achats réalisés par DCB pour le compte du propriétaire (HAOWNER) doivent également produire des écritures comptables dans la ventilation.
- Ces éléments ne sont pas des sources de données externes mais des corrections métier appliquées après la ventilation initiale.

---

## 1. Revenu brut de réservation (`fin_revenue`)

**Donnée** : donnée financière brute par réservation, en centimes — sert de base au calcul de la ventilation dans `ventilation.js`. Elle ne correspond pas nécessairement au montant réellement versé en banque : les payouts peuvent regrouper ou ajuster plusieurs réservations, être nuls ou négatifs. `fin_revenue` n'est pas une vérité bancaire — c'est une entrée pour le calcul métier. ✅ Confirmé fournisseur : cette valeur **peut être négative** (annulation avec pénalité, ajustement, remboursement partiel) — des valeurs négatives sont normales et attendues.

| Étape | Source | Mécanisme |
|---|---|---|
| Création (référence clôture) | **CSV Hospitable** | `toC(row.payout)` — parsé depuis le CSV export Hospitable. Source principale pour la clôture mensuelle. |
| Enrichissement / mise à jour | Hospitable API (`/v2/reservations?include=financials`) | `financials.host.revenue.amount` → `fin_revenue` (✅ line item brut — peut être négatif). Source secondaire — upsert `onConflict: 'hospitable_id'`. |
| Mise à jour via webhook | Hospitable webhook | ✅ Confirmé fournisseur : si les financials changent, Hospitable déclenche un webhook réservation. Le payload correspond à la structure d'un GET réservation avec financials mis à jour. Aucun cas connu où les financials changent sans webhook. |
| Sync périodique (fallback) | Hospitable API (re-sync manuelle) | ✅ Confirmé fournisseur : les webhooks ne sont pas garantis — un mécanisme de sync périodique reste nécessaire en complément du CSV. |
| Fallback affichage | `hospitable_raw.financials` | Utilisé si `reservation_fee` vide |

**Source brute principale** : CSV Hospitable — référence de clôture mensuelle. En cas de divergence avec l'API, le CSV fait foi sauf intervention explicite.

**Source brute secondaire** : Hospitable API / webhook — enrichissement et mise à jour. Peut corriger une valeur CSV mais ne doit pas invalider une clôture déjà validée.

**Source de calcul métier** : `ventilation.js` V1 — calcule le revenu net DCB à partir de `fin_revenue` et des `reservation_fee`, quelle que soit leur origine. Hospitable ne fournit pas ce calcul.

**Conflits actifs** :
- ⚠ `final_status` peut valoir `'accepted'` par défaut si `reservation_status.current.category` est null (Booking.com) — une réservation annulée peut être considérée comme confirmée.
- ℹ `toC()` dans importCSV peut produire des valeurs négatives sur les annulations partielles avec pénalité — comportement normal et attendu selon les confirmations fournisseur (line items mixtes positifs et négatifs).

---

## 2. Fees détaillés (`reservation_fee`)

**Donnée** : line items financiers bruts de la réservation (cleaning fee, community fee, host service fee, taxes…).

| Étape | Source | Mécanisme |
|---|---|---|
| Création | Hospitable API (`include=financials`) | `guest_fees`, `host_fees`, `taxes`, `accommodation_breakdown` → DELETE + INSERT |
| Création (webhook) | Hospitable webhook | Même structure — DELETE + INSERT si `fees.length > 0` |
| Création (import CSV) | CSV Hospitable | `parseFees()` dans importCSV — DELETE + INSERT sans transaction |
| Fallback ventilation | `hospitable_raw.financials.host` | Utilisé si `reservation_fee` vide au moment du calcul |

**Source de vérité finale** : `reservation_fee` en base (priorité absolue). `hospitable_raw.financials` est un fallback de dernier recours utilisé uniquement si la table est vide.

**Règles critiques** :
- Les montants (`amount`) peuvent être **positifs ou négatifs**. ✅ Confirmé fournisseur : des line items mixtes positifs et négatifs sont normaux et attendus dans un même payload. Les `host_fee` sont systématiquement négatifs (commission plateforme). `fin_revenue` lui-même peut être négatif.
- ⚠ Les `label` et `category` des line items **ne doivent pas être considérés comme stables dans le temps**. ✅ Confirmé fournisseur explicitement. La logique de ventilation identifie les fees par comparaison de label (`toLowerCase().includes('cleaning')`, etc.) — tout changement de libellé côté Hospitable cassera silencieusement la ventilation sans erreur visible. Cette fragilité est structurelle et doit être corrigée.
- ✅ Confirmé fournisseur : `financials` et `financialsV2` sont équivalents en pratique. Hospitable fournit des **line items financiers bruts** — l'API ne calcule pas les totaux métier consolidés. `ventilation.js` V1 est la couche légitime pour calculer le revenu net métier DCB, catégoriser les montants et produire les codes comptables.

**Conflits actifs** :
- ⚠ DELETE + INSERT sans transaction (CF-I2) — perte définitive possible si crash entre les deux opérations.

---

## 3. Codes comptables (`ventilation`)

**Donnée** : HON, FMEN, AUTO, LOY, VIR, TAXE, MEN, COM — résultat de la transformation des données financières brutes Hospitable (`fin_revenue` + `reservation_fee`) en écritures comptables DCB. C'est ici, et uniquement ici, que le revenu net métier DCB est calculé.

| Étape | Source | Mécanisme |
|---|---|---|
| Calcul de référence | `ventilation.js` V1 | `calculerVentilationMois()` → DELETE + INSERT par réservation |
| Calcul alternatif (cassé) | `global-sync/index.ts` V2 | Même logique mais `TVA_RATE` et `AIRBNB_FEES_RATE` non définies → NaN |
| Calcul alternatif (probablement inopérant) | `hospitable-webhook/index.ts` V3 | Appelle RPC `ventiler_toutes_resas` probablement inexistante |
| Mise à jour manuelle | Portail AE | `UPDATE ventilation SET montant_reel = X WHERE reservation_id = Y AND code = 'AUTO'` |
| Mise à jour rapprochement | `rapprochement.js` | `UPDATE ventilation SET mouvement_id = X WHERE reservation_id IN (...)` |

**Source de vérité finale** : `ventilation.js` V1 (`src/services/ventilation.js`) — **seule implémentation de référence**. V2 et V3 sont non fiables.

**Transformations appliquées par V1** :

| Entrée | Transformation | Sortie |
|---|---|---|
| `fin_revenue` + `reservation_fee` | Calcul par plateforme (cf. domain-rules.md) | HON, FMEN, AUTO, LOY, VIR, TAXE |
| `bien.taux_commission_override` ou `proprietaire.taux_commission` ou 25% | Priorité : override bien > proprio > défaut | `taux_calcule` sur la ligne HON |
| `bien.provision_ae_ref` | Valeur directe (centimes) | Code AUTO |
| `bien.forfait_dcb_ref` (si renseigné) | Écrase cleaningFeeNet | FMEN |
| `ventilation.montant_reel` si non null | `COALESCE(montant_reel, montant_ht)` dans `genererFactureProprietaire` et `genererFactureDebours` | Montant AUTO effectif pour absorption et facturation débours |

> **Rôle de LOY** : le code LOY représente le montant reversé au propriétaire. Il ne correspond pas à une ligne de facturation DCB. Les factures DCB sont basées sur les honoraires (HON), les forfaits ménage (FMEN) et autres prestations. LOY est utilisé pour calculer le reversement propriétaire — pas pour générer une facture.

> **Rôle de `montant_reel` (AE)** : le montant réel saisi par les auto-entrepreneurs (`ventilation.montant_reel`) constitue une correction de la ventilation initiale. Il remplace la provision AUTO et impacte directement le calcul du FMEN. Cette étape est une transformation métier, non une source de donnée externe.

**Conflits actifs** :
- ⚠ V2 (global-sync) écrase les lignes de V1 si "Global Update" est lancé après une ventilation normale — NaN en base (CF-C2).
- ⚠ `ventilation_calculee = true` est permanent : une réservation déjà ventilée ne sera plus jamais recalculée automatiquement, même si le taux ou la provision du bien change.
- ⚠ `montant_reel` reste null si le portail AE est inaccessible — `genererFactureProprietaire` et `genererFactureDebours` utilisent alors `montant_ht` (provision) via `COALESCE`. L'écart éventuel entre réel et provision n'est pas signalé dans `ventilation.js`.

---

## 4. Taux de commission

**Donnée** : ratio appliqué pour calculer HON (honoraires de gestion DCB).

| Priorité | Source | Champ | Condition |
|---|---|---|---|
| 1 (priorité absolue) | `bien` | `taux_commission_override` | Si non null |
| 2 | `proprietaire` | `taux_commission / 100` | Si taux_commission_override est null |
| 3 (défaut) | Constante hardcodée | `0.25` (25%) | Si les deux précédents sont null |

**Source de vérité finale** : `bien.taux_commission_override` si renseigné, sinon `proprietaire.taux_commission`.

**Règle critique** : le taux est résolu au moment du calcul de ventilation. Une modification du taux sur un bien ou un propriétaire **ne reventile pas** les réservations déjà ventilées (`ventilation_calculee = true`). La correction nécessite un reset manuel du flag puis une reventilation.

---

## 5. Encaissements prouvés par réservation (`reservation_mouvement`)

**Donnée** : montant réel encaissé (CSV bancaire) rapproché à une réservation, par bien et mois comptable.

| Étape | Source | Mécanisme |
|---|---|---|
| Calcul et persistance | Edge Function `allocate-encaissements` v2 | Déclenché par `⚡ Contrôle trésorerie` — DELETE + INSERT dans `encaissement_allocation` |
| Lecture | Vue `reservation_mouvement` | SELECT direct, filtre `mouvement_bancaire_id IS NOT NULL` |

**Chemins de preuve autorisés (dans cet ordre, déduplication par mb_id)** :
1. `ventilation.mouvement_id → mouvement_bancaire.credit`
2. `reservation_paiement.mouvement_id → mouvement_bancaire.credit`
3. `payout_reservation → payout_hospitable.mouvement_id → mouvement_bancaire.credit`

**Source de vérité finale** : `reservation_mouvement` (vue sur `encaissement_allocation`) — **uniquement des valeurs `mouvement_bancaire.credit` réelles**. Aucun fallback théorique.

**Règle absolue** : `payout_hospitable.amount` n'est jamais utilisé comme montant d'encaissement. Si aucun des 3 chemins ne trouve un mouvement bancaire → `NON_PROUVEE` → anomalie `MOUVEMENT_BANCAIRE_MISSING`.

**Requête type** :
```sql
SELECT bien_id, SUM(credit_retenu_centimes)
FROM reservation_mouvement
WHERE mois_comptable = '2026-03'
GROUP BY bien_id;
```

---

## 6. Lien mouvement bancaire ↔ réservation (rapprochement — Flux 1)

**Donnée** : association entre un virement Caisse d'Épargne et une ou plusieurs réservations.

| Étape | Source | Mécanisme |
|---|---|---|
| Matching automatique | `rapprochement.js` → `lancerMatchingAuto` | Via `payout_hospitable` → `payout_reservation` → `reservation` |
| Matching manuel | `rapprochement.js` → `matcherManuellement` | Sélection directe par l'utilisateur |
| Matching all-time (Config) | `matching.js` (ANCIEN moteur) | Logique différente — résultats inconsistants |
| Annulation | `rapprochement.js` → `annulerRapprochement` | Nettoyage partiel (stripe/booking_payout_line non nettoyés) |

**Source de vérité finale** : `ventilation.mouvement_id` — champ primaire. `reservation.rapprochee` et `payout_hospitable.mouvement_id` sont des dérivés mis à jour en même temps.

**Conflits actifs** :
- ⚠ `matching.js` (Config) et `rapprochement.js` (PageRapprochement) produisent des résultats différents pour le même mois (CF-C3).
- ⚠ `ventilation.mouvement_id` reste renseigné si le mouvement est supprimé sans passer par `annulerRapprochement` — orphelin définitif (CF-BQ1).
- ⚠ `reservation.rapprochee` reste `true` si le mouvement est supprimé brutalement — la réservation disparaît des alertes de rapprochement.

---

## 6. Payout Hospitable (`payout_hospitable`)

**Donnée** : virement de la plateforme vers le compte bancaire DCB, associé à une ou plusieurs réservations.

> ✅ Confirmé fournisseur : **il n'existe pas de relation 1:1 garantie entre une réservation et un payout**. Un payout peut couvrir plusieurs réservations, et son montant peut être ajusté, nul ou négatif. `fin_revenue` d'une réservation n'est donc pas équivalent au montant du payout bancaire correspondant.

| Étape | Source | Mécanisme | Schéma inséré |
|---|---|---|---|
| Airbnb synthétique | `syncReservations.js` | `hospitable_id = resa.id + '_airbnb_payout'`, `amount = fin_revenue`, `date_payout = arrival_date` | `mois_comptable`, `platform`, `statut_matching = 'en_attente'` |
| Tous canaux (all-time) | `global-sync/index.ts` | Depuis `/v2/payouts` Hospitable | `mois_payout` (pas `mois_comptable`), `canal = 'airbnb'` hardcodé, `statut_matching` absent |
| Booking/Stripe | `rapprochement.js` → `syncPayoutsHospitable` | Upsert depuis Hospitable API | `mois_comptable`, `platform` dynamique |

**Source de vérité finale** : payouts insérés par `syncReservations.js` (frontend) — les seuls trouvés par le matching frontend via `.eq('mois_comptable', mois)`.

**Conflits actifs** :
- ⚠ Les payouts insérés par `global-sync` utilisent `mois_payout` et non `mois_comptable` — ils ne sont jamais trouvés par les requêtes de matching frontend (CF-C4). Deux populations de payouts coexistent dans la même table avec des schémas incompatibles.
- ⚠ Le payout Airbnb synthétique créé par `syncReservations.js` utilise `fin_revenue` comme `amount` — or `fin_revenue` n'est pas garanti d'être égal au payout réel (relation non 1:1, payout potentiellement ajusté ou négatif).

---

## 7. Montant reversement propriétaire

**Donnée** : montant à virer au propriétaire en fin de mois, calculé depuis le code LOY de la ventilation.

> **Distinction critique** : LOY est le montant qui revient au propriétaire — ce n'est pas une ligne de facture DCB. La facture DCB porte sur les honoraires (HON), les forfaits ménage (FMEN) et autres prestations. `montant_reversement` est la traduction comptable de LOY, pas le montant facturé.

| Étape | Source | Mécanisme |
|---|---|---|
| Calcul | `facturesEvoliz.js` → `genererFactureProprietaire` | `sumByCode('LOY').montant_ht` sur les lignes de ventilation du mois |
| Gel | `facture_evoliz.montant_reversement` | Écrit à la génération — n'est jamais mis à jour automatiquement ensuite |
| Vérité légale | Evoliz (après push) | Irréversible — fait foi pour la comptabilité |

**Source de vérité finale** : `facture_evoliz.montant_reversement` **au moment de la génération**. Si une reventilation intervient après la génération, ce champ est périmé jusqu'à une régénération manuelle des factures.

**Règle critique** : toute reventilation après génération des factures doit être suivie d'une régénération des factures avant push Evoliz. Dans le cas contraire, le reversement envoyé à Evoliz ne correspond plus à la ventilation réelle.

**Note** : le champ `mois` est utilisé partout dans `facturesEvoliz.js` — l'incohérence initiale `mois_facturation` / `mois` a été corrigée (CF-F1).

---

## 8. Facture propriétaire (légale)

**Donnée** : document comptable officiel envoyé au propriétaire.

| Étape | Source | Statut |
|---|---|---|
| Brouillon | `facture_evoliz` (statut='brouillon') | Modifiable — régénérable |
| Validée | `facture_evoliz` (statut='valide') | Validée — pas encore envoyée |
| Envoyée | Evoliz + `facture_evoliz` (statut='envoye_evoliz', `evoliz_id` renseigné) | **Irréversible** |

**Source de vérité finale** : Evoliz après push. La table `facture_evoliz` est le brouillon de travail — Evoliz est l'original légal.

**Règle critique** : le push vers Evoliz est irréversible. Un guard `id_evoliz` + skip protège le cas nominal (CF-F2, commit e228e0b0). Résidu : si l'UPDATE Supabase échoue définitivement après création Evoliz, un second push reste possible — réconciliation manuelle requise.

---

## 9. Heures réelles AE (`ventilation.montant_reel`)

**Donnée** : montant réel facturé par l'AE pour le ménage d'une réservation (remplace la provision `AUTO`).

| Étape | Source | Mécanisme |
|---|---|---|
| Saisie | Portail AE | `UPDATE ventilation SET montant_reel = X WHERE reservation_id = Y AND code = 'AUTO'` |
| Condition | Ventilation existante | ⚠ Si la ventilation du mois n'a pas été calculée, l'UPDATE touche 0 lignes — silencieux |
| Utilisation | Balance AUTO/FMEN | Comparaison `provision_ae_ref` vs `montant_reel` dans PageAEs |

**Source de vérité finale** : `ventilation.montant_reel` si non null. Sinon `bien.provision_ae_ref` (provision) est utilisé à la place dans les factures.

**Conflits actifs** :
- ⚠ Chaîne d'accès portail brisée (CF-PAE1/PAE2) — `montant_reel` reste null pour tous les AEs tant que le portail est inaccessible.
- ⚠ Si `montant_reel` est saisi avant que la ventilation soit calculée, les heures sont silencieusement perdues (CF-PAE3).

---

## 10. Statut d'une réservation (`final_status`)

**Donnée** : état de la réservation — 'accepted', 'cancelled', 'not_accepted'.

| Source | Mécanisme | Priorité |
|---|---|---|
| Webhook Hospitable (temps réel) | `reservation_status.current.category` | Priorité 1 — temps réel |
| Sync API Hospitable | `reservation_status?.current?.category \|\| resa.status \|\| 'accepted'` | Priorité 2 — sync manuelle |
| Import CSV Hospitable | `mapStatus(row.status)` — fallback 'accepted' si inconnu | Priorité 3 — historique |

**Source de vérité finale** : webhook Hospitable si disponible. Sinon dernière sync API.

**Conflit actif** :
- ⚠ Le fallback `'accepted'` dans la sync API et l'import CSV peut masquer des annulations réelles si `reservation_status.current.category` est null (courant sur Booking.com). Une réservation annulée peut être ventilée à tort.

---

## 11. Accès portail AE (authentification)

**Donnée** : identifiants de connexion de l'AE au portail.

| Étape | Source | Mécanisme |
|---|---|---|
| Création | `create-ae-user` Edge Function | `supabaseAdmin.auth.admin.createUser()` → `ae_user_id` mis à jour en base |
| Mot de passe affiché | État React (popup) | Généré côté client — jamais persisté en base |
| Mot de passe en base | `auto_entrepreneur.mdp_temporaire` | ⚠ Jamais écrit — toujours null |
| Reset | `reset-ae-password` Edge Function | ⚠ Edge Function inexistante — erreur 404 garantie |

**Source de vérité finale** : Supabase Auth (UUID `ae_user_id`). Le mot de passe réel n'est accessible que via Supabase Auth Dashboard.

**Conflit actif** :
- ⚠ `mdp_temporaire` est toujours null en base (CF-PAE1) — le bouton "Identifiants" affiche systématiquement "(non disponible - recréer le compte)".
- ⚠ Aucun chemin de reset fonctionnel sans intervention Supabase Dashboard (CF-PAE2).

---

## 12. Missions AE (`mission_menage`)

**Donnée** : missions de ménage associées à un AE pour un mois donné.

| Étape | Source | Mécanisme |
|---|---|---|
| Création automatique (cron) | `sync-ical-cron` | Parse iCal de chaque AE — 3 mois (mois-1, mois, mois+1) |
| Création manuelle | `sync-ical-ae` (via portail ou PageAEs) | Parse iCal d'un AE spécifique pour un mois |
| Clé de déduplication | `ical_uid` | Upsert `onConflict: 'ical_uid'` |
| Attribution au bien | Correspondance `ical_code` | `bien.ical_code` préfixe du code extrait du titre iCal |

**Source de vérité finale** : calendrier iCal Hospitable (source externe). `mission_menage` en base est un cache de ce calendrier.

**Conflits actifs** :
- ⚠ Si deux biens ont des `ical_code` similaires, les missions peuvent être attribuées au mauvais bien (CF-PAE4).
- ⚠ `sync-ical-cron` ne filtre pas les AEs inactifs — génère des missions fantômes (CF-PAE6).

---

## 13. Facturation propriétaire (`facture_evoliz`)

**Donnée** : factures générées par `genererFacturesMois` dans `src/services/facturesEvoliz.js`. Deux types coexistent depuis mars 2026.

| `type_facture` | Contenu | `montant_reversement` | Déclencheur |
|---|---|---|---|
| `'honoraires'` | HON, FMEN, DIV, HAOWNER (si présent), PREST (mémo local, non poussé Evoliz), FRAIS (déduction loyer, montant négatif, non poussé) | Non null — calculé à la génération | Toujours généré si réservations du mois |
| `'debours'` | DEB_AE (TVA 0%) + DEBP (debours_proprio, TVA selon ae.type) — une ligne par bien avec AUTO/debours à facturer | `null` — non applicable à une créance | Généré si surplus AUTO ou bien `mode_encaissement='proprio'` avec AUTO, ou debours_proprio |

> La facture `'debours'` couvre AUTO (DEB_AE) et `debours_proprio` (DEBP). Extensible à d'autres types de débours.

**Contrainte UNIQUE** : `(proprietaire_id, mois, type_facture)` — au plus une facture de chaque type par propriétaire par mois.

**Calcul `montantReversement` (facture honoraires)** :
```
montantReversement = max(0, LOY_global − deduction_loy − haownerTTC − autoAbsorbableTotal − deboursPropAbsorbTotal − deboursPropSurplusTotal)
autoAbsorbableTotal    = Σ biens dcb : min(AUTO_bien, max(0, LOY_bien − prest_bien − haownerBienTTC))
deboursPropAbsorbTotal = Σ biens : min(DEBP_bien, max(0, LOY_restant_bien))  [après absorption AUTO]
deboursPropSurplusTotal = DEBP non absorbé → facturé dans facture débours (code DEBP)
```

**`resteAPayer`** : calculé à la volée dans `genererFacturesMois`, accumulé dans `log.resteAPayer`, affiché comme alerte warning dans PageFactures. **Non stocké en base. Non comptable. UI uniquement. Il ne doit jamais être utilisé comme base de rapprochement bancaire ou d'écriture comptable.**

**Source de vérité finale** : `facture_evoliz` (après génération), puis Evoliz (après push — irréversible).

---

## 14. Notes de marché (`bien_notes`)

**Donnée** : notes rédigées par DCB pour chaque bien, par mois. Intégrées dans les rapports propriétaires.

| Étape | Source | Mécanisme |
|---|---|---|
| Création / mise à jour | `rapportProprietaire.js` → `saveBienNote` | Upsert `onConflict: 'bien_id,mois'` |
| Lecture | `rapportProprietaire.js` → `getBienNote` | SELECT `maybeSingle` |

**Source de vérité finale** : `bien_notes` en base. Mise à jour manuelle via `PageRapports` (auto-save on blur).

---

## 15. Avis voyageurs (`reservation_review`)

**Donnée** : avis reçus via webhook Hospitable. Associés à une réservation interne.

| Étape | Source | Mécanisme |
|---|---|---|
| Création / mise à jour | `hospitable-webhook` → `handleReview` | Upsert `onConflict: 'hospitable_reservation_id'` |
| Lecture | `rapportProprietaire.js` → `getReviewsMois` | SELECT + join reservation/bien, filtre par mois |

**Source de vérité finale** : `reservation_review` en base. `reservation_id` peut être null si la réservation n'est pas encore importée au moment du webhook.

**Conflit potentiel** : si une réservation est importée après le webhook, `reservation_id` reste null — la jointure `reservation/bien` ne remontera pas le bien. Impact : rapport propriétaire sans attribution de bien pour cet avis.

---

## 16. Configuration du mode d'encaissement (`bien.mode_encaissement`)

**Donnée** : champ `text NOT NULL DEFAULT 'dcb'` sur la table `bien`, avec contrainte `CHECK IN ('dcb', 'proprio')`.

| Valeur | Signification | Impact facturation |
|---|---|---|
| `'dcb'` | DCB encaisse les paiements voyageurs | AUTO absorbable sur le reversement (`autoAbsorbableBien`) ; surplus → facture débours |
| `'proprio'` | Le propriétaire encaisse directement | Totalité de l'AUTO → facture débours ; aucune absorption |

**Qualification mars 2026** : 24 biens `'dcb'`, 13 biens `'proprio'` (correspondant aux biens avec `gestion_loyer = false`, zéro rapprochement bancaire confirmé en 2025-2026).

**Source de vérité** : table `bien`, champ `mode_encaissement`. Qualifié manuellement — aucune synchronisation automatique.

---

## Synthèse — Sources de vérité par étape du flux

| Étape du flux | Donnée clé | Source brute principale | Source brute secondaire | Source de calcul métier | Source légale aval | Conflits actifs |
|---|---|---|---|---|---|---|
| Collecte (clôture) | `fin_revenue` | **CSV Hospitable** (référence mensuelle) | Hospitable API / webhook (enrichissement) | — | — | ⚠ Fallback 'accepted' sur annulations Booking — divergence CSV/API possible |
| Collecte (clôture) | Fees détaillés | **CSV Hospitable** (référence mensuelle) | Hospitable API (`include=financials`, `financials` = `financialsV2`) | — | — | ⚠ DELETE+INSERT sans transaction — labels/catégories instables |
| Ventilation | Codes comptables (HON…LOY) | — | — | `ventilation.js` V1 uniquement | — | ⚠ V2 NaN, V3 RPC absente |
| Ventilation | Taux de commission | — | — | `bien.taux_commission_override` → `proprietaire.taux_commission` → 25% | — | Aucun conflit — ordre de priorité explicite |
| Rapprochement | Lien mouvement ↔ réservation | — | — | `ventilation.mouvement_id` (primaire) | — | ⚠ 2 moteurs de matching, orphelins si suppression brutale |
| Rapprochement | Payout attendu | — | — | `payout_hospitable` (syncReservations.js) | — | ⚠ Payouts global-sync incompatibles (mois_payout) — pas de relation 1:1 réservation/payout, montant peut être ajusté ou négatif |
| AE réel | Heures effectuées | — | — | `ventilation.montant_reel` (portail) | — | ⚠ Null si portail inaccessible — provisions utilisées à la place |
| Facturation | Reversement propriétaire | — | — | — | `facture_evoliz.montant_reversement` (gelé à la génération) | ⚠ Périmé si reventilation sans régénération |
| Facturation | Facture officielle | — | — | — | Evoliz (après push) | ⚠ Doublon possible, irréversible |
| Auth AE | Identifiants portail | — | — | — | Supabase Auth Dashboard | ⚠ mdp_temporaire null, reset inexistant (à confirmer) |
| Facturation | `type_facture` / `mode_encaissement` | — | — | `genererFacturesMois` (`facturesEvoliz.js`) | `facture_evoliz` (gelé à génération), puis Evoliz | ✅ `debours_proprio` intégré (CF-P1-BC). `dcb_direct` : log interne par conception. |
| Rapports | Notes de marché | `bien_notes` | — | `rapportProprietaire.js` | — | Auto-save on blur dans PageRapports |
| Rapports | Avis voyageurs | `reservation_review` | webhook Hospitable (handleReview) | `rapportProprietaire.js` | — | `reservation_id` peut être null si resa pas encore importée |

---

*Fichier généré dans le cadre de l'audit structurel DCB Compta — mars 2026.*
*Ne pas modifier sans relecture du code source.*
