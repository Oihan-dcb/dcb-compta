# Questions pour Laura — intégration comptable des LLD

> Objectif : faire passer les locations longue durée (loyers mensuels) dans la même comptabilité que les locations saisonnières (rapport proprio, facture d'honoraires Evoliz, virement). Avant de coder, on a besoin de figer quelques règles métier. Pour chaque point : ce que le système fait **aujourd'hui**, puis la **question**.

> **✅ RÉPONDU par Laura le 2026-06-11.** Réponses consignées ci-dessous (en *italique*) et reportées dans `lld-integration-plan.md` §6. Reste ouvert uniquement le **compte comptable Evoliz** (Q7, à valider avec le cabinet Garnier).

## ⭐ Réponses clés (synthèse 2026-06-11)
1. **Honoraires mensuels = % du loyer CC** (charges comprises), PAS un montant fixe : **10 % étudiants**, **8 % bail à l'année**, **5 % exception BITXI**. → le champ `etudiant.honoraires_dcb` (montant figé) doit devenir un **taux de commission** (`taux_commission`) appliqué au loyer total CC.
2. **Frais de mise en location** (one-shot, distinct des honoraires mensuels) : **13 €/m² de chaque côté** (locataire + propriétaire), à chaque nouvelle location.
3. **Charges** = reversées au proprio, **forfaitaires partout** (~15 € eau + copro fixe + internet/autres), jamais régularisées. Honoraires calculés sur le loyer **CC** (charges comprises).
4. **Prorata** entrée/sortie : loyer **CC** × jours occupés ÷ jours du mois (charges + supplément + complément inclus — tout est CC).
5. **TVA 20 %** sur les honoraires : oui.
6. **Séquestre LLD dédié** (« compte de gestion longue durée ») : oui. Cautions sur **compte excédent**.
7. **Reversement proprio** : vers le **7/8 du mois**. Virement **global des honoraires** du mois en une fois. 
8. **Documents mensuels** : facture d'honoraires (pour le comptable) + quittance locataire + **relevé pour le proprio**.
9. **Compléments de loyer** : inclus dans le loyer, pas à différencier.
10. **Apporteur sans gestion** : aucun cas (sauf historique LAUIAN — 2 apparts CIRAUQUI + 1 Guétary).

## A. Charges (eau / copropriété / internet)
- **Aujourd'hui** : les charges sont **reversées au propriétaire** (on lui vire le loyer + supplément + charges, moins nos honoraires). Le réglage `charges_nature` peut être « forfaitaires » ou « provisions ».
- **Q1.** C'est bien correct de reverser les charges au proprio, ou DCB doit-il en garder/gérer une partie ?
- **Q2.** Les charges sont-elles **forfaitaires** (montant fixe, jamais régularisé) ou des **provisions** (à régulariser une fois par an sur charges réelles) ? Si provisions : qui fait la régularisation annuelle et quand ?
- **Q3.** Si un locataire part en cours de mois, les charges sont-elles dues **en entier** ou **au prorata** des jours (comme le loyer) ?

## B. Honoraires DCB & facture au propriétaire
- **Aujourd'hui** : on déduit un montant d'honoraires (`honoraires_dcb`) par locataire du virement proprio. Aucune **facture d'honoraires** n'est émise au proprio (contrairement au saisonnier qui génère une facture Evoliz chaque mois).
- **Q4.** Les honoraires LLD sont-ils un **forfait** par locataire ou un **pourcentage** du loyer ?
- **Q5.** Le propriétaire LLD doit-il recevoir une **facture d'honoraires mensuelle** (comme le saisonnier), ou juste un relevé ?
- **Q6.** Ces honoraires sont-ils soumis à **TVA 20 %** comme le saisonnier ? *(à confirmer éventuellement avec le comptable cec-garnier)*
- **Q7.** Sur quel **compte comptable** mettre les honoraires LLD ? Réutiliser le compte « honoraires locations étudiantes » (7067) déjà créé, ou un compte dédié « honoraires LLD » ? *(question comptable cec-garnier)*

## C. Séquestre & virements
- **Aujourd'hui** : les loyers LLD arrivent sur un **séquestre loyers dédié** (séparé du séquestre saisonnier), les cautions sur un **séquestre cautions** séparé. Le virement au proprio se fait depuis le séquestre loyers LLD.
- **Q8.** On garde bien ce séquestre loyers LLD **distinct** du saisonnier (pas de fusion) ? *(c'est ce qu'on prévoit)*
- **Q9.** À quel moment reverse-t-on le loyer au proprio : **dès réception** du loyer, ou à **date fixe** chaque mois ? Y a-t-il une retenue (ex. premier mois, dépôt) ?

## D. Prorata entrée / sortie en cours de mois
- **Aujourd'hui** : le loyer est **toujours compté en entier**, même si le locataire entre ou part en milieu de mois (pas de prorata). C'est le bug repéré dans le portail proprio.
- **Q10.** Confirme la règle : loyer du mois d'entrée et du mois de sortie = **loyer × jours occupés ÷ jours du mois** ?
- **Q11.** Ce prorata s'applique-t-il aussi aux **charges** et au **supplément** ?
- **Q12.** La **quittance** du locataire doit-elle afficher le montant proratisé et la **vraie période** (ex. « du 1er au 10 ») au lieu du mois entier ?

## E. Divers
- **Supplément de loyer** : noté comme faisant partie du loyer (loyer plafonné + supplément) → reversé au proprio. ✅ (décidé)
- **Q13.** On a vu des « compléments de loyer » (ex. +30 €/mois) en plus du supplément : c'est le même poste que `supplement_loyer`, ou un poste distinct à tracer séparément ?
- **Q14.** Y a-t-il des cas où DCB **n'est pas mandataire** mais juste apporteur (honoraires one-shot) plutôt que gestion mensuelle ?

---

## Réponses verbatim de Laura (2026-06-11)
- **Q1.** « Oui, nos honoraires sont calculées sur le loyer total, charges comprises. Par ex si le locataire paie 800 €, on reverse 720 €. 10 % de commission pour les étudiants / 8 % pour les locations à l'année. La seule exception c'est **BITXI** qui était à **5 %**. »
- **Q2.** « Les charges sont **forfaitaires** partout, je provisionne environ 15 € d'eau + charges de copro fixes + internet ou autres frais. » → pas de régularisation annuelle.
- **Q3.** « Au **prorata**. Tu prends le loyer total du mois, tu le divises par 30 ou 31 et tu multiplies par le nombre de jours qu'il reste dans le mois. »
- **Q4.** Deux niveaux : honoraires **mensuels** = % du loyer **CC** (10 %/8 %/5 % BITXI) ; **frais d'agence** de mise en location = **13 €/m² de chaque côté** (locataire + propriétaire).
- **Q5.** « Il faut chaque mois la **facture** pour le comptable du montant de nos honoraires + la **quittance** étudiante + un **relevé** pour le proprio. »
- **Q6.** « Oui les honoraires sont soumis à **TVA**. »
- **Q7.** « Pour le comptable OK » → **délégué au cabinet Garnier** (compte comptable à confirmer). ⏳ SEUL POINT OUVERT.
- **Q8.** « Oui, les loyers LLD sont sur le **compte de gestion longue durée** ! »
- **Q9.** « On reverse le loyer vers le **7/8 du mois** environ. Un virement **global des honoraires** du mois est fait aussi en une fois. Les **cautions** sont stockées sur le **compte excédent**. »
- **Q10.** « Oui ! En prenant le loyer **charges comprises**. »
- **Q11.** « Oui on prend toujours le **CC**. »
- **Q12.** « Oui idéalement mais en général ils ne demandent jamais leur dernière quittance. » → nice-to-have, faible priorité.
- **Q13.** « Non c'est inclus dans le loyer, pas besoin de le différencier. »
- **Q14.** « Non aucun, cela a juste été le cas pour LAUIAN pour les deux appartements des CIRAUQUI et l'autre de Guétary. »

*Réponses → reportées dans `docs/lld-integration-plan.md` §6 avant de coder la Phase 1 (prorata).*
