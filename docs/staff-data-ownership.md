# Propriété des champs `auto_entrepreneur` (staff/AE) — cross-app

Table unique (`auto_entrepreneur`, projet Supabase `omuncchvypbtxkpalwcr`), déjà partagée par 3
apps : **dcb-compta** (admin compta), **dcb-planning/PowerHouse** (hub de gestion staff depuis le
23/08/2026), **dcb-portail-ae** (self-service AE). La RLS est déjà scopée par rôle
(`auth_user_is_bureau()`, `auth_user_is_internal()`, `auth_user_owns_ae()`), pas par app —
l'accès partagé existe donc déjà.

**Mise à jour du 23/08/2026 (décision Oïhan) : PowerHouse a désormais la même écriture que
dcb-compta sur tous les champs "métier staff".** Ceci ANNULE la doctrine A/B/C ci-dessous pour
ces champs — conservée en historique pour comprendre le raisonnement initial (pourquoi ils
avaient été jugés sensibles) et parce qu'elle reste utile pour ce qui est réellement resté
exclusif à dcb-compta. Motivation du changement : PowerHouse est désormais pensé comme le hub
backend de l'écosystème DCB, dcb-compta se recentre sur la comptabilité pure — dupliquer l'écran
staff n'est plus "zéro nouvel usage" comme au 22/08, c'est la direction produit voulue.

Ce document répond à une question qui reste pertinente même après ce changement : **qui a le
droit d'ÉCRIRE quel champ, et pourquoi** — pour ne pas répéter l'incident `staff_dcb` (voir
`invariants.md` I-136) où une valeur de `type` non synchronisée entre deux fichiers a rendu un
test toujours faux.

## Champs désormais éditables des deux côtés (dcb-compta ET PowerHouse)

Liste blanche technique côté PowerHouse : `STAFF_EDITABLE_FIELDS` dans
`dcb-planning/src/parts/00-prelude.jsx`. Comprend tout ce qui suit (anciennes classes A/B/C
fusionnées) : `contrat_agences`, `ical_pro`, `auto_send_navette`, `note`, `telephone`,
`taux_horaire`, `heures_contrat`, `forfait_menage`, `is_assujetti_tva`, `siret`, `iban`,
`adresse`, `code_postal`, `ville`, `date_debut`, `date_fin`, `type`, `agence`,
`voit_toutes_agences`, `acces_admin`, `acces_calendrier`, `saisie_heures`, `actif`.

- **`type`** (`ae`/`staff`/`gerant`/`assistante`) reste le champ le plus sensible : lu directement
  par `buildComptaMensuelle.js`, `facturesEvoliz.js`, `buildRapportData.js`,
  `exportAutoDebours.js` pour décider facturation/débours/rapports propriétaires. Le changer
  reclasse rétroactivement la production de la personne dans les factures. **PowerHouse demande
  une confirmation explicite avant d'écrire ce champ** (`StaffFicheDrawer`, `showConfirm`).
- **`actif`** n'est pas un simple interrupteur d'affichage : désactiver un staff le retire du
  planning ET modifie les exports mensuels — c'est un acte RH, pas un nettoyage d'écran. Même
  garde-fou de confirmation côté PowerHouse.

**Restent volontairement HORS de la liste éditable côté PowerHouse** (pas des champs "métier
staff", des mécanismes système/auth distincts, à traiter séparément si besoin un jour) :
`email`/`prenom`/`nom` (identifiant de connexion + slug utilisé ailleurs dans l'app, lien avec
`ae_user_id`), `ae_user_id`/`linked_ae_user_id`/`token_acces` (liaison compte auth),
`is_chat_manager`/`chat_group_slug`/`is_chat_hidden` (messagerie interne, écran dédié),
`memo_perso`/`notification_prefs`/`ical_perso` (self-service AE sur sa propre fiche).

**PowerHouse ne doit toujours pas recalculer localement une valeur déjà calculée par dcb-compta**
(pas de 4ᵉ implémentation de la logique paie — 3 existent déjà et doivent rester synchronisées à
la main, voir mémoire `project_manon_hybride`) — écrire `taux_horaire` depuis PowerHouse est
maintenant permis, mais le CALCUL de paie reste dans dcb-compta.

## Ce qui reste exclusivement dans dcb-compta

Création d'un nouveau staff, désactivation *via le flux d'onboarding/offboarding complet* (le
champ `actif` seul est désormais éditable depuis PowerHouse, voir ci-dessus), création d'un accès
auth, reset de mot de passe (`src/services/autoEntrepreneurs.js`,
`src/pages/PageAutoEntrepreneurs.jsx`). Ce sont des actes rares impliquant plus qu'une simple
mise à jour de champ (création de ligne, appel Supabase Auth Admin) — jamais dupliqués ailleurs.

## Doctrine historique du 22/08/2026 (annulée pour les champs listés ci-dessus, gardée pour mémoire)

<details>
<summary>Classes A/B/C — raisonnement initial avant le changement du 23/08/2026</summary>

**Règle de base : un champ = un propriétaire d'écriture. Jamais "une app a tous les droits".**

- **Classe A — Opérationnel/planning** (PowerHouse pouvait déjà écrire) : `contrat_agences`,
  `ical_pro`, `auto_send_navette`, `is_chat_manager`, `chat_group_slug`, `is_chat_hidden`, `note`.
  Aucun de ces champs n'est lu par un calcul financier.
- **Classe B — Contact** (éditable des deux côtés) : `telephone`, `email`, `prenom`, `nom`.
- **Classe C — Paie/légal/accès** (dcb-compta seul maître, "sans exception") : `taux_horaire`,
  `heures_contrat`, `forfait_menage`, `is_assujetti_tva`, `siret`, `iban`, `adresse`,
  `date_debut`, `date_fin`, `type`, `agence`, `voit_toutes_agences`, `acces_admin`,
  `acces_calendrier`, `saisie_heures`, `ae_user_id`, `token_acces`, `actif`.

Le raisonnement de fond (pourquoi ces champs sont sensibles) reste valable et explique les
garde-fous de confirmation ajoutés dans PowerHouse pour `type`/`actif` — seule la conclusion
("dcb-compta seul maître") a changé.
</details>

## Garde-fou en base — ce qu'il peut et ne peut pas faire

Un trigger `BEFORE UPDATE` (`trg_log_auto_entrepreneur_classe_c_change`) journalise dans
`journal_ops` toute modification d'un champ (ex-)classe C par un compte **bureau** (staff_users,
gérant/assistante/acces_admin) — traçabilité, pas blocage, et ça reste vrai après le 23/08/2026 :
PowerHouse écrivant désormais ces champs, ce log devient la trace utile pour distinguer "modifié
depuis dcb-compta" vs "modifié depuis PowerHouse" a posteriori si besoin (il ne peut toujours pas
bloquer par app cliente — les deux apps authentifient le même compte avec le même rôle, voir
I-137 dans `invariants.md`). Le seul garde-fou de PORTÉE (quels champs sont éditables du tout
depuis PowerHouse) reste **le code** : `STAFF_EDITABLE_FIELDS` dans
`dcb-planning/src/parts/00-prelude.jsx` (le repo est découpé en `src/parts/*.jsx` depuis le
22/08/2026, plus un seul `app.jsx`) — désormais volontairement large plutôt que restreint,
suite à la décision du 23/08/2026.

Le risque inverse (un AE qui élève ses propres privilèges via son compte self-service) est lui
bloqué en dur — voir `trg_check_ae_self_update_scope` (migration
`fix_ae_privilege_escalation_and_bureau_bucket`, 21/08/2026, indépendante de ce chantier) :
seuls `memo_perso`/`notification_prefs`/`ical_perso` sont éditables par un AE sur sa propre fiche.

## Historique

- 22/08/2026 — Document créé suite à une demande d'Oïhan de centraliser la gestion staff
  cross-app dcb-compta/PowerHouse. Consultation Opus : la centralisation DB existe déjà (RLS
  role-based), ce qui manquait était cette carte de propriété. Plan en phases dans la mémoire de
  session `project_powerhouse_audit_ux_2026-08` (PowerHouse). Fix associé : `exportAutoDebours.js`
  testait `type === 'staff_dcb'` (valeur inexistante en base) au lieu de `'staff'` — voir I-136.
- 22/08/2026 — Phase 1 (panneau lecture seule PowerHouse) et Phase 2 (édition
  téléphone/note/agences/navette depuis PowerHouse, liste blanche `STAFF_EDITABLE_FIELDS`)
  déployées. Phase 3 (trigger d'audit `trg_log_auto_entrepreneur_classe_c_change`) appliquée —
  voir I-137 pour la limite structurelle découverte (pas de blocage possible par app).
- 23/08/2026 — Décision Oïhan : parité complète PowerHouse/dcb-compta sur tous les champs
  "métier staff" (annule la doctrine A/B/C ci-dessus, gardée en historique). `StaffFicheDrawer`
  (PowerHouse) étendu avec tous les champs paie/légal/accès, confirmation explicite ajoutée pour
  `type`/`actif`. Restent exclusifs à dcb-compta : création/désactivation-onboarding, accès auth,
  reset mot de passe. Champs volontairement toujours non éditables depuis PowerHouse :
  email/prénom/nom, ae_user_id/linked_ae_user_id/token_acces, champs messagerie interne,
  memo_perso/notification_prefs/ical_perso (self-service AE).
  voir I-137 pour la limite structurelle découverte (pas de blocage possible par app).
