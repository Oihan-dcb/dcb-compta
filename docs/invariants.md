# DCB Compta — Invariants système

> **Statut** : Document d'audit — mars 2026
> **Source** : Code source + audit complet + règles métier (`domain-rules.md`)
> **Avertissement** : Ce document distingue explicitement les invariants respectés et ceux actuellement violés, avec référence aux bugs correspondants.

---

## Principe

Un invariant est une règle qui doit **toujours être vraie** dans le système, indépendamment de l'opération effectuée. Toute violation est un état corrompu qui peut se propager silencieusement jusqu'aux factures et aux reversements.

Les invariants sont organisés par domaine. Pour chaque invariant : état attendu, état actuel, et référence au bug si violé.

---
<<<<<<< HEAD
=======

## Domaine 1 — Intégrité financière globale

Ces invariants ont la priorité absolue. Leur violation peut entraîner une facturation incorrecte.

| # | Invariant | État | Violation / Référence |
|---|---|---|---|
| I-01 | `ventilation.montant_ht`, `montant_tva`, `montant_ttc` ne sont jamais NaN, null ou non numériques | ✅ **Corrigé** | `global-sync` V2 désactivée (bouton Global Update désactivé, commit 119be181 — CF-C2/C8). V1 seule voie active. V3 webhook probablement inopérante mais toujours dans le code. |
| I-02 | `facture_evoliz.montant_ht`, `montant_tva`, `montant_ttc` ne sont jamais NaN | ✅ Respecté | Calculés depuis la ventilation — violé si I-01 est violé en amont |
| I-03 | `facture_evoliz.montant_reversement` correspond au montant de reversement calculé à partir de la ventilation (notamment le code LOY) au moment de la génération. Ce montant est gelé dans la facture mais ne constitue pas une ligne de facturation DCB — LOY est un composant de reversement propriétaire, pas une ligne facturée. | ✅ Respecté à la génération | ⚠ Devient faux si reventilation après génération sans régénération (périmé) |
| I-04 | Toute facture est reconstruisable depuis la ventilation et les données source | ✅ Structurellement vrai | ⚠ Compromis si NaN en base (I-01) — CF-F1 corrigé |
| I-05 | LOY ne doit jamais être interprété comme une ligne de facturation DCB. LOY est un composant de reversement propriétaire — les lignes de facturation DCB sont HON, FMEN et autres prestations. | ✅ Règle métier | ⚠ Pas de protection technique — risque de confusion dans le code et les rapports |
| I-06 | Si `ventilation.montant_reel` (AUTO réel) est renseigné, il remplace la provision AUTO. Si AUTO réel > provision, le traitement de l'écart doit être explicite (CAS OWNER → EXTRA, ou CAS DCB → absorption FMEN) — il ne doit pas être absorbé silencieusement. | ⚠ **Partiellement implémenté** | `COALESCE(montant_reel, montant_ht)` appliqué dans `genererFactureProprietaire` et `genererFactureDebours` — le réel remplace la provision dans le calcul d'absorption et de surplus. Aucun mécanisme de signalement d'anomalie si réel > provision dans `ventilation.js`. |
| I-07 | Pour chaque bien `mode_encaissement = 'dcb'`, la part AUTO absorbable est calculée sur le LOY du bien seul — un bien ne peut pas absorber le surplus AUTO d'un autre bien du même propriétaire | ✅ **Implémenté** | Boucle bien-par-bien dans `genererFactureProprietaire` (commits 96c10f80, efc33afb) |
| I-08 | Pour un même propriétaire et un même mois, une facture `type_facture='honoraires'` et une facture `type_facture='debours'` peuvent coexister — la contrainte UNIQUE porte sur `(proprietaire_id, mois, type_facture)` | ✅ **Implémenté** | Migration SQL + lookup sécurisé par `.eq('type_facture', 'honoraires')` dans `genererFactureProprietaire` + `type_facture: 'honoraires'` explicite dans `factureData`. Commit `214872e`. |

---

## Domaine 2 — Cohérence réservation / ventilation

| # | Invariant | État | Violation / Référence |
|---|---|---|---|
| I-10 | Une réservation avec `ventilation_calculee = true` a des lignes dans `ventilation` | ✅ Respecté normalement | ⚠ Violable si suppression manuelle des lignes sans reset du flag |
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
| I-20 | `reservation.rapprochee = true` implique l'existence d'au moins un `ventilation.mouvement_id` valide | ❌ **Violé** | Suppression de mouvement sans nettoyage laisse `rapprochee = true` avec `mouvement_id` orphelin (CF-BQ1) |
| I-21 | `ventilation.mouvement_id` renseigné implique que le mouvement existe en base | ❌ **Violé** | Même cause : CF-BQ1/BQ2 |
| I-22 | `payout_hospitable.mouvement_id` renseigné implique que le mouvement existe en base | ❌ **Violé** | Même cause : CF-BQ1 |
| I-23 | Un mouvement `statut = 'rapproche'` a au moins une réservation liée via `ventilation.mouvement_id` | ⚠ Probablement violé | Annulation de rapprochement partielle possible (CF-RAPP-4) |
| I-24 | Le résultat du matching est identique quel que soit le bouton utilisé (Config ou PageRapprochement) | ❌ **Violé** | Deux moteurs avec logiques différentes (CF-C3) |

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
| I-40 | Une facture `statut = 'envoye_evoliz'` a un `evoliz_id` non null | ⚠ Violable | Si update Supabase échoue après création Evoliz (CF-F2) |
| I-41 | Une facture a au moins une ligne dans `facture_evoliz_ligne` | ⚠ Violable | Si génération interrompue entre INSERT facture et INSERT lignes |
| I-42 | Une facture ne peut être poussée vers Evoliz qu'une seule fois | ⚠ **Partiellement corrigé** | Guard `if (facture.id_evoliz) throw` + skip dans `pousserFacturesMoisVersEvoliz` (CF-F2, commit e228e0b0). Résidu : si l'UPDATE Supabase échoue après création Evoliz, `id_evoliz` reste null et un second push reste possible. |
| I-43 | Les factures d'un mois sont navigables depuis le MoisSelector | ✅ **Corrigé** | Champ `mois` utilisé partout dans `facturesEvoliz.js` — `mois_facturation` absent du code actuel (CF-F1) |

---

## Domaine 6 — Intégrité AE / Portail

| # | Invariant | État | Violation / Référence |
|---|---|---|---|
| I-50 | Un AE avec `ae_user_id` non null peut se connecter au portail | ❌ **Violé** | `mdp_temporaire` jamais sauvegardé + reset inexistant (CF-PAE1/PAE2) |
| I-51 | `ventilation.montant_reel` saisi par le portail correspond à la réservation du bon mois | ✅ **Corrigé** | `ventilation.js` V1 renseigne `mission_menage.ventilation_auto_id` via RPC `lier_ventilation_auto_mission` après calcul. La saisie silencieusement perdue est prévenue pour tous les cas avec ligne AUTO (CF-PAE3). |
| I-52 | Une prestation `statut = 'valide'` a un impact sur la comptabilité (LOY, facture, ou débit DCB) | ⚠ **Partiellement corrigé** | `deduction_loy` : déduit du reversement ✅. `haowner` : ligne de facturation TVA 20% dans la facture principale ✅. AUTO : absorbé ou facturé séparément selon `mode_encaissement` ✅. Restent sans effet : `dcb_direct`, `debours_proprio`, code EXTRA dans `ventilation.js`. |
| I-53 | `auto_entrepreneur.mdp_temporaire` est synchronisé avec le mot de passe Supabase Auth | ❌ **Violé** | `mdp_temporaire` toujours null (CF-PAE1) |
| I-54 | Une prestation hors forfait validée produit une écriture dans la ventilation (code EXTRA) | ⚠ **Non implémenté** — à formaliser | Code EXTRA inexistant dans V1 — état cible non encore atteint |
| I-55 | Tout achat DCB pour le compte d'un propriétaire (HAOWNER) produit une ligne de facturation explicite | ✅ **Implémenté** | Ligne HAOWNER TVA 20% dans la facture principale (`genererFactureProprietaire`, commit 2c5f9d15). `montantReversement = max(0, LOY − deduction_loy − haownerTTC)`. Pas de code HAOWNER dans `ventilation.js` — prestation lue depuis `prestation_hors_forfait`. |

---

## Domaine 7 — Traçabilité

| # | Invariant | État | Violation / Référence |
|---|---|---|---|
| I-60 | Toute opération métier significative est tracée dans `journal_ops` | ❌ **Violé** | 1 seul appel `logOp` sur ~20 opérations (CF-J2) |
| I-61 | Le filtre mois de PageJournal retourne les opérations du mois sélectionné | ❌ **Violé** | `mois_comptable` toujours null dans le seul appel logOp (CF-J1) |
| I-62 | Les logs d'import et de webhook sont visibles dans PageJournal | ❌ **Violé** | `import_log` et `webhook_log` jamais lues par PageJournal (CF-J3) |

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

| Invariant | Description courte | Référence bug |
|---|---|---|
| I-20 | rapprochee=true sans mouvement_id valide | CF-BQ1 |
| I-21 | ventilation.mouvement_id orphelin | CF-BQ1/BQ2 |
| I-22 | payout.mouvement_id orphelin | CF-BQ1 |
| I-23 | Rapprochement partiel possible à l'annulation | CF-RAPP-4 |
| I-24 | Matching non déterministe selon déclencheur | CF-C3 |
| I-40 | facture envoyée sans evoliz_id | CF-F2 (résidu) |
| I-42 | Push Evoliz non idempotent | CF-F2 (partiellement corrigé) |
| I-50 | AE avec ae_user_id ne peut pas se connecter | CF-PAE1/PAE2 (à confirmer) |
| I-53 | mdp_temporaire désynchronisé | CF-PAE1 (à confirmer) |
| I-60 | Opérations non tracées dans journal | CF-J2 |
| I-61 | Filtre mois journal inopérant | CF-J1 |
| I-62 | import_log / webhook_log invisibles | CF-J3 |

### Invariants corrigés (mars 2026)

| Invariant | Description courte | Commit |
|---|---|---|
| I-01 | NaN dans montants ventilation | CF-C2/C8 — V2 désactivée (119be181) |
| I-32 | fusionnerDoublons supprime sans vérifier migration | CF-I1 (d8fedd9b) |
| I-43 | Navigation temporelle factures cassée | CF-F1 — champ `mois` partout |
| I-51 | Saisie AE perdue si ventilation non calculée | CF-PAE3 — RPC `lier_ventilation_auto_mission` |
| I-52 | Prestations validées sans impact comptable | CF-P1 — partiellement (deduction_loy, haowner, AUTO) |
| I-55 | Achat HAOWNER sans ligne de facturation | ✅ (commit 2c5f9d15) |

### Invariants ajoutés (mars 2026)

| Invariant | Description courte | Statut |
|---|---|---|
| I-07 | Absorption AUTO bien-par-bien — cloisonnement strict | ✅ Implémenté |
| I-08 | Coexistence factures honoraires / débours par mois | ✅ Implémenté |

### Invariants métier à formaliser (non encore implémentés dans V1)

| Invariant | Description courte |
|---|---|
| I-06 | Écart AUTO réel > provision — signalement d'anomalie dans `ventilation.js` non implémenté |
| I-54 | Prestation validée doit produire une écriture EXTRA dans la ventilation |
| I-73 | Modification après clôture doit être explicite et documentée |

**Total actuel** : 12 invariants violés actifs, 6 corrigés, 2 nouveaux, sur 40 documentés.

---

*Fichier généré dans le cadre de l'audit structurel DCB Compta — mars 2026.*
*Ne pas modifier sans relecture du code source et de `domain-rules.md`.*
>>>>>>> 2e1ab89 (docs: documentation projet + CLAUDE.md)
