#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
MODEL="${MODEL:-deepseek-chat}"
PROMPT="${PROMPT:-你好，返回一个简短问候}"

read -r -d '' PAYLOAD <<JSON || true
{
  "model": "${MODEL}",
  "messages": [
    {"role": "user", "content": "${PROMPT}"}
  ],
  "stream": false
}
JSON

echo "POST ${BASE_URL}/v1/chat/completions"
response="$(curl -sS -w '\n%{http_code}' "${BASE_URL}/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d "${PAYLOAD}")"
body="$(printf '%s' "$response" | sed '$d')"
status="$(printf '%s' "$response" | tail -n1)"

echo "HTTP ${status}"
if [[ "$status" != "200" ]]; then
  printf '%s\n' "$body"
  exit 1
fi
printf '%s\n' "$body" | python3 -m json.tool
