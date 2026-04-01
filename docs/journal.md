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
