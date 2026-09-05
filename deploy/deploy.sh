#!/usr/bin/env bash
set -euo pipefail

# Deploy the WaCRM (MongoDB edition) stack for whatsapp.stepsolar.in.
#
# Usage:
#   deploy/deploy.sh                       # uses deploy/.env if present, else frontend/.env.local
#   ENV_FILE=/path/to/crm.env deploy/deploy.sh
#
# The env file must contain at least:
#   MONGO_URL            Atlas connection string (full URI incl. credentials)
#   JWT_SECRET           long random string for session tokens
#   ENCRYPTION_KEY       64 hex chars (AES-256-GCM) for WhatsApp/AI tokens
#   META_APP_SECRET      Meta app secret (webhook HMAC verification)
#   NEXT_PUBLIC_SITE_URL https://whatsapp.stepsolar.in  (build-time)
#
# Optional:
#   DB_NAME                     (default: stepsolar)
#   SEED_INDEXES_ON_START=1     create/ensure CRM indexes on boot (idempotent)
#   AUTOMATION_CRON_SECRET      required if you use Wait steps in automations
#   META_APP_ID                 needed for image-header message templates
#   NEXT_PUBLIC_APP_LOCALE      (default: en)
#
# Copy deploy/.env.example to deploy/.env and fill it in first.
# Disk note: the frontend build layer (node_modules) needs ~10GB free.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_FILE="${ENV_FILE:-}"
if [[ -z "$ENV_FILE" ]]; then
  if [[ -f "$SCRIPT_DIR/.env" ]]; then
    ENV_FILE="$SCRIPT_DIR/.env"
  elif [[ -f "$SCRIPT_DIR/../frontend/.env.local" ]]; then
    ENV_FILE="$SCRIPT_DIR/../frontend/.env.local"
  else
    echo "ERROR: no env file found."
    echo "  Copy deploy/.env.example to deploy/.env and fill it in."
    exit 1
  fi
fi
ENV_FILE="$(cd "$(dirname "$ENV_FILE")" && pwd)/$(basename "$ENV_FILE")"
echo "Using env file: $ENV_FILE"

# ---------------------------------------------------------------- checks
command -v docker >/dev/null 2>&1 || { echo "ERROR: docker not found"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "ERROR: docker compose v2 not found"; exit 1; }

REQUIRED=(MONGO_URL JWT_SECRET ENCRYPTION_KEY META_APP_SECRET)
MISSING=()
for k in "${REQUIRED[@]}"; do
  grep -qE "^${k}=.+" "$ENV_FILE" || MISSING+=("$k")
done
if (( ${#MISSING[@]} )); then
  echo "ERROR: required vars missing from $ENV_FILE: ${MISSING[*]}"
  exit 1
fi

# ----------------------------------------------------------------- build
export ENV_FILE
echo ">> Building images (this may take several minutes) ..."
docker compose --env-file "$ENV_FILE" build --pull

# ------------------------------------------------------------------- up
echo ">> Starting services ..."
docker compose --env-file "$ENV_FILE" up -d

# ------------------------------------------------------------ healthcheck
echo ">> Waiting for services to become healthy ..."
for i in $(seq 1 45); do
  FE=$(docker inspect -f '{{.State.Health.Status}}' wacrm-stepsolar-frontend-1 2>/dev/null || echo "missing")
  PX=$(docker inspect -f '{{.State.Health.Status}}' wacrm-stepsolar-proxy-1 2>/dev/null || echo "missing")
  if [[ "$FE" == "healthy" && "$PX" == "healthy" ]]; then
    echo "OK: frontend (:3000) and proxy (:8001) are healthy."
    echo
    echo "Reverse proxy mapping for whatsapp.stepsolar.in:"
    echo "  location /api/ { proxy_pass http://127.0.0.1:8001; }   # via proxy"
    echo "  location /     { proxy_pass http://127.0.0.1:3000; }   # direct to Next"
    echo "  (Or route everything to :3000 and drop the proxy service.)"
    echo
    echo "Meta webhook URL:"
    echo "  https://whatsapp.stepsolar.in/api/whatsapp/webhook   (verify token from Settings)"
    exit 0
  fi
  sleep 2
done

echo "WARNING: services not healthy within 90s. Check logs:"
echo "  docker compose --env-file '$ENV_FILE' logs frontend"
echo "  docker compose --env-file '$ENV_FILE' logs proxy"
exit 1
