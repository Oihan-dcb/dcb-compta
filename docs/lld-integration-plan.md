# Plan d'intégration des LLD dans la machinerie comptable (rapports · facturation · virements)

> **Statut : préparation (pas d'implémentation).** Objectif : doter les LLD (table `etudiant`) d'une **facturation d'honoraires Evoliz + relevé proprio**, comme le saisonnier — mais via un **chemin dédié, totalement séparé du saisonnier**. Ce document fige le principe, l'architecture cible, le modèle de données, les décisions métier, et un plan par phases.

## 1. Principe directeur (RÉVISÉ 2026-06-17 — chemin dédié, PAS via `ventilation`)

> ⚠️ **Décision révisée** : on **NE réinjecte PAS** les LLD dans la table `ventilation` du saisonnier. Le co-mêlage (lignes `source='lld'`, `reservation_id` NULL dans la table chaude qui alimente rapports + factures + SEPA saisonniers) est trop risqué : un seul filtre `source` oublié = du loyer LLD dans un rapport/une facture/un fichier SEPA saisonnier. Et c'est incohérent avec « séquestre dédié, ne pas fusionner les flux ». → **On partage le FORMAT de sortie (facture Evoliz, affichage Facturation), pas la table de calcul.**

**Source de vérité LLD = `loyer_suivi`** (qui a déjà `montant_attendu`, `montant_recu` proratisés, et le taux via `etudiant.taux_commission`). On génère la facture d'honoraires et le relevé proprio **directement depuis `loyer_suivi`**, sans jamais toucher `ventilation`.

Trois principes verrouillés :
- **Facturation séparée** : générateur LLD dédié lisant `loyer_suivi`. Zéro écriture dans `ventilation`, pas de `reservation_id` nullable, aucun filtre `source` à ajouter dans le code saisonnier.
- **Séquestre dédié** : loyers LLD sur `agency_config.seq_lld_loyers_iban` (≠ saisonnier `seq_lc_iban`). Virement proprio + virement honoraires déjà branchés sur `virement_proprio_suivi` / `genererSCTHonorairesDCB` (Phase 1). Inchangé.
- **Affichage partagé** : les factures LLD vivent dans la table `facture_evoliz` avec un discriminant `type_facture='lld'` → visibles dans la page Facturation (badge « LLD », filtre dédié), mais générées par le chemin LLD et **exclues des agrégats saisonniers** (filtre `type_facture`).

On ne facture **qu'une seule chose** : les **honoraires de gestion DCB** (commission). Pas le loyer, pas les charges (reversés au proprio). Code comptable **`HON_LLD`** (compte Evoliz à confirmer Garnier — 7067 existant ou dédié).

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

## 4. Architecture cible (chemin dédié — facture honoraires depuis `loyer_suivi`)

```
loyer_suivi (statut=recu)  ──► generateurFactureLLD(mois, bien)   [nouveau, lit loyer_suivi, N'ÉCRIT PAS dans ventilation]
   pour chaque loyer reçu du bien dans le mois :
       base   = montant_recu (réel, déjà proratisé)         ← Laura : commission sur le loyer CC reçu
       honTTC = round(base × etudiant.taux_commission)      [10%/8%/5% BITXI]  ← commission TTC
       honHT  = round(honTTC / 1.20)                        ← TVA 20%
       honTVA = honTTC − honHT
   ──► 1 facture_evoliz par BIEN par MOIS (type_facture='lld', client = propriétaire du bien)
         1 ligne par loyer LLD (code HON_LLD) :  HT=honHT, TVA=honTVA, TTC=honTTC
         (2 lignes si turnover : deux locataires se succèdent sur le même bien dans le mois)
   ──► push Evoliz (ACCOUNT_MAP : HON_LLD → compte à confirmer Garnier)
   ──► affichage page Facturation : badge « LLD », filtre type_facture='lld'

relevé proprio (mensuel, léger) : depuis loyer_suivi (loyer reçu, honoraires, net reversé) — document proprio.
virement : virement_proprio_suivi (net) + genererSCTHonorairesDCB (commission) — DÉJÀ en place (Phase 1).
ventilation saisonnière : NON TOUCHÉE.
```

**Exemple Solène** (CC reçu 790 €, taux 10 %) : honTTC = **79 €** → ligne facture **65,83 HT + 13,17 TVA = 79 TTC** ; net reversé proprio = 790 − 79 = **711 €**.

**On ne facture que les honoraires.** Le loyer + charges sont reversés (pas facturés). **Frais de mise en location** (13 €/m² × 2) = facture **one-shot** au début du bail (locataire + proprio), hors flux mensuel — à modéliser à part.

Point de génération : sur les loyers `statut='recu'` du mois (commission sur le réel encaissé). Idéal après `majLoyersDepuisVirements` / passage à `recu`.

## 5. Modèle de données à préparer (groundwork)
- **`ventilation`** : ❌ **AUCUN changement** (on n'y touche pas — décision révisée). Pas de `reservation_id` nullable, pas de `source`.
- **`facture_evoliz`** : ajouter un discriminant **`type_facture`** (`'lc'`/`'lld'`) — visibilité page Facturation + exclusion des agrégats saisonniers. Le reste des colonnes facture est générique (réutilisable).
- **`loyer_suivi`** : `montant_attendu`/`montant_recu` déjà proratisés (Phase 1). Lien facture : ajouter `facture_evoliz_id` (FK, nullable) pour tracer quelle facture couvre quel loyer (et éviter de re-facturer).
- **`etudiant.taux_commission`** : ✅ déjà fait (Phase 0, migration 201). `honoraires_dcb` gardé comme cache legacy.
- **`agency_config`** : `seq_lld_loyers_iban` / `seq_lld_loyers_bic` / `agence_iban` — déjà utilisés (Phase 1, exportSCT).
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

### Tranchées (Oïhan, 2026-06-17) — design facturation
- **Facturation LLD séparée** : chemin dédié lisant `loyer_suivi`, **PAS** via la table `ventilation` (cf. §1 révisé).
- **Commission = TTC** : le taux (10/8/5 %) donne le montant **tout compris**. Facture = HT (= TTC/1,20) + TVA 20 %. (Confirmé Laura : « 800 → reverse 720 » ⇒ DCB garde 80 € TTC.)
- **Granularité facture** : **1 facture par bien et par mois**, **1 ligne par loyer LLD** (2 lignes si turnover — deux locataires sur le même bien dans le mois). Client = propriétaire du bien.
- **Affichage** : factures LLD dans `facture_evoliz` avec `type_facture='lld'` → visibles en page Facturation (badge/filtre), exclues des agrégats saisonniers.

### Reste ouvert (cabinet Garnier)
- **Compte comptable Evoliz** pour `HON_LLD` (réutiliser 7067 « honoraires étudiantes » ou créer un compte dédié). Q7 déléguée au comptable.

## 6bis. Questions pour Laura
Voir `docs/lld-questions-laura.md`.

## 7. Prorata entrée/sortie (prérequis transverse — cf. audit séparé)
Le loyer du **mois d'entrée et du mois de sortie** doit être proratisé : `montant = round(plein × jours_occupés / jours_du_mois)`. Aujourd'hui absent partout (date_sortie ne sert qu'à inclure/exclure le mois entier). À intégrer dans la **source unique** `montantTotalEtudiant(e, mois)` / `montantVirementProprio(e, mois)` (`locationsLongues.js`), idéalement en **persistant** le montant proratisé dans `loyer_suivi.montant_attendu` pour que relance / quittance / bilan / (future) facture LLD le **lisent** au lieu de recalculer le plein (4 recalculs dupliqués aujourd'hui : `locationsLongues.js:67`, `relance-loyer:174`, `generer-quittance:66`, `bilan-lld:50`).

## 8. Plan par phases (RÉVISÉ 2026-06-17)
- **Phase 0 — Terrain** : ✅ FAIT. `etudiant.taux_commission` (migration 201, 10/8/5 %).
- **Phase 1 — Prorata + honoraires %** : ✅ FAIT (commit b08accd). `prorataMois`, `montantTotalEtudiant(e,mois)`, `honorairesEtudiant`, persistance `loyer_suivi.montant_attendu` + `virement_proprio_suivi.montant` ; lus par relance/quittance/bilan ; virement honoraires (exportSCT) = taux × reçu ; UI saisie taux %.
- **Phase 2 — Facture honoraires LLD (chemin dédié)** : générateur `genererFactureLLD(mois, bien)` lisant `loyer_suivi` (statut recu) → **1 facture `facture_evoliz` (type_facture='lld') par bien/mois**, 1 ligne par loyer (code `HON_LLD`, commission **TTC** décomposée HT + TVA 20 %), client = proprio du bien. Push Evoliz. **N'écrit PAS dans `ventilation`.** Pré-requis schéma : `facture_evoliz.type_facture` + `loyer_suivi.facture_evoliz_id`.
- **Phase 3 — Affichage + relevé** : page Facturation affiche les factures LLD (badge/filtre `type_facture='lld'`, exclues des agrégats saisonniers) ; **relevé proprio** mensuel léger depuis `loyer_suivi` (loyer reçu / honoraires / net reversé).
- **Phase 4 — Frais de mise en location** (optionnel) : facture one-shot 13 €/m² × 2 (locataire + proprio) au début du bail. Nécessite `etudiant.surface_m2`. Indépendant du flux mensuel.
- **Note** : le virement (proprio + honoraires) est déjà opérationnel via `virement_proprio_suivi` / `genererSCTHonorairesDCB` (Phase 1) — **pas de cutover ventilation à prévoir** puisqu'on ne passe pas par `ventilation`.

⏳ **Bloquant Phase 2** : compte comptable Evoliz `HON_LLD` (Garnier).

## Fichiers clés
`api/ventiler.js`, `supabase/functions/ventilation-auto/index.ts`, `src/services/buildRapportData.js`, `src/services/facturesEvoliz.js`, `src/services/evoliz.js` (ACCOUNT_MAP), `src/services/exportSCT.js`, `src/services/locationsLongues.js`, `src/services/lldBanque.js`, `supabase/functions/{relance-loyer,generer-quittance,bilan-lld}/index.ts`.
