# DCB Compta — Cartographie technique

> **Statut** : Document d'audit — mars 2026
> **Source** : Code source + audit complet
> **Avertissement** : Ce document décrit l'architecture **telle qu'elle existe réellement**, avec ses duplications et incohérences actives.

---

## TL;DR

Deux applications React (DCB Compta + Portail AE) partagent une base Supabase commune. Les opérations sensibles (auth AE, sync iCal, sync globale, webhook) passent par des Edge Functions Deno. Trois couches de code contiennent des copies divergentes de la logique de ventilation. Le matching bancaire existe en deux versions dans deux services différents. Aucune couche d'authentification ne protège l'accès aux applications.

**Architecture CSV-first** : le CSV Hospitable est la source principale de données pour la comptabilité mensuelle. L'API Hospitable et les webhooks sont des sources secondaires d'enrichissement. Le système ne dépend plus des webhooks pour la cohérence comptable.

---

## 1. Vue d'ensemble des couches

```
┌─────────────────────────────────────────────────────────────────┐
│  COUCHE CLIENT                                                  │
│                                                                 │
│  dcb-compta.vercel.app        dcb-portail-ae.vercel.app        │
│  React + Vite                 React + Vite (repo privé)        │
│  (pas d'auth frontend)        (auth via Supabase JWT)          │
│                                                                 │
│  api/ae-action.js                                              │
│  (Vercel serverless — proxy vers Edge Functions)               │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTPS + Supabase JS client
┌────────────────────────▼────────────────────────────────────────┐
│  SUPABASE                                                       │
│                                                                 │
│  Postgres (tables)      Realtime (subscriptions)               │
│  Auth (JWT AE)          Storage (non utilisé)                  │
│  REST API               RLS Policies (❓ non auditées)         │
│                                                                 │
│  Edge Functions (Deno) :                                        │
│    create-ae-user       sync-ical-ae                           │
│    sync-ical-cron       hospitable-webhook                     │
│    global-sync          evoliz-proxy                           │
│    smtp-send            [reset-ae-password]                    │
└────────────────────────┬────────────────────────────────────────┘
                         │ API HTTPS
┌────────────────────────▼────────────────────────────────────────┐
│  APIS EXTERNES                                                  │
│                                                                 │
│  Hospitable v2 API      Evoliz API         Stripe              │
│  (réservations,         (facturation       (paiements directs)  │
│   payouts, biens)        légale)                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Modules ↔ Services ↔ Tables

### Module Biens
```
PageBiens.jsx
  → syncBiens.js          → API Hospitable /v2/properties
                          → table: bien
  → syncProprietaires.js  → evoliz-proxy (Edge Function)
                          → table: proprietaire
  Lecture directe Supabase (inline dans PageBiens.jsx) :
    → table: bien (airbnb_account, ical_code, gestion_loyer, agence)
    → table: mission_menage (ical codes — chargé mais non utilisé dans le rendu)
```

### Module Réservations
```
PageReservations.jsx
  → syncReservations.js   → API Hospitable /v2/reservations?include=financials
                            [✅ Confirmé fournisseur : /v2/reservations est l'endpoint correct
                             pour récupérer réservations + données financières]
                            [✅ Confirmé fournisseur : include=financials est le bon paramètre —
                             financials et financialsV2 sont actuellement équivalents]
                            [✅ Confirmé fournisseur : Hospitable fournit des line items bruts —
                             l'API ne calcule pas les totaux métier consolidés →
                             ventilation.js est l'endroit légitime pour calculer le revenu net,
                             catégoriser les montants et transformer en codes comptables]
                          → table: reservation (upsert)
                          → table: reservation_fee (DELETE + INSERT)
                          → table: payout_hospitable (Airbnb synthétique)
                          → table: payout_reservation
  → ventilation.js (V1)  → table: ventilation (DELETE + INSERT)
                          → table: reservation (ventilation_calculee=true)
  → ModalResa.jsx
    → useOwnerStay.js     → table: reservation (owner_stay)
                          → table: ventilation (FMEN forfait proprio)
  → TableReservations.jsx (lecture seule)
  → TableVentilation.jsx  → ventilation.js (getRecapVentilation)
                          → table: ventilation (SELECT)
```

### Module Banque
```
PageBanque.jsx
  → banque.js             → table: mouvement_bancaire (SELECT)
  → importBanque.js       → table: mouvement_bancaire (INSERT via upsert)
                          → table: import_log
  → importBooking.js      → table: booking_payout_line (INSERT)
                          → table: mouvement_bancaire (UPDATE statut)
  Suppression inline      → table: mouvement_bancaire (DELETE brut ⚠)
```

### Module Rapprochement
```
PageRapprochement.jsx
  → rapprochement.js (NOUVEAU moteur)
    getMouvementsMois     → table: mouvement_bancaire (SELECT + enrichissement)
                          → table: reservation_paiement
                          → table: ventilation (code=VIR)
                          → table: stripe_payout_line
                          → table: booking_payout_line
    lancerMatchingAuto    → table: payout_hospitable
                          → table: payout_reservation
                          → table: ventilation (UPDATE mouvement_id)
                          → table: reservation (UPDATE rapprochee)
                          → table: mouvement_bancaire (UPDATE statut)
    matcherManuellement   → (même tables via _lier)
    annulerRapprochement  → table: ventilation (mouvement_id=null)
                          → table: reservation (rapprochee=false)
                          → table: payout_hospitable (mouvement_id=null)
                          → table: reservation_paiement (DELETE)
                          → journal.js → table: journal_ops
  → syncStripe.js         → API Stripe (❓ détails non audités)
```

### Module Factures
```
PageFactures.jsx
  → facturesEvoliz.js
    genererFacturesMois
      → genererFactureProprietaire(proprio, mois)
            → table: ventilation (SELECT par code + SELECT par bien — LOY, AUTO)
            → table: prestation_hors_forfait (deduction_loy, haowner — par bien_id)
            → table: expense (SELECT — table référencée mais non auditée)
            → table: facture_ae (SELECT)
            → table: facture_evoliz (INSERT/UPDATE, type_facture='honoraires')
            → table: facture_evoliz_ligne (DELETE + INSERT)
            [bien.mode_encaissement lu depuis proprio.biens]
      → genererFactureDebours(proprio, mois)   [NOUVEAU — mars 2026]
            → table: ventilation (SELECT code='AUTO' par bien)
            → table: prestation_hors_forfait (deduction_loy, haowner — pour calcul surplus dcb)
            → table: facture_evoliz (INSERT/UPDATE, type_facture='debours')
            → table: facture_evoliz_ligne (DELETE + INSERT, code='DEB_AE', taux_tva=0)
            [montant_reversement=null — déclenchement si AUTO à facturer]
    getFacturesMois       → table: facture_evoliz (SELECT *, filtre: mois — inclut type_facture)
                          [✅ champ réel utilisé : `mois` — incohérence initiale corrigée (CF-F1)]
    validerFacture        → table: facture_evoliz (UPDATE statut)
    exportCSVComptable    → table: ventilation (SELECT tous codes, sans filtre agence)
  → evoliz.js
    pousserFacturesMoisVersEvoliz → evoliz-proxy (Edge Function)
                                 → table: facture_evoliz (UPDATE id_evoliz, statut)
                                 → table: proprietaire (UPDATE id_evoliz si nouveau client)
                                 [vatRate: l.taux_tva ?? 20 — respecte taux_tva=0 pour DEB_AE]
```

### Module Import CSV
```
PageImport.jsx
  → importCSV.js
    analyseCSV            → (parse local, pas de DB)
    importHospitableCSV   → table: bien (SELECT — map par nom et id)
                          → table: reservation (SELECT tous codes, UPDATE, INSERT)
                          → table: reservation_fee (DELETE + INSERT ⚠ sans transaction)
                          → fusionnerDoublons:
                              table: reservation (SELECT tous, DELETE slaves)
                              table: reservation_fee (UPDATE reservation_id)
                              table: ventilation (UPDATE reservation_id)
                              [⚠ reservation_paiement et payout_reservation non migrés]
```

### Module AEs
```
PageAutoEntrepreneurs.jsx
  → autoEntrepreneurs.js  → table: auto_entrepreneur (SELECT, INSERT, UPDATE, DELETE)
  → api/ae-action.js (Vercel proxy)
    action=create         → Edge Function: create-ae-user
                              → Supabase Auth (createUser)
                              → table: auto_entrepreneur (UPDATE ae_user_id)
                              [⚠ mdp_temporaire NON sauvegardé]
    action=reset          → Edge Function: reset-ae-password [⚠ MANQUANTE]
    action=sync           → Edge Function: sync-ical-ae
                              → iCal URL Hospitable (fetch externe)
                              → table: bien (SELECT ical_code)
                              → table: mission_menage (UPSERT)
  → supabase direct (inline) :
      table: prestation_type (SELECT, INSERT, UPDATE, DELETE)
  [⚠ confirmModal et balance balance hors du return() — jamais rendus]
```

### Module Prestations
```
PagePrestationsAE.jsx
  → table: prestation_hors_forfait (SELECT, UPDATE statut)
  → table: auto_entrepreneur (SELECT référentiel)
  → table: bien (SELECT référentiel)
  [validation = UPDATE statut uniquement dans cette page]
  [type_imputation 'deduction_loy' : déduit du reversement ✅]
  [type_imputation 'haowner' : ligne HAOWNER TVA 20% dans facture honoraires ✅]
  [type_imputation 'debours_proprio' : absorption LOY + ligne DEBP ✅ (CF-P1-BC)]
  [type_imputation 'dcb_direct' : log interne uniquement, pas de facturation propriétaire — par conception ✅]
```

### Module Rapports
```
PageRapports.jsx
  → rapportProprietaire.js
    getBienNote / saveBienNote → table: bien_notes (upsert onConflict bien_id,mois)
    getReviewsMois             → table: reservation_review (SELECT + join reservation/bien)
    getKPIsMois                → table: reservation (SELECT fin_revenue, nights par proprio)
                               → table: ventilation (SELECT LOY)
                               → table: bien (SELECT count actif dcb)
    genererRapportHTML         → (local, pas de DB) — génère HTML avec template DCB
                                 images hero/logo : import ?inline Vite (base64 au build)
                                 heroSrc ← src/assets/rapport-hero.jpg?inline
                                 logoSrc ← src/assets/rapport-logo.png?inline
    envoyerRapportEmail        → smtp-send (Edge Function) via fetch SUPABASE_URL
  → /api/generate-pdf (Vercel Function Node.js)
      puppeteer-core + @sparticuz/chromium-min
      POST { html } → PDF A4 binaire (printBackground:true)
      Téléchargé directement : Rapport_NomBien_YYYY-MM.pdf
      1024MB RAM, 30s maxDuration (vercel.json)
  → llm-analyse (Supabase Edge Function)
      genererBloc(which) : 'analyse' | 'contexte' | 'tendances' | 'all'
      _genererAnalyse()   → SYSTEM_PROMPT + prompt performance mois + notePerso
      _genererContexte()  → SYSTEM_PROMPT + prompt météo/marché (sans notePerso)
      _genererTendances() → SYSTEM_PROMPT + prompt M+1/M+2 + resasFutures + meteoPrevisions
      'all' : séquentiel (analyse → contexte → tendances)
      Résultats sauvés dans bien_notes (note_analyse_llm, note_contexte, note_tendances)
  [rapports envoyés par email avec CC oihan@destinationcotebasque.com]
  [aperçu modal HTML via iframe srcDoc]
```

### Module Config (dropdown dans la nav)
```
Nav "Config" → dropdown avec 4 entrées : Import CSV, Journal, AEs, Paramètres
  (implémenté via ConfigDropdown dans App.jsx — useLocation pour active state)

PageConfig.jsx
  → ventilation.js (V1)   calculerVentilationMois — all-time depuis 2022
  → matching.js (ANCIEN)  lancerMatching — [⚠ moteur différent de PageRapprochement]
  → rapprochement.js      resetEtRematcher — depuis 2025 seulement
  → syncProprietaires.js  → evoliz-proxy
  → evoliz.js             → evoliz-proxy (pingEvoliz, getPaytermsEvoliz)
  → global-sync (Edge Function) :
      → API Hospitable (biens + réservations + payouts)
      → table: bien, reservation, reservation_fee, payout_hospitable
      → ventilation V2 inline [⚠ TVA_RATE et AIRBNB_FEES_RATE non définies → NaN]
      → matching inline [⚠ 3e copie du moteur de matching]
  [⚠ EVOLIZ_PUBLIC_KEY + EVOLIZ_SECRET_KEY affichées en clair dans le HTML]
```

### Portail AE (repo privé — architecture déduite)
```
dcb-portail-ae (React, repo privé)
  → Supabase Auth (login JWT)
  → table: auto_entrepreneur (SELECT profil via ae_user_id)
  → table: mission_menage (SELECT missions du mois)
  → table: ventilation (UPDATE montant_reel ⚠ si ligne inexistante → silencieux)
  → table: prestation_hors_forfait (INSERT)
  → api/ae-action.js → sync-ical-ae (sync calendrier)
```

---

## 3. Edge Functions Supabase — état réel

| Edge Function | Appelée depuis | Rôle | État |
|---|---|---|---|
| `create-ae-user` | PageAEs (via resetMdp) + api/ae-action.js | Crée compte Auth Supabase | ✅ Existe — sauvegarde `mdp_temporaire` (code path ✅, audit 30 mars) |
| `reset-ae-password` | api/ae-action.js (action=reset) | Reset mot de passe AE | ✅ Existe — sauvegarde `mdp_temporaire` (code path ✅, audit 30 mars) |
| `sync-ical-ae` | api/ae-action.js (action=sync) + sync-ical-cron | Parse iCal → mission_menage | ✅ Existe — pas de protection multi-match |
| `sync-ical-cron` | Cron Supabase | Sync iCal automatique tous les AEs | ✅ Existe — sans filtre actif=true |
| `global-sync` | PageConfig (lancerGlobalUpdate) | Sync totale all-time | ✅ Existe — **produit des NaN** (CF-C2) |
| `evoliz-proxy` | syncProprietaires.js + evoliz.js | Proxy vers API Evoliz | ✅ Existe |
| `hospitable-webhook` | Hospitable (événements temps réel) | Upsert réservations + avis | ✅ Existe — `handleReview` upsert dans `reservation_review` (30 mars). Appelle RPC `ventiler_toutes_resas` probablement inexistante. [✅ Confirmé fournisseur : si les financials changent, Hospitable déclenche un webhook réservation.] |
| `smtp-send` | rapportProprietaire.js | Envoi email SMTP OVH | ✅ Existe — denomailer@1.6.0. Supporte to/cc/subject/html/attachments. CC oihan@destinationcotebasque.com. |
| `ventiler_toutes_resas` | hospitable-webhook (RPC Postgres) | Ventilation post-webhook | 🔶 **Probablement inexistante** en base |

---

## 4. Tables Supabase — cartographie des accès

| Table | Créée par | Modifiée par | Lue par |
|---|---|---|---|
| `bien` | syncBiens / hospitable-webhook | PageBiens (inline) | ventilation.js, syncReservations, rapprochement.js, matching.js, importCSV.js |
| `proprietaire` | syncProprietaires (Evoliz) | evoliz.js (id_evoliz) | facturesEvoliz.js, getProprietaires |
| `reservation` | syncReservations / importCSV / webhook | ventilation.js, useOwnerStay, matching | getReservationsMois, facturesEvoliz, rapprochement |
| `reservation_fee` | syncReservations / importCSV / webhook | (DELETE+INSERT à chaque sync) | ventilation.js (calculs fees) |
| `ventilation` | ventilation.js V1 / global-sync V2 / webhook V3 | Portail AE (montant_reel), rapprochement (mouvement_id) | facturesEvoliz (codes), getRecapVentilation, rapprochement |
| `mouvement_bancaire` | importBanque / importBooking | rapprochement (statut), importBooking (statut+detail) | PageBanque, PageRapprochement, matching |
| `payout_hospitable` | syncReservations (Airbnb synthétique) / global-sync (schéma divergent) | rapprochement (mouvement_id) | matching.js, rapprochement.js, lancerMatchingAuto |
| `payout_reservation` | syncReservations / global-sync | fusionnerDoublons (❌ non migré) | rapprochement.js (liens payout↔résa) |
| `reservation_paiement` | rapprochement._lier / importBooking / importStripe | annulerRapprochement (DELETE) | getMouvementsMois (enrichissement), exportCSV |
| `booking_payout_line` | importBooking.js | (aucune mise à jour après insertion) | rapprochement.js (enrichissement passe 3) |
| `stripe_payout_line` | syncStripe.js | (aucune mise à jour après insertion) | rapprochement.js (enrichissement passe 3) |
| `facture_evoliz` | facturesEvoliz.js | facturesEvoliz.js (statut), evoliz.js (id_evoliz) | PageFactures |
| `facture_evoliz_ligne` | facturesEvoliz.js | (DELETE+INSERT à chaque génération) | PageFactures (affichage détail) |
| `facture_ae` | (❓ non localisé dans le code audité) | (❓) | facturesEvoliz.js (SELECT par bien+mois) |
| `auto_entrepreneur` | PageAEs (saveAutoEntrepreneur) | create-ae-user (ae_user_id), Portail (❓) | PageAEs, sync-ical-ae, sync-ical-cron |
| `mission_menage` | sync-ical-ae / sync-ical-cron | (aucune mise à jour — upsert seul) | Portail AE, PageBiens (codes iCal — non utilisé) |
| `prestation_hors_forfait` | Portail AE | PagePrestations (statut) | PagePrestations, App.jsx (badge count) |
| `prestation_type` | PageAEs (inline) | PageAEs (inline) | Portail AE (catalogue), PagePrestations |
| `bien_notes` | rapportProprietaire.js (saveBienNote) | rapportProprietaire.js (saveBienNote — upsert) | PageRapports, rapportProprietaire.js (getBienNote) |
| `reservation_review` | hospitable-webhook (handleReview — upsert) | hospitable-webhook (upsert) | PageRapports, rapportProprietaire.js (getReviewsMois) |
| `journal_ops` | journal.js (logOp) — quelques appels clés | (jamais modifiée) | PageJournal (getJournal — inclut import_log) |
| `import_log` | banque.js, syncBiens, syncReservations, global-sync | (jamais modifiée) | ✅ lue par `getJournal` (CF-J3) via merge avec journal_ops |
| `webhook_log` | hospitable-webhook | (jamais modifiée) | **Toujours non exposée dans PageJournal** |
| `expense` | (❓ non localisé dans le code audité) | (❓) | facturesEvoliz.js (SELECT type_expense=DCB) |

---

## 5. Flux de données entre services — diagramme textuel

> **Architecture CSV-first (décision d'architecture)**
> Le CSV Hospitable est désormais la source principale de données pour la comptabilité mensuelle. L'API et les webhooks sont des sources secondaires d'enrichissement — non bloquantes pour la cohérence comptable.
>
> **Note de validation fournisseur Hospitable**
> - `/v2/reservations?include=financials` reste l'endpoint correct pour l'enrichissement secondaire via API
> - `financials` et `financialsV2` sont équivalents en pratique
> - L'API fournit des line items financiers bruts — pas de totaux métier consolidés
> - `ventilation.js` V1 reste la couche légitime pour calculer le revenu net, catégoriser et transformer en codes comptables — quelle que soit la source d'entrée (CSV ou API)
> - Les webhooks Hospitable peuvent alimenter la même logique que la sync API en cas d'ajustement financier
> - **Les webhooks ne sont pas garantis** — un fallback de sync (CSV ou API) reste obligatoire
>
> **Ces confirmations ne remettent pas en cause les critiques documentées sur la duplication de la logique de ventilation (3 versions — cf. section 9).**


```
[SOURCE PRINCIPALE — référence de clôture mensuelle]
CSV Hospitable
    └─ importCSV.js ──→ reservation + reservation_fee
                     ──→ fusionnerDoublons
                               │
                               ▼
                         ventilation.js (V1) ──→ ventilation (HON,FMEN,AUTO,LOY,VIR,TAXE)
                                                       │
[SOURCE SECONDAIRE — enrichissement, non bloquant]     │
Hospitable API (/v2/reservations, /v2/properties, /v2/payouts)
    └─ syncReservations.js ──→ reservation + reservation_fee + payout_hospitable
    │                          (enrichissement ou correction post-CSV)
    │
    └─ hospitable-webhook ──→ reservation (ajustement temps réel)
                          ──→ ventilation V3 (RPC ❓)
                          [⚠ webhooks non garantis — fallback sync obligatoire]
                                                            │
                                                            ▼
CSV Caisse d'Épargne                                rapprochement.js
    └─ importBanque.js ──→ mouvement_bancaire ──────────────▲
                                                             │
CSV Booking                                                  │
    [détaille la composition des virements Booking :         │
     identifie quelles réservations composent un payout,     │
     permet la décomposition des virements pour le           │
     rapprochement bancaire]                                  │
    └─ importBooking.js ──→ booking_payout_line ────────────┘
                        ──→ mouvement_bancaire (statut)

API Stripe / syncStripe.js
    [source des paiements directs — alimente le rapprochement
     des virements Stripe et la ventilation des paiements directs]
    └─ stripe_payout_line ──────────────────────────────────┘
                                                             │
                                                             ▼
                                                    ventilation.mouvement_id mis à jour
                                                    reservation.rapprochee = true

Portail AE — [IMPLÉMENTÉ]
    └─ saisie heures ──→ ventilation.montant_reel
                          (correction de la ventilation initiale :
                           AUTO réel remplace la provision)
                          [⚠ silencieux si ventilation non calculée]

Portail AE — [FLUX MÉTIER CIBLE — non encore implémenté]
    └─ prestation validée ──→ [cible] ventilation (code EXTRA)
                                        impact sur LOY / facturation propriétaire
    └─ achat HAOWNER ──────→ [cible] ventilation / facturation
                                        impact explicite sur reversement propriétaire
                          [prestation_hors_forfait : deduction_loy et haowner intégrés ✅]
                          [dcb_direct et debours_proprio : toujours sans impact comptable ⚠]

ventilation enrichie (AE réel + EXTRAS + HAOWNER si implémentés)
    └─ facturesEvoliz.js ──→ facture_evoliz + facture_evoliz_ligne
                          ──→ genererFactureProprietaire (honoraires) + genererFactureDebours (débours AE)
                          [prestation_hors_forfait deduction_loy / haowner lus ✅]
                               │
                               ▼
                         evoliz-proxy ──→ Evoliz API (irréversible)
```

---

## 6. Points d'entrée du système

Chaque action utilisateur déclenche une chaîne précise de fonctions et d'effets en base. Ce tableau est la référence pour comprendre l'impact réel de chaque bouton.

| Action utilisateur | Page | Fonction appelée | Tables écrites | Effets secondaires |
|---|---|---|---|---|
| ⊙ Sync Hospitable | PageRéservations | `syncReservations.js` | `reservation`, `reservation_fee`, `payout_hospitable`, `payout_reservation` | Upsert — écrase fin_revenue si changé |
| ⚡ Ventiler | PageRéservations | `ventilation.js` → `calculerVentilationMois` | `ventilation` (DELETE+INSERT), `reservation` (ventilation_calculee=true) | Irréversible sans reset manuel — ne recalcule pas les resas déjà ventilées |
| ↺ Sync payouts | PageRapprochement | `rapprochement.js` → `syncPayoutsHospitable` | `payout_hospitable`, `payout_reservation` | Peut écraser des payouts déjà matchés (ignoreDuplicates:false) |
| ⚡ Matching auto | PageRapprochement | `rapprochement.js` → `lancerMatchingAuto` | `mouvement_bancaire`, `payout_hospitable`, `ventilation`, `reservation` | Moteur NOUVEAU — résultats différents du matching Config |
| Lier (manuel) | PageRapprochement | `rapprochement.js` → `matcherManuellement` | `mouvement_bancaire`, `ventilation`, `reservation`, `reservation_paiement` | Loggé dans `journal_ops` (seul appel logOp du projet) |
| Inconnu | PageRapprochement | inline Supabase | `mouvement_bancaire` (statut=non_identifie) | Aucun nettoyage des tables liées |
| Annuler rapprochement | PageRapprochement | `rapprochement.js` → `annulerRapprochement` | `ventilation`, `reservation`, `payout_hospitable`, `reservation_paiement` | Ne nettoie pas `stripe_payout_line` ni `booking_payout_line` (🔶) |
| ↑ Import CSV | PageBanque | `importBanque.js` → `importerMouvementsBancaires` | `mouvement_bancaire` | Importe tous les mois du fichier si moisSelectionnes non passé (⚠ CF-BQ6) |
| 🗑 Supprimer mouvement | PageBanque | DELETE inline Supabase | `mouvement_bancaire` | ⚠ N'écrit PAS ventilation/reservation/payout — orphelins garantis (CF-BQ1) |
| ⚡ Générer factures | PageFactures | `facturesEvoliz.js` → `genererFacturesMois` | `facture_evoliz` (honoraires + débours), `facture_evoliz_ligne` | Gèle montant_reversement (honoraires). Crée facture débours si AUTO à facturer. deduction_loy et haowner intégrés ✅. dcb_direct et debours_proprio ignorés ⚠. |
| ✓ Valider facture | PageFactures | `facturesEvoliz.js` → `validerFacture` | `facture_evoliz` (statut=valide) | Silencieux si statut ≠ brouillon (CF-F6) |
| → Pousser vers Evoliz | PageFactures | `evoliz.js` → `pousserFacturesMoisVersEvoliz` | `facture_evoliz` (id_evoliz, statut=envoyee), `proprietaire` (id_evoliz) | ⚠ IRRÉVERSIBLE côté Evoliz — doublon si Supabase update échoue (CF-F2) |
| ⚡ Global Update | PageConfig | `global-sync` Edge Function (chunks 3 mois) | `bien`, `reservation`, `reservation_fee`, `payout_hospitable`, `ventilation` | ⚠ Produit des NaN (CF-C2) — schéma payout divergent (CF-C4) — non idempotent |
| ⚡ Ventilation+Matching all-time | PageConfig | `ventilation.js` V1 + `matching.js` (ANCIEN) | `ventilation`, `mouvement_bancaire`, `reservation` | Moteur matching différent de PageRapprochement (⚠ CF-C3) |
| ⚡ Re-matching complet | PageConfig | `rapprochement.js` → `resetEtRematcher` | `ventilation`, `reservation`, `payout_hospitable`, `mouvement_bancaire` | Depuis 2025 seulement — écrase les rapprochements manuels |
| + Créer accès AE | PageAEs | `create-ae-user` Edge Function | `auto_entrepreneur` (ae_user_id, mdp_temporaire) | ✅ mdp_temporaire sauvegardé (code path ✅, audit 30 mars) |
| 🔑 Reset mdp | PageAEs | `reset-ae-password` Edge Function | `auto_entrepreneur` (mdp_temporaire) | ✅ Edge Function existe — sauvegarde mdp_temporaire (code path ✅, audit 30 mars) |
| 📧 Envoyer rapport | PageRapports | `rapportProprietaire.js` → `smtp-send` | `bien_notes` (SELECT), `reservation_review` (SELECT) | Email HTML avec CC oihan@. Aperçu modal avant envoi. |
| Sync iCal (AE) | PageAEs / Portail | `sync-ical-ae` Edge Function | `mission_menage` | Pas de protection contre les correspondances ical_code multiples |
| ✓ Valider prestation | PagePrestations | UPDATE inline Supabase | `prestation_hors_forfait` (statut=valide) | Impact sur factures pour types deduction_loy et haowner ✅. Aucun impact pour dcb_direct et debours_proprio ⚠. Aucun impact sur ventilation (code EXTRA absent). |
| Importer CSV Hospitable | PageImport | `importCSV.js` → `importHospitableCSV` | `reservation`, `reservation_fee` (DELETE+INSERT sans transaction ⚠) | `fusionnerDoublons` ne migre pas `reservation_paiement` ni `payout_reservation` |

---

## 7. Source dominante en cas de conflit

Quand plusieurs sources contiennent des données contradictoires pour la même entité, la règle de priorité est la suivante :

| Donnée | Source dominante | Sources secondaires | Règle |
|---|---|---|---|
| Revenu réservation (`fin_revenue`) | **CSV Hospitable** (référence de clôture mensuelle) | Hospitable API (enrichissement secondaire), `hospitable_raw` (fallback) | CSV fait foi pour la clôture — API/webhook : enrichissement non bloquant. En cas de divergence, le CSV prime sauf intervention explicite |
| Fees détaillés | `reservation_fee` (table) | `hospitable_raw.financials` (JSON) | reservation_fee est prioritaire si non vide ; sinon fallback raw |
| Codes comptables (HON, FMEN…) | `ventilation` calculée par V1 | V2 (global-sync, NaN), V3 (webhook, RPC ?) | V1 est la référence — mais aucun mécanisme n'empêche V2/V3 d'écraser |
| Taux de commission | `bien.taux_commission_override` | `proprietaire.taux_commission` → 25% défaut | Override bien > proprio > défaut — ordre de priorité explicite dans ventilation.js |
| Lien mouvement ↔ réservation | `ventilation.mouvement_id` | `reservation.rapprochee`, `payout_hospitable.mouvement_id` | mouvement_id est la source primaire — rapprochee est un dérivé |
| Montant reversement | `facture_evoliz.montant_reversement` | `ventilation` (recalcul possible) | Gelé à la génération — périmé si reventilation après sans régénération |
| Facture légale | Evoliz (après push) | `facture_evoliz` Supabase | Evoliz est irréversible et fait foi légalement — Supabase est le brouillon |
| Payout Hospitable | Inséré par `syncReservations.js` (frontend) | Inséré par `global-sync` (schéma divergent) | ⚠ Conflit actif : `mois_comptable` vs `mois_payout` selon la voie — le matching frontend ne trouve pas les payouts de global-sync |
| Statut réservation (`final_status`) | Webhook Hospitable (temps réel) | CSV import (fallback 'accepted') | ⚠ Webhook peut mettre 'cancelled', CSV peut écraser avec 'accepted' si reimporté |

---

## 8. Zones critiques prioritaires

Hiérarchie des parties du système les plus sensibles, par ordre de risque métier décroissant.

### Niveau 1 — Impact immédiat sur les données financières

**global-sync (Edge Function)**
Opération all-time qui touche toutes les tables financières. Produit activement des NaN en base (CF-C2). *(NaN = valeur numérique invalide, "Not a Number" — un calcul comptable produit un montant inexploitable, ce qui corrompt la ventilation, les factures et les reversements.)* Schéma payout divergent (CF-C4). Non idempotente. **Ne pas utiliser sans correction préalable de CF-C2.**

**Logique de ventilation (3 versions)**
Cœur du système. Toute erreur ici se propage dans toutes les factures et reversements. V2 (global-sync) est cassée. V3 (webhook) est probablement inopérante. Seule V1 est fiable. **Toute modification doit être propagée dans les 3 versions.**

**Matching bancaire (2 moteurs)**
Un matching incorrect marque des réservations comme rapprochées à tort, ou laisse des virements non associés. Les deux moteurs coexistent sans mécanisme de cohérence. **Résultats peuvent diverger selon le bouton utilisé.**

### Niveau 2 — Impact sur la facturation

**Génération des factures**
Point de non-retour opérationnel. Gèle `montant_reversement`. **Actuellement** : ignore les prestations validées et les achats HAOWNER. **État cible** : la ventilation doit être enrichie (EXTRAS, HAOWNER) avant génération pour que les factures soient complètes. Une reventilation post-génération ne se reflète pas sans régénération manuelle.

**Push vers Evoliz**
Point de non-retour légal. Irréversible. Un second push crée un doublon. Aucune idempotence.

**Suppression de mouvements bancaires**
Opération destructrice sans nettoyage des tables liées. Crée des orphelins silencieux qui faussent les compteurs et les rapprochements futurs.

### Niveau 3 — Impact sur l'intégrité des données

**Import CSV Hospitable**
Pas de transaction entre DELETE fees et INSERT fees. Une réservation peut se retrouver sans fees après un crash — la ventilation produira alors des valeurs incorrectes.

**Accès portail AE**
Chaîne d'authentification brisée. Si les AEs ne peuvent pas se connecter, les heures réelles ne sont jamais saisies et les factures utilisent les provisions à la place du réel.

**Prestations hors forfait**
Module validé dans l'UI mais sans effet comptable. Les prestations validées disparaissent comptablement. Risque de sur-reversement propriétaire.

---

## 9. Logique dupliquée — risque structurel formalisé

**Le système contient plusieurs logiques métier dupliquées et non synchronisées.** Cette duplication n'est pas accidentelle — elle résulte de l'ajout progressif de voies d'exécution (frontend, Edge Functions, webhook) sans refactoring du code commun vers une source unique.

**Conséquence structurelle** : toute correction d'un bug dans une copie laisse les autres copies dans leur état bugué. Les trois voies peuvent produire des résultats différents pour la même réservation selon le déclencheur utilisé. Il n'existe aucun mécanisme de détection de divergence ni de test de cohérence entre les copies.

| Logique dupliquée | Nombre de copies | Copies et localisation | État de synchronisation |
|---|---|---|---|
| `calculerVentilationResa` | 3 | ventilation.js (V1) / global-sync (V2) / hospitable-webhook (V3) | ❌ Non synchronisées — V2 cassée (NaN), V3 probablement inopérante |
| Moteur de matching bancaire | 2 + 1 inline | matching.js / rapprochement.js / global-sync | ❌ Non synchronisées — logiques différentes, résultats divergents |
| Génération liste mois all-time | 2 | PageConfig (lancerVentMatcher) / PageConfig (lancerGlobalUpdate) | ⚠ Identiques actuellement — risque si l'une évolue sans l'autre |

**Règle à respecter avant toute modification d'une logique dupliquée** : identifier toutes les copies, évaluer l'impact de la correction sur chacune, et appliquer la correction dans toutes les copies concernées.

---

*Fichier généré dans le cadre de l'audit structurel DCB Compta — mars 2026.*
*Ne pas modifier sans relecture du code source.*
