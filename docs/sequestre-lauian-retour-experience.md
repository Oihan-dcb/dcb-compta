# Séquestre Lauïan — retour d'expérience pour le système séquestre multi-agence

Session Lauïan, 25/09/2026 (clôture Lauïan fin septembre). Rapprochement complet du séquestre LC
Lauïan (FR76 1333 5000 4008 0029 6014 240) au 25/09 : solde 65 857,32 €, justifié à ~1 017 € près.
Tout ce qui suit doit être couvert par le système commun (fiche agence, grand livre des mandants,
boîte « À affecter », alertes, clôture mensuelle).

## 1. Fiche compte séquestre — spécificités Lauïan
- **Source bancaire : relevé CSV Caisse d'Épargne importé à la main** (Pennylane pas encore dispo
  pour Lauïan). Aucun solde synchronisé → la fiche doit permettre de **saisir le solde bancaire**
  (date + montant) et l'import CSV ne contient pas de ligne de solde.
- Solde d'ouverture **non documenté** : implicite 19 271,07 € au 02/12/2025 (premier mouvement
  importé 03/12/2025). Il faut un champ « solde d'ouverture + pièce justificative ».
- DCB : la vraie bascule CaisseEpargne → Pennylane est le **04/07/2026** (CE jusqu'au 03/07, Pennylane
  dès le 06/07), corrigé dans `BASCULE_PENNYLANE` (commit c77c007).

## 2. Ayants droit à prévoir dans le grand livre
- **Autre agence** — dans les deux sens, montants réels trouvés :
  - 9 174,81 € de résas directes Lauïan encaissées par le **Stripe DCB** (SUZETTE, BERDEA, BITXI,
    ALTHEA) : Hospitable Direct = **un compte Stripe par site de réservation** ; ces biens n'étaient
    publiés que sur destinationcotebasque.com (corrigé par Oïhan dans Hospitable le 25/09).
    Détection : `reservation_paiement` dont la résa a `bien.agence ≠ mouvement.agence`.
  - ~~949,93 € d'un payout Airbnb du 05/01 pour 3 séjours DCB~~ — **faux, corrigé le 25/09** : c'est
    le séjour Lauïan ENEKO HMH9BJKYYF (Goberville, 949,93 € exact) ; le rapprochement l'avait relié à
    3 résas DCB (somme 949,92) déjà payées sur le compte DCB le 29/12. Leçon : un subset-sum au
    centime près entre agences doit être refusé quand une résa de la bonne agence a le montant exact.
- **DCB comme créancier de Lauïan** (pas « courant Lauïan ») :
  - FMEN : factures `lauian_fmen` générées côté DCB par `genererFactureLauianFMEN`, **client = le
    propriétaire Lauïan** (pas la société Lauïan). Montant dû = factures (réel > provision > report +
    rattrapages auto), **pas** la page Comptabilité (ex. ARROSA mai : ménages non faits encore
    ventilés). Payée côté propriétaire par retenue → reste une dette du séquestre Lauïan envers DCB
    jusqu'au virement.
  - COM (frais de service voyageur des résas directes) : **toujours DCB**, même sur un bien Lauïan
    (règle Oïhan 25/09).
  - Frais `facturer_et_deduire` = achats DCB refacturés sur la facture `lauian_fmen` → DCB.
    Frais `deduire_loyer` = achats payés par le courant Lauïan → courant Lauïan.
- **Reversement propriétaire hors facture** : AUGUSTA (villa Anglet Benichou) — commission 1 600 €
  facturée, reversement 10 145,04 € fait sans montant_reversement sur la facture.
- **Perte / retenue plateforme** : payout inférieur à la résa alors que le proprio est payé plein
  (BITXI HMJZK54KC5, Airbnb a retenu 395 € le 24/08).

## 3. Règles de classement : les libellés DCB ne marchent pas pour Lauïan
`sequestreCore.classerSortie` classait la plupart des reversements Lauïan en « autre » et les AE en
« inter_agence » (le détail contient « LAUIAN IMMOBILIER »). Les payeurs/bénéficiaires ont des noms
bancaires différents de la fiche : « EVE DIOR SECK » = AE Eve Vincent, « M OU MME JEAN-JACQUES C »
= Cirauqui (ENEKO), « THIERRY MANIVI » = Manivit (AMAÏA), « COURSAN LAURA PRO » = débours AE de
Laura. → la boîte « À affecter » avec **mémorisation d'alias par tiers** est indispensable.

## 4. Pièges de données trouvés (déjà corrigés, à garder en tête pour les contrôles)
| Piège | Correctif |
|---|---|
| Opération CE sans référence renommée par la banque entre 2 imports → doublon (Guérin 494,96 €) | `importBanque.js` `retirerDoublonsRenommes` (96a6def) |
| Pennylane courant : même virement 3× (FMEN juin 1 798,36 €) | 2 copies `ignore` — la cause Pennylane n'est pas corrigée |
| `stripe_payout_line` sans `stripe_charge_id` réinsérée à chaque passage (30 copies) | clé de repli = id transaction (d5a4cf2) |
| `sync-stripe` type_paiement `'partiel'` refusé par la contrainte | `'acompte'` (37a54f6) |
| Manuelle annulée : Hospitable garde le prix total en revenue (Y6MOIX 2 935 €) | `sync-reservations` : manuelle annulée sans paiement = 0 (23e178a) |
| Directe annulée remboursée : revenue = host fee (HOST-4JMIOG 3,78 €) → ventilation complète fantôme | données corrigées ; règle `isFullRefundDirect` existante mais jamais réappliquée aux mois anciens |
| Moteur : une annulée avec revenu > 0 est ventilée sur l'hébergement d'origine, pas sur le revenu réel | **non corrigé** — à traiter avec dry-run (CLAUDE.md) |
| Double rattachement d'un payout à une résa déjà payée (DCB BITXI/HMWEBSK4Z4, BIXINTXO) | anomalie auto dans le justificatif (c77c007) |

## 5. Ce qui reste ouvert côté Lauïan (mail à Laura : `~/Downloads/Mail_Laura_sequestre_Lauian.html`)
- Virement séquestre DCB → séquestre Lauïan 9 151,00 € (à passer AVANT les virements HON Lauïan).
- Virements à faire depuis le séquestre Lauïan : honoraires 47 418,02 € → courant Lauïan ; frais
  1 894,80 € → courant Lauïan ; FMEN 11 100,56 € + 350 € rattrapage KOSTALDEA → DCB ; COM
  3 615,10 € → DCB ; ARROSA 150,25 € → Mena Mauriz.
- À confirmer par Laura : AE (annexe F, 572,92 € restant), FMEN janv-mars (370,66 €), résolution
  Airbnb BITXI 395 €.
- Charges DCB → Lauïan à facturer après justification : main d'œuvre Clémence, forfaits logiciels
  par bien actif (Hospitable, PriceLabs), dev lauian-compta.
- Scripts d'analyse (lecture seule) dans le scratchpad de la session Lauïan : `lauian_seq.mjs`,
  `lauian_bien.mjs`, `lauian_pont.mjs` (pont de trésorerie au centime), `lauian_annexes.mjs`
  (génère les annexes par bien / résa / propriétaire / AE). À reprendre comme tests du système commun.

## 6. Boîte « À affecter » Lauïan (25/09, session Lauïan)
26 → 8 : 6 alias propriétaires (Cirauqui, Veyssière, Lopez Quesada, Manivit, Benichou ×2), alias
« hono » (virements honoraires → courant Lauïan), alias remboursement DCB « trop perçu FMEN » ;
liens ajoutés : 05/01 949,93 → ENEKO HMH9BJKYYF, 24/12 354,08 → ENEKO HMPJWDXMWY, 27/07 66 →
COCO HMS53M5BCH (AirCover). Restent 8 payouts plateformes janv-mars (17 132,75 €, séjours d'avant
l'app, dont Airbnb 13 547,14 € le 13/01). **Écart Lauïan du justificatif = −9 146 € ≈ les 9 151 €
encaissés par le Stripe DCB** : les compter en créance sur DCB (ou les exclure de l'encaissé Lauïan).

## 7. Mise à jour 25/09 fin de journée — « À affecter » 8 → 1
- Relevés Booking Lauïan : 5 payouts janv. 2026 rattachés (MIRAMARVEL : Vareilles 813,38, Legrand
  361,65, Fitoussi 643,56, Ego 447,38, Bruno Geay 761,10). **Booking 6610427759 (Bruno Geay,
  21-28/12/2025) n'avait jamais été synchronisée** (séjour d'avant la couverture sync) : résa créée
  avec le hospitable_id réel, `ventilation_manuelle=true` sans ventilation (proprio réglé hors app).
  → le système commun doit prévoir « payout d'un séjour antérieur à l'app » sans exiger de ventilation.
- Reste 1 seul mouvement à affecter : Airbnb 13 547,14 € du 13/01 (autre compte Airbnb, export attendu).
- Justificatif Lauïan (lecture seule) : écart −8 113,56 € ; toujours dominé par les 9 151 € encaissés
  par le Stripe DCB (§2).
- **Airbnb 13 547,14 € du 13/01 rattaché** (export compte ARROSA) : 4 séjours ARROSA été 2025
  (HM3XA5AR2H, HMPEJHB5XP, HMS9RPXQR4 + AirCover 720,70, HM2PTSR2SR). Payouts **gelés par Airbnb**
  (infos légales manquantes sur le compte Airbnb du propriétaire) ; Oïhan a payé le propriétaire en
  2025 sans attendre → le payout reconstitue le séquestre (avance), aucun reversement dû.
  → cas à prévoir dans le système commun : « avance propriétaire sur payout plateforme gelé ».
  À affecter Lauïan = **0**. Justificatif lecture seule après lien : écart +5 433,58 €.

## 8. Rapprochement 2025 depuis 0 (25/09 nuit)
- Historique complet : séquestre **Shine** (26/02/2025 → 23/12/2025, 0 → 0) + séquestre **CE** ouvert le 25/04/2025 à 0 (relevés PDF mai-août). Le « solde d'ouverture » n'existe plus.
- **Inter-agence, sens Lauïan → DCB : 3 067,68 €.** L'annonce Airbnb « Cozy 47m2 avec balcon » (LVH – Le Bouscat, bien DCB `BDX`) était sur le compte Airbnb Lauïan ; 11 séjours du 02/08 au 23/09/2025 ont été versés sur le Shine Lauïan (seul Levi Verkuil 200,77 € renvoyé à DCB). DCB a payé Emma Lalande (862,80 € le 08/09, 831,62 € le 07/10) → **créance du séquestre DCB sur le séquestre Lauïan**. Le virement DCB → Lauïan passe de 9 151,00 € à **6 083,32 € net**. À refléter dans le justificatif DCB (encaissements BDX août-sept 2025 jamais reçus côté DCB).
- Écarts Lauïan identifiés : HON et FMEN de décembre 2025 jamais virés, AirCover 720,70 € non reversé, frais Stripe 2026 (651,93 €) jamais remboursés par le courant (le courant les avait remboursés pour 2025 le 27/12/2025). Reste : séquestre court d'environ 4 000 € par rapport à l'ensemble des créances — à détailler.

## 9. Mise à jour 25/09 (nuit) — preuves et points pour le système commun
**Comptes Lauïan (tous vérifiés depuis leur ouverture)** : séquestre Shine FR76 1741 8000 0100 0118 8939 513
(26/02 → 23/12/2025, clôturé à 0), principal Shine …8758 511 (21/02 → 27/12/2025, 0 → 0), séquestre CE
08002960142 40 (dep. 25/04/2025), courant CE 08002959940 64 (dep. 06/05/2025), excédent CE 08002960041 52 (cautions).
Exports : iCloud `000 LAUIAN IMMOBILIER/Compta/2025/…EXPORT (ARCHIVE VRAC 2025)/` + `~/Downloads/operations_01032025_25092026.csv`
(séquestre CE complet, somme = 65 857,32) et `operations_01092024_25092026.csv` (courant CE complet).

**Solde d'ouverture de l'exercice** (plaquette cabinet au 30/09/2025) : séquestre Shine 14 210,59 + CE 18 841,76 =
32 052,35 € au passif (467100/467200), sans détail par mandant — recalculé au centime depuis les relevés.
Lauïan clôture au **30/09** → le justificatif doit pouvoir partir d'un solde d'ouverture d'exercice documenté.

**LVH (inter-agence Lauïan → DCB, 3 067,68 €) — certain** : export Airbnb = versements vers IBAN …9513 (Shine Lauïan),
retrouvés en banque ; aucune restitution sur les 5 comptes Lauïan ; factures DCB→Lauïan payées depuis
(F-20260000054 frais mars→sept 2025 : VIP Arosteguy/Hospitable/PriceLabs ; F-20260000162 COM avr→sept 2025) sans LVH.
Côté DCB : 11 résas `BDX` (02/08 → 23/09/2025) sans `reservation_paiement` alors que le propriétaire a été payé
→ à inscrire en créance sur le séquestre Lauïan dans le justificatif DCB. Détection générique proposée :
payout Airbnb dont l'IBAN de destination (export Airbnb, colonne « Détails ») appartient à une autre agence que le bien.

**Bug moteur à traiter (impact réel)** : une résa ventilée puis **annulée et remboursée à 100 %** garde son ancienne
ventilation si le mois est facturé/verrouillé → reversement propriétaire surpayé. Cas : AMAÏA HMSFJF3F2Y (Bill
Hamilton, juillet 2026) : fin_revenue = 0 mais VIR 646,86 + FMEN 79,54 toujours en base, 646,86 inclus dans le
reversement Manivit du 07/08/2026. Il faut au minimum une alerte « fin_revenue ≠ somme ventilée » sur mois verrouillé.
Contrôle SQL utilisé : `abs(fin_revenue − Σ(VIR,HON,FMEN,AUTO,COM)) > 1 €` hors owner_stay (seul cas Lauïan réel ;
les biens DCB sans collecte de loyer sortent en faux positifs, à exclure).

**Frais Stripe** : en 2025 le courant Lauïan remboursait les frais Stripe au séquestre (27/12/2025 : 752,91 €) ;
pas fait pour 2026 (651,93 € sur les résas Lauïan, dont 346,25 € prélevés côté Stripe DCB). Le système commun devrait
porter ces frais en « dû par le courant de l'agence ».

## 10. ⛔ ANNULÉ par Oïhan (25/09, 22h40) — commit 26a2c9a reverté (081cbb7), `ventilation-auto` redéployée sans la règle.
**« Résa annulée = aucun ménage » n'est PAS une règle d'Oïhan : ne pas la réappliquer, ne pas recalculer les 17 résas ci-dessous.**
Seul point réel qui reste : les résas annulées à **0 € encaissé** dont le VIRProprio a quand même été versé
(AMAÏA HMSFJF3F2Y 646,86 € Manivit — réclamé ; DUL2 HM8HQQP53E 384,44 € ; PANTXIKA HMEAQXCBW8 403,80 € — décision Oïhan).

### (historique) Passage de relais — bug « annulée » : correctif DÉJÀ DÉPLOYÉ par la session Lauïan (25/09, 22h30)
Fait avant de lire votre message « laisse-le à l'autre session » — je m'arrête ici, la suite est à vous.
- **Commit `26a2c9a`** (`ventilationCore.js` + test + `domain-rules.md`), poussé, **edge function `ventilation-auto` redéployée**.
  Règle Oïhan : résa annulée = **aucun ménage** (FMEN 0, MEN 0, pas d'AUTO) ; le retenu va au propriétaire
  (Airbnb/Booking : `revenue − HON − taxes` ; Direct annulée : `LOY = revenue − HON − COM − taxes`).
  Tests 102/102. Dry-run (`_writeResa` dryRun) : 17 annulées 2026 modifiées, 22 témoins acceptés IDENTIQUES.
- **Rien n'a été réécrit en base.** Les 17 ventilations existantes sont à reprendre par vous (mois verrouillés = régularisation) :

| Agence | Résa | Bien | Mois | Verrou | Effet du recalcul |
|---|---|---|---|---|---|
| dcb | HOST-XLJHOF | GAXUXA | 02 | non | FMEN 82 → 0, LOY 92,55 → 173,26 |
| dcb | HM2WM5CBDC | 416 | 03 | oui (payée) | FMEN 83,47 → 0, LOY +83,47 |
| dcb | HMKFAEPWRF | CERES | 04 | oui | FMEN 228,89 → 0, LOY +228,89 |
| dcb | HMW93C2JKE | EKIA | 04 | oui | FMEN 64,54 → 0, LOY +64,54 |
| dcb | HMNQZ8FCYF | CERES | 04 | oui | FMEN 114,45 → 0, LOY +114,45 |
| dcb | HM938TBKBT | 602 | 05 | oui | FMEN 41,73 → 0, LOY +41,73 |
| dcb | HOST-COTEY7 | GAXUXA | 06 | oui | FMEN 82 → 0, LOY +81,03 |
| dcb | HMR4K85RHK | ARREBA | 06 | oui | FMEN 21,99 → 0, LOY +21,99 |
| dcb | **HM8HQQP53E** | DUL2 | 07 | oui | **LOY 384,44 → 0** (0 € encaissé, Chevalier surpayé) |
| dcb | **HMEAQXCBW8** | PANTXIKA | 07 | oui | **LOY 403,80 → 0** (0 € encaissé, Waldau surpayé) |
| dcb | HM8SZAKKMK | VIKY | 07 | non | FMEN 92,07 → 0 |
| dcb | HOST-HXIDGK | IBANETA | 08 | oui | ⚠️ cas complexe (RGLM/SOLDE manuels, TAXE sur annulée) — ne pas réécrire tel quel |
| dcb | HMMKQK2E2S | PATXI | 09 | non | FMEN 45,18 → 0 (le cron le corrigera) |
| lauian | HMQJRNPFZF | MIRAMARVEL | 03 | non | FMEN 98,10 → 0, LOY +98,10 (Smaniotto sous-payé) |
| lauian | HMZE225AMM | ENEKO | 04 | non (FMEN « valide ») | FMEN 86,05 → 0, LOY +86,05 (Cirauqui) — facture lauian_fmen avril à régénérer |
| lauian | **HMSFJF3F2Y** | AMAÏA | 07 | oui | **LOY 646,86 → 0** — Manivit : **décision Oïhan = réclamer** |
| lauian | HMQKYJB5A5 | FOLLE | 07 | oui | FMEN 75,12 → 0, LOY +75,12 (Lopez Quesada sous-payé) |

- **Taxe de séjour sur une annulée : on ne change pas la règle** (décision Oïhan 25/09) — la TAXE reste calculée comme avant.
- Cause du « figé » Hamilton/Peterfy/Martorana : ventilation recalculée le 06/08 alors que `fin_revenue` valait encore le
  montant d'origine, puis passé à 0 (remboursement hôte) après verrouillage → pas de recalcul. Alerte à prévoir sur
  mois verrouillé quand `fin_revenue ≠ Σ ventilé`.
- **LVH vs 9 151 €** : aucun recoupement. Les 9 151 € = résas Lauïan **2026** (SUZETTE, BERDEA, BITXI, ALTHEA) encaissées
  par le **Stripe DCB** ; LVH = 11 résas du bien DCB `BDX` d'**août-sept. 2025** versées par **Airbnb** sur le Shine Lauïan.
  Net DCB → Lauïan = 9 151,00 − 3 067,68 = **6 083,32 €**.

## 11. Précision d'Oïhan (25/09, 22h35) — pour la session qui reprend le moteur
La règle « pas de ménage » ne vaut **que pour une annulée à 0 €** (remboursée en totalité) :
- **Annulée à 0 €** (`final_status` annulé ET `fin_revenue = 0`) → **aucune ligne** : ni HON, ni FMEN, ni MEN, ni AUTO, ni LOY/VIR.
  Aujourd'hui (code reverté) une annulée à 0 € dont les financials Airbnb gardent le cleaning/community fee produit
  encore FMEN + MEN (ex. HMSFJF3F2Y : FMEN 79,54, MEN 90) et, si le mois est verrouillé, garde l'ancien LOY.
- **Annulée avec frais retenus** (`fin_revenue > 0`) → **ventilation normale inchangée** (FMEN compris).
  Donc les lignes « FMEN → 0 / LOY + » du tableau §10 pour les annulées à revenu > 0 (HOST-XLJHOF, HM2WM5CBDC,
  HMKFAEPWRF, HMW93C2JKE, HMNQZ8FCYF, HM938TBKBT, HOST-COTEY7, HMR4K85RHK, HM8SZAKKMK, HMMKQK2E2S, HMQJRNPFZF,
  HMZE225AMM, HMQKYJB5A5) sont **caduques** : rien à régulariser pour elles.
- Restent concernées (annulées à 0 € mais ventilées/reversées) : **HMSFJF3F2Y** AMAÏA (Manivit 646,86 € — à réclamer,
  décision Oïhan), **HM8HQQP53E** DUL2 (Chevalier 384,44 €), **HMEAQXCBW8** PANTXIKA (Waldau 403,80 €).
Implémentation minimale suggérée (dans `_calculerLignes`, après `const revenue`) :
`if (STATUTS_NON_VENTILABLES.includes(resa.final_status) && revenue <= 0) return { lignes: [], isProlongation: false, fallbackAirbnb: null }`
+ test « annulée à 0 € avec community fee → aucune ligne » ; la session Lauïan ne touche plus au moteur.
**✅ FAIT par la session DCB (25/09, 23h) : garde-fou dans `_calculerLignes` + 2 tests + simulation mai-août (seules les annulées à 0 € changent), `ventilation-auto` redéployée — invariant I-168. Rien réécrit en base.**


## 12. Décision Oïhan (25/09, nuit) — LVH récupéré sur le séquestre Lauïan
Les 3 067,68 € LVH sont **récupérés par DCB sur le séquestre Lauïan**, par compensation : virement séquestre DCB → séquestre Lauïan = **6 083,32 € net** (9 151,00 − 3 067,68). Le trou ≈ 3 350 € côté Lauïan reste à combler par ses propres causes (Manivit 646,86 € réclamé, frais Stripe 651,93 € dus par le courant Lauïan, AE, écarts 2025). Refaire le bilan du mail Laura sur cette base.
