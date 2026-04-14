#!/bin/bash
# ============================================================
# APPLICATION DES MIGRATIONS — projet sandbox uniquement
# Usage : ./scripts/apply-migrations-sandbox.sh
# Applique toutes les migrations dans l'ordre sur le sandbox
# ============================================================

set -e

SANDBOX_REF="${SUPABASE_SANDBOX_REF:-}"
PROD_REF="omuncchvypbtxkpalwcr"

if [ -z "$SANDBOX_REF" ]; then
  echo "❌ ERREUR : variable SUPABASE_SANDBOX_REF non définie"
  echo "   export SUPABASE_SANDBOX_REF=<ref_sandbox>"
  exit 1
fi

if [ "$SANDBOX_REF" = "$PROD_REF" ]; then
  echo "❌ REFUS : SUPABASE_SANDBOX_REF pointe vers le projet PRODUCTION"
  exit 1
fi

MIGRATIONS_DIR="supabase/migrations"

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "❌ Dossier $MIGRATIONS_DIR introuvable. Lancer depuis la racine du projet."
  exit 1
fi

echo "🟡 SANDBOX $SANDBOX_REF — Application des migrations"
echo ""

# Récupérer l'URL et la service role key du sandbox depuis les secrets locaux
# Requiert SUPABASE_SANDBOX_DB_URL dans l'environnement
if [ -z "$SUPABASE_SANDBOX_DB_URL" ]; then
  echo "❌ ERREUR : SUPABASE_SANDBOX_DB_URL non définie"
  echo "   Format : postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres"
  echo "   Récupérer depuis le dashboard Supabase sandbox > Settings > Database"
  exit 1
fi

for file in $(ls "$MIGRATIONS_DIR"/*.sql | sort); do
  name=$(basename "$file")
  echo "  → $name"
  psql "$SUPABASE_SANDBOX_DB_URL" -f "$file" -v ON_ERROR_STOP=1
done

echo ""
echo "✅ Migrations appliquées sur sandbox $SANDBOX_REF"
echo ""
echo "Vérifier le schéma sandbox vs prod :"
echo "  supabase db diff --project-ref $SANDBOX_REF"
