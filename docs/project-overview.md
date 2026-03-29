# DCB Compta — Vue d'ensemble du système

> **Statut** : Document d'audit — mars 2026
> **Source** : Code source + audit complet + guide d'utilisation
> **Avertissement** : Ce document décrit le système **tel qu'il existe réellement**, incluant ses incohérences structurelles actives. Il ne décrit pas un système idéal.

---

## TL;DR — Lecture rapide

DCB Compta est une application comptable mensuelle pour une conciergerie de locations. Son cœur est la **ventilation** qui transforme chaque réservation en codes comptables (HON, FMEN, AUTO, LOY, VIR). Ces codes pilotent directement les factures propriétaires et les reversements.

**Architecture CSV-first** : l'export CSV Hospitable est la source principale de données pour la comptabilité mensuelle. L'API Hospitable et les webhooks sont des sources secondaires d'enrichissement — utiles mais non indispensables à la cohérence comptable.

**Le système est séquentiel et fragile** : une erreur en amont (mauvaise ventilation, mauvais matching) se propage silencieusement jusqu'aux factures et aux virements. Il présentait trois critiques structurels actifs : ventilation dupliquée en 3 versions dont une cassée (V2 désactivée ✅), double moteur de matching aux logiques divergentes, prestations hors forfait partiellement intégrées (`deduction_loy`, `haowner`, AUTO ✅ — `dcb_direct` et `debours_proprio` restent sans effet).

**Certaines opérations ne sont pas idempotentes** : relancer global-sync, le matching ou pousser vers Evoliz une deuxième fois peut produire des données en double ou des écrasements incorrects.

**À retenir avant toute modification** : corriger un bug dans `ventilation.js` ne corrige pas les deux autres copies. Supprimer un mouvement bancaire sans passer par `annulerRapprochement` laisse des orphelins en base. Toute erreur peut entraîner une mauvaise facturation, un mauvais reversement propriétaire, ou une incohérence bancaire.

---

## 1. Présentation générale

DCB Compta est une application comptable interne pour **Destination Côte Basque (DCB)**, conciergerie de locations courte durée gérant ~50 biens sur la zone Biarritz / Bidart / Anglet.

Elle couvre l'intégralité du **cycle financier mensuel** : synchronisation des réservations depuis le PMS (Hospitable), ventilation comptable automatique, rapprochement bancaire, facturation des propriétaires via Evoliz, et gestion des auto-entrepreneurs ménage.

### Deux applications, une base commune

| Application | URL | Utilisateurs | Rôle |
|---|---|---|---|
| DCB Compta | dcb-compta.vercel.app | Oïhan (admin) | Gestion comptable complète |
| Portail AE | dcb-portail-ae.vercel.app | Prestataires ménage | Saisie heures + prestations extras |

Les deux applications partagent la **même base Supabase**. Aucune des deux n'a de protection d'authentification côté frontend (✅ confirmé — App.jsx sans guard).

---

## 2. Stack technique

| Couche | Technologie | Usage |
|---|---|---|
| Frontend | React + Vite, déployé sur Vercel | DCB Compta + Portail AE |
| Base de données | Supabase (Postgres + Realtime) | Stockage central |
| Backend serverless | Edge Functions Deno (Supabase) | Auth AE, sync iCal, sync globale, webhook |
| API route Vercel | `api/ae-action.js` | Proxy frontend → Edge Functions |
| APIs externes | Hospitable v2, Evoliz, Stripe | PMS, facturation légale, paiements directs |

---

## 3. Les 10 modules

### Module 1 — Biens
**Rôle réel** : Référentiel central. Configure les paramètres qui pilotent toute la ventilation et la facturation.
**Données** : `bien` (hospitable_name, code, proprietaire_id, provision_ae_ref, forfait_dcb_ref, taux_commission_override, airbnb_account, ical_code, gestion_loyer, agence, has_ae)
**Dépendances entrantes** : Hospitable API (sync biens), saisie manuelle
**Dépendances sortantes** : Ventilation (taux, provisions), Rapprochement (airbnb_account), Portail AE (ical_code), Factures (via propriétaire)

### Module 2 — Réservations
**Rôle réel** : Réceptacle des données brutes Hospitable. Déclencheur de la ventilation.
**Données** : `reservation` (fin_revenue, platform, arrival_date, final_status, ventilation_calculee, rapprochee, owner_stay), `reservation_fee` (fees détaillés)
**Dépendances entrantes** : CSV Hospitable (source principale — photo mensuelle de référence), Hospitable API (enrichissement secondaire), webhook Hospitable (mise à jour secondaire non bloquante)
**Dépendances sortantes** : Ventilation (source des calculs), Rapprochement (cible des matchings), Factures (base des honoraires)

### Module 3 — Banque
**Rôle réel** : Import et stockage des mouvements bancaires Caisse d'Épargne. Préparation du rapprochement.
**Données** : `mouvement_bancaire` (libelle, credit, debit, canal, statut_matching, date_operation, mois_releve)
**Dépendances entrantes** : CSV Caisse d'Épargne (import manuel), CSV Booking (import payout_line)
**Dépendances sortantes** : Rapprochement (mouvements à associer), `booking_payout_line`, `stripe_payout_line`
**Avertissement** : La suppression d'un mouvement (individuelle ou en masse) ne nettoie pas les tables liées — génère des orphelins en base (✅ CF-BQ1/BQ2).

### Module 4 — Rapprochement
**Rôle réel** : Association mouvements bancaires ↔ réservations via les payouts Hospitable. Met à jour `ventilation.mouvement_id` et `reservation.rapprochee`.
**Données** : `payout_hospitable`, `payout_reservation`, `reservation_paiement`, liens `ventilation.mouvement_id`
**Dépendances entrantes** : Mouvements bancaires (Module 3), Payouts Hospitable/Stripe (sync), VIR ventilés (Module 2)
**Dépendances sortantes** : `reservation.rapprochee`, `ventilation.mouvement_id`, `payout_hospitable.mouvement_id`
**Avertissement** : Deux moteurs de matching coexistent avec des logiques différentes — résultats inconsistants selon le déclencheur (✅ CF-C3, critique majeur).

### Module 5 — Factures
**Rôle réel** : Génération des factures DCB → Propriétaires à partir de la ventilation calculée. Envoi vers Evoliz.
**Données** : `facture_evoliz` (type_facture: 'honoraires' | 'debours'), `facture_evoliz_ligne` (HON, FMEN, DIV, HAOWNER, PREST, DEB_AE)
**Dépendances entrantes** : Ventilation (HON, FMEN, LOY, AUTO par bien), Expenses DCB, Propriétaires (Evoliz), `prestation_hors_forfait` (deduction_loy ✅, haowner ✅), `bien.mode_encaissement`
**Dépendances sortantes** : Evoliz (API), export CSV comptable
**Avertissement** : CF-P1 partiellement corrigé — `deduction_loy` et `haowner` intégrés, AUTO routé bien-par-bien. `dcb_direct` et `debours_proprio` encore sans effet. Navigation temporelle : ✅ corrigée (CF-F1).

### Module 6 — Import CSV
**Rôle réel** : Chargement en masse de l'historique des réservations depuis Hospitable CSV. Alternative à la sync API.
**Données** : `reservation`, `reservation_fee`, `mission_menage` (indirectement via fusionnerDoublons)
**Dépendances entrantes** : Fichier CSV exporté depuis Hospitable (Metrics → Reservations)
**Dépendances sortantes** : `reservation` (upsert), `reservation_fee` (DELETE + INSERT), déclenchement `fusionnerDoublons`
**Avertissement** : Pas de transaction entre DELETE fees et INSERT fees — perte définitive possible en cas de crash (✅ CF-I2). `fusionnerDoublons` ne migre pas `reservation_paiement` ni `payout_reservation` (✅ CF-I1).

### Module 7 — Auto-entrepreneurs (AEs)
**Rôle réel** : Gestion des prestataires ménage. Configuration des accès portail, sync iCal, catalogue prestations.
**Données** : `auto_entrepreneur` (email, ical_url, taux_horaire, ae_user_id, mdp_temporaire), `prestation_type`, `mission_menage`
**Dépendances entrantes** : iCal Hospitable (sync missions), saisie manuelle (fiches AE)
**Dépendances sortantes** : Portail AE (accès auth), `mission_menage` (missions du mois), `prestation_hors_forfait` (catalogue types)
**Avertissement** : `confirmModal` et balance AUTO/FMEN hors du `return()` JSX → jamais rendus (✅ CF-AE1). Suppression AE impossible via l'UI. `mdp_temporaire` jamais sauvegardé (✅ CF-AE3). `reset-ae-password` Edge Function inexistante (✅ CF-PAE2).

### Module 8 — Prestations hors forfait
**Rôle réel** : Réception et validation des prestations extras soumises par les AEs. Partiellement intégré dans la facturation depuis mars 2026.
**Données** : `prestation_hors_forfait` (statut, montant, type_imputation, bien_id, ae_id, mission_id)
**Dépendances entrantes** : Portail AE (soumission AE), validation manuelle DCB
**Dépendances sortantes** : `genererFactureProprietaire` lit `deduction_loy` (déduction reversement ✅) et `haowner` (ligne TVA 20% facture principale ✅). `debours_proprio` et `dcb_direct` : toujours sans effet comptable ⚠. Aucune écriture dans `ventilation.js` (code EXTRA absent).
**Avertissement** : CF-P1 partiellement corrigé. Les types `dcb_direct` et `debours_proprio` sont stockés mais toujours sans impact comptable.

### Module 9 — Config
**Rôle réel** : Interface d'administration et de déclenchement des opérations en masse (sync all-time, matching, reventilation).
**Données** : Variables d'environnement, déclencheurs d'Edge Functions
**Dépendances entrantes** : Aucune (interface déclencheuse)
**Dépendances sortantes** : `global-sync` Edge Function, `syncProprietairesEvoliz`, `lancerMatching` (ancien), `resetEtRematcher`
**Avertissement** : Clés Evoliz secrète et publique affichées en clair dans le HTML rendu (✅ CF-C1, risque sécurité immédiat). `global-sync` produit des NaN dans la ventilation (✅ CF-C2, critique majeur). Utilise l'ancien moteur de matching (✅ CF-C3).

### Module 10 — Portail AE
**Rôle réel** : Interface mobile-first pour les prestataires ménage. Saisie des heures, soumission de prestations extras, consultation des missions.
**Données** : lit `mission_menage`, écrit `ventilation.montant_reel` (heures), insère `prestation_hors_forfait`
**Dépendances entrantes** : `mission_menage` (sync iCal), auth Supabase (ae_user_id)
**Dépendances sortantes** : `ventilation.montant_reel` (heures réelles → impact AUTO/FMEN), `prestation_hors_forfait` (prestations extras)
**Avertissement** : Chaîne d'accès brisée sur deux points (mdp_temporaire non sauvegardé, reset inexistant) → portail inutilisable sans intervention Supabase Dashboard (✅ CF-PAE1/PAE2). `montant_reel` UPDATE sur ligne inexistante si ventilation non calculée → heures silencieusement perdues (🔶 CF-PAE3).

---

## 4. Flux global d'exécution mensuel

Le système fonctionne en continu pendant le mois (import, rapprochement, saisie AE), puis une clôture mensuelle centralisée est réalisée à partir du CSV Hospitable.

```
SUIVI CONTINU — pendant le mois (au fil de l'eau)
──────────────────────────────────────────────────────────────────
  [SOURCE SECONDAIRE — enrichissement, non bloquant]
  Hospitable API ──────────────────────────────→ Réservations (enrichissement)
  webhook Hospitable (temps réel) ─────────────→ Réservations [⚠ ventilation RPC probablement absente]
  iCal Hospitable (cron/manuel) ───────────────→ mission_menage (AEs)
  CSV Caisse d'Épargne ────────────────────────→ Banque (mouvements)
  Portail AE → saisie heures ──────────────────→ ventilation.montant_reel
                                                   (correction AUTO réel — remplace la provision)
                                                   [⚠ silencieux si ventilation non calculée — CF-PAE3]
  Portail AE → prestations ────────────────────→ prestation_hors_forfait
                                                   [⚠ AUCUN impact comptable actuellement — CF-P1]
                                                   [cible : code EXTRA dans ventilation]
  Rapprochement progressif des virements ──────→ ventilation.mouvement_id mis à jour

CLÔTURE MENSUELLE — session centralisée (cf. ordre de clôture §4.4)
──────────────────────────────────────────────────────────────────
  [SOURCE PRINCIPALE — référence de clôture]
  CSV Hospitable (export mensuel) ──────────────→ Réservations + reservation_fee

  Réservations ────────────────────────────────→ VENTILATION [⚠ 3 versions, cf. critique 1]
                                                   ↓
  AUTO réel (AE) ───────────────────────────────→ correction ventilation
  EXTRAS (prestations) ─────────────────────────→ [cible] enrichissement ventilation
  HAOWNER (achats proprio) ─────────────────────→ [cible] enrichissement ventilation
                                                   ↓
  Mouvements bancaires ────→ RAPPROCHEMENT ←── Payouts Hospitable/Booking/Stripe
                                [⚠ 2 moteurs, cf. critique 2]
                                   ↓
  Ventilation finale ───────────────────────────→ FACTURES PROPRIÉTAIRES
                                                   [⚠ EXTRAS et HAOWNER non intégrés actuellement]
                                                   ↓
                                              Evoliz (envoi légal)
                                                   ↓
                                           Export CSV comptable

TRAÇABILITÉ (transversal)
──────────────────────────────────────────────────────────────────
  Journal des opérations ───────────────────────→ [⚠ 1 seule opération loguée sur ~20]
  import_log ───────────────────────────────────→ [⚠ non affiché dans Journal]
  webhook_log ──────────────────────────────────→ [⚠ non affiché dans Journal]
```

---

## 4. Flux réel d'exécution

### 4.1 Mode CSV-first avec clôture mensuelle centralisée

DCB Compta est désormais basé sur une architecture **CSV-first** : l'export CSV Hospitable constitue la source principale de données pour la comptabilité. L'API Hospitable et les webhooks sont des sources secondaires d'enrichissement — utiles pour le suivi en temps réel, mais non indispensables à la cohérence comptable de clôture.

Le système fonctionne selon deux temps : **préparation continue pendant le mois** (suivi progressif), puis **clôture comptable mensuelle centralisée** basée sur le CSV.

### 4.2 Suivi en temps réel pendant le mois

Les opérations suivantes peuvent être effectuées au fil de l'eau :
- Import des réservations via API Hospitable (enrichissement secondaire)
- Import des mouvements bancaires (CSV Caisse d'Épargne)
- Synchronisation des payouts (Hospitable / Stripe)
- Rapprochement progressif des virements
- Synchronisation iCal des missions AE
- Saisie des heures par les AEs (Portail)
- Soumission et validation des prestations hors forfait

Ce suivi continu prépare progressivement la clôture. **Il ne se substitue pas à l'import CSV mensuel** — qui reste l'acte de collecte de référence pour la clôture.

### 4.3 Clôture mensuelle du mois précédent

La clôture comptable complète est effectuée en **une seule session**, généralement le **4 du mois suivant**.

Exemple : le 4 avril → clôture du mois de mars.

### 4.4 Ordre réel de clôture

Au moment de la clôture, l'ordre logique obligatoire est le suivant :

```
1.  Importer le CSV Hospitable du mois (source principale de référence)
       └─ PageImport → Import CSV Hospitable

2.  Vérifier que les réservations du mois sont complètes
       └─ PageRéservations → Sync Hospitable (enrichissement secondaire si nécessaire)

3.  Vérifier que les mouvements bancaires sont tous importés
       └─ PageBanque → Import CSV Caisse d'Épargne

4.  Synchroniser les payouts (Booking + Stripe + Hospitable)
       └─ PageRapprochement → Sync payouts

5.  Calculer la ventilation comptable
       └─ PageRéservations → ⚡ Ventiler [⚠ 3 versions — utiliser ventilation.js V1 uniquement]

6.  Intégrer les ajustements métier (doit précéder la facturation)
       └─ AUTO réel (AE) : PageAEs → Balance AUTO/FMEN
                          [⚠ actuellement non fonctionnel — CF-AE1]
                          [AUTO réel corrige la ventilation : remplace la provision]
       └─ EXTRAS (prestations validées) : PagePrestations → Valider
                          [⚠ sans effet comptable actuellement — CF-P1]
                          [cible : doit produire une écriture EXTRA dans la ventilation]
       └─ HAOWNER (achats propriétaire) : [⚠ non implémenté]
                          [cible : doit produire une écriture dans la ventilation ou la facturation]

7.  Finaliser le rapprochement bancaire
       └─ PageRapprochement → ⚡ Matching auto + traitement manuel

8.  Vérifications finales
       └─ Contrôler les écarts ventilation, les mouvements non rapprochés, les anomalies

9.  Générer les factures
       └─ PageFactures → ⚡ Générer factures
       [⚠ la ventilation doit être finale avant cette étape — montant_reversement gelé à la génération]

10. Valider les factures
       └─ PageFactures → ✓ Valider chaque facture

11. Pousser vers Evoliz
       └─ PageFactures → → Pousser vers Evoliz [⚠ opération irréversible]

12. Exporter les écritures et documents de clôture
       └─ PageFactures → ↓ Export comptable
       └─ PageRapprochement → ↓ Export CSV
```

> **Clarification métier** : la facturation dépend de la ventilation finale. Les ajustements métier (AUTO réel, EXTRAS, HAOWNER) doivent être intégrés à la ventilation **avant** l'étape 9. Toute correction post-génération nécessite une régénération des factures avant push Evoliz.

### 4.5 Points de non-retour

Certaines étapes sont **irréversibles ou difficiles à corriger** une fois franchies :

| Étape | Risque |
|---|---|
| Génération des factures | Le `montant_reversement` est gelé — une reventilation post-génération ne le met pas à jour sans régénération manuelle |
| Push vers Evoliz | Irréversible côté Evoliz — un second push crée une facture en doublon (✅ CF-F2) |
| Suppression d'un mouvement bancaire | Ne nettoie pas les tables liées — orphelins définitifs (✅ CF-BQ1/BQ2) |
| DELETE fees dans importCSV | Sans transaction — perte définitive si crash entre DELETE et INSERT (✅ CF-I2) |

### 4.6 Conséquence métier

Une erreur non détectée **pendant le suivi mensuel** peut encore être corrigée avant la clôture.

En revanche, une erreur non détectée avant :
- la **génération des factures** (étape 9)
- ou le **push vers Evoliz** (étape 11)

se propage dans la comptabilité du mois et peut nécessiter une correction manuelle a posteriori, voire une intervention directe dans Evoliz.

---

## 5. Propagation des erreurs

**Le système est séquentiel.** Chaque étape du flux mensuel dépend de la qualité des données produites par l'étape précédente. Une erreur en amont se propage silencieusement vers l'aval sans mécanisme d'alerte fiable (le journal est quasi-inopérant).

Exemples de propagations confirmées :

| Erreur source | Propagation |
|---|---|
| Ventilation NaN (global-sync CF-C2) | HON/FMEN/LOY = NaN → facture 0€ ou incorrecte → mauvais reversement |
| Suppression mouvement sans nettoyage (CF-BQ1) | réservation reste `rapprochee=true` → VIR orphelin → facture calculée sur base fantôme |
| Portail AE inaccessible (CF-PAE1/2) | heures non saisies → `montant_reel` null → AUTO = provision (pas réel) → facture inexacte |
| Matching divergent (CF-C3) | résultats différents selon le bouton → état `rapprochee` instable → incohérences bancaires |
| Prestations non intégrées (CF-P1) | prestations validées ignorées → LOY non réduit → propriétaire sur-reversé |

---

## 6. Sources de vérité par étape du flux

La vérité métier n'est pas uniforme — elle dépend du stade d'avancement du flux mensuel.

**Hiérarchie des sources (architecture CSV-first)** :
1. **Source brute principale** : CSV Hospitable — photo mensuelle de référence pour la clôture
2. **Source brute secondaire** : Hospitable API / webhook — enrichissement et suivi en temps réel, non bloquants
3. **Source de calcul métier** : `ventilation.js` V1 — transforme les données brutes en codes comptables DCB
4. **Source légale finale** : Evoliz (après push)

> **Règle critique** : Le CSV constitue la photographie de référence du mois pour la comptabilité. Toute divergence avec les données issues de l'API ou des webhooks doit être analysée, mais ne doit pas modifier une clôture déjà validée sans intervention explicite.

| Étape | Donnée clé | Source de vérité |
|---|---|---|
| Collecte (référence clôture) | Revenu brut réservation (`fin_revenue`) | **CSV Hospitable** (photo mensuelle de référence) — API/webhook : source secondaire d'enrichissement |
| Collecte (référence clôture) | Fees détaillés (cleaning, community, etc.) | **CSV Hospitable** (priorité clôture) — `reservation_fee` en base — `hospitable_raw` (fallback) |
| Ventilation | Codes comptables (HON, FMEN, AUTO, LOY, VIR) | Table `ventilation` — calculée par `ventilation.js` V1 idéalement |
| Ventilation | Taux de commission appliqué | `bien.taux_commission_override` → `proprietaire.taux_commission` → 25% défaut |
| Rapprochement | Lien mouvement ↔ réservation | `ventilation.mouvement_id` + `reservation.rapprochee` |
| AE réel | Heures effectuées | `ventilation.montant_reel` (saisi par portail) |
| Facturation | Montant facturé propriétaire | `facture_evoliz.total_ttc` (gelé à la génération) |
| Facturation | Reversement propriétaire | `facture_evoliz.montant_reversement` (**gelé à la génération** — périmé si reventilation après) |
| Légal | Facture officielle | Evoliz (après push — irréversible) |

**Conflits de sources actifs :**
- `facture_evoliz` : schéma SQL utilise `mois_facturation`, service utilise `mois` (✅ CF-F1)
- `payout_hospitable` : inséré avec `mois_payout` par global-sync vs `mois_comptable` attendu par le matching frontend (✅ CF-C4)
- `ventilation` : trois versions de calcul peuvent produire des valeurs différentes pour la même réservation selon le déclencheur utilisé
- Divergence CSV / API : si une re-sync API produit des valeurs différentes du CSV importé, le CSV fait foi pour la clôture mensuelle en cours — sauf correction explicite et documentée

---

## 7. Non-idempotence des opérations critiques

Certaines opérations **ne peuvent pas être relancées en toute sécurité** sans risque d'effet de bord :

| Opération | Risque si relancée |
|---|---|
| **global-sync** | Réinsère des payouts avec un schéma divergent, recalcule la ventilation avec NaN, peut écraser des rapprochements existants |
| **Matching auto** (Config, ancien moteur) | Peut créer des doublons de `reservation_paiement`, résultats différents du matching PageRapprochement |
| **Push vers Evoliz** | Si l'update Supabase échoue après création Evoliz, le second push crée une facture en doublon dans Evoliz (✅ CF-F2) |
| **Import CSV bancaire** | Réimporte tous les mois du fichier sans filtre si `moisSelectionnes` non passé (✅ CF-BQ6) |
| **fusionnerDoublons** | Supprime les slaves sans transaction — perte définitive si crash (✅ CF-I2) |

---

## 8. Critiques majeurs actifs

Ces trois points sont des incohérences structurelles qui affectent la fiabilité globale du système.

### [CRITIQUE 1] Ventilation dupliquée — 3 versions divergentes
La logique de ventilation comptable (transformation `fin_revenue` → HON/FMEN/AUTO/LOY/VIR/TAXE) existe dans trois fichiers distincts. Toute correction dans l'un ne se propage pas aux autres.
- V1 `src/services/ventilation.js` — référence la plus cohérente observée
- V2 `supabase/functions/global-sync/index.ts` — constantes manquantes → **produit des NaN en base**
- V3 `supabase/functions/hospitable-webhook/index.ts` — appelle `ventiler_toutes_resas` RPC (probablement inexistante)

### [CRITIQUE 2] Matching doublé — 2 moteurs avec logiques différentes
- `src/services/matching.js` (ancien) — utilisé par PageConfig
- `src/services/rapprochement.js` (nouveau) — utilisé par PageRapprochement
- `global-sync` — contient sa propre copie inline
Un même mois peut produire des résultats de rapprochement différents selon le bouton utilisé.

### [CRITIQUE 3] Prestations hors forfait non intégrées
Le module Prestations existe dans l'UI, la validation fonctionne, mais les prestations validées n'ont **aucun effet** sur la ventilation ni sur les factures. La logique d'imputation (`type_imputation`) est définie mais jamais exécutée.

---

## 9. Risques métier directs

| Risque | Déclencheur | Modules impactés |
|---|---|---|
| Facture propriétaire incorrecte | Ventilation NaN (global-sync) / Prestations non intégrées | Factures, Reversements |
| Mauvais reversement propriétaire | LOY calculé sur ventilation corrompue ou périmée | Factures, Rapprochement |
| Incohérence bancaire | Double moteur de matching / Suppression sans nettoyage | Banque, Rapprochement |
| Données orphelines en base | Suppression mouvement sans nettoyage tables liées | Banque, Rapprochement, Réservations |
| Exposition de secrets | Clés Evoliz en clair dans HTML public | Config, Evoliz |
| Heures AE perdues | Portail inaccessible / UPDATE sur ligne inexistante | AEs, Factures |

---

*Fichier généré dans le cadre de l'audit structurel DCB Compta — mars 2026.*
*Ne pas modifier sans relecture du code source.*


---

## Fixes session 29 mars 2026 (soir)
- `5e3c428` : suppression fragment JSX orphelin PageFactures.jsx (diagnostiqué par git bisect)
- `214872e` : type_facture honoraires explicite + filtre lookup + clé mois dupliquée supprimée
- `27afd2dd` : batch N+1 genererFactureDebours, filtre mémoire AUTO, logs AUTO-PROPRIO/DEBOURS
- Restauration accents UI dans tous les fichiers JSX/JS