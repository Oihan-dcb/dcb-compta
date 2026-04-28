# DCB Compta — Context for AI Agents

## Protocole de coordination inter-agents (Codex ↔ Claude Code)

Ce projet est maintenu en parallèle par **Claude Code** (CLI local, sessions quotidiennes) et **ChatGPT Codex** (tâches ponctuelles). Pour rester synchronisés :

### Ce que Codex DOIT faire après chaque modification significative

1. **Mettre à jour `docs/`** selon les règles "Règle obligatoire" ci-dessous
2. **Commit atomique** avec message explicite (pas de "fix stuff")
3. **Ajouter une entrée dans `docs/project-overview.md`** section "Fixes récents" si c'est un bug corrigé
4. **Ne jamais modifier `docs/domain-rules.md`** sans avoir lu et compris toute la section concernée

### Ce que Claude Code fera automatiquement

Claude Code lit git log au démarrage et se met à jour depuis les commits de Codex. Il utilise aussi MemPalace (MCP local) pour la mémoire persistante — Codex n'a pas accès à MemPalace mais Claude Code re-synchronise depuis les `docs/` après chaque session.

### Règle de non-régression entre agents

- Ne jamais supprimer ou modifier un comportement documenté dans `docs/domain-rules.md` sans laisser une trace dans le commit message.
- Si tu touches `ventilation.js`, `facturesEvoliz.js`, ou `rapprochement.js` : mentionner explicitement dans le commit message quelle règle métier a changé (ex: "fix HON calc: round→floor pour directes — domain-rules §4.4").
- Les tests dans `src/services/__tests__/ventilation.test.js` doivent passer après toute modification de `ventilation.js`.

---


## Identité projet
Application comptable interne pour **Destination Côte Basque (DCB)**, conciergerie ~50 biens, Biarritz.
- **GitHub** : `github.com/Oihan-dcb/dcb-compta` (org : Oihan-dcb)
- **Vercel** : `dcb-compta.vercel.app`
- **Supabase** : projet partagé DCB (URL dans `.env` / variables Vercel)

## Stack
- React + Vite (frontend)
- Supabase Postgres (base de données)
- Supabase Edge Functions Deno (backend serverless)
- Vercel (hosting + `api/` routes Node.js)
- Hospitable API v2, Evoliz API, Stripe

**Important** : pas de Next.js, pas d'App Router. React + Vite classique.

## Règles techniques obligatoires
- `npm run build` avant tout commit/push
- Commits atomiques avec message explicite
- Email commit : `oihan@destinationcotebasque.com`
- Ne jamais utiliser `btoa(unescape(encodeURIComponent()))` pour encoder des fichiers
- Pour encoder un fichier source en base64 via l'API GitHub, utiliser uniquement :
  ```js
  const blob = new Blob([src], { type: 'text/plain;charset=utf-8' })
  const ab = await blob.arrayBuffer()
  const u8 = new Uint8Array(ab)
  let b64 = ''
  for (let i = 0; i < u8.length; i += 3072) b64 += btoa(String.fromCharCode(...u8.slice(i, i+3072)))
  ```

## Documentation — lire en priorité
Tous les fichiers `docs/` sont la source de vérité du projet :

| Fichier | Contenu |
|---|---|
| `docs/project-overview.md` | Vue d'ensemble, stack, bugs connus, historique fixes |
| `docs/architecture-map.md` | Carte des modules, flux de données, dépendances |
| `docs/data-model.md` | Schéma Supabase complet, champs, contraintes |
| `docs/domain-rules.md` | Règles métier : ventilation, facturation, AUTO, HAOWNER — **lire avant toute modification de ventilation.js** |
| `docs/invariants.md` | Invariants système avec statut ✅/⚠/❌ |
| `docs/source-of-truth.md` | Sources de données, priorités, comportements |

**Règle obligatoire après chaque fix/feature :**
- Bug corrigé → passer ❌ → ✅ dans `invariants.md`
- Nouveau comportement → documenter dans `domain-rules.md`
- Schéma modifié → mettre à jour `data-model.md`

## Architecture clé

### Fichiers critiques
```
src/services/ventilation.js        ← moteur comptable central (NE PAS modifier sans lire domain-rules.md §1-10)
src/services/buildRapportData.js   ← données rapports propriétaires
src/services/facturesEvoliz.js     ← génération factures
src/services/rapprochement.js      ← moteur de rapprochement bancaire
src/pages/PageReservations.jsx     ← ventilation UI
src/pages/PageFactures.jsx         ← factures + contrôle trésorerie
src/lib/agence.js                  ← constante AGENCE (filtre multi-tenant)
src/lib/constants.js               ← STATUTS_NON_VENTILABLES et autres constantes partagées
```

### Multi-tenant
La base Supabase héberge 3 agences : `dcb`, `lauian`, `bordeaux`.
Toujours filtrer par `agence === AGENCE` (importé depuis `src/lib/agence.js`).
Ne jamais oublier ce filtre sur les requêtes Supabase.

### Codes comptables DCB
`HON` (honoraires DCB), `FMEN` (forfait ménage), `AUTO` (débours AE), `LOY` (reversement proprio),
`VIR` (virement réel), `TAXE` (taxe de séjour), `COM` (commission directe), `MEN` (ménage brut voyageur)

### Charte graphique (zéro bleu)
- `--brand #CC9933` or · `--bg #F7F3EC` crème · `--border #D9CEB8` · `--text #2C2416` brun

## Points critiques à ne jamais oublier
1. **ventilation.js existe en 3 versions** (`ventilation.js` V1, `global-sync` V2, `hospitable-webhook` V3). Corriger V1 ne corrige pas les autres.
2. **`calculerVentilationMois` filtre par agence en JS** (pas en SQL) — toujours vérifier `r.bien?.agence === AGENCE`.
3. **`resolution=merge-duplicates` PostgREST écrase tous les champs** y compris `status`. Utiliser avec précaution.
4. **`montant_reel`** sur une ligne ventilation = valeur saisie manuellement → à préserver lors des recalculs.
5. **`ventilation_calculee=true`** n'est plus un verrou absolu depuis mars 2026 — seul `envoye_evoliz` verrouille.

## Tests
```
src/services/__tests__/ventilation.test.js
```
Lancer avec `npm test` avant tout changement sur `ventilation.js`.

## Mémoire persistante (MemPalace)
Le projet utilise un serveur MCP local MemPalace (`wing: dcb_compta`) pour stocker la mémoire des sessions de développement. Non accessible directement depuis Codex, mais les décisions importantes sont reflétées dans les fichiers `docs/`.
