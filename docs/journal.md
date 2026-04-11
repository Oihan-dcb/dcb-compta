# DCB Compta — Journal session 07 avril 2026

## Formules ventilation Direct — correction majeure

### Problème : LOY Direct incorrect (HOST-9HAQHD Ibaneta)
Analyse du statement Hospitable pour HOST-9HAQHD :
- Commissionable base = 299,47€ ✅ (= accommodation 304€ + hostServiceFee −4,53€)
- Reservation commissions = 71,87€ ✅ (= commissionableBase × 0.24)
- **Total owner fees = 1,02€** → manquait dans le calcul
- Net owner income = 228,62€ cible → notre calcul = 227,60€ (écart = 1,02€)

### Correction 1 — commissionableBase unifiée toutes plateformes
Ancienne formule Direct : `revenue − cleaningFee − communityFee − managementFee − taxes + discounts`  
Nouvelle formule (toutes plateformes) : `accommodation + hostServiceFee + discountsTotal`
- Prouvé sur réels : Direct 304−4,53=299,47 ✓ | Booking 152,45−37,87=114,58 ✓

### Correction 2 — ownerFees (nouveau concept, réservations Direct uniquement)
Les "Total owner fees" Hospitable = portion de la platform fee (hostServiceFee) reversée pro-rata de chaque guest fee, nette de commission DCB :
```
totalFeesForOwnerRate = accommodation + Σ guestFees
ownerFees = Σ_i round(|hostServiceFee| × fee_i / totalFeesForOwnerRate × (1 − taux))
```
Vérifié HOST-9HAQHD : management(24) + community(76) + resort(2) = 102¢ = 1,02€ ✓

### Correction 3 — LOY Direct
Ancienne : `commissionableBase − honTTC + platformRemb(feesDirectBruts/1.0077)`  
Nouvelle : `commissionableBase − honTTC + ownerFees`
- `platformRemb` Direct supprimé (concept 0,77% Hospitable abandonné)

### Correction 4 — menLabelsToExclude
Ajout de `'resort fee'` : `['management fee', 'host service fee', 'resort fee']`
- Resort fee est une taxe de lieu, pas un vrai ménage — ne doit pas aller dans MEN

## Patches global-sync alignés avec ventilation.js

La Edge Function `global-sync/index.ts` contenait une copie divergente de la logique de ventilation. 4 patches appliqués (via Python byte-level — fichier UTF-8 double-encodé) :
1. `commissionableBase` unifié toutes plateformes
2. Bloc `platformRembourseMenage` Direct supprimé
3. LOY Direct → `commissionableBase − honTTC + ownerFees`
4. `menLabelsToExclude` + `resort fee`

**global-sync V2 est maintenant alignée avec ventilation.js V1.** Bouton Global Update ré-activable.

## Bug HOST-A8NEDM (Jonathan Frydman) — FK RESTRICT silencieuse

### Diagnostic
- `ventilation_calculee = false`, seule une ligne AUTO en base (updated_at 2026-04-02)
- Cause : `mission_menage.ventilation_auto_id_fkey` était en `RESTRICT`
- Quand ventilation supprime les lignes ventilation pour recalcul, le DELETE échoue (code 23503)
- L'erreur était ignorée silencieusement (pas de `const { error }` sur le DELETE)
- 22 réservations affectées

### Fix immédiat — code
Ajout du déliaison manuelle avant DELETE dans `ventilation.js` et `global-sync` :
```js
await supabase.from('mission_menage')
  .update({ ventilation_auto_id: null })
  .eq('reservation_id', resa.id)
  .not('ventilation_auto_id', 'is', null)
```

## Migration FK — ON DELETE SET NULL (002)

### Migration appliquée en prod (migration 002)
```sql
ALTER TABLE mission_menage
  DROP CONSTRAINT IF EXISTS mission_menage_ventilation_auto_id_fkey,
  ADD CONSTRAINT mission_menage_ventilation_auto_id_fkey
    FOREIGN KEY (ventilation_auto_id)
    REFERENCES ventilation(id)
    ON DELETE SET NULL;
```
Application : `supabase migration repair 001 --status applied` puis `supabase db push`.

### Code simplifié
Le bloc manuel de déliage FK supprimé de `ventilation.js` et `global-sync/index.ts`.  
Postgres gère maintenant le NULL automatiquement lors du DELETE ventilation.

## Reste à faire
- Relancer ⚡ Ventiler sur les réservations Direct mars 2026 (HOST-9HAQHD, HOST-A8NEDM et autres)
- Valider les montants LOY sur statement Ibaneta après recalcul

---

# DCB Compta — Journal session 02 avril 2026 — Bilan complet

## Rapport propriétaire — opérationnel

- Phases 1–4 `prestation_hors_forfait` → PDF complètes ✅
- Colonnes HON / LOY / VIR dans tableau réservations ✅
- Section débours (DEB_AE / HAOWNER) dans le rapport PDF ✅
- Aperçu mail avant envoi + case PDF Evoliz optionnel ✅
- **Premier rapport envoyé avec succès** : BURGY 602, mars 2026 ✅

## Corrections comptables

- Taux FMEN Airbnb corrigé : 16,21 % → 13,95 % ✅
- AUTO supprimé du reversement propriétaire (LOY) ✅
- Footer email : `oihan@` → `rapports@destinationcotebasque.com` ✅
- `&nbsp;` supprimés dans HTML email → fin des `=20` en quoted-printable ✅

## Evoliz — push opérationnel

- Refs HON / FMEN / DIV configurées ✅
- Paiement automatique au push ✅
- Encodage UTF-8 correct ✅

## Sécurisation tokens

- Tokens révoqués : `sbp_b707...` (Supabase) + `ghp_lnjT...` (GitHub) ✅
- Remote GitHub mis à jour avec nouveau token ✅
- `DCB_MANAGEMENT_TOKEN` configuré dans Supabase secrets (hors code source) ✅
- Edge Function `update-smtp-secrets` créée et déployée sur `omuncchvypbtxkpalwcr` ✅
- `sauvegarderSMTP()` passe désormais par la Edge Function — aucun token dans `src/` ✅

## Reste à faire

- Classification Evoliz : IDs comptes à récupérer
- Factures mars restantes à valider et pousser vers Evoliz
- Tester bouton Sauvegarder PageConfig SMTP en prod (Vercel)
- Fix `ctrl_ventilation_vs_revenu_ok` dans `exportCSVComptable.js`
- CF-PAE1 / PAE2 à confirmer
- Supprimer test AE record `id: 19a27f7a`

### Reste à faire
- Tester l'envoi SMTP une fois `SMTP_PASS` configuré dans les secrets Supabase

---

# DCB Compta — Journal session 22 mars 2026 (partie 10)

## Bugs résolus
- prestation_type en triple en base (15 lignes) : DELETE + réinsertion 5 types propres
- RLS manquante sur prestation_type, taux_ae_prestation, prestation_hors_forfait : policies créées
- facture_ae supprimée (inutilisée)
- AIRBNB_FEES_RATE 0.1395 → 0.1621 (16.21%)
- charger() redondant après ajouterPrestation/syncICal : rechargement missions local uniquement
- Responsive mobile portail : font-size 16px anti-zoom iOS, flex-wrap, padding

## Nouvelles fonctionnalités
- Flag AUTO réel vs provision dans TableReservations (🔴/🟢 + tooltip)
- Edge Function update-ventilation-auto : montant_reel sur AUTO et FMEN
- Balance mensuelle AUTO/FMEN dans PageAutoEntrepreneurs
- Export CSV Rapprochement avec n° virements + réservations

## Charte graphique
- Zéro bleu — palette or/crème/brun sur les deux apps
- --brand #CC9933, --bg #F7F3EC, header nav #EAE3D4 + filet 2px or
- Police logo : Northwell (fichier .ttf à re-uploader en session suivante)
- Référence : docs/charte-graphique.md

## Documentation
- Guide d'utilisation complet Word (33 pages) : DCB_Compta_Guide_Utilisation.docx

## Pending
- Favicons Option A Northwell (re-uploader .ttf)
- Sprint C : facturation Evoliz (bouton tout valider + test push)
- Supprimer AE TEST id: 19a27f7a-4ab2-4b80-a96a-9179a0fb011f

# DCB Compta — Journal session 1 avril 2026

## Contexte
Suite directe de la session précédente — module Rapport Mensuel Propriétaires.
Focus : LLM 3 blocs, mise en page PDF, génération PDF serveur.

## Nouvelles fonctionnalités

### Génération PDF via Puppeteer (Vercel Function)
- `api/generate-pdf.js` créé — Vercel Function Node.js avec `puppeteer-core` + `@sparticuz/chromium-min`
- Reçoit le HTML du rapport en POST, rend un vrai PDF A4 (`printBackground:true`), renvoie le fichier `.pdf`
- Plus de dépendance à `window.print()` / boîte de dialogue navigateur
- Fichier téléchargé directement : `Rapport_NomBien_YYYY-MM.pdf`
- Bouton PDF affiche `⏳ Génération...` pendant l'appel Puppeteer
- `vercel.json` mis à jour : 1024MB RAM, 30s max pour `api/generate-pdf.js`

### LLM — 3 blocs distincts (refonte)
- `genererBloc(which)` : génère l'un des 3 blocs ou les 3 en séquence
- `_genererAnalyse()` : performance du mois, notePerso incluse
- `_genererContexte()` : météo + marché Biarritz, sans notePerso
- `_genererTendances()` : M+1/M+2, résas futures, météo prévisions
- `SYSTEM_PROMPT` partagé entre les 3 blocs (gestionnaire d'actif, 3ème personne)
- Bouton "Tout générer" exécute les 3 en séquence (non parallèle — _tendances dépend des états précédents)

### Images PDF — Vite ?inline
- `src/assets/rapport-hero.jpg` et `rapport-logo.png` ajoutés (255KB + 52KB)
- `import heroSrc from '../assets/rapport-hero.jpg?inline'` dans `rapportProprietaire.js`
- Plus de fetch runtime, plus de `rapportAssets.js`, plus d'`imgToBase64`
- Images encodées base64 par Vite au build — disponibles dans le bundle dès le démarrage

## Bugs résolus

### Bug LLM — `_genererTendances` silencieusement vide
- `nextMoisLabel`, `nextNextMoisLabel`, `totalNuitsFutures`, `meteoPrevisions` n'étaient pas définis dans `genererBloc` → `undefined` dans le prompt → LLM retournait texte vide ou erreur avalée par `catch`
- Fix : variables calculées depuis `m1`/`m2` après la requête `resasFutures`
- Fix : `which === 'all'` passe de `Promise.all` à séquentiel (`await _genererAnalyse()` → `_genererContexte()` → `_genererTendances()`)

### Bug PDF — coupures de page au milieu des sections
- `page-break-inside: avoid; break-inside: avoid` ajouté sur `.section-kpis`, `.section-synthese`, `.section-analyse`, `.section-sejours`, `.section-avis`, `.section-contexte`, `.section-perspectives`, `table`, `.avis-block`, `.kpi-grid`, `p`
- Classes CSS ajoutées sur chaque div section dans le template HTML

### Bug PDF — images invisibles à l'impression
- Diagnostic : images bien dans le bundle (base64 via Vite), problème = rendu navigateur en print mode
- `print-color-adjust: exact !important` ajouté inline sur hero img, logo img, et container
- `overflow:hidden` retiré du container hero (Safari l'ignore en print)
- `height:230px` explicite sur l'img hero (au lieu de `height:100%` relatif)
- `img[src^="data:"] { display:block !important; visibility:visible !important; opacity:1 !important }` dans `@media print`
- Solution finale : Puppeteer rend le HTML en headless Chrome → PDF propre, indépendant du navigateur

### Bug PDF — `telechargerPDF` iframe et timing
- Remplacé `setTimeout(800ms)` par attente explicite `img.complete && naturalWidth > 0` via `Promise.all` + 2× `requestAnimationFrame`
- Puis supprimé entièrement au profit de l'appel Puppeteer

## État des variables LLM dans genererBloc
```
m1 = nextMoisStr(mois)          // ex: 2026-05
m2 = nextMoisStr(m1)            // ex: 2026-06
nextMoisLabel   = MOIS_FR[m1mo-1] + ' ' + m1yr   // "Mai 2026"
nextNextMoisLabel = MOIS_FR[m2mo-1] + ' ' + m2yr // "Juin 2026"
totalNuitsFutures = resasFutures.reduce(nights)
meteoPrevisions = meteoFutur || 'Données météo non disponibles...'
```

## Pending
- Tester la Vercel Function `generate-pdf` en production (cold start ~15-20s au premier appel)
- Favicons Option A Northwell (re-uploader .ttf)
- Supprimer AE TEST id: 19a27f7a-4ab2-4b80-a96a-9179a0fb011f

# DCB Compta — Journal session 1 avril 2026 (suite — PDF header & glyphes)

## Bugs résolus / Améliorations

### Glyphes Puppeteer
- Tous les Unicode remplacés par SVG inline dans `rapportProprietaire.js` :
  - `★`/`☆` → `SVG.starFull()` / `SVG.starEmpty()` (polygon SVG)
  - `↑`/`↓` → `SVG.arrowUp()` / `SVG.arrowDown()` (polygon SVG)
  - Objet `SVG` avec helpers `starFull`, `starEmpty`, `arrowUp`, `arrowDown`, `stars(rating, size)`

### Chromium Puppeteer
- `@sparticuz/chromium-min` remplacé par `@sparticuz/chromium` (complet)
- `page.setBypassCSP(true)` + `page.emulateMediaType('print')`
- Fallback `setTimeout(resolve, 3000)` sur les images

### Avis voyageurs
- Limite `slice(0,3)` / `slice(0,5)` supprimée → tous les avis dans le PDF et le prompt LLM
- Troncature `substring(0,150/180)` supprimée → texte complet des commentaires

### Header hero — refonte itérative
- Logo et titre séparés en deux blocs `position:absolute` indépendants
- Titres centrés verticalement dans la zone haute (`bottom:175px`)
- `white-space:nowrap` sur les deux lignes de texte (fix retour à la ligne lettre par lettre)
- Logo : 200px, `bottom:-2px` (déborde légèrement sous l'image hero, au-dessus des KPIs)
- `letter-spacing` réduit sur tous les éléments (compatibilité Puppeteer)

## État final du header hero
```
┌──────────────────────────────────────┐  ← hero 230px
│  [photo + gradient overlay]          │
│                                      │
│    RAPPORT MENSUEL · MARS 2026       │  ← bottom:175px, nowrap
│    BURGY — 602 "Horizonte"           │
│                                      │
│         [Logo DCB 200px]             │  ← bottom:-2px, centré
├──────── Base ── Honoraires ── Rev. ──┤  ← bande KPIs
└──────────────────────────────────────┘
```

## Pending
- Tester génération PDF Puppeteer en prod (cold start ~15-20s)
- Favicons Northwell
- Supprimer AE TEST id: 19a27f7a-4ab2-4b80-a96a-9179a0fb011f

---

## Migration SMTP OVH → Resend API — 05/04/2026

### Contexte
L'envoi d'emails via OVH SMTP (denomailer) provoquait des `Load failed` / `502` côté navigateur malgré l'envoi effectif des mails. Cause prouvée par logs Supabase : `UnexpectedEof: peer closed connection without sending TLS close_notify` — le serveur OVH coupait la session TLS sans fermeture propre.

### Ce qui a changé
- `smtp-send/index.ts` : denomailer supprimé → fetch natif vers API REST Resend
- Domaine expéditeur vérifié : `mail.destinationcotebasque.com`
- From : `rapports@mail.destinationcotebasque.com`
- Secret Supabase : `RESEND_API_KEY` (secrets OVH SMTP_HOST/PORT/USER/PASS/FROM supprimés)
- `PageConfigSMTP.jsx` supprimé (config OVH obsolète)
- Lien nav "Email SMTP" et route `/config-smtp` supprimés de `App.jsx`
- Front : gestion `envoi_incertain` (erreur réseau post-envoi) dans `PageRapports.jsx` + `rapportProprietaire.js`

### Résultat
- `{ ok: true, id: "..." }` confirmé en prod avec domaine vérifié ✅
- Load failed résolu définitivement ✅

---

## Session fixes UX & métier — 10/04/2026 (suite)

### Fixes déployés

**1. Réservations manuelles annulées — édition fin_revenue**
- `ModalResa.jsx` : bouton ✏️ sur "Revenue net" pour les resas `platform=manual`
- Sauvegarde : supprime ventilation + update `fin_revenue` + reset `ventilation_calculee=false`
- Mise à jour optimiste de la ligne dans le tableau (state local avant rechargement)
- Vérification erreur Supabase avec `.select()` pour détecter les blocages RLS

**2. Owner stay batch ventilation**
- `ventilation.js` `calculerVentilationMois` : suppression du filtre `.eq('owner_stay', false)`
- Les resas `owner_stay=true` sont maintenant incluses dans le batch ⚡ Ventiler
- `calculerVentilationResa` gère déjà le cas `owner_stay` (FMEN = fin_revenue - AUTO provision)

**3. gross_revenue owner_stay dans rapport**
- `buildRapportData.js` : `gross_revenue: r.owner_stay ? 0 : ...`
- Évite que le fin_revenue du ménage proprio apparaisse dans la colonne "Brut voyageur"

**4. Frais type Remboursement**
- Nouveau `mode_traitement = 'remboursement'` dans `frais_proprietaire`
- HT sans TVA (HT = TTC), montant positif — vient **augmenter** le LOY/reversement
- `buildRapportData.js` : remboursement = négatif dans `fraisDeductionLoy` → augmente `virementNet`
- `facturesEvoliz.js` : `remboursementsTotal` ajouté au `montantReversement`
- `rapportStatement.js` : lignes vertes `+ montant` dans bloc Reversement
- `PageRapports.jsx` : typeLabel "Remboursement" en vert dans section Débours & frais
- Contrainte DB ajoutée via SQL Editor : `CHECK (mode_traitement IN ('deduire_loyer','facturer_direct','remboursement'))`

**5. Ordre LOY → Taxe → VIR dans statement PDF**
- Ancien affichage : VIR puis Taxes de séjour → double comptage apparent
- Nouveau : LOY (réversement net) → Taxe de séjour → VIR (= LOY + taxes) → Remboursements → Débours → Total

**6. Cascade mois prestation AE**
- `PagePrestationsAE.jsx` `sauvegarderModif` : update `mois = date_prestation.slice(0,7)`
- Quand une date est changée vers avril, la prestation disparaît de mars et apparaît en avril

**7. MoisSelector — mois actif toujours présent**
- `MoisSelector.jsx` : si `mois` n'est pas dans `moisDispos`, il est ajouté automatiquement
- Fix global — s'applique à toutes les pages avec MoisSelector

**8. Persistance mois globale — pages manquantes**
- `PageFraisProprietaire.jsx` et `PagePrestationsAE.jsx` ajoutés à `useMoisPersisted`
- Toutes les pages principales partagent maintenant `dcb_mois_courant` via localStorage


---

## Session fixes — 11/04/2026

### Fixes déployés

**1. Factures — frais facturés inclus dans la régénération** (bugs a75de0a5, 80a81fe5)
- Cause : `facturesEvoliz.js` filtrait `.eq('statut', 'a_facturer')` sur les frais déductibles et directs. Un frais déjà facturé (`statut='facture'`) disparaissait de la facture régénérée.
- Fix : `.in('statut', ['a_facturer', 'facture'])` pour `fraisDeduire` et `fraisDirect`
- Cas concrets : étendoir ALAÏAPINONCELY (63,58€) et serpillère EKIAWALLAERT (21€) réapparus en 2026-03

**2. Frais propriétaires — suppression accessible depuis statut `a_facturer`** (bug 1c48394a)
- Avant : bouton 🗑 disponible uniquement pour `statut='brouillon'`
- Fix : `PageFraisProprietaire.jsx` — delete autorisé pour `brouillon` ET `a_facturer`

**3. Vision Staff — table récap + provision/réel par AE + export CSV** (bugs f02bd5b9, ce240b71)
- `PageAutoEntrepreneurs.jsx` :
  - Table récap globale : nb ménages, provision (duree×taux), réel (Σmontant), écart, % total
  - Header de chaque card AE : provision/réel/écart affichés
  - Bouton export CSV par AE (en plus du global)
  - Bien joint sur la requête `mission_menage` (was: code bien affiché `—`)

**4. Rapprochement — VIR résiduel préservé après recalcul ventilation** (bug f6202cdf)
- Cause profonde : `ventilation.js` sauvegardait UN seul `mouvement_id` par code avant suppression. Après recalcul, le VIR résiduel (créé par `_lier` pour le solde partiel) était détruit ; la réservation se retrouvait `rapprochee=true` mais avec solde non encaissé.
- Fix `ventilation.js` : après restauration du `mouvement_id` principal, si `fin_revenue - Σcredits_liés > 100`, un VIR résiduel est recréé automatiquement et `rapprochee=false`
- Fix données : VIR résiduel 15€ inséré manuellement pour HMW5JNT3DZ (Marlène Noguez, 2026-03)

**5. RLS `mission_menage` — ménages visibles dans dcb-compta**
- Cause : la table avait uniquement une policy AE-auth (portail). La clé anon (dcb-compta) ne voyait aucune ligne même après sync réussie via service_role.
- Fix : migration `007_mission_menage_anon_select.sql` — `CREATE POLICY "anon_can_select_mission_menage" ON mission_menage FOR SELECT TO anon USING (true)`
- Vérifié : missions visibles immédiatement après `supabase db push`

**6. Vision Staff — majuscules corrigées**
- Cause : règle CSS globale `th { text-transform: uppercase }` (App.css l.42) s'appliquait aux `<th>` de la table récap inline
- Fix : `textTransform: 'none'`, `fontSize: 13`, `color: var(--text)` en inline sur chaque `<th>`

### Fixes déployés (suite session 11/04/2026)

**7. VIR en doublon par réservation — rapport affichait 15€ au lieu de 132€** (bug fcdb37eb)
- Cause : `buildRapportData.js` construisait `ventByResa` en last-write-wins pour tous les codes y compris VIR. Après le fix VIR résiduel (fix 4), HMW5JNT3DZ avait deux lignes VIR (11728 + 1500 centimes, chacune liée à un mouvement bancaire distinct). Seule la dernière (1500 = 15€) survivait dans `ventByResa`. `rapportStatement.js` calculait `virTotal` à partir de `r.vir` (ventByResa), donc affichait 15€ pour cette résa au lieu de 132.28€.
- Fix : `buildRapportData.js` — la construction de `ventByResa` somme désormais les `montant_ht` et `montant_ttc` de plusieurs lignes VIR pour la même réservation (cas de paiements partiels liés à des mouvements bancaires distincts). Les autres codes restent last-write-wins.
- Note : `virTotal` dans les KPIs (buildRapportData l.104) était déjà correct (somme brute de toutes les lignes VIR). La divergence n'existait que dans `r.vir` → `virTotal` de rapportStatement.

**8. Frais déduction loyer non visibles dans le statement** (bugs 33cb7950, e2b933ed)
- Cause : `rapportStatement.js` montrait VIR puis Total reversement sans ligne intermédiaire pour les frais `mode_traitement='deduire_loyer'`. L'utilisateur voyait VIR − Charges DCB ≠ Total reversement sans explication.
- Fix : `rapportStatement.js` — ajout de la computation `fraisDeductionLoyList/Total` (même règle que `buildRapportData.fraisDeductionLoy`), puis affichage de chaque frais comme ligne individuelle de déduction (rouge, label libelle) dans le bloc Reversement, entre VIR et Total.

**9. Factures brouillon EKIA/PINONCELY mars 2026 — frais absents** (bugs b3664558, afa21f2f)
- Cause : Les brouillons (c2a3c0ce, 1b17711a) ont été générés AVANT le fix #1 (session 11/04/2026) qui ajoutait `statut='facture'` dans les requêtes `fraisDeduire`/`fraisDirect`. La serpillère EKIA (c42f2fb3, 21€) et l'étendoir PINONCELY (6ced0890, 63.58€) avaient déjà `statut='facture'` mais étaient exclus par le filtre `.eq('statut', 'a_facturer')`.
- Confirmation : `mode_encaissement='dcb'`, `mois_facturation='2026-03'`, `statut='facture'` — les deux frais sont correctement qualifiés.
- Fix requis : régénérer les brouillons via le bouton "Générer factures mars 2026" dans l'UI. La fonction `genererFactureGroupe` met à jour les brouillons existants (statut brouillon → UPDATE, pas re-création) et mettra à jour `montant_reversement` + ajoutera les lignes FRAIS. Après régénération, `frais_proprietaire.statut_deduction` passera de `en_attente` à `totalement_deduit` → affichage "déduit" en vert dans la section Débours du rapport.
- Données actuelles : EKIA reversement actuel = 476.28€ (sans déduction), cible = 455.28€ ; PINONCELY reversement actuel = 74.79€ (sans déduction), cible = 11.21€.

