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
| I-06 | AUTO (provision ou réel) est déduit du MEN pour donner FMEN. Il ne touche jamais le LOY pour `mode_encaissement='dcb'`. `autoNetMen = max(0, autoBien - menBien)` — seul ce surplus peut absorber du LOY ou générer DEB_AE. | ✅ **Implémenté** commit `00436d3` session 21/04/2026 | CAS DCB : `autoCouvertMen = min(autoBien, menBien)` ne touche pas LOY. `update-ventilation-auto` met aussi à jour `FMEN.montant_reel`. |
| I-07 | Pour chaque bien `mode_encaissement = 'dcb'`, la part AUTO absorbable est calculée sur le LOY du bien seul — un bien ne peut pas absorber le surplus AUTO d'un autre bien du même propriétaire | ✅ **Implémenté** | Boucle bien-par-bien dans `genererFactureProprietaire` (commits 96c10f80, efc33afb) |
| I-08 | Pour un même propriétaire et un même mois, une facture `type_facture='honoraires'` et une facture `type_facture='debours'` peuvent coexister — la contrainte UNIQUE porte sur `(proprietaire_id, mois, type_facture)` | ✅ **Implémenté** | Migration SQL + lookup sécurisé par `.eq('type_facture', 'honoraires')` dans `genererFactureProprietaire` + `type_facture: 'honoraires'` explicite dans `factureData`. Commit `214872e`. |
| I-09 | Le DELETE des lignes ventilation ne bloque jamais sur la FK `mission_menage.ventilation_auto_id` | ✅ **Corrigé** | Migration `002_fk_ventilation_auto_set_null` : FK passée de `RESTRICT` à `ON DELETE SET NULL`. Postgres met automatiquement `ventilation_auto_id = NULL` sur les missions liées lors du DELETE. Code manuel de déliage (`update({ ventilation_auto_id: null })`) supprimé de `ventilation.js` et `global-sync`. Session 07/04/2026. |
| I-10 | Les labels de fees depuis `hospitable_raw` sont normalisés en anglais canonique avant extraction | ✅ **Implémenté** session 04/05/2026 | `LABEL_ALIASES` dans `_calculerLignes` : `"frais de ménage"→"cleaning fee"`, `"frais de service (5%)"→"community fee"`. 102 resas Booking FR avaient FMEN=0 — corrigées par migration 124. |

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
| I-20 | `reservation.rapprochee = true` implique l'existence d'un `payout_hospitable.mouvement_id` valide OU d'un `reservation_paiement` lié | ✅ **Corrigé** | Depuis la session 12/04/2026 : `reservation.rapprochee` est positionné directement via la chaîne `payout_hospitable → payout_reservation → reservation` (Flux 1 pur). Plus aucun lien via `ventilation.mouvement_id`. `annulerRapprochement` remet à `false` via payout + reservation_paiement. |
| I-20b | Le rapprochement (Flux 1) et le reversement propriétaire (Flux 2) sont des flux strictement indépendants — `ventilation.mouvement_id` n'est jamais positionné par le moteur de rapprochement | ✅ **Implémenté** | Session 12/04/2026 — `_lierViaPayout` remplace `_lier`. Jamais de `ventilation.mouvement_id` ni de VIR résiduels créés par le rapprochement. Flux 1 : VIRSEPA distributeur/voyageur → DCB. Flux 2 : VIR = reversement DCB → propriétaire (indépendant). |
| I-21 | `payout_hospitable.mouvement_id` renseigné implique que le mouvement existe en base | ✅ **Corrigé** | `annulerRapprochement` remet `mouvement_id=null` sur `payout_hospitable` (CF-BQ1, confirmé session 12/04/2026) |
| I-22 | `reservation_paiement.mouvement_id` renseigné implique que le mouvement existe en base | ✅ **Corrigé** | `annulerRapprochement` supprime les `reservation_paiement` liés au mouvement annulé |
| I-23 | Un mouvement `statut = 'rapproche'` a au moins une réservation liée via `payout_hospitable → payout_reservation → reservation` ou `reservation_paiement` | ✅ **Renforcé** | `_lierViaPayout` crée désormais `reservation_paiement` AVANT de mettre `statut_matching='rapproche'` — élimine la fenêtre de ghost match en cas d'erreur mid-séquence. Trigger DB `prevent_ghost_match` bloque toute transition `→ rapproche` sans FK valide. Session 03/05/2026. |
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
| I-56 | Les missions `mission_menage` synchronisées depuis les iCals AE sont lisibles par l'app dcb-compta (clé anon) | ✅ **Corrigé** | Migration `007_mission_menage_anon_select.sql` — policy `SELECT TO anon USING (true)`. Avant : seuls les AEs authentifiés voyaient leurs propres missions ; l'app admin voyait 0 lignes. Session 11/04/2026. |
| I-51 | `ventilation.montant_reel` saisi par le portail correspond à la réservation du bon mois | ✅ **Corrigé** | `ventilation.js` V1 renseigne `mission_menage.ventilation_auto_id` via RPC `lier_ventilation_auto_mission` après calcul. La saisie silencieusement perdue est prévenue pour tous les cas avec ligne AUTO (CF-PAE3). |
| I-52 | Une prestation `statut = 'valide'` a un impact sur la comptabilité (LOY, facture, ou débit DCB) | ⚠ **Majoritairement corrigé** | `deduction_loy` : déduit du reversement ✅. `haowner` : ligne HAOWNER TVA 20% ✅. AUTO : absorbé ou DEB_AE ✅. `debours_proprio` : absorption LOY après AUTO + ligne DEBP + surplus facturé ✅ ; cas sans réservation (ménage hors forfait isolé) : fix 18/05/2026 — facture débours créée + rapport accessible + virementNet créance négative ✅. `dcb_direct` : suivi interne uniquement (`log.dcbDirectTotal`) par conception ✅. Reste : code EXTRA dans `ventilation.js` non implémenté. |
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

Aucun invariant actif violé à l'issue de la session du 12 avril 2026.

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
| I-59 | genererFacturesMois facture les propriétaires `actif=true` avec des biens `agence='dcb'`, listés ou non (un bien démasqué d'Airbnb avec activité réelle doit quand même être facturé, cf. I-65) | ⚠️ Révisé (06/08/2026) |
| I-65 | `listed=false` (masqué Airbnb côté Hospitable) ne veut pas dire "ignorer le bien" — un bien démasqué mais actif (résas en cours) doit rester dans les rapports propriétaires et la facturation Evoliz, avec une alerte `BIEN_INACTIF_AVEC_MOUVEMENTS` (buildComptaMensuelle) / `biensNonListesFactures` (facturesEvoliz) pour vérification manuelle | ✅ Implémenté (06/08/2026) — avant : `PageRapports.jsx` (3 filtres) et `facturesEvoliz.js` (`.eq('bien.listed', true)`) excluaient silencieusement ces biens. Cas réel : 408P "Ikuspegi", masqué mais ~7 400€ de CA juillet — rapport propriétaire cassé (fallback sur le nom du propriétaire "BELAIR") et facture d'honoraires qui n'aurait jamais été générée. |
| I-60b | Réservation `STATUTS_NON_VENTILABLES` → `fin_revenue=0`, ventilation supprimée, `ventilation_calculee=true`. Badge "Ventilée" masqué dans UI. | ✅ Implémenté (commit `349ba88`, `9233c59`) |
| I-61b | Le montant de référence pour le rapprochement bancaire est `fin_revenue` (pas `VIR.montant_ttc` = LOY). `soldeRestant` = `fin_revenue − Σ(bank_credits)`. | ✅ Implémenté (commits `f730a90`, `2b1df6e`) |
| I-63 | Une réservation peut avoir plusieurs lignes VIR (paiements partiels liés à des mouvements bancaires distincts). `buildRapportData.ventByResa['VIR']` somme tous ces montants pour la réservation. | ✅ **Corrigé** (session 11/04/2026) — avant : last-write-wins gardait seulement la dernière ligne VIR ; `r.vir` et `virTotal` de rapportStatement étaient faux (bug fcdb37eb). |
| I-64 | Le statement mensuel affiche une ligne de déduction explicite pour chaque frais `mode_traitement='deduire_loyer'` dans le bloc Reversement, avec le même calcul que `buildRapportData.fraisDeductionLoy`. | ✅ **Implémenté** (session 11/04/2026) — avant : la déduction était silencieuse (virementNet réduit sans ligne visible), créant un écart inexpliqué entre VIR et Total reversement (bug 33cb7950). |
| I-66 | Le reliquat d'un frais `deduire_loyer`/`facturer_et_deduire` non couvert par le LOY (`montant_reliquat > 0`) doit toujours devenir une ligne facturable (facture débours) ET apparaître dans le total "Charges DCB"/"Total dû à DCB" du statement — jamais disparaître silencieusement. | ✅ **Corrigé** (06/08/2026) — avant : `genererFactureDebours` ne lisait jamais `frais_proprietaire` (seulement `prestation_hors_forfait`) → reliquat jamais refacturé ; `rapportStatement.js` filtrait la ligne si `montant_deduit_loy=0` → reliquat absent du total. 623,58€ concernés sur juillet 2026 (5 biens `mode_encaissement='proprio'`), cf. project-overview.md. |
| I-67 | La vue mensuelle Comptabilité (`buildComptaMensuelle.js`) et son export CSV doivent signaler tout bien avec un reliquat de frais non facturé (`RELIQUAT_NON_FACTURE`), quel que soit `bien.mode_encaissement` — sans jamais faire entrer ce reliquat dans `reversement_calcule` (qui reste `mode_encaissement='dcb'` uniquement). | ✅ **Corrigé** (06/08/2026) — avant : la requête `frais_proprietaire` de la vue mensuelle était filtrée `mode_encaissement='dcb'` (même filtre que le calcul de reversement) → les biens `proprio` concernés par I-66 étaient invisibles dans la vue Comptabilité, sans aucune alerte. Limite connue : l'alerte reste affichée même une fois le reliquat facturé (pas de flag "résolu" sur `frais_proprietaire`). |
| I-68 | `stripe_payout_line` doit inclure toute transaction de balance Stripe affectant un payout, y compris les remboursements (`type='refund'`/`'payment_refund'`, montant négatif) — pas seulement les paiements/charges. | ✅ **Corrigé** (06/08/2026) — avant : `api/sync-stripe.js` filtrait `t.type === 'payment' || t.type === 'charge'` uniquement, un remboursement Stripe était donc invisible (le payout matchait quand même le mouvement bancaire par montant total, mais aucune ligne n'expliquait la différence, et `reservation_paiement` ne reflétait jamais le remboursement). Cas réel : HOST-EIEADC (408P), 1 864,65€ remboursés le jour de l'annulation, jamais visibles → ventilation manuelle initiale surestimée de ce montant avant correction. Limite connue : le payout historique contenant ce remboursement précis n'est pas rejoué rétroactivement (déjà marqué `rapproche`) — seule la ventilation de cette résa a été corrigée à la main. |
| I-69 | Une résa `platform` direct/manual, `final_status='cancelled'`, avec un paiement net confirmé (`reservation_paiement`) au rapprochement bancaire → ventilation automatique 100% code COM + `fin_revenue=0` (masquée des rapports propriétaire). Exclusions : `bien.skip_facturation=true`, `bien.agence != 'dcb'`, `ventilation_manuelle` déjà posée. | ✅ **Implémenté** (06/08/2026) — trigger `trg_annulation_paiement_avere_com` (migration 239, `SECURITY DEFINER`) sur `reservation`, déclenché au passage `rapprochee → true`, pas au calcul de ventilation (le paiement peut arriver des semaines après l'annulation). Ne s'applique qu'aux futures transitions — les cas historiques identifiés au scan (HOST-AFELXA candidat propre ; HOST-EQWNPW/COTEY7/RKU105 déjà ventilés normalement avant annulation, à traiter au cas par cas ; LAGREOU/ASKIDA exclus par skip_facturation) restent à traiter manuellement si besoin. |
| I-70 | `calculerVentilationResa` (ventilation-auto + api/ventiler.js) doit être idempotent : si les lignes recalculées sont identiques (code + montant_ht/tva/ttc) aux lignes déjà en base, ne rien écrire (ni DELETE, ni INSERT, ni toucher `mission_menage.ventilation_auto_id`). | ✅ **Corrigé** (06/08/2026, audit Opus) — avant : chaque recalcul faisait un DELETE+INSERT inconditionnel, même quand rien ne changeait. `api/webhook-hospitable.js` déclenche `ventilation-auto` sur tout le mois pour les 2 agences à *chaque* webhook Hospitable (résa créée/modifiée) → 115 393 écritures ventilation en 7 jours sur 515 résas (jusqu'à 1524 cycles sur une seule résa depuis mai), 12 `mission_menage.ventilation_auto_id` cassés (FK `ON DELETE SET NULL`, migration 002), `ventilation-auto` qui timeout (504 à 150s) en boucle. Comparaison ajoutée juste avant le DELETE — élimine ~99% de l'écriture inutile sans dépendre de la fréquence des déclencheurs. Cron `ventilation-auto-nightly-lauian` (job 25) corrigé au passage : ne passait aucun `mois` → retraitait ~110 mois (depuis 2017) chaque nuit au lieu du seul mois courant. **Non traité** (pistes plus risquées, proposées mais pas appliquées) : réduire le fan-out du webhook lui-même (mois entier + 2 agences à chaque appel — actuellement neutralisé côté écriture par I-70 mais toujours coûteux en lecture) ; la edge function `hospitable-webhook` renvoie 401 sur 100% de ses appels (contrats/avis/messages/annulations hors service, même famille que l'incident `verify_jwt` précédent). |
| I-127 | **`hospitable-webhook` (edge function distincte de `api/ventiler.js` et `ventilation-auto`) doit elle aussi respecter `ventilation_manuelle` avant tout `DELETE` sur `ventilation`.** L'audit Opus qui a produit I-70 concluait "risque sur ventilation manuelle : LOW" en n'auditant que les 2 moteurs "officiels" — mais un 3e chemin d'écriture existait, non couvert par le fix I-70 (qui neutralise le *recalcul inutile*, pas ce *DELETE sans recalcul*). Découvert après que HOST-EIEADC (408P) a vu sa ventilation manuelle (COM 1 605,95€) effacée 3 fois le 06/08/2026 (13:13, 14:02, **15:19:51 — après déploiement du fix I-70**), la 3e fois retrouvée uniquement via un balayage large de `journal_ops` déclenché par un doute sur un total agrégé, pas par une alerte système. | ✅ **Corrigé** (06/08/2026) — `supabase/functions/hospitable-webhook/index.ts` v90 : les 2 sites de `.delete().eq('reservation_id', ...)` sur `ventilation` (handler `reservation.cancelled` + branche générale upsert `finalStatus==='cancelled'/'not accepted'`) vérifient désormais `ventilation_manuelle` avant suppression, comme les 2 autres moteurs. Ventilation HOST-EIEADC restaurée une dernière fois après déploiement. **Limite connue** : `hospitable-webhook` renvoie 401 sur une partie de ses appels (cf. I-70) — cause et impact réel non encore investigués. |

**Détail I-56** : `genererFactureDebours` ne marque pas les frais directs `statut='facture'` dans le chemin skipped (aucune donnée à facturer). Le `UPDATE` est placé exclusivement dans le bloc `if (factureId)` — après insertion des lignes Evoliz confirmée. Idem pour `deduire_loyer` dans `genererFactureProprietaire`.

### Invariants ajoutés (avril 2026 — refactor architecture rapports)

| Invariant | Description courte | Statut |
|---|---|---|
| I-80 | `buildRapportData.js` est la source de calcul unique pour toutes les surfaces rapport (UI, PDF, Statement) — aucun recalcul divergent ailleurs | ✅ Implémenté (session 08/04/2026) |
| I-81 | `STATUTS_NON_VENTILABLES` est défini une seule fois dans `src/lib/constants.js` et importé partout — pas de redéfinition locale | ✅ Implémenté (session 08/04/2026) |
| I-82 | `virementNet` utilise `facture.montant_reversement` si la facture est confirmée (statut hors `brouillon`/`calcul_en_cours`) — jamais recalculé depuis la ventilation quand une facture validée existe | ✅ Implémenté (BRANCHE 1 dans `buildRapportData.js`) — ⚠ **bug corrigé le 06/07/2026** : la requête `facture_evoliz` ne filtrait que par `proprietaire_id`+`mois`, pas par `bien_id`. Pour tout proprio multi-biens facturés le même mois, `.maybeSingle()` trouvait plusieurs lignes → erreur silencieuse → `facture` restait `null` → BRANCHE 1 jamais déclenchée, retombait sur BRANCHE 2 (calcul depuis la ventilation) même quand une facture confirmée existait. Fix : `.eq('bien_id', bienId)` (ou `.in('bien_id', maiteIds)` si `isGlobal`) ajouté à la requête. Impact réel vérifié (BGH/Jeremy Chevalier, juin 2026) : rapport affichait 2086,00€ au lieu des 1978,00€ réellement confirmés par la facture Evoliz. Concerne potentiellement tous les rapports déjà envoyés à des proprios multi-biens depuis mars 2026 — recalcul/vérification manuelle à faire au cas par cas si écart significatif. |
| I-83 | `ownerStayMenageTotal` est déduit du `montant_reversement` dans `facturesEvoliz.js` (génération de facture) et dans le calcul BRANCHE 2 de `virementNet` dans `buildRapportData.js` — cohérence génération ↔ affichage | ✅ Implémenté (session 08/04/2026) |
| I-84 | `fraisDeductionLoy` suit la règle : `statut='facture' && statut_deduction≠'en_attente'` → `montant_deduit_loy` ; `statut='facture' && statut_deduction='en_attente'` → fallback `montant_ttc` ; `statut='a_facturer'` → `montant_ttc`. Cette règle est centralisée dans `buildRapportData.js` uniquement. | ✅ Implémenté (session 08/04/2026) |

### Invariants ajoutés (10 avril 2026 — import CSV + calculs brut + Booking pro-rata)

| Invariant | Description courte | Statut |
|---|---|---|
| I-85 | `reservation_fee` ne contient pas de lignes en doublon pour une même réservation — chaque fee type/label apparaît une seule fois. Une ré-import CSV sans purge préalable provoque un doublement silencieux des fees qui fausse tous les calculs HON/LOY/VIR. | ✅ Règle opérationnelle — à surveiller après chaque import |
| I-86 | Le calcul `gross_revenue` dans `buildRapportData.js` suit la règle plateforme : Direct → `fin_gross_revenue` ; Airbnb → `fin_accommodation + Σ guest_fees` ; Booking → `fin_accommodation + Σ guest_fees + Σ taxes non-remitted`. Le champ `label` doit être inclus dans le SELECT `reservation_fee` — sans lui le filtre `remitted` échoue silencieusement. | ✅ Implémenté (commit `072f6dd`) |
| I-87 | `fin_host_service_fee` est importé depuis `host_service_fee` CSV comme valeur négative : `-(Math.abs(parseFloat(row.host_service_fee) × 100))`. Toute valeur positive dans ce champ est un symptôme d'une ancienne sync API fantôme. | ✅ Implémenté (session 10/04/2026) |
| I-88 | `discountsTotal` utilise un fallback unique : `hospitable_raw.financials.host.discounts` (négatif) si présent, sinon `-(fin_discount || 0)` (CSV). Les deux sources ne doivent jamais être additionnées pour éviter le double-comptage. | ✅ Implémenté dans `ventilation.js` (session 10/04/2026) |
| I-89 | Booking `dueToOwner` est calculé en pro-rata comme Airbnb et Direct : `Math.round(|hostServiceFee| × fmenBase / totalFeesForOwnerRate × (1 − tauxCom))`. Le taux fixe 0.1517 est abandonné. | ✅ Implémenté (session 10/04/2026) |

### Invariants ajoutés (10 avril 2026 — owner stay / séjour propriétaire)

| Invariant | Description courte | Statut |
|---|---|---|
| I-90 | `calculerVentilationResa` calcule automatiquement pour `owner_stay=true` : FMEN = fin_revenue − AUTO (provision_ae_ref), AUTO = provision bien. Inclus dans le batch ⚡ Ventiler. VentilationEdit reste disponible pour correction. | ✅ Session 10/04/2026 (révisé) |
| I-91 | `sumByCode('FMEN')` dans `genererFactureGroupe` exclut les reservation_ids owner_stay — évite le double-comptage avec la ligne "Ménage séjour propriétaire" ou l'absorption sur LOY. | ✅ Session 10/04/2026 |
| I-92 | Owner stay ménage absorbé par LOY (per-bien, en priorité après deboursProp) → réduit `montant_reversement`. Owner stay surplus FMEN → ligne séparée "Ménage séjour propriétaire" (TVA 20%) dans la facture honoraires. Owner stay surplus AUTO → ligne `DEB_AE` dans `genererFactureDebours`. | ✅ Session 10/04/2026 |
| I-93 | `STATUTS_NON_VENTILABLES` est importé de `src/lib/constants.js` dans `ventilation.js` — plus de double définition locale. | ✅ Session 10/04/2026 (I-81 renforcé) |
| I-94 | `calculerVentilationMois` inclut les resas `owner_stay=true` (filtre supprimé). `calculerVentilationResa` calcule FMEN = fin_revenue − AUTO auto. | ✅ Session 10/04/2026 |
| I-95 | `gross_revenue` est 0 pour les resas `owner_stay=true` dans `buildRapportData` — évite d'afficher le ménage proprio dans la colonne "Brut voyageur". | ✅ Session 10/04/2026 |
| I-96 | `fraisDeductionLoy` inclut les remboursements en négatif (`mode_traitement='remboursement'`, `statut≠'brouillon'`). Un remboursement augmente `virementNet`. | ✅ Session 10/04/2026 |
| I-97 | `prestation_hors_forfait.mois` est mis à jour en cascade quand `date_prestation` change dans `PagePrestationsAE`. | ✅ Session 10/04/2026 |
| I-98 | `MoisSelector` inclut toujours le mois actif dans les options, même s'il n'a pas de données dans `moisDispos`. | ✅ Session 10/04/2026 |

### Invariants ajoutés (12 avril 2026 — Contrôle trésorerie v2)

| Invariant | Description courte | Statut |
|---|---|---|
| I-99 | `encaissement_allocation` ne contient que des valeurs `mouvement_bancaire.credit` réelles (CSV importé). Aucun fallback `payout_hospitable.amount`. La catégorie `approxime` est abandonnée — toute ligne a `preuve_niveau='prouve'` et `can_be_used_for_reversement=true`. | ✅ Session 12/04/2026 — Edge Function v2 |
| I-100 | La vue `reservation_mouvement` expose uniquement les encaissements prouvés (`mouvement_bancaire_id IS NOT NULL`). Elle ne retourne jamais de valeurs estimées ou théoriques. | ✅ Session 12/04/2026 — Migration 011 |
| I-101 | `PageFactures` lit `reservation_mouvement` pour les encaissements prouvés — jamais `encaissement_allocation` directement. | ✅ Session 12/04/2026 |
| I-102 | Déduplication par `mouvement_bancaire.id` dans `allocate-encaissements` : un même mouvement bancaire ne peut être compté qu'une seule fois par réservation, même s'il est accessible par plusieurs chemins (ventilation + payout_hospitable). | ✅ Session 12/04/2026 |
| I-103 | L'anomalie `MOUVEMENT_BANCAIRE_MISSING` est le seul code d'anomalie produit par `allocate-encaissements` v2. Les anciens codes (`PAYOUT_MISSING`, `MOUVEMENT_ID_NULL`, etc.) sont obsolètes. | ✅ Session 12/04/2026 |

### Invariants ajoutés (13 avril 2026 — Trésorerie complète, Booking/Stripe)

| ID | Description | Statut |
|---|---|---|
| I-104 | `allocate-encaissements` couvre 5 chemins dans l'ordre : ventilation → reservation_paiement → payout_hospitable → booking_payout_line → stripe_payout_line. Déduplication par `mouvement_bancaire.id` par réservation. | ✅ Session 13/04/2026 |
| I-105 | Pour `booking_payout_line` et `stripe_payout_line`, le montant retenu est `amount_cents` / `montant_net` (par réservation), jamais `mouvement_bancaire.credit` (total payout). Évite l'inflation ×N pour les payouts groupés. | ✅ Session 13/04/2026 |
| I-106 | `allocate-encaissements` ne traite que les biens `agence='dcb'`. Les biens Lauian sont exclus via pré-requête `bien.agence='dcb'`. | ✅ Session 13/04/2026 |
| I-107 | Dans `PageFactures`, la déduplication par `mouvement_bancaire_id` n'est active que pour `source_rapprochement = 'payout_hospitable'`. Pour `stripe_payout_line` / `booking_payout_line`, `credit_retenu_centimes` est déjà par réservation — sommation directe. | ✅ Session 13/04/2026 |
| I-108 | La requête ventilation dans `PageFactures` exclut les réservations `owner_stay = true` (jointure `reservation!inner` + filtre). Les séjours propriétaires ne génèrent pas d'emplois dans la matrice de contrôle trésorerie. | ✅ Session 13/04/2026 |
| I-109 | **VIR trésorerie = résiduel** : `max(0, creditsProuves − HON − FMEN − AUTO − COM − PREST − HAOWNER)`. La ventilation VIR (basée sur `fin_revenue`) n'est PAS utilisée dans la matrice de contrôle. Le solde = 0 signifie que les encaissements nets couvrent exactement les retenues DCB + reversement réel. | ✅ Session 13/04/2026 |
| I-110 | Badge trésorerie et bloc Contrôle Trésorerie masqués pour `type_facture = 'debours'`. | ✅ Session 13/04/2026 |
| I-111 | Le recalcul `allocate-encaissements` se déclenche automatiquement à chaque visite de la page Factures (arrière-plan). Aucun bouton manuel. | ✅ Session 13/04/2026 |

### Invariant ajouté (10 mai 2026 — Pagination Supabase)

| ID | Description | Statut |
|---|---|---|
| I-120 | Toute requête Supabase paginée avec `.range()` **doit** inclure `.order('id')` (ou un tri stable). Sans `ORDER BY`, `OFFSET/LIMIT` est non-déterministe : le moteur retourne des tranches différentes à chaque appel, causant des doublons ou des lignes manquantes. **Effets concrets dans `SequestreTempsReel`** : (1) requête `reservation` (4710 rows, 5 pages) — 40 resas passées + 4 futurs manquaient, exclus de `resasAvecPayin`, faussant le compte (375 au lieu de 415) ; (2) requête `ventilation` (2275 rows, 3 pages nécessaires) — des entrées de ventilation étaient comptées 2× → `ventilByResa` gonflé → résiduel -44 828€ au lieu de -35 373€. Les deux bugs causaient un séquestre affiché de -9 496€ au lieu de +7 273€. Corollaire : le gateway cloud plafonne à 1000 lignes/requête — toujours paginer les tables volumineuses. | ✅ Corrigé (session 10/05/2026) — `.order('id')` ajouté sur les 3 boucles de `SequestreTempsReel`. |
| I-121 | **Ne jamais utiliser `.in('foreign_id', largeArray)` avec plus de ~100 IDs.** PostgREST encode les IDs dans l'URL (`?col=in.(id1,id2,...)`). Avec 400 UUIDs (×37 chars) = ~15 000 chars dans l'URL — certains appels retournent silencieusement `[]` sans erreur, stoppant la pagination et causant des données partielles non-déterministes. **Exemple concret** : `.in('reservation_id', batchIds)` avec batches de 400 dans `SequestreTempsReel` — `payinKeys` fluctuait entre 330 et 448 (correct), `futurs` entre 17 et 21. **Fix** : remplacer le filtre par un `JOIN` sur la table parente filtrée par ses propres IDs courts — ex. `reservation!inner(bien_id)` + `.filter('reservation.bien_id', 'in', '(id1,...)')` avec `bienIds` (~50 items = URL courte). Filtrage résiduel en mémoire via `Set`. | ✅ Corrigé (session 10/05/2026) — `reservation_paiement` et `ventilation` migrent vers join `bienIds`. |

### Invariants ajoutés (3 mai 2026 — Anti ghost match systémique)

| ID | Description | Statut |
|---|---|---|
| I-118 | `_lierViaPayout` crée `reservation_paiement` avant de mettre `statut_matching='rapproche'`. Ordre inverse → ghost match si l'upsert échoue après la mise à jour du statut. | ✅ Session 03/05/2026 |
| I-119 | Trigger DB `prevent_ghost_match` sur `mouvement_bancaire` : bloque toute transition vers `rapproche` sans FK valide dans `reservation_paiement`, `payout_hospitable` ou `ventilation`. | ✅ À appliquer via SQL Editor |

### Invariants ajoutés (21 avril 2026 — SMS automation + base_comm + LLM géo)

| ID | Description | Statut |
|---|---|---|
| I-112 | `buildRapportData.js` : `base_comm = fin_accommodation + fin_host_service_fee - fin_discount`. Les trois champs sont inclus dans le SELECT. `fin_discount` (positif en base) est soustrait. | ✅ Session 21/04/2026 |
| I-113 | `PageRapports.jsx` : le prompt LLM utilise `bien.ville` pour déterminer la zone géographique (Bordeaux vs Biarritz). SYSTEM_PROMPT, villeLabel, agenceLabel et coordonnées météo sont dynamiques. | ✅ Session 21/04/2026 |
| I-114 | `hospitable-webhook` : les avis reçus via `review.*` lisent le rating depuis `data.public?.rating` et le commentaire depuis `data.public?.review` — structure réelle du payload Hospitable. | ✅ Session 21/04/2026 — v40 |
| I-115 | `hospitable-webhook` `handleReview` : met à jour `reservation.review_rating` et `reservation_review.bien_id` à chaque avis reçu via webhook. | ✅ Session 21/04/2026 |
| I-116 | Chaîne SMS automatique complète : `review.created` webhook → `sms_queue` (28 min) → pg_cron (1 min) → `process-sms-queue` → Twilio → `sms_logs`. Aucune action manuelle requise pour les avis 5⭐ avec téléphone disponible. | ✅ Session 21/04/2026 |
| I-117 | `process-sms-queue` : le corps du SMS se termine par une invitation Google explicite (`"Laissez-nous aussi un avis Google (1 clic) ↓"`) avant la signature `"— Destination Côte Basque"`, suivie du lien Google. | ✅ Session 21/04/2026 |

### Invariants métier à formaliser (non encore implémentés dans V1)

| Invariant | Description courte |
|---|---|
| I-06 | Écart AUTO réel > provision — signalement d'anomalie dans `ventilation.js` non implémenté |
| I-54 | Prestation validée doit produire une écriture EXTRA dans la ventilation |
| I-73 | Modification après clôture doit être explicite et documentée |

**Total actuel** : 0 invariants violés actifs (⚠ I-60 partiellement couvert), 22 corrigés, 36 nouveaux, sur 77 documentés.

### Invariants ajoutés (6 août 2026 — Fix double-décompte DEB_AE sur groupe_facturation)

| ID | Description | Statut |
|---|---|---|
| I-126 | **L'absorption LOY (`deduction_loy`/HAOWNER/AUTO/`debours_proprio`/owner-stay) doit être poolée au niveau du `groupe_facturation`, pas calculée bien par bien.** Quand plusieurs biens partagent un `groupe_facturation` (ex. `MAITE` : bien parent `M-MAITE` + 5 chambres), le bien parent porte souvent 0 LOY propre (aucune résa directe, tout le loyer transite par les chambres) tout en recevant des prestations `deduction_loy` imputées directement sur lui. Calculée bien par bien, cette absorption ne pouvait jamais couvrir le parent — le reliquat partait en facture `DEB_AE`/`DEBP` séparée alors que `genererFactureGroupe` avait déjà déduit ce même montant du reversement groupe (`totalPrestations`, group-wide) → double décompte. Incident constaté Maison Maïté juillet 2026 : 150€ de ménage communs facturés en `DEB_AE` en plus du reversement déjà net de ce montant. | ✅ Corrigé (session 06/08/2026) — `genererFactureGroupe` et `genererFactureDebours` (`facturesEvoliz.js`) puisent désormais dans un pool LOY partagé par groupe pour les biens `mode_encaissement='dcb'`, consommé séquentiellement (même priorité qu'avant). Pour un bien seul (cas général), comportement strictement inchangé. Vérifié par simulation sur données réelles juillet 2026 : reliquat M-MAITE 150€ → 0€. |

### Invariants ajoutés (6 août 2026 — Fix rapprochement Airbnb groupé)

| ID | Description | Statut |
|---|---|---|
| I-125 | **Rapprochement Airbnb par référence (`platform_id`) : ne matcher qu'un seul payout par référence que si elle est non-ambiguë.** Quand Airbnb regroupe plusieurs réservations dans un seul virement bancaire, les payouts synthétiques par-résa partagent le même `platform_id`. L'ancien code (`rapprochement.js`, Étape 0 du matching, `.find()`) ne récupérait que le premier payout trouvé et marquait le virement `rapproche`, laissant les autres réservations du groupe orphelines (`en_attente`) alors que leur argent était déjà en banque — le filet de sécurité (subset-sum, Étape 2) ne se déclenchait jamais car le virement était déjà consommé avant d'y arriver. Incident constaté Lauian 03/07/2026 : virement 2 150,52€ regroupant 3 résas (Rondeau+Greffier+Niedermann), seule Rondeau rapprochée. | ✅ Corrigé (session 06/08/2026) — `.find()` remplacé par `.filter()` + condition `length === 1` ; en cas d'ambiguïté (plusieurs payouts partagent la référence), l'Étape 1/2 retrouve le groupe par montant+date (mécanisme déjà éprouvé, inchangé). Vérifié sur Lauian juillet 2026 : reset ciblé + rematch → 3/3 résas rapprochées avec le bon montant chacune (aucun sur-crédit), aucune régression sur les 24 autres résas déjà rapprochées du mois. |

### Invariants ajoutés (3 août 2026 — Fix LOY skip_facturation LAGREOU/ASKIDA)

| ID | Description | Statut |
|---|---|---|
| I-124 | **`skip_facturation=true` : le LOY doit être 100% de `revenue - taxesTotal`, jamais dérivé de `commissionableBase`.** Sur LAGREOU/ASKIDA (biens perso, commission 0%), Oïhan se reverse l'intégralité de l'encaissement — le ménage AE réel restant une créance séparée (ligne AUTO), jamais déduite du LOY/VIR. `commissionableBase` (formule Airbnb/Booking `accommodation+hostServiceFee+...`) n'est pas fiable sur les résas `platform=direct` de ces biens (Hospitable calcule sa propre base différemment selon le statement, confirmé par comparaison de données réelles). **Fichiers corrigés simultanément** : `api/ventiler.js` ET `supabase/functions/ventilation-auto/index.ts`. Impact rétroactif estimé (simulation, non appliqué en base) : LAGREOU 2 352,33€ + ASKIDA 4 885,10€ = 7 237,43€ dus en plus à Oïhan sur l'historique. | ✅ Corrigé (session 03/08/2026) — override `loyAmount = revenue - taxesTotal` ajouté dans les deux fichiers pour `bien.skip_facturation`. |

### Invariants ajoutés (5 juin 2026 — Fix LOY Booking double déduction CITY_TAX)

| ID | Description | Statut |
|---|---|---|
| I-123 | **Booking.com LOY : `CITY_TAX (Withheld Tax)` ne doit pas être déduit du `revenue`.** `host.revenue.amount` (= `fin_revenue`) est déjà net de la taxe retenue directement par Booking aux autorités fiscales. Déduire `withheldTotal` une 2e fois sous-estimait le LOY d'un montant égal à la withheld tax (≈ 2–5% du séjour). **Fichiers corrigés simultanément** : `src/services/ventilation.js` (frontend) ET `supabase/functions/ventilation-auto/index.ts` (cron nightly 3h UTC). La cause du "revert" précédent était la correction d'un seul des deux fichiers — le cron réécrivait les lignes avec la mauvaise formule chaque nuit. | ✅ Corrigé (session 05/06/2026) — `withheldTotal` supprimé des deux fichiers, remplacé par commentaire explicatif. |

| I-122 | **L'import Powens crée des doublons de mouvement_bancaire.** Powens (`Powens_seq_lc`) importe les mêmes transactions que le relevé CSV (`CaisseEpargne`) mais sans libellé (libellé vide). Résultat : pour chaque transaction réelle, deux entrées en base — une avec label (`CaisseEpargne`, rapprochée), une vide (`Powens_seq_lc`, en attente). **Constaté le 10/05/2026** : 63 doublons Powens identifiés (avril–mai 2026), supprimés manuellement. **Fix à implémenter dans l'import Powens** : avant insertion, vérifier qu'aucun MB de même `date_operation` et même `credit` n'existe déjà — si oui, ignorer l'entrée Powens. Contrainte de déduplication à ajouter : `UNIQUE (date_operation, credit, debit, canal)` ou dédoublonnage applicatif. | ❌ **Bug actif** — import Powens en cours de développement. Dédoublonnage absent. |

---

*Fichier généré dans le cadre de l'audit structurel DCB Compta — mars 2026.*
*Ne pas modifier sans relecture du code source et de `domain-rules.md`.*
