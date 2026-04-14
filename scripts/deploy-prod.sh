#!/bin/bash
# ============================================================
# DÉPLOIEMENT PRODUCTION — Edge Functions uniquement
# Usage : ./scripts/deploy-prod.sh
# ⚠️  NE PAS UTILISER pendant le chantier multi-entité
# ============================================================

set -e

PROD_REF="omuncchvypbtxkpalwcr"

# Vérification de branche : refuser si on est sur feat/multi-entite
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" = "feat/multi-entite" ]; then
  echo "❌ REFUS : déploiement prod depuis la branche '$CURRENT_BRANCH' interdit"
  echo "   Revenir sur 'main' avant de déployer en prod."
  exit 1
fi

echo "⚠️  PRODUCTION : déploiement sur projet $PROD_REF"
echo "   Branche : $CURRENT_BRANCH"
echo ""
read -p "   Confirmer le déploiement prod ? (oui/non) : " confirm
if [ "$confirm" != "oui" ]; then
  echo "   Déploiement annulé."
  exit 0
fi

FUNCTIONS=(
  "allocate-encaissements"
  "global-sync"
  "hospitable-webhook"
  "evoliz-proxy"
  "create-ae-user"
  "reset-ae-password"
  "smtp-send"
  "sync-ical-ae"
  "sync-ical-cron"
  "update-smtp-secrets"
)

for fn in "${FUNCTIONS[@]}"; do
  echo "  → Déploiement $fn..."
  supabase functions deploy "$fn" --project-ref "$PROD_REF"
done

echo ""
echo "✅ Edge Functions déployées sur prod $PROD_REF"
