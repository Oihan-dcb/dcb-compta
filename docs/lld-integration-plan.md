# Plan d'intégration des LLD dans la machinerie comptable (rapports · facturation · virements)

> **Statut : préparation (pas d'implémentation).** Objectif futur : faire passer les locations longue durée (LLD, table `etudiant`) par le **même pipeline que les locations saisonnières** — rapport propriétaire, facturation Evoliz, virements proprio. Ce document fige le principe, l'architecture cible, le modèle de données à préparer, les décisions métier à trancher, et un plan par phases.

## 1. Principe directeur

**Un loyer LLD mensuel = une mini-réservation mensuelle**, mais **distincte du saisonnier** : elle réutilise la *mécanique* `ventilation` (mêmes colonnes/codes génériques), **pas le même circuit d'argent**. Deux différences structurantes décidées :

- **Identification explicite** : la mini-réservation / les lignes `ventilation` LLD doivent porter un **discriminant clair** (ex. `source='lld'` + `etudiant_id`/`loyer_suivi_id`, `reservation_id` NULL) pour ne jamais être confondues avec une vraie résa saisonnière, et pour router le reste.
- **Séquestre dédié** : les loyers LLD vont sur un **compte séquestre LLD distinct** (`agency_config.seq_lld_loyers_iban`), **pas** le séquestre saisonnier (`seq_lc_iban`). Donc le virement proprio et la clôture séquestre LLD restent **séparés** — on ne fusionne pas les deux flux d'argent, on partage seulement le format de ventilation / rapport / facture.

Au lieu du pipeline parallèle actuel (`loyer_suivi`/`virement_proprio_suivi` alimentés directement depuis `etudiant`), chaque loyer mensuel encaissé produit des **lignes `ventilation`** taguées LLD. Le rapport et la facturation Evoliz lisent déjà `ventilation` → quasi gratuit ; le **virement** reste sur le circuit séquestre LLD existant (`genererSCTVirementsProprios`) mais alimenté désormais par la ventilation taguée.

Indice que c'est l'intention d'origine : les comptes comptables **`HON_ETU` (7067)** et **`HON_MOB` (7068)** existent déjà dans `src/services/evoliz.js` (`ACCOUNT_MAP`) mais ne sont produits par aucun code path. → On créera plutôt un code générique **`HON_LLD`** (les LLD ne sont pas que des étudiants ; compte Evoliz à confirmer avec Laura — réutiliser 7067 ou nouveau compte).

## 2. État actuel — les deux pipelines

### Saisonnier (cible à répliquer)
- **Déclencheur** : réservation Hospitable → `api/webhook-hospitable.js` → `sync-reservations` → `ventilation-auto` / `api/ventiler.js`.
- **Ventilation** : `_calculerLignes()` (`api/ventiler.js:69-226`) décompose en codes **HON** (honoraires, TVA 20%), **LOY** (loyer proprio), **VIR** (=LOY+TAXE, VIRProprio), **FMEN**, **COM**, **MEN**, **AUTO**, **TAXE**. Colonnes : `reservation_id, bien_id, proprietaire_id, code, montant_ht, montant_tva, montant_ttc, taux_tva, mois_comptable, calcul_source, mouvement_id`.
- **Rapport proprio** : `src/services/buildRapportData.js` lit `reservation`+`ventilation` (codes HON/LOY/VIR/FMEN/AUTO/MEN) filtrés par `mois_comptable` → KPIs + `virementNet`.
- **Evoliz** : `src/services/facturesEvoliz.js` agrège la `ventilation` du mois → `facture_evoliz` (+ `facture_evoliz_ligne`), calcule `montant_reversement`. Push via `src/services/evoliz.js` (`ACCOUNT_MAP` : HON→7061, FMEN→7062, COM→7063, DIV→7065, HAOWNER→7066, **HON_ETU→7067**, **HON_MOB→7068**, DEB_AE→467).
- **Virement** : `src/services/exportSCT.js` → `genererSCTVirementsPropriosLC` lit `ventilation.code='VIR'`.

### LLD (actuel — pipeline parallèle, déconnecté)
- **Déclencheur** : `initialiserLoyersMois(mois)` (`src/services/locationsLongues.js:89-129`) — analogue de `processMois`, mais écrit dans `loyer_suivi` (`montant_attendu`) et `virement_proprio_suivi` (`montant`), **pas** dans `ventilation`.
- **Montant** : `montantTotalEtudiant(e)` (`locationsLongues.js:67`) = `loyer_nu + supplement_loyer + charges_eau + charges_copro + charges_internet` (**plein, sans prorata**) ; reversement = `− honoraires_dcb`.
- **Rapport** : aucun rapport comptable structuré — seulement un email `bilan-lld` (edge function).
- **Evoliz** : aucune facture LLD (compte 7067 jamais utilisé).
- **Virement** : `genererSCTVirementsProprios` (`exportSCT.js:175`) depuis `virement_proprio_suivi` — fonctionne mais autonome, montant figé, sans déductions par bien.
- **Rapprochement** : table + moteur séparés (`lld_mouvement_bancaire`, `src/services/lldBanque.js`).

## 3. Gap — ce qui manque aux LLD pour égaler le saisonnier
1. Pas de lignes `ventilation` (aucune décomposition par code/TVA).
2. Pas de rapport propriétaire (buildRapportData ignore `etudiant`/`loyer_suivi`).
3. Pas de facture Evoliz (HON_ETU/7067 inutilisé).
4. Virement autonome (pas issu de `ventilation`, pas de déductions AUTO/HAOWNER/débours/frais/owner_stay).
5. Rapprochement bancaire séparé (pas de VIRPayinProuvé ni clôture séquestre).
6. **Pas de prorata** entrée/sortie en cours de mois (cf. §7).
7. `loyer_suivi`/`virement_proprio_suivi` indexés par `etudiant_id`+`mois` (string), pas `bien_id`/`proprietaire_id`/`mois_comptable` au niveau ligne.

## 4. Architecture cible

```
loyer_suivi (mensuel, statut=recu)
   └─► [nouveau] _calculerLignesLLD(loyer_suivi, etudiant, bien)   ← analogue de _calculerLignes
          base_CC = loyer_nu + supplement_loyer + charges_eau + charges_copro + charges_internet
                    (× prorata jours_occupés/jours_du_mois si entrée/sortie en cours de mois)
          └─► écrit dans `ventilation` (taguées source='lld') :
                 LOY     = base_CC − HON_LLD_ht ... non : VIR = base_CC − HON_LLD_ttc (cf. ci-dessous)
                 HON_LLD = round(base_CC × taux_commission)   [10%/8%/5% BITXI]   TTC, dont TVA 20%
                 VIR     = base_CC − HON_LLD                   hors TVA → VIRProprio (reversé au proprio)
              (Laura : « locataire paie 800 € → on reverse 720 € » = base_CC − 10% ; honoraires retenus sur le loyer CC)
              avec reservation_id = NULL, source='lld', etudiant_id = e.id, loyer_suivi_id = l.id,
                   bien_id, proprietaire_id, mois_comptable = mois
   └─► rapport / facture Evoliz : lisent déjà `ventilation`.
        virement : circuit séquestre LLD dédié (seq_lld_loyers_iban), pas le séquestre saisonnier.
```

**Honoraires = % du loyer CC** (10 % étudiant / 8 % bail à l'année / 5 % BITXI), TVA 20 % incluse — le champ `etudiant.honoraires_dcb` (montant figé) est remplacé par `etudiant.taux_commission`. **Supplément + compléments + charges forfaitaires** : tous dans la **base CC** (commission ET LOY reversé). **Frais de mise en location** (13 €/m² × 2) = poste **one-shot séparé**, hors ventilation mensuelle.

Point d'intégration recommandé : **à l'encaissement** du loyer (passage `loyer_suivi.statut → 'recu'`, ou via `lldBanque.majLoyersDepuisVirements`), générer les lignes `ventilation`. Alternative : à `initialiserLoyersMois` (attendu) puis ajuster au réel — moins propre (le saisonnier ventile sur le réel encaissé).

## 5. Modèle de données à préparer (groundwork)
- **`ventilation`** : autoriser `reservation_id` NULL ; ajouter `source` (`'lc'|'lld'`, discriminant), `etudiant_id` (FK) et `loyer_suivi_id` (FK) pour la traçabilité + le routage séquestre LLD. Garder `bien_id`/`proprietaire_id`/`mois_comptable`/`code`/montants identiques au saisonnier.
- **`loyer_suivi`** : ajouter `mois_comptable` (YYYY-MM, déjà ~équivalent à `mois`), et éventuellement `bien_id`/`proprietaire_id` dénormalisés (sinon joindre via `etudiant`).
- **`etudiant`** : ⚠️ ajouter **`taux_commission`** (numeric, ex. 0.10/0.08/0.05) en remplacement de `honoraires_dcb` (montant figé). Migration : déduire le taux existant = `honoraires_dcb / montant_total_CC` par locataire, ou saisir manuellement (10 % défaut étudiant, 8 % bail année, 5 % BITXI). Garder `honoraires_dcb` en transition si besoin, mais la source devient le taux. Éventuellement `frais_mise_en_location` (one-shot, 13 €/m² × 2) si on veut le tracer.
- **Codes** : réutiliser `LOY`/`VIR` (LOY/VIR = base CC − honoraires) ; créer **`HON_LLD`** pour les honoraires (= % CC, TVA 20 %, compte Evoliz à confirmer Garnier). Charges intégrées au CC (pas de code charges séparé).
- **`facture_evoliz`** : prévoir un `type_facture` LLD ; le reste du flux est générique.
- **`agency_config`** : `seq_lld_loyers_iban` (séquestre LLD) — déjà utilisé par `genererSCTVirementsProprios`.

## 6. Décisions métier

### Tranchées (Oïhan, 2026-06-11)
- **Identification** : mini-résa LLD distincte (`source='lld'`, `reservation_id` NULL) — jamais confondue avec une résa saisonnière.
- **Séquestre dédié** : loyers LLD sur `seq_lld_loyers_iban` — virement + clôture séparés du saisonnier.
- **Supplément de loyer** : fait partie du loyer (loyer plafonné + supplément) → reversé au proprio (LOY), pas un honoraire.
- **Code honoraires** : `HON_LLD` (générique, pas seulement étudiants) — pas `HON_ETU`.
- **Rapport proprio** : pas de rapport saisonnier complet (KPIs occupation/RevPAR sans objet). Format léger/dédié, ou pas de rapport — à définir au moment de la Phase 3.
- **Quittance locataire** : reste séparée (`generer-quittance`) — document locataire.

### Tranchées (Laura, 2026-06-11) — voir `lld-questions-laura.md`
- **Honoraires mensuels = % du loyer CC**, PAS un montant fixe : **10 % étudiants**, **8 % bail à l'année**, **5 % BITXI** (exception). ⚠️ **Changement de modèle** : le champ `etudiant.honoraires_dcb` (montant figé en centimes) doit devenir un **`taux_commission`** appliqué au loyer total CC. → `HON_LLD = round(montant_total_CC × taux)`.
- **Frais de mise en location** (one-shot, à chaque nouvelle location, **distinct** des honoraires mensuels) : **13 €/m² × 2 côtés** (locataire + proprio). Poste séparé — pas dans la ventilation mensuelle. *(Modélisation à définir : facture one-shot dédiée, hors pipeline mensuel.)*
- **Charges** = reversées au proprio, **forfaitaires partout** (jamais régularisées). Les honoraires sont calculés sur le loyer **CC** (charges comprises). → `charges_*` font partie de la base commission ET du LOY reversé.
- **TVA 20 %** sur les honoraires : **oui**.
- **Prorata** entrée/sortie : `loyer CC × jours occupés ÷ jours du mois` — s'applique au **CC complet** (loyer + supplément + complément + charges). « / 30 ou 31 » = jours réels du mois.
- **Documents mensuels** : facture d'honoraires Evoliz (comptable) **+** quittance locataire (`generer-quittance`) **+** **relevé proprio** (nouveau, léger).
- **Séquestre LLD dédié** (« compte de gestion longue durée ») : confirmé. **Cautions sur compte excédent** (séparé). Reversement loyer vers le **7/8 du mois** ; virement **global des honoraires** en une fois.
- **Compléments de loyer** : inclus dans `LOY`, pas de poste distinct.
- **Apporteur sans gestion** : aucun cas à gérer (sauf historique LAUIAN CIRAUQUI ×2 + Guétary).

### Reste ouvert (cabinet Garnier)
- **Compte comptable Evoliz** pour `HON_LLD` (réutiliser 7067 « honoraires étudiantes » ou créer un compte dédié). Q7 déléguée au comptable.

## 6bis. Questions pour Laura
Voir `docs/lld-questions-laura.md`.

## 7. Prorata entrée/sortie (prérequis transverse — cf. audit séparé)
Le loyer du **mois d'entrée et du mois de sortie** doit être proratisé : `montant = round(plein × jours_occupés / jours_du_mois)`. Aujourd'hui absent partout (date_sortie ne sert qu'à inclure/exclure le mois entier). À intégrer dans la **source unique** `montantTotalEtudiant(e, mois)` / `montantVirementProprio(e, mois)` (`locationsLongues.js`), idéalement en **persistant** le montant proratisé dans `loyer_suivi.montant_attendu` pour que relance / quittance / bilan / (futures) ventilations le **lisent** au lieu de recalculer le plein (4 recalculs dupliqués aujourd'hui : `locationsLongues.js:67`, `relance-loyer:174`, `generer-quittance:66`, `bilan-lld:50`).

## 8. Plan par phases
- **Phase 0 — Terrain (maintenant, sans changer le comportement)** : ce document ; décisions §6 tranchées ✅ ; migration schéma `ventilation.reservation_id` nullable + `etudiant_id`/`loyer_suivi_id` ; `loyer_suivi.mois_comptable` ; **`etudiant.taux_commission`** (10 %/8 %/5 % BITXI, remplace `honoraires_dcb`).
- **Phase 1 — Prorata + honoraires % (source unique)** : `montantTotalEtudiant(e, mois)` proratisé (CC × jours/jours_mois) + honoraires = `taux_commission × base_CC` ; persistance `loyer_suivi.montant_attendu` ; faire lire cette valeur par relance/quittance/bilan + le portail owner. *(Corrige le bug de prorata + bascule honoraires fixe → %.)*
- **Phase 2 — Ventilation LLD** : `_calculerLignesLLD()` à l'encaissement → lignes `ventilation` (LOY/**HON_LLD**/VIR, TVA 20 % sur HON_LLD).
- **Phase 3 — Rapport + Evoliz** : **relevé proprio** mensuel léger (décidé par Laura) + facture Evoliz LLD (code `HON_LLD`, compte à confirmer Garnier). `buildRapportData` étendu ou ventilation seule.
- **Phase 4 — Virement + rapprochement** : alimenter le virement séquestre LLD (`genererSCTVirementsProprios`, `seq_lld_loyers_iban`) depuis la `ventilation` taguée `source='lld'` ; converger le rapprochement.
- **Phase 5 — Cutover** : retirer le pipeline parallèle `virement_proprio_suivi` une fois la ventilation faisant foi.

## Fichiers clés
`api/ventiler.js`, `supabase/functions/ventilation-auto/index.ts`, `src/services/buildRapportData.js`, `src/services/facturesEvoliz.js`, `src/services/evoliz.js` (ACCOUNT_MAP), `src/services/exportSCT.js`, `src/services/locationsLongues.js`, `src/services/lldBanque.js`, `supabase/functions/{relance-loyer,generer-quittance,bilan-lld}/index.ts`.
