#!/usr/bin/env bash
# Tests d'intégration Worker + D1 : base locale vierge, wrangler dev, puis tests/integration.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=${PORT:-8799}
TOKEN=jeton-local-de-test-0123456789
rm -rf .wrangler/state
[ -f .dev.vars ] && cp .dev.vars .dev.vars.bak
printf 'ADMIN_TOKEN=%s\nREPORT_SALT=sel-local-de-test\n' "$TOKEN" > .dev.vars
cleanup() { kill "$WRANGLER" 2>/dev/null || true; rm -f .dev.vars; [ -f .dev.vars.bak ] && mv .dev.vars.bak .dev.vars; }
trap cleanup EXIT
npx wrangler d1 execute tcn-calendrier-2027 --local --file worker/schema.sql > /dev/null
npx wrangler dev --port "$PORT" > /tmp/tcn-wrangler-test.log 2>&1 &
WRANGLER=$!
for _ in $(seq 1 60); do curl -sf "http://localhost:$PORT/api/status" > /dev/null && break; sleep 1; done
BASE_URL="http://localhost:$PORT" ADMIN_TOKEN="$TOKEN" node --test tests/integration/reports.test.mjs
