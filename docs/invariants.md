# DCB Compta — Invariants système

> **Statut** : Document d'audit — mars 2026
> **Source** : Code source + audit complet + règles métier (`domain-rules.md`)
> **Avertissement** : Ce document distingue explicitement les invariants respectés et ceux actuellement violés, avec référence aux bugs correspondants.

---

## Principe

Un invariant est une règle qui doit **toujours être vraie** dans le système, indépendamment de l'opération effectuée. Toute violation est un état corrompu qui peut se propager silencieusement jusqu'aux factures et aux reversements.

Les invariants sont organisés par domaine. Pour chaque invariant : état attendu, état actuel, et référence au bug si violé.

---
