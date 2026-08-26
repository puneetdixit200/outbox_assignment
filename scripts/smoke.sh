#!/usr/bin/env bash
set -euo pipefail

api_url="${API_URL:-http://localhost:4000}"
cookie_file="$(mktemp /tmp/outbox-smoke-cookie.XXXXXX)"
trap 'rm -f "$cookie_file"' EXIT

curl -fsS "$api_url/ready" | grep -q '"ok":true'
curl -fsS -c "$cookie_file" -H 'content-type: application/json' -d '{}' "$api_url/auth/dev-login" >/dev/null
sender_id="$(curl -fsS -b "$cookie_file" "$api_url/senders" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)"
subject="smoke-$(date +%s)"
start_at="$(date -u -d '+2 seconds' +%Y-%m-%dT%H:%M:%S.000Z)"
payload="$(printf '{"subject":"%s","body":"smoke","recipients":["smoke@example.test"],"senderId":"%s","startAt":"%s","delayBetweenEmailsMs":100,"hourlyLimit":200}' "$subject" "$sender_id" "$start_at")"
curl -fsS -b "$cookie_file" -H 'content-type: application/json' -H "Idempotency-Key: smoke-$subject" -d "$payload" "$api_url/emails/schedule" >/dev/null
sleep 4
curl -fsS -b "$cookie_file" "$api_url/emails/sent" | grep -q "$subject"
echo "smoke acceptance passed"
