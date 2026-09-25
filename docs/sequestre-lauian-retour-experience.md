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
  - 949,93 € d'un payout Airbnb du 05/01 arrivé sur le séquestre Lauïan pour 3 séjours DCB
    (EKIA, 602, IBANETA, 26/12/2025).
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
  3 615,10 € → DCB ; 949,93 € → DCB ; ARROSA 150,25 € → Mena Mauriz.
- À confirmer par Laura : AE (annexe F, 572,92 € restant), FMEN janv-mars (370,66 €), résolution
  Airbnb BITXI 395 €.
- Charges DCB → Lauïan à facturer après justification : main d'œuvre Clémence, forfaits logiciels
  par bien actif (Hospitable, PriceLabs), dev lauian-compta.
- Scripts d'analyse (lecture seule) dans le scratchpad de la session Lauïan : `lauian_seq.mjs`,
  `lauian_bien.mjs`, `lauian_pont.mjs` (pont de trésorerie au centime), `lauian_annexes.mjs`
  (génère les annexes par bien / résa / propriétaire / AE). À reprendre comme tests du système commun.
