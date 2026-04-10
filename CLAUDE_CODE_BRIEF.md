# BRIEF DÉVELOPPEMENT - MODULE PLANNING POWERHOUSE

## 🎯 CONTEXTE

Tu vas développer le module Planning de Powerhouse, une plateforme d'orchestration pour agence location courte durée.

**Architecture:**
- Frontend: Next.js + React + TypeScript
- Backend: Supabase (Postgres + Auth + Edge Functions)
- Deployment: Vercel

**Document de référence complet:** `/mnt/project/PowerHouse_V1.rtf`

---

## ⚠️ RÈGLES ABSOLUES

1. **Lis d'abord le document PowerHouse_V1.rtf** pour comprendre l'architecture globale
2. **N'invente AUCUNE règle métier** - tout est dans le doc
3. **Aucun secret côté frontend** - tout passe par API sécurisées
4. **Toute action importante = log** dans audit_logs
5. **Workflows idempotents** (pas de double exécution)
6. **TypeScript strict** partout
7. **Validation inputs** avec Zod
8. **RLS Supabase** sur toutes tables sensibles

---

## 🔄 CHANGEMENT IMPORTANT vs DOC ORIGINAL

**Dans le doc:** Staff a accès au planning pour voir ses tâches
**NOUVELLE SPEC:** Staff n'a PAS accès au planning

**Utilisateurs du planning:**
- Admin (full access)
- Clémence (coordination_planning role)
- Staff → verra ses tâches ailleurs, PAS dans ce module

---

## 📦 PÉRIMÈTRE MODULE PLANNING

### 1. OBJECTIFS

Créer un planning opérationnel pour:
- Suivre toutes les tâches staff (ménages, check-in, maintenance)
- Gérer dispos/indispos staff (vue hebdo simple)
- Détecter conflits horaires
- Suggérer créneaux techniques optimaux
- Synchroniser avec Hospitable

### 2. SOURCES DE DONNÉES

Le planning agrège:
- ✅ Tâches Hospitable (via webhook/API)
- ✅ Événements Google Calendar équipe (via sync)
- ✅ Tâches techniques créées dans Powerhouse
- ✅ Rappels et échéances Powerhouse
- ✅ Disponibilités staff (nouvelle table)

### 3. FONCTIONNALITÉS ATTENDUES

#### A. Vue Dispos Hebdo (simple pour Clémence)
```
Grille semaine AM/PM par staff:
        Lun    Mar    Mer    Jeu    Ven    Sam    Dim
Marie   ✅✅   ✅✅   ✅❌   ❌❌   ✅✅   ✅✅   ❌❌
Paul    ✅✅   ❌❌   ❌❌   ✅✅   ✅✅   ❌❌   ❌❌

✅✅ = dispo matin + après-midi
✅❌ = dispo matin uniquement
❌❌ = indispo
```

**Features:**
- Édition rapide au clic
- Raisons indispo (congé, formation, maladie)
- Export CSV
- Navigation semaine précédente/suivante

#### B. Vue Planning Admin (complète)

**Affichages:**
- Timeline jour/semaine
- Vue par staff
- Vue par bien

**Filtres:**
- Par staff
- Par bien (property)
- Par type de tâche
- Par statut

**Features:**
- Drag & drop assignation tâches
- Création manuelle tâche
- Édition tâche
- Détection conflits
- Suggestions créneaux techniques

#### C. Détection Conflits

Détecter automatiquement:
- ❌ Staff assigné 2 tâches même horaire
- ❌ Staff indispo mais tâche assignée
- ❌ Bien occupé mais tâche programmée
- ❌ Temps trajet impossible entre 2 tâches

Afficher panel conflits avec actions correctives.

#### D. Suggestions Intelligentes

```typescript
// Logique suggestion créneau technique
IF staff_sur_place_pour_tache(bien_X) 
   AND temps_libre_avant_prochaine_tâche > 45min
   AND dernier_suivi_technique(bien_X) > 30j
   AND bien_pas_occupé
THEN 
   suggerer_suivi_technique(bien_X, staff, créneau)
```

Afficher suggestions comme cartes validables.

#### E. Sync Hospitable (bidirectionnel)

**Import Hospitable → Powerhouse:**
- Webhook reçoit nouvelles tâches Hospitable
- Créer `planning_events` avec `source_system: 'hospitable'`
- Stocker `external_id` pour sync inverse

**Export Powerhouse → Hospitable:**
- Tâche technique validée dans Powerhouse
- API call vers Hospitable (si disponible)
- Sauvegarder `external_id` retourné
- Logger action dans audit_logs

⚠️ **TODO:** Vérifier capacités réelles API Hospitable pour création tâches

---

## 🗄️ SCHÉMA BASE DE DONNÉES

### Tables existantes (doc PowerHouse_V1.rtf section 10)

```sql
-- Déjà définies dans le doc
staff_members (
  id, auth_user_id, first_name, last_name, 
  email, role, active, color
)

planning_events (
  id, external_source, external_id, event_type,
  title, property_id, assigned_staff_id,
  starts_at, ends_at, status, source_system,
  source_payload, created_by
)

properties (
  id, external_hospitable_id, agency_id,
  name, address, last_technical_audit_at
)

technical_tickets (
  id, property_id, category, urgency,
  reported_by, assigned_to, status
)

audit_logs (
  id, actor_type, actor_id, action,
  entity_type, entity_id, metadata
)
```

### Nouvelle table à créer

```sql
CREATE TABLE staff_availability (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id UUID REFERENCES staff_members(id) NOT NULL,
  date DATE NOT NULL,
  am_available BOOLEAN DEFAULT true,
  pm_available BOOLEAN DEFAULT true,
  full_day_available BOOLEAN GENERATED ALWAYS AS 
    (am_available AND pm_available) STORED,
  reason TEXT, -- 'congé', 'formation', 'maladie', etc.
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(staff_id, date)
);

CREATE INDEX idx_staff_avail_date ON staff_availability(date);
CREATE INDEX idx_staff_avail_staff ON staff_availability(staff_id);

-- RLS
ALTER TABLE staff_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin + Coordination read"
  ON staff_availability FOR SELECT
  USING (
    auth.uid() IN (
      SELECT auth_user_id FROM staff_members 
      WHERE role IN ('admin', 'coordination_planning')
    )
  );

CREATE POLICY "Admin + Coordination write"
  ON staff_availability FOR ALL
  USING (
    auth.uid() IN (
      SELECT auth_user_id FROM staff_members 
      WHERE role IN ('admin', 'coordination_planning')
    )
  );
```

---

## 🏗️ ARCHITECTURE CODE

```
/modules/planning/
  
  /services/
    planningService.ts       # Logique métier planning
    dispoService.ts          # Gestion disponibilités
    conflictDetector.ts      # Détection conflits
    suggestionEngine.ts      # Suggestions techniques
    
  /integrations/
    hospitable-sync.ts       # Sync bidirectionnel Hospitable
    calendar-sync.ts         # Import Google Calendar
    
  /components/
    AdminPlanningView.tsx    # Vue complète admin
    DispoWeekGrid.tsx        # Grille dispos hebdo
    TaskAssigner.tsx         # Assignation tâches
    ConflictPanel.tsx        # Panel détection conflits
    SuggestionCard.tsx       # Carte suggestion technique
    TaskCard.tsx             # Carte tâche individuelle
    PlanningFilters.tsx      # Filtres vue
    
  /hooks/
    usePlanning.ts           # Hook fetch planning
    useStaffAvailability.ts  # Hook dispos
    useConflicts.ts          # Hook conflits
    useSuggestions.ts        # Hook suggestions
    
  /types/
    planning.types.ts        # Types TypeScript
    
/app/api/planning/
  events/
    route.ts                 # CRUD planning_events
  availability/
    route.ts                 # CRUD staff_availability
  conflicts/
    route.ts                 # GET conflits détectés
  suggestions/
    route.ts                 # GET suggestions techniques
  sync-hospitable/
    route.ts                 # POST création tâche Hospitable
    
/supabase/
  migrations/
    YYYYMMDD_create_staff_availability.sql
    YYYYMMDD_add_planning_rls.sql
  functions/
    detect-conflicts/
      index.ts               # Edge Function détection conflits
    generate-suggestions/
      index.ts               # Edge Function suggestions
```

---

## 🔐 SÉCURITÉ & PERMISSIONS

### Rôles utilisateurs

```typescript
enum UserRole {
  ADMIN = 'admin',
  COORDINATION = 'coordination_planning',
  STAFF = 'staff_operational'
}
```

### Permissions Planning

| Action | Admin | Coordination | Staff |
|--------|-------|--------------|-------|
| Voir planning complet | ✅ | ✅ | ❌ |
| Éditer dispos | ✅ | ✅ | ❌ |
| Créer tâches | ✅ | ✅ | ❌ |
| Assigner tâches | ✅ | ✅ | ❌ |
| Voir suggestions | ✅ | ✅ | ❌ |
| Valider suggestions | ✅ | ✅ | ❌ |
| Sync Hospitable | ✅ | ✅ | ❌ |
| Voir ses propres tâches | ✅ | ✅ | ✅* |

*Staff voit ses tâches dans un autre module (pas le planning)

### RLS à implémenter

Toutes les requêtes doivent vérifier:
```sql
auth.uid() IN (
  SELECT auth_user_id FROM staff_members 
  WHERE role IN ('admin', 'coordination_planning')
)
```

---

## 🎨 UI/UX GUIDELINES

### Principes design (doc section 12)

- Interfaces très lisibles
- Statuts visibles immédiatement
- Couleur = information métier (pas décoration)
- Desktop-first (mobile non prioritaire pour planning)
- Timeline claire pour flux longs

### Codes couleur tâches

```typescript
const TASK_STATUS_COLORS = {
  pending: '#F59E0B',      // Orange
  assigned: '#3B82F6',     // Bleu
  in_progress: '#8B5CF6',  // Violet
  completed: '#10B981',    // Vert
  cancelled: '#6B7280',    // Gris
  conflict: '#EF4444'      // Rouge
}

const AVAILABILITY_COLORS = {
  available: '#10B981',    // Vert
  partial: '#F59E0B',      // Orange
  unavailable: '#EF4444'   // Rouge
}
```

### Composants UI à utiliser

```typescript
// Utiliser shadcn/ui components
import { Calendar } from "@/components/ui/calendar"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Card, CardHeader, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
```

---

## 🔄 WORKFLOW SYNC HOSPITABLE

### 1. Webhook Hospitable → Powerhouse

```typescript
// /app/api/webhooks/hospitable/route.ts
POST /api/webhooks/hospitable

Payload attendu:
{
  event_type: 'task.created' | 'task.updated',
  task: {
    id: string,
    title: string,
    property_id: string,
    assigned_to: string,
    starts_at: datetime,
    ends_at: datetime,
    status: string
  }
}

Action:
1. Vérifier signature webhook (sécurité)
2. Créer/update planning_event
3. Mapper staff Hospitable → staff_id Powerhouse
4. Logger dans audit_logs
5. Retourner 200 OK
```

### 2. Powerhouse → Hospitable

```typescript
// /app/api/planning/sync-hospitable/route.ts
POST /api/planning/sync-hospitable

Body:
{
  planning_event_id: uuid
}

Action:
1. Vérifier permissions user
2. Récupérer planning_event complet
3. Formatter pour API Hospitable
4. POST https://api.hospitable.com/v1/tasks
5. Sauvegarder external_id retourné
6. Logger dans audit_logs
7. Retourner statut

TODO: Vérifier si API Hospitable permet création tâches
Si non disponible: 
  - Générer payload pré-rempli
  - Afficher pour copier-coller manuel
  - Garder traçabilité
```

---

## 🧮 LOGIQUE DÉTECTION CONFLITS

### Service conflictDetector.ts

```typescript
interface Conflict {
  type: 'time_overlap' | 'staff_unavailable' | 'property_occupied' | 'travel_time',
  severity: 'high' | 'medium' | 'low',
  event1_id: string,
  event2_id?: string,
  staff_id?: string,
  property_id?: string,
  description: string,
  suggested_action: string
}

async function detectConflicts(date_range): Promise<Conflict[]> {
  const conflicts = []
  
  // 1. Time overlap même staff
  const overlaps = await detectTimeOverlaps()
  
  // 2. Staff indispo mais assigné
  const unavailableAssignments = await detectUnavailableStaff()
  
  // 3. Bien occupé (réservation active)
  const propertyConflicts = await detectPropertyOccupation()
  
  // 4. Temps trajet impossible (optionnel phase 2)
  // const travelConflicts = await detectTravelTimeIssues()
  
  return conflicts
}
```

### Requête détection overlaps

```sql
-- Détecter overlaps horaires même staff
SELECT 
  e1.id AS event1_id,
  e2.id AS event2_id,
  e1.assigned_staff_id,
  e1.title AS event1_title,
  e2.title AS event2_title,
  e1.starts_at,
  e1.ends_at,
  e2.starts_at,
  e2.ends_at
FROM planning_events e1
JOIN planning_events e2 
  ON e1.assigned_staff_id = e2.assigned_staff_id
  AND e1.id < e2.id
WHERE 
  e1.status NOT IN ('cancelled', 'completed')
  AND e2.status NOT IN ('cancelled', 'completed')
  AND e1.starts_at < e2.ends_at
  AND e1.ends_at > e2.starts_at
```

### Requête staff indispo mais assigné

```sql
-- Staff indispo mais tâche assignée
SELECT 
  pe.id AS event_id,
  pe.title,
  pe.assigned_staff_id,
  sm.first_name || ' ' || sm.last_name AS staff_name,
  pe.starts_at,
  pe.ends_at,
  sa.reason AS unavailability_reason
FROM planning_events pe
JOIN staff_members sm ON pe.assigned_staff_id = sm.id
JOIN staff_availability sa ON sa.staff_id = sm.id
WHERE 
  pe.status NOT IN ('cancelled', 'completed')
  AND DATE(pe.starts_at) = sa.date
  AND (
    (EXTRACT(HOUR FROM pe.starts_at) < 12 AND sa.am_available = false)
    OR (EXTRACT(HOUR FROM pe.starts_at) >= 12 AND sa.pm_available = false)
  )
```

---

## 💡 LOGIQUE SUGGESTIONS TECHNIQUES

### Service suggestionEngine.ts

```typescript
interface TechnicalSuggestion {
  property_id: string,
  property_name: string,
  staff_id: string,
  staff_name: string,
  suggested_slot_start: datetime,
  suggested_slot_end: datetime,
  reason: string,
  confidence: 'high' | 'medium',
  metadata: {
    days_since_last_audit: number,
    available_time_minutes: number,
    staff_already_on_site: boolean
  }
}

async function generateSuggestions(date_range): Promise<TechnicalSuggestion[]> {
  const suggestions = []
  
  // Pour chaque tâche planifiée
  const events = await getPlannedEvents(date_range)
  
  for (const event of events) {
    // Vérifier si staff sur place pour ménage/check-in
    if (!isOnSiteTask(event)) continue
    
    // Récupérer le bien
    const property = await getProperty(event.property_id)
    
    // Vérifier dernière visite technique
    const daysSinceAudit = getDaysSince(property.last_technical_audit_at)
    if (daysSinceAudit < 30) continue // TODO: confirmer seuil
    
    // Vérifier temps libre après tâche
    const nextEvent = await getNextEvent(event.staff_id, event.ends_at)
    if (!nextEvent) continue
    
    const availableMinutes = getMinutesBetween(event.ends_at, nextEvent.starts_at)
    if (availableMinutes < 45) continue // TODO: confirmer seuil
    
    // Vérifier bien pas occupé
    const isOccupied = await isPropertyOccupied(property.id, event.ends_at, nextEvent.starts_at)
    if (isOccupied) continue
    
    // Créer suggestion
    suggestions.push({
      property_id: property.id,
      property_name: property.name,
      staff_id: event.assigned_staff_id,
      staff_name: event.staff_name,
      suggested_slot_start: event.ends_at,
      suggested_slot_end: addMinutes(event.ends_at, 30), // Durée suggérée
      reason: `Staff sur place après ${event.title}, ${availableMinutes}min disponibles, dernier audit il y a ${daysSinceAudit} jours`,
      confidence: daysSinceAudit > 60 ? 'high' : 'medium',
      metadata: {
        days_since_last_audit: daysSinceAudit,
        available_time_minutes: availableMinutes,
        staff_already_on_site: true
      }
    })
  }
  
  return suggestions
}
```

---

## 📝 VALIDATION & LOGS

### Validation Zod

```typescript
// /modules/planning/types/planning.types.ts

import { z } from 'zod'

export const PlanningEventSchema = z.object({
  id: z.string().uuid().optional(),
  external_source: z.string().optional(),
  external_id: z.string().optional(),
  event_type: z.enum(['task', 'appointment', 'reminder', 'technical']),
  title: z.string().min(1).max(200),
  property_id: z.string().uuid().optional(),
  assigned_staff_id: z.string().uuid().optional(),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
  status: z.enum(['pending', 'assigned', 'in_progress', 'completed', 'cancelled']),
  source_system: z.enum(['powerhouse', 'hospitable', 'calendar', 'manual']).optional(),
  source_payload: z.record(z.any()).optional()
})

export const StaffAvailabilitySchema = z.object({
  staff_id: z.string().uuid(),
  date: z.string().date(),
  am_available: z.boolean().default(true),
  pm_available: z.boolean().default(true),
  reason: z.string().optional(),
  notes: z.string().optional()
})
```

### Logs obligatoires

Toute action importante doit être loguée dans `audit_logs`:

```typescript
// Créer log
await supabase.from('audit_logs').insert({
  actor_type: 'user',
  actor_id: user.id,
  action: 'planning_event_created',
  entity_type: 'planning_event',
  entity_id: event.id,
  metadata: {
    event_type: event.event_type,
    property_id: event.property_id,
    assigned_staff_id: event.assigned_staff_id,
    source: 'manual'
  }
})
```

**Actions à logger:**
- Création/modification/suppression tâche
- Assignation staff
- Modification disponibilité
- Validation suggestion
- Sync Hospitable
- Détection conflit

---

## 🧪 TESTS MINIMAUX

```typescript
// /modules/planning/__tests__/conflictDetector.test.ts

describe('Conflict Detector', () => {
  test('détecte overlap horaire même staff', async () => {
    // Créer 2 events overlapping
    const event1 = createEvent({ starts_at: '2026-04-14T09:00', ends_at: '2026-04-14T11:00', staff_id: 'staff-1' })
    const event2 = createEvent({ starts_at: '2026-04-14T10:00', ends_at: '2026-04-14T12:00', staff_id: 'staff-1' })
    
    const conflicts = await detectConflicts(['2026-04-14'])
    
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].type).toBe('time_overlap')
  })
  
  test('détecte staff indispo mais assigné', async () => {
    // Créer dispo
    await createAvailability({ staff_id: 'staff-1', date: '2026-04-14', am_available: false })
    
    // Créer event matin
    const event = createEvent({ starts_at: '2026-04-14T09:00', staff_id: 'staff-1' })
    
    const conflicts = await detectConflicts(['2026-04-14'])
    
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].type).toBe('staff_unavailable')
  })
})

// /modules/planning/__tests__/suggestionEngine.test.ts

describe('Suggestion Engine', () => {
  test('génère suggestion créneau technique optimal', async () => {
    // Setup: property avec dernier audit il y a 40j
    const property = await createProperty({ last_technical_audit_at: subDays(40) })
    
    // Event ménage avec 60min libres après
    const event = await createEvent({ 
      property_id: property.id, 
      ends_at: '2026-04-14T11:00',
      staff_id: 'staff-1'
    })
    const nextEvent = await createEvent({ 
      starts_at: '2026-04-14T12:00',
      staff_id: 'staff-1'
    })
    
    const suggestions = await generateSuggestions(['2026-04-14'])
    
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].property_id).toBe(property.id)
    expect(suggestions[0].confidence).toBe('high')
  })
})
```

---

## 📋 CHECKLIST DÉVELOPPEMENT

### Phase 1: Base données
- [ ] Migration `staff_availability`
- [ ] RLS policies planning
- [ ] Seed data test (staff, properties, events)

### Phase 2: Services backend
- [ ] `dispoService.ts` (CRUD dispos)
- [ ] `planningService.ts` (CRUD events)
- [ ] `conflictDetector.ts` (détection conflits)
- [ ] `suggestionEngine.ts` (suggestions techniques)

### Phase 3: API Routes
- [ ] `/api/planning/events` (CRUD)
- [ ] `/api/planning/availability` (CRUD)
- [ ] `/api/planning/conflicts` (GET)
- [ ] `/api/planning/suggestions` (GET)
- [ ] `/api/planning/sync-hospitable` (POST)

### Phase 4: Hooks React
- [ ] `usePlanning()`
- [ ] `useStaffAvailability()`
- [ ] `useConflicts()`
- [ ] `useSuggestions()`

### Phase 5: UI Components
- [ ] `DispoWeekGrid` (grille dispos simple)
- [ ] `AdminPlanningView` (vue complète)
- [ ] `TaskCard` (carte tâche)
- [ ] `ConflictPanel` (panel conflits)
- [ ] `SuggestionCard` (carte suggestion)
- [ ] `PlanningFilters` (filtres)

### Phase 6: Intégrations
- [ ] Webhook Hospitable → Powerhouse
- [ ] API Powerhouse → Hospitable (si dispo)
- [ ] Sync Google Calendar (optionnel phase 2)

### Phase 7: Tests & Polish
- [ ] Tests unitaires services
- [ ] Tests E2E création tâche
- [ ] Logs audit complets
- [ ] Gestion erreurs

---

## ❌ PIÈGES À ÉVITER

1. **Logique métier côté frontend**
   - ❌ Calculer conflits dans React
   - ✅ Calculer côté serveur, afficher dans UI

2. **Secrets exposés**
   - ❌ API keys Hospitable dans frontend
   - ✅ Tout passe par API routes sécurisées

3. **Duplication logique**
   - ❌ Code détection conflit à plusieurs endroits
   - ✅ Service unique `conflictDetector.ts`

4. **Oubli permissions**
   - ❌ Oublier vérifier rôle user
   - ✅ Vérifier à chaque API call + RLS

5. **Pas de logs**
   - ❌ Action sensible sans trace
   - ✅ Logger dans audit_logs systématiquement

6. **Webhooks non idempotents**
   - ❌ Recevoir 2x même webhook = double création
   - ✅ Vérifier `external_id` avant insert

---

## 🚀 ORDRE D'IMPLÉMENTATION RECOMMANDÉ

1. **Jour 1-2: Base**
   - Migration DB
   - Services dispoService + planningService
   - API routes CRUD basiques

2. **Jour 3-4: Vue Dispos**
   - Hook `useStaffAvailability`
   - Composant `DispoWeekGrid`
   - Édition rapide dispos

3. **Jour 5-7: Vue Planning Admin**
   - Hook `usePlanning`
   - Composant `AdminPlanningView`
   - Filtres
   - Assignation tâches

4. **Jour 8-9: Conflits**
   - Service `conflictDetector`
   - API route conflicts
   - Composant `ConflictPanel`

5. **Jour 10-11: Suggestions**
   - Service `suggestionEngine`
   - API route suggestions
   - Composant `SuggestionCard`

6. **Jour 12-13: Sync Hospitable**
   - Webhook entrant
   - API sortant (si dispo)
   - Logs audit

7. **Jour 14: Polish**
   - Tests
   - Gestion erreurs
   - UX refinement

---

## 📞 CONTACT & QUESTIONS

Si tu trouves:
- **Incohérence dans le doc** → Signaler avec `// TODO: INCOHÉRENCE - ...`
- **Information manquante** → Écrire `// TODO: À PRÉCISER - ...`
- **Risque de dette technique** → Documenter avec `// WARNING: DETTE TECH - ...`

**Questions à trancher:**
1. Seuil jours dernier audit technique (actuellement 30j)
2. Temps min créneau technique (actuellement 45min)
3. API Hospitable permet création tâches?
4. Format exact webhook Hospitable
5. Mapping staff Hospitable ↔ staff Powerhouse

---

## 🎯 DÉFINITION OF DONE

Module planning considéré terminé quand:

✅ Admin peut voir planning complet semaine
✅ Clémence peut éditer dispos staff (grille hebdo)
✅ Conflits horaires détectés automatiquement
✅ Suggestions créneaux techniques affichées
✅ Tâches Hospitable importées via webhook
✅ Création tâche Powerhouse sync Hospitable (ou workflow manuel si API indispo)
✅ Toutes actions sensibles loguées
✅ Permissions respectées (staff n'a PAS accès)
✅ TypeScript strict partout
✅ Validation inputs avec Zod
✅ Tests unitaires services critiques
✅ Gestion erreurs propre
✅ UI responsive desktop
✅ Documentation code

---

## 📚 RESSOURCES

- **Doc complet:** `/mnt/project/PowerHouse_V1.rtf`
- **Supabase docs:** https://supabase.com/docs
- **Next.js App Router:** https://nextjs.org/docs/app
- **Shadcn/ui:** https://ui.shadcn.com
- **Zod validation:** https://zod.dev

---

**BON CODE! 🚀**
