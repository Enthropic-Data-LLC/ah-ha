#!/bin/bash
set -euo pipefail

API="${API_URL:-http://localhost:3100}"
EMAIL="${TEST_EMAIL:-smoketest@ah-ha.local}"
PASS=0
FAIL=0

ok()   { echo "  ✓ $1"; ((PASS++)) || true; }
fail() { echo "  ✗ $1"; ((FAIL++)) || true; }

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    ok "$label (HTTP $actual)"
  else
    fail "$label — expected HTTP $expected, got $actual"
  fi
}

urlencode() {
  echo "$1" | sed 's|/|%2F|g'
}

extract_id() {
  echo "$1" | grep -o '"_id":"[^"]*"' | head -1 | sed 's/"_id":"//;s/"//'
}

COOKIE_JAR=$(mktemp)
trap 'rm -f "$COOKIE_JAR"' EXIT

echo "=== Ah-Ha Smoke Test ==="
echo "API: $API"
echo ""

# --- Auth ---
echo "[Auth]"
DEV_LINK_RES=$(curl -sf "$API/auth/dev-link?email=$EMAIL" 2>&1) || {
  echo "  ✗ GET /auth/dev-link failed — is NODE_ENV=production?"
  exit 1
}
TOKEN=$(echo "$DEV_LINK_RES" | grep -o '"token":"[^"]*"' | sed 's/"token":"//;s/"//' 2>/dev/null || true)
if [ -z "$TOKEN" ]; then
  # try extracting from url field
  URL_VAL=$(echo "$DEV_LINK_RES" | grep -o 'token=[^"\\]*' | head -1 | sed 's/token=//')
  TOKEN="$URL_VAL"
fi
if [ -z "$TOKEN" ]; then
  echo "  ✗ Could not extract token from dev-link response: $DEV_LINK_RES"
  exit 1
fi
ok "GET /auth/dev-link → token acquired"

STATUS=$(curl -sf -o /dev/null -w "%{http_code}" -c "$COOKIE_JAR" \
  -X POST "$API/api/auth/verify" \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$TOKEN\"}" 2>/dev/null || echo "000")
check "POST /api/auth/verify" "200" "$STATUS"

ME=$(curl -sf -b "$COOKIE_JAR" "$API/auth/me" 2>/dev/null || echo "{}")
USERNAME=$(echo "$ME" | grep -o '"username":"[^"]*"' | head -1 | sed 's/"username":"//;s/"//')
if [ -n "$USERNAME" ]; then
  ok "GET /auth/me → username: $USERNAME"
else
  fail "GET /auth/me — could not extract username"
  USERNAME="unknown"
fi

echo ""
echo "[Spaces]"
STATUS=$(curl -sf -o /dev/null -w "%{http_code}" -b "$COOKIE_JAR" "$API/api/spaces" 2>/dev/null || echo "000")
check "GET /api/spaces" "200" "$STATUS"

TRAIL_SLUG="smoke-trail-$$"
CREATE_RES=$(curl -sf -b "$COOKIE_JAR" -X POST "$API/api/spaces" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"trail\",\"name\":\"Smoke Test Trail\",\"slug\":\"$TRAIL_SLUG\"}" 2>/dev/null || echo "{}")
TRAIL_REF="${USERNAME}/trail/${TRAIL_SLUG}"
ok "POST /api/spaces → $TRAIL_REF"

TABLE_SLUG="smoke-table-$$"
curl -sf -o /dev/null -b "$COOKIE_JAR" -X POST "$API/api/spaces" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"table\",\"name\":\"Smoke Test Table\",\"slug\":\"$TABLE_SLUG\"}" 2>/dev/null || true
TABLE_REF="${USERNAME}/table/${TABLE_SLUG}"

echo ""
echo "[MQTT Subscriptions]"
STATUS=$(curl -sf -o /dev/null -w "%{http_code}" -b "$COOKIE_JAR" "$API/api/mqtt/subscriptions" 2>/dev/null || echo "000")
check "GET /api/mqtt/subscriptions" "200" "$STATUS"

MQTT_RES=$(curl -sf -b "$COOKIE_JAR" -X POST "$API/api/mqtt/subscriptions" \
  -H "Content-Type: application/json" \
  -d "{\"topic_pattern\":\"test/smoke/+\",\"space_ref\":\"$TRAIL_REF\",\"text_template\":\"{{payload}}\"}" 2>/dev/null || echo "{}")
MQTT_ID=$(extract_id "$MQTT_RES")
if [ -n "$MQTT_ID" ]; then
  ok "POST /api/mqtt/subscriptions → $MQTT_ID"
  STATUS=$(curl -sf -o /dev/null -w "%{http_code}" -b "$COOKIE_JAR" \
    -X DELETE "$API/api/mqtt/subscriptions/$MQTT_ID" 2>/dev/null || echo "000")
  check "DELETE /api/mqtt/subscriptions/:id" "200" "$STATUS"
else
  fail "POST /api/mqtt/subscriptions — no _id in response: $MQTT_RES"
fi

echo ""
echo "[Webhooks]"
STATUS=$(curl -sf -o /dev/null -w "%{http_code}" -b "$COOKIE_JAR" "$API/api/webhooks" 2>/dev/null || echo "000")
check "GET /api/webhooks" "200" "$STATUS"

WH_RES=$(curl -sf -b "$COOKIE_JAR" -X POST "$API/api/webhooks" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Smoke Test Hook\",\"target_space_ref\":\"$TRAIL_REF\",\"events\":[\"trail.append\"]}" 2>/dev/null || echo "{}")
WH_ID=$(extract_id "$WH_RES")
if [ -n "$WH_ID" ]; then
  ok "POST /api/webhooks → $WH_ID"
  STATUS=$(curl -sf -o /dev/null -w "%{http_code}" \
    -X POST "$API/api/webhooks/receive/$WH_ID" \
    -H "Content-Type: application/json" \
    -d "{\"text\":\"smoke test entry\"}" 2>/dev/null || echo "000")
  check "POST /api/webhooks/receive/:id" "200" "$STATUS"
  STATUS=$(curl -sf -o /dev/null -w "%{http_code}" -b "$COOKIE_JAR" \
    -X DELETE "$API/api/webhooks/$WH_ID" 2>/dev/null || echo "000")
  check "DELETE /api/webhooks/:id" "200" "$STATUS"
else
  fail "POST /api/webhooks — no _id in response: $WH_RES"
fi

echo ""
echo "[Notifications]"
STATUS=$(curl -sf -o /dev/null -w "%{http_code}" -b "$COOKIE_JAR" "$API/api/notifications/prefs" 2>/dev/null || echo "000")
check "GET /api/notifications/prefs" "200" "$STATUS"

STATUS=$(curl -sf -o /dev/null -w "%{http_code}" -b "$COOKIE_JAR" \
  -X PUT "$API/api/notifications/prefs" \
  -H "Content-Type: application/json" \
  -d "{\"daily_briefing\":{\"enabled\":false,\"time\":\"08:00\",\"timezone\":\"UTC\"},\"presence\":{\"enabled\":false},\"channels\":{}}" 2>/dev/null || echo "000")
check "PUT /api/notifications/prefs" "200" "$STATUS"

STATUS=$(curl -sf -o /dev/null -w "%{http_code}" -b "$COOKIE_JAR" "$API/api/notifications" 2>/dev/null || echo "000")
check "GET /api/notifications" "200" "$STATUS"

echo ""
echo "[Audit]"
STATUS=$(curl -sf -o /dev/null -w "%{http_code}" -b "$COOKIE_JAR" "$API/api/audit" 2>/dev/null || echo "000")
check "GET /api/audit" "200" "$STATUS"

echo ""
echo "[Table]"
ENC_TABLE_REF=$(urlencode "$TABLE_REF")
STATUS=$(curl -sf -o /dev/null -w "%{http_code}" -b "$COOKIE_JAR" \
  "$API/api/spaces/$ENC_TABLE_REF/table" 2>/dev/null || echo "000")
check "GET /api/spaces/:ref/table" "200" "$STATUS"

ROW_RES=$(curl -sf -b "$COOKIE_JAR" -X POST "$API/api/spaces/$ENC_TABLE_REF/table" \
  -H "Content-Type: application/json" \
  -d "{\"cells\":{}}" 2>/dev/null || echo "{}")
ROW_STATUS=$(curl -sf -o /dev/null -w "%{http_code}" -b "$COOKIE_JAR" \
  -X POST "$API/api/spaces/$ENC_TABLE_REF/table" \
  -H "Content-Type: application/json" \
  -d "{\"cells\":{}}" 2>/dev/null || echo "000")
check "POST /api/spaces/:ref/table (add row)" "201" "$ROW_STATUS"

echo ""
echo "[Cleanup]"
curl -sf -o /dev/null -b "$COOKIE_JAR" \
  -X DELETE "$API/api/spaces/$(urlencode "$TRAIL_REF")" 2>/dev/null && ok "Deleted test trail space" || fail "Failed to delete trail space"
curl -sf -o /dev/null -b "$COOKIE_JAR" \
  -X DELETE "$API/api/spaces/$(urlencode "$TABLE_REF")" 2>/dev/null && ok "Deleted test table space" || fail "Failed to delete table space"

echo ""
echo "==========================="
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
