#!/usr/bin/env bash
set -euo pipefail

# Local-only smoke test.
# Start the API with ALLOW_DEV_LOGIN=true. Use real Ethereal credentials, or set
# ALLOW_DEV_MAIL=true only for this local test.
api_url="${API_URL:-http://localhost:4000}"
smoke_delay_ms="${SMOKE_DELAY_MS:-1000}"
cookie_file="$(mktemp /tmp/outbox-smoke-cookie.XXXXXX)"
trap 'rm -f "$cookie_file"' EXIT

curl -fsS "$api_url/ready" | grep -q '"ok":true'
if ! curl -fsS -c "$cookie_file" -H 'content-type: application/json' -d '{"email":"'"${DEV_LOGIN_EMAIL:-demo@outbox.local}"'","password":"'"${DEV_LOGIN_PASSWORD:-outbox-local-demo}"'"}' "$api_url/auth/password-login" >/dev/null; then
  echo "dev login is disabled; restart API with ALLOW_DEV_LOGIN=true for this local smoke test" >&2
  exit 1
fi

sender_id="$(curl -fsS -b "$cookie_file" "$api_url/senders" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)"
subject="smoke-$(date +%s)"
start_at="$(date -u -d '+2 seconds' +%Y-%m-%dT%H:%M:%S.000Z)"
payload="$(printf '{"subject":"%s","body":"smoke","recipients":["smoke@example.test"],"senderId":"%s","startAt":"%s","delayBetweenEmailsMs":%s,"hourlyLimit":200}' "$subject" "$sender_id" "$start_at" "$smoke_delay_ms")"

curl -fsS -b "$cookie_file" -H 'content-type: application/json' -H "Idempotency-Key: smoke-$subject" -d "$payload" "$api_url/emails/schedule" >/dev/null

for _ in $(seq 1 20); do
  if curl -fsS -b "$cookie_file" "$api_url/emails/sent" | grep -q "$subject"; then
    echo "smoke acceptance passed"
    exit 0
  fi
  sleep 1
done

echo "smoke acceptance failed: message did not reach sent/failed history in time" >&2
exit 1
