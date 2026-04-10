# DCB Compta — Invariants système

> **Statut** : Document d'audit — avril 2026
> **Source** : Code source + audit complet + règles métier (`domain-rules.md`)
> **Avertissement** : Ce document distingue explicitement les invariants respectés et ceux actuellement violés, avec référence aux bugs correspondants.

---

## Principe

Un invariant est une règle qui doit **toujours être vraie** dans le système, indépendamment de l'opération effectuée. Toute violation est un état corrompu qui peut se propager silencieusement jusqu'aux factures et aux reversements.

Les invariants sont organisés par domaine. Pour chaque invariant : état attendu, état actuel, et référence au bug si violé.

---

## Domaine 1 — Intégrité financière globale

Ces invariants ont la priorité absolue. Leur violation peut entraîner une facturation incorrecte.

| # | Invariant | État | Violation / Référence |
|---|---|---|---|
| I-01 | `ventilation.montant_ht`, `montant_tva`, `montant_ttc` ne sont jamais NaN, null ou non numériques | ✅ **Corrigé** | `global-sync` V2 alignée avec V1 (session 07/04/2026) — constantes, commissionableBase unifiée, ownerFees Direct, menLabelsToExclude. Bouton Global Update ré-activable. V3 webhook toujours non auditée. |
| I-02 | `facture_evoliz.montant_ht`, `montant_tva`, `montant_ttc` ne sont jamais NaN | ✅ Respecté | Calculés depuis la ventilation — violé si I-01 est violé en amont |
| I-03 | `facture_evoliz.montant_reversement` correspond au montant de reversement calculé à partir de la ventilation (notamment le code LOY) au moment de la génération. Ce montant est gelé dans la facture mais ne constitue pas une ligne de facturation DCB — LOY est un composant de reversement propriétaire, pas une ligne facturée. | ✅ Respecté à la génération | ⚠ Devient faux si reventilation après génération sans régénération (périmé) |
| I-04 | Toute facture est reconstruisable depuis la ventilation et les données source | ✅ Structurellement vrai | ⚠ Compromis si NaN en base (I-01) — CF-F1 corrigé |
| I-05 | LOY ne doit jamais être interprété comme une ligne de facturation DCB. LOY est un composant de reversement propriétaire — les lignes de facturation DCB sont HON, FMEN et autres prestations. | ✅ Règle métier | ⚠ Pas de protection technique — risque de confusion dans le code et les rapports |
| I-06 | Si `ventilation.montant_reel` (AUTO réel) est renseigné, il remplace la provision AUTO. Si AUTO réel > provision, le traitement de l'écart doit être explicite (CAS OWNER → EXTRA, ou CAS DCB → absorption FMEN) — il ne doit pas être absorbé silencieusement. | ⚠ **Partiellement implémenté** | `COALESCE(montant_reel, montant_ht)` appliqué dans `genererFactureProprietaire` et `genererFactureDebours` — le réel remplace la provision dans le calcul d'absorption et de surplus. Aucun mécanisme de signalement d'anomalie si réel > provision dans `ventilation.js`. |
| I-07 | Pour chaque bien `mode_encaissement = 'dcb'`, la part AUTO absorbable est calculée sur le LOY du bien seul — un bien ne peut pas absorber le surplus AUTO d'un autre bien du même propriétaire | ✅ **Implémenté** | Boucle bien-par-bien dans `genererFactureProprietaire` (commits 96c10f80, efc33afb) |
| I-08 | Pour un même propriétaire et un même mois, une facture `type_facture='honoraires'` et une facture `type_facture='debours'` peuvent coexister — la contrainte UNIQUE porte sur `(proprietaire_id, mois, type_facture)` | ✅ **Implémenté** | Migration SQL + lookup sécurisé par `.eq('type_facture', 'honoraires')` dans `genererFactureProprietaire` + `type_facture: 'honoraires'` explicite dans `factureData`. Commit `214872e`. |
| I-09 | Le DELETE des lignes ventilation ne bloque jamais sur la FK `mission_menage.ventilation_auto_id` | ✅ **Corrigé** | Migration `002_fk_ventilation_auto_set_null` : FK passée de `RESTRICT` à `ON DELETE SET NULL`. Postgres met automatiquement `ventilation_auto_id = NULL` sur les missions liées lors du DELETE. Code manuel de déliage (`update({ ventilation_auto_id: null })`) supprimé de `ventilation.js` et `global-sync`. Session 07/04/2026. |

---

## Domaine 2 — Cohérence réservation / ventilation

| # | Invariant | État | Violation / Référence |
|---|---|---|---|
| I-10 | Une réservation avec `ventilation_calculee = true` a des lignes dans `ventilation` — **exception** : les réservations `STATUTS_NON_VENTILABLES` (cancelled, not_accepted, declined, expired) ont `ventilation_calculee=true` sans lignes ventilation (comportement attendu) | ✅ Respecté | Nettoyage explicite dans `calculerVentilationResa` pour STATUTS_NON_VENTILABLES (commit `349ba88`) |
| I-11 | Une réservation ventilée a au minimum les codes HON et LOY | ✅ Respecté si `fin_revenue > 0` | ⚠ Peut être violé si ventilation interrompue à mi-calcul |
| I-12 | `fin_revenue = 0` → aucune ligne de ventilation | ✅ Respecté | Règle explicite dans V1 (early return) |
| I-13 | Réservation `owner_stay = true` → aucune ligne de ventilation | ✅ Respecté | Filtre explicite dans `calculerVentilationMois` |
| I-14 | Réservation `bien.gestion_loyer = false` → aucune ligne de ventilation | ✅ Respecté | Filtre explicite |
| I-15 | Réservation `bien.agence ≠ 'dcb'` → aucune ligne de ventilation | ✅ Respecté | Filtre explicite |
| I-16 | `ventilation_calculee` ne repasse jamais automatiquement à `false` | ✅ Respecté | Aucun mécanisme de reset automatique — correction manuelle uniquement |

---

## Domaine 3 — Cohérence rapprochement

| # | Invariant | État | Violation / Référence |
|---|---|---|---|
| I-20 | `reservation.rapprochee = true` implique l'existence d'au moins un `ventilation.mouvement_id` valide | ✅ **Corrigé** | `supprimerMouvement` et `supprimerMois` appellent `annulerRapprochement` avant DELETE — nettoyage complet (CF-BQ1, confirmé audit 30 mars) |
| I-20b | `reservation.rapprochee = true` implique que `fin_revenue` est intégralement couvert par des virements bancaires liés (`Σ mouvement_bancaire.credit ≥ fin_revenue − 200`) | ✅ **Implémenté** | `_lier` vérifie le solde après chaque lien — si solde > 100 centimes : `rapprochee=false` + nouvelle ligne VIR résiduelle créée automatiquement (commit `2b1df6e`) |
| I-21 | `ventilation.mouvement_id` renseigné implique que le mouvement existe en base | ✅ **Corrigé** | `annulerRapprochement` remet `mouvement_id=null` sur toutes les lignes ventilation liées (CF-BQ1/BQ2) |
| I-22 | `payout_hospitable.mouvement_id` renseigné implique que le mouvement existe en base | ✅ **Corrigé** | `annulerRapprochement` remet `mouvement_id=null` sur `payout_hospitable` (CF-BQ1) |
| I-23 | Un mouvement `statut = 'rapproche'` a au moins une réservation liée via `ventilation.mouvement_id` | ✅ **Corrigé** | `annulerRapprochement` couvre VIR + payout sans VIR via `payout_reservation` join (CF-RAPP-4, commit `55ad751`) |
| I-24 | Le résultat du matching est identique quel que soit le bouton utilisé (Config ou PageRapprochement) | ✅ **Corrigé** | Unified sur `lancerMatchingAuto` de `rapprochement.js` — PageConfig et PageMatching utilisent le même moteur (CF-C3) |

---

## Domaine 4 — Intégrité des données de base

| # | Invariant | État | Violation / Référence |
|---|---|---|---|
| I-30 | `reservation_fee` d'une réservation est cohérente avec `hospitable_raw.financials` | ⚠ Probable | DELETE+INSERT sans transaction (CF-I2) — peut laisser une réservation sans fees après crash |
| I-31 | Pas de réservations en doublon (même `hospitable_id`) | ✅ Respecté | Contrainte UNIQUE sur `hospitable_id` |
| I-32 | Après `fusionnerDoublons`, le slave est supprimé seulement si toutes les migrations ont réussi | ✅ **Corrigé** | Migrations séquentielles complètes avec `throw` sur toute erreur avant DELETE (CF-I1, commit d8fedd9b). Résidu : `expense` et `journal_ops` non migrés (faible risque). |
| I-33 | `bien.provision_ae_ref` est renseigné pour tous les biens avec `has_ae = true` | ⚠ Non garanti | `biensAConfigurer` compte ce cas mais l'UI ne bloque pas la ventilation |

---

## Domaine 5 — Intégrité des factures

| # | Invariant | État | Violation / Référence |
|---|---|---|---|
| I-40 | Une facture `statut = 'envoye_evoliz'` a un `evoliz_id` non null | ✅ **Corrigé** | Les deux champs sont mis à jour dans le même UPDATE — si ce dernier échoue, la facture reste `envoi_en_cours` (jamais `envoye_evoliz` sans `id_evoliz`). Verrou pre-envoi CF-F2 (commit `1c7305f`) |
| I-41 | Une facture a au moins une ligne dans `facture_evoliz_ligne` | ⚠ Violable | Si génération interrompue entre INSERT facture et INSERT lignes |
| I-42 | Une facture ne peut être poussée vers Evoliz qu'une seule fois | ✅ **Corrigé** | Verrou `statut='envoi_en_cours'` avant appel Evoliz — si UPDATE final échoue, la facture reste `envoi_en_cours` et n'est plus repêchée par `pousserFacturesMoisVersEvoliz` (query `statut='valide'`). Rollback `statut='valide'` si Evoliz échoue avant `saveInvoice`. CF-F2 (commit `1c7305f`) |
| I-43 | Les factures d'un mois sont navigables depuis le MoisSelector | ✅ **Corrigé** | Champ `mois` utilisé partout dans `facturesEvoliz.js` — `mois_facturation` absent du code actuel (CF-F1) |

---

## Domaine 6 — Intégrité AE / Portail

| # | Invariant | État | Violation / Référence |
|---|---|---|---|
| I-50 | Un AE avec `ae_user_id` non null peut se connecter au portail | ✅ **Corrigé** | `create-ae-user` et `reset-ae-password` sauvegardent `mdp_temporaire` — code path ✅ confirmé audit 30 mars (CF-PAE1/PAE2) |
| I-51 | `ventilation.montant_reel` saisi par le portail correspond à la réservation du bon mois | ✅ **Corrigé** | `ventilation.js` V1 renseigne `mission_menage.ventilation_auto_id` via RPC `lier_ventilation_auto_mission` après calcul. La saisie silencieusement perdue est prévenue pour tous les cas avec ligne AUTO (CF-PAE3). |
| I-52 | Une prestation `statut = 'valide'` a un impact sur la comptabilité (LOY, facture, ou débit DCB) | ⚠ **Majoritairement corrigé** | `deduction_loy` : déduit du reversement ✅. `haowner` : ligne HAOWNER TVA 20% ✅. AUTO : absorbé ou DEB_AE ✅. `debours_proprio` : absorption LOY après AUTO + ligne DEBP + surplus facturé (CF-P1-BC, commit `b7bedc1`) ✅. `dcb_direct` : suivi interne uniquement (`log.dcbDirectTotal`) par conception — pas de facturation propriétaire (CF-P1-A) ✅. Reste : code EXTRA dans `ventilation.js` non implémenté. |
| I-53 | `auto_entrepreneur.mdp_temporaire` est synchronisé avec le mot de passe Supabase Auth | ✅ **Corrigé** | Edge Function `create-ae-user` sauvegarde `mdp_temporaire` — code path ✅ confirmé audit 30 mars (CF-PAE1) |
| I-54 | Une prestation hors forfait validée produit une écriture dans la ventilation (code EXTRA) | ⚠ **Non implémenté** — à formaliser | Code EXTRA inexistant dans V1 — état cible non encore atteint |
| I-55 | Tout achat DCB pour le compte d'un propriétaire (HAOWNER) produit une ligne de facturation explicite | ✅ **Implémenté** | Ligne HAOWNER TVA 20% dans la facture principale (`genererFactureProprietaire`, commit 2c5f9d15). `montantReversement = max(0, LOY − deduction_loy − haownerTTC)`. Pas de code HAOWNER dans `ventilation.js` — prestation lue depuis `prestation_hors_forfait`. |

---

## Domaine 7 — Traçabilité

| # | Invariant | État | Violation / Référence |
|---|---|---|---|
| I-60 | Toute opération métier significative est tracée dans `journal_ops` | ⚠ **Partiellement corrigé** | Ventilation et factures loguées (CF-J2) — ~15 opérations restent sans logOp. Couverture partielle acceptée — pas un invariant critique. |
| I-61 | Le filtre mois de PageJournal retourne les opérations du mois sélectionné | ✅ **Corrigé** | `mois_comptable` renseigné dans logOp (CF-J1) |
| I-62 | Les logs d'import et de webhook sont visibles dans PageJournal | ✅ **Corrigé** | `import_log` mergée dans `getJournal` (CF-J3) |

---

## Domaine 8 — Architecture CSV-first

| # | Invariant | État | Violation / Référence |
|---|---|---|---|
| I-70 | Le CSV Hospitable est importé avant toute clôture mensuelle | ✅ Règle de processus | Pas de mécanisme de vérification dans l'UI — repose sur la discipline opérationnelle |
| I-71 | Une clôture validée (factures générées + push Evoliz) n'est pas modifiée implicitement par une re-sync API ou un webhook | ✅ Règle documentée — protection partielle | Le push Evoliz est irréversible. Mais une re-sync API peut écraser `fin_revenue` en base après clôture, invalidant toute future régénération — pas de protection technique contre cet écrasement |
| I-72 | En cas de divergence CSV / API sur `fin_revenue`, le CSV fait foi pour la clôture tant qu'aucune intervention explicite n'a été décidée | ✅ Règle documentée | Pas de mécanisme technique de protection — repose sur la discipline opérationnelle. La divergence ne doit jamais être résolue silencieusement par une re-sync. |
| I-73 | Toute modification d'une donnée financière après clôture validée doit faire l'objet d'une décision explicite et documentée | ✅ Règle métier | Non implémenté techniquement — aucun mécanisme de verrouillage après clôture |

---

## Résumé des invariants violés

### Invariants violés actifs

Aucun invariant actif violé à l'issue de la session du 02 avril 2026.

> I-60 reste ⚠ partiellement couvert (~15 opérations non loguées) mais n'est plus considéré comme un invariant critique bloquant.

### Invariants corrigés (mars 2026)

| Invariant | Description courte | Commit / Référence |
|---|---|---|
| I-01 | NaN dans montants ventilation | CF-C2/C8 — V2 désactivée (`119be181`) |
| I-20 | rapprochee=true sans mouvement_id valide | CF-BQ1 — `annulerRapprochement` appelé avant DELETE (`55ad751`) |
| I-21 | ventilation.mouvement_id orphelin | CF-BQ1/BQ2 — nettoyage complet dans `annulerRapprochement` |
| I-22 | payout.mouvement_id orphelin | CF-BQ1 — idem |
| I-23 | Rapprochement partiel à l'annulation | CF-RAPP-4 (`55ad751`) — VIR + payout couverts |
| I-24 | Matching non déterministe selon déclencheur | CF-C3 — moteur unifié `lancerMatchingAuto` |
| I-32 | fusionnerDoublons supprime sans vérifier migration | CF-I1 (`d8fedd9b`) |
| I-40 | facture envoye_evoliz sans evoliz_id | CF-F2 (`1c7305f`) — verrou envoi_en_cours |
| I-42 | Push Evoliz non idempotent | CF-F2 (`1c7305f`) — verrou pre-envoi + rollback |
| I-43 | Navigation temporelle factures cassée | CF-F1 — champ `mois` partout |
| I-50 | AE avec ae_user_id ne peut pas se connecter | CF-PAE1/PAE2 — code path ✅ confirmé audit 30 mars |
| I-51 | Saisie AE perdue si ventilation non calculée | CF-PAE3 — RPC `lier_ventilation_auto_mission` |
| I-52 | Prestations validées sans impact comptable | CF-P1 — `deduction_loy`, `haowner`, AUTO, `debours_proprio` ✅. `dcb_direct` : log interne par conception. EXTRA ventilation : non implémenté. |
| I-53 | mdp_temporaire désynchronisé | CF-PAE1 — code path ✅ confirmé audit 30 mars |
| I-55 | Achat HAOWNER sans ligne de facturation | ✅ (commit `2c5f9d15`) |
| I-61 | Filtre mois journal inopérant | CF-J1 — `mois_comptable` renseigné dans logOp |
| I-62 | import_log / webhook_log invisibles | CF-J3 — `import_log` mergée dans `getJournal` |

### Invariants ajoutés (mars 2026)

| Invariant | Description courte | Statut |
|---|---|---|
| I-07 | Absorption AUTO bien-par-bien — cloisonnement strict | ✅ Implémenté |
| I-08 | Coexistence factures honoraires / débours par mois | ✅ Implémenté |
| I-56 | Frais propriétaire marqué `facture` uniquement si facture Evoliz effectivement traitée | ✅ Implémenté (commit `360b959`) |
| I-57 | Ligne PREST TVA 20% pour prestation staff DCB, TVA 0% pour AE | ✅ Implémenté (commit `654d102`) |
| I-58 | `debours_proprio` absorbé sur LOY bien-par-bien après AUTO ; surplus → ligne DEBP avec TVA selon ae.type | ✅ Implémenté (CF-P1-BC, commit `b7bedc1`) |
| I-59 | genererFacturesMois ne facture que les propriétaires `actif=true` avec des biens `listed=true, agence='dcb'` | ✅ Implémenté (CF-F8, commit `cd8c20a`) |
| I-60b | Réservation `STATUTS_NON_VENTILABLES` → `fin_revenue=0`, ventilation supprimée, `ventilation_calculee=true`. Badge "Ventilée" masqué dans UI. | ✅ Implémenté (commit `349ba88`, `9233c59`) |
| I-61b | Le montant de référence pour le rapprochement bancaire est `fin_revenue` (pas `VIR.montant_ttc` = LOY). `soldeRestant` = `fin_revenue − Σ(bank_credits)`. | ✅ Implémenté (commits `f730a90`, `2b1df6e`) |

**Détail I-56** : `genererFactureDebours` ne marque pas les frais directs `statut='facture'` dans le chemin skipped (aucune donnée à facturer). Le `UPDATE` est placé exclusivement dans le bloc `if (factureId)` — après insertion des lignes Evoliz confirmée. Idem pour `deduire_loyer` dans `genererFactureProprietaire`.

### Invariants ajoutés (avril 2026 — refactor architecture rapports)

| Invariant | Description courte | Statut |
|---|---|---|
| I-80 | `buildRapportData.js` est la source de calcul unique pour toutes les surfaces rapport (UI, PDF, Statement) — aucun recalcul divergent ailleurs | ✅ Implémenté (session 08/04/2026) |
| I-81 | `STATUTS_NON_VENTILABLES` est défini une seule fois dans `src/lib/constants.js` et importé partout — pas de redéfinition locale | ✅ Implémenté (session 08/04/2026) |
| I-82 | `virementNet` utilise `facture.montant_reversement` si la facture est confirmée (statut hors `brouillon`/`calcul_en_cours`) — jamais recalculé depuis la ventilation quand une facture validée existe | ✅ Implémenté (BRANCHE 1 dans `buildRapportData.js`) |
| I-83 | `ownerStayMenageTotal` est déduit du `montant_reversement` dans `facturesEvoliz.js` (génération de facture) et dans le calcul BRANCHE 2 de `virementNet` dans `buildRapportData.js` — cohérence génération ↔ affichage | ✅ Implémenté (session 08/04/2026) |
| I-84 | `fraisDeductionLoy` suit la règle : `statut='facture' && statut_deduction≠'en_attente'` → `montant_deduit_loy` ; `statut='facture' && statut_deduction='en_attente'` → fallback `montant_ttc` ; `statut='a_facturer'` → `montant_ttc`. Cette règle est centralisée dans `buildRapportData.js` uniquement. | ✅ Implémenté (session 08/04/2026) |

### Invariants métier à formaliser (non encore implémentés dans V1)

| Invariant | Description courte |
|---|---|
| I-06 | Écart AUTO réel > provision — signalement d'anomalie dans `ventilation.js` non implémenté |
| I-54 | Prestation validée doit produire une écriture EXTRA dans la ventilation |
| I-73 | Modification après clôture doit être explicite et documentée |

**Total actuel** : 0 invariants violés actifs (⚠ I-60 partiellement couvert), 17 corrigés, 14 nouveaux, sur 55 documentés.

---

*Fichier généré dans le cadre de l'audit structurel DCB Compta — mars 2026.*
*Ne pas modifier sans relecture du code source et de `domain-rules.md`.*
