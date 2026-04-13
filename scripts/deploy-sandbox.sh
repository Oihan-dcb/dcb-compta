#!/bin/bash
# ============================================================
# DÉPLOIEMENT SANDBOX — Edge Functions uniquement
# Usage : ./scripts/deploy-sandbox.sh
# ============================================================

set -e

SANDBOX_REF="${SUPABASE_SANDBOX_REF:-}"

if [ -z "$SANDBOX_REF" ]; then
  echo "❌ ERREUR : variable SUPABASE_SANDBOX_REF non définie"
  echo "   Exporter d'abord : export SUPABASE_SANDBOX_REF=<ref_sandbox>"
  exit 1
fi

# Garde-fou : refuser si le ref ressemble au projet prod
PROD_REF="omuncchvypbtxkpalwcr"
if [ "$SANDBOX_REF" = "$PROD_REF" ]; then
  echo "❌ REFUS : SUPABASE_SANDBOX_REF pointe vers le projet PRODUCTION"
  echo "   Déploiement annulé pour protéger la prod."
  exit 1
fi

echo "🟡 SANDBOX : déploiement sur projet $SANDBOX_REF"
echo "   (pas le projet prod $PROD_REF)"
echo ""

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
  supabase functions deploy "$fn" --project-ref "$SANDBOX_REF"
done

echo ""
echo "✅ Edge Functions déployées sur sandbox $SANDBOX_REF"
echo ""
echo "⚠️  Vérifier les secrets sandbox :"
echo "   supabase secrets list --project-ref $SANDBOX_REF"
echo "   S'assurer que AGENCE=dcb et EVOLIZ_COMPANY_ID=SANDBOX_DO_NOT_USE"
