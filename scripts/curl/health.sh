#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"

echo "GET ${BASE_URL}/health"
response="$(curl -sS -w '\n%{http_code}' "${BASE_URL}/health" -H "Accept: application/json")"
body="$(printf '%s' "$response" | sed '$d')"
status="$(printf '%s' "$response" | tail -n1)"

echo "HTTP ${status}"
printf '%s\n' "$body" | python3 -m json.tool
