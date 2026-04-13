#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
MODEL="${MODEL:-deepseek-chat}"
SYSTEM_PROMPT="${SYSTEM_PROMPT:-你是一个简洁助手，只返回关键信息}"
USER_PROMPT="${USER_PROMPT:-请用一句话介绍你自己}"

read -r -d '' PAYLOAD <<JSON || true
{
  "model": "${MODEL}",
  "messages": [
    {"role": "system", "content": "${SYSTEM_PROMPT}"},
    {"role": "user", "content": "${USER_PROMPT}"}
  ],
  "stream": false
}
JSON

echo "POST ${BASE_URL}/v1/chat/completions (system+user)"
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
