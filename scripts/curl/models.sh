#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"

echo "GET ${BASE_URL}/v1/models"
response="$(curl -sS -w '\n%{http_code}' "${BASE_URL}/v1/models" -H "Accept: application/json")"
body="$(printf '%s' "$response" | sed '$d')"
status="$(printf '%s' "$response" | tail -n1)"

echo "HTTP ${status}"
if [[ "$status" != "200" ]]; then
  printf '%s\n' "$body"
  exit 1
fi
printf '%s\n' "$body" | python3 -m json.tool
