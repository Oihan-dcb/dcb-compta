# Propriété des champs `auto_entrepreneur` (staff/AE) — cross-app

Table unique (`auto_entrepreneur`, projet Supabase `omuncchvypbtxkpalwcr`), déjà partagée par 3
apps : **dcb-compta** (admin complet), **dcb-planning/PowerHouse** (planning), **dcb-portail-ae**
(self-service AE). La RLS est déjà scopée par rôle (`auth_user_is_bureau()`,
`auth_user_is_internal()`, `auth_user_owns_ae()`), pas par app — l'accès partagé existe donc déjà.

Ce document répond à une question différente : **qui a le droit d'ÉCRIRE quel champ, et
pourquoi** — pour ne pas répéter l'incident `staff_dcb` (voir `invariants.md` I-136) où une valeur
de `type` non synchronisée entre deux fichiers a rendu un test toujours faux.

**Règle de base : un champ = un propriétaire d'écriture. Jamais "une app a tous les droits".**

## Classe A — Opérationnel / planning (PowerHouse peut écrire)

`contrat_agences`, `ical_pro`, `auto_send_navette`, `is_chat_manager`, `chat_group_slug`,
`is_chat_hidden`, `note`.

Aucun de ces champs n'est lu par un calcul financier (facturation, débours, rapports
propriétaires). Les modifier ne peut pas déplacer un euro.

## Classe B — Contact (éditable des deux côtés, dcb-compta reste l'écran canonique)

`telephone`, `email`, `prenom`, `nom`.

Réserve : `email` sert aussi d'identifiant de connexion (lien avec `ae_user_id`) — à traiter
comme classe C tant que ce lien n'est pas clarifié.

## Classe C — Paie, légal, accès (dcb-compta SEUL maître, sans exception)

`taux_horaire`, `heures_contrat`, `forfait_menage`, `is_assujetti_tva`, `siret`, `iban`,
`adresse`, `date_debut`, `date_fin`, **`type`**, `agence`, `voit_toutes_agences`, `acces_admin`,
`acces_calendrier`, `saisie_heures`, `ae_user_id`, `token_acces`, **`actif`**.

- **`type`** (`ae`/`staff`/`gerant`/`assistante`) est le champ le plus sensible : lu directement
  par `buildComptaMensuelle.js`, `facturesEvoliz.js`, `buildRapportData.js`,
  `exportAutoDebours.js` pour décider facturation/débours/rapports propriétaires. Le changer
  reclasse rétroactivement la production de la personne dans les factures.
- **`actif`** n'est pas un simple interrupteur d'affichage : désactiver un staff le retire du
  planning ET modifie les exports mensuels — c'est un acte RH, pas un nettoyage d'écran.

**PowerHouse ne doit jamais écrire un champ lu par un calcul financier**, et ne doit jamais
recalculer localement une valeur déjà calculée par dcb-compta (pas de 4ᵉ implémentation de la
logique paie — 3 existent déjà et doivent rester synchronisées à la main, voir mémoire
`project_manon_hybride`).

## Ce qui reste exclusivement dans dcb-compta

Création d'un staff, désactivation, création d'un accès auth, reset de mot de passe
(`src/services/autoEntrepreneurs.js`, `src/pages/PageAutoEntrepreneurs.jsx`). Actes rares,
sensibles, jamais dupliqués ailleurs.

## Historique

- 22/08/2026 — Document créé suite à une demande d'Oïhan de centraliser la gestion staff
  cross-app dcb-compta/PowerHouse. Consultation Opus : la centralisation DB existe déjà (RLS
  role-based), ce qui manquait était cette carte de propriété. Plan en phases dans la mémoire de
  session `project_powerhouse_audit_ux_2026-08` (PowerHouse). Fix associé : `exportAutoDebours.js`
  testait `type === 'staff_dcb'` (valeur inexistante en base) au lieu de `'staff'` — voir I-136.
