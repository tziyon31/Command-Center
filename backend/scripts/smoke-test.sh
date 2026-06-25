#!/usr/bin/env bash
# Smoke test against production or local API. Usage: ./scripts/smoke-test.sh [BASE_URL]
set -euo pipefail

API="${1:-https://command-center-api-8nr8.onrender.com}"
FAILED=0

pass() { echo "✅ $1"; }
fail() { echo "❌ $1"; FAILED=1; }

json() { python3 -c "import sys,json; print(json.load(sys.stdin)$1)" 2>/dev/null; }

echo "API: $API"
echo ""

echo "=== AUTH ==="
LOGIN=$(curl -s -X POST "$API/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@local.test","password":"Admin123!"}')
TOKEN=$(echo "$LOGIN" | json "['token']")
[ -n "$TOKEN" ] && pass "login" || { fail "login"; exit 1; }
AUTH=(-H "Authorization: Bearer $TOKEN")

ME=$(curl -s "${AUTH[@]}" "$API/api/auth/me")
echo "$ME" | grep -q admin && pass "me" || fail "me"

echo ""
echo "=== CLIENT ==="
CLIENT=$(curl -s -X POST "${AUTH[@]}" "$API/api/entities/clients" -H 'Content-Type: application/json' \
  -d '{"name":"Smoke Client","status":"draft","rating":"B","company":"Co"}')
CID=$(echo "$CLIENT" | json "['id']")
[ -n "$CID" ] && pass "client create" || fail "client create: $CLIENT"

curl -s "${AUTH[@]}" "$API/api/entities/clients?filter=%7B%22id%22%3A%22$CID%22%7D" | grep -q "$CID" && pass "client filter" || fail "client filter"

echo ""
echo "=== INQUIRY ==="
INQ=$(curl -s -X POST "${AUTH[@]}" "$API/api/entities/inquiries" -H 'Content-Type: application/json' \
  -d '{"client_name":"Smoke","form_status":"draft","area":100}')
IID=$(echo "$INQ" | json "['id']")
[ -n "$IID" ] && pass "inquiry create" || fail "inquiry create"

INQ2=$(curl -s -X PUT "${AUTH[@]}" "$API/api/entities/inquiries/$IID" -H 'Content-Type: application/json' \
  -d '{"form_status":"submitted","submitted_at":"2026-06-24T12:00:00.000Z"}')
echo "$INQ2" | grep -q submitted && pass "inquiry update status" || fail "inquiry update"

echo ""
echo "=== PROJECT ==="
PROJ=$(curl -s -X POST "${AUTH[@]}" "$API/api/entities/projects" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Smoke Project\",\"client_id\":\"$CID\",\"status\":\"lead\",\"year\":2026,\"source_inquiry_id\":\"$IID\",\"collection_events\":[]}")
PID=$(echo "$PROJ" | json "['id']")
[ -n "$PID" ] && pass "project create" || fail "project create: $PROJ"

PROJ2=$(curl -s -X PUT "${AUTH[@]}" "$API/api/entities/projects/$PID" -H 'Content-Type: application/json' \
  -d '{"status":"pricing","total_amount":50000}')
echo "$PROJ2" | grep -q pricing && pass "project status change" || fail "project status"

curl -s "${AUTH[@]}" "$API/api/entities/projects?sort=-year" | grep -q "$PID" && pass "project sort -year" || fail "project sort"

echo ""
echo "=== PROPOSAL ==="
PROP=$(curl -s -X POST "${AUTH[@]}" "$API/api/entities/proposals" -H 'Content-Type: application/json' \
  -d "{\"client_id\":\"$CID\",\"project_id\":\"$PID\",\"client_name\":\"Smoke Client\",\"form_status\":\"draft\"}")
PRID=$(echo "$PROP" | json "['id']")
[ -n "$PRID" ] && pass "proposal create" || fail "proposal create"

echo ""
echo "=== SIGNED PROPOSAL ==="
SIGNED=$(curl -s -X POST "${AUTH[@]}" "$API/api/entities/signed_proposals" -H 'Content-Type: application/json' \
  -d "{\"project_id\":\"$PID\",\"client_id\":\"$CID\",\"has_signed_offer_or_order\":true,\"form_status\":\"submitted\"}")
SID=$(echo "$SIGNED" | json "['id']")
[ -n "$SID" ] && pass "signed proposal create" || fail "signed proposal create"

echo ""
echo "=== WORK STAGE ==="
WS=$(curl -s -X POST "${AUTH[@]}" "$API/api/entities/work_stages" -H 'Content-Type: application/json' \
  -d "{\"project_id\":\"$PID\",\"title\":\"Stage 1\",\"order_index\":1,\"status\":\"pending\"}")
WSID=$(echo "$WS" | json "['id']")
[ -n "$WSID" ] && pass "work stage create" || fail "work stage create"

curl -s "${AUTH[@]}" "$API/api/entities/work_stages?sort=order_index" | grep -q "$WSID" && pass "work stage sort order_index" || fail "work stage sort"

echo ""
echo "=== INVOICE PROCESS ==="
INV=$(curl -s -X POST "${AUTH[@]}" "$API/api/entities/invoice_processes" -H 'Content-Type: application/json' \
  -d "{\"project_id\":\"$PID\",\"amount\":1000,\"invoice_scope\":\"general\",\"form_status\":\"draft\"}")
INVID=$(echo "$INV" | json "['id']")
[ -n "$INVID" ] && pass "invoice process create" || fail "invoice process create"

echo ""
echo "=== INVOICE ==="
INVOICE=$(curl -s -X POST "${AUTH[@]}" "$API/api/entities/invoices" -H 'Content-Type: application/json' \
  -d "{\"project_id\":\"$PID\",\"date\":\"2026-06-01\",\"amount\":1000,\"status\":\"created\"}")
INVOICEID=$(echo "$INVOICE" | json "['id']")
[ -n "$INVOICEID" ] && pass "invoice create" || fail "invoice create"

echo ""
echo "=== COLLECTION DUE + EVENT ==="
CD=$(curl -s -X POST "${AUTH[@]}" "$API/api/entities/collection_dues" -H 'Content-Type: application/json' \
  -d "{\"project_id\":\"$PID\",\"amount_due\":5000,\"status\":\"open\",\"invoice_process_id\":\"$INVID\"}")
CDID=$(echo "$CD" | json "['id']")
[ -n "$CDID" ] && pass "collection due create" || fail "collection due create"

CE=$(curl -s -X POST "${AUTH[@]}" "$API/api/entities/collection_events" -H 'Content-Type: application/json' \
  -d "{\"project_id\":\"$PID\",\"amount\":1000,\"type\":\"collection_paid\"}")
CEID=$(echo "$CE" | json "['id']")
[ -n "$CEID" ] && pass "collection event create" || fail "collection event create"

curl -s "${AUTH[@]}" "$API/api/entities/collection_dues?sort=-created_date" | grep -q "$CDID" && pass "collection due list sort" || fail "collection due sort"

echo ""
echo "=== TASK + QUOTE (Dashboard) ==="
TASK=$(curl -s -X POST "${AUTH[@]}" "$API/api/entities/tasks" -H 'Content-Type: application/json' \
  -d '{"title":"Smoke task","status":"pending","priority":"medium","assigned_to":"admin@local.test"}')
TID=$(echo "$TASK" | json "['id']")
[ -n "$TID" ] && pass "task create" || fail "task create"

QUOTE=$(curl -s -X POST "${AUTH[@]}" "$API/api/entities/quotes" -H 'Content-Type: application/json' \
  -d "{\"project_id\":\"$PID\",\"date\":\"2026-06-01\",\"status\":\"draft\",\"items\":[]}")
QID=$(echo "$QUOTE" | json "['id']")
[ -n "$QID" ] && pass "quote create" || fail "quote create"

echo ""
echo "=== REMINDER ==="
REM=$(curl -s -X POST "${AUTH[@]}" "$API/api/entities/reminders" -H 'Content-Type: application/json' \
  -d "{\"title\":\"Smoke reminder\",\"client_name\":\"Smoke Client\",\"client_id\":\"$CID\",\"source_type\":\"project\",\"source_id\":\"$PID\",\"condition_key\":\"smoke:test\",\"action_url\":\"/Projects\",\"status\":\"active\",\"frequency\":\"daily\"}")
RID=$(echo "$REM" | json "['id']")
[ -n "$RID" ] && pass "reminder create" || fail "reminder create: $REM"

RS=$(curl -s -X POST "${AUTH[@]}" "$API/api/entities/reminder_settings" -H 'Content-Type: application/json' \
  -d '{"daily_reminder_time":"07:00","daily_reminders_enabled":true}')
RSID=$(echo "$RS" | json "['id']")
[ -n "$RSID" ] && pass "reminder settings create" || fail "reminder settings"

echo ""
echo "=== USERS ==="
curl -s "${AUTH[@]}" "$API/api/entities/users" | grep -q admin@local.test && pass "users list" || fail "users list"

ROLE=$(curl -s -X PUT "${AUTH[@]}" "$API/api/entities/users/$(echo "$ME" | json "['id']")" -H 'Content-Type: application/json' \
  -d '{"phone":"050","position":"Admin"}')
echo "$ROLE" | grep -q '050' && pass "user update" || fail "user update"

echo ""
echo "=== BULK CLIENTS ==="
BULK=$(curl -s -X POST "${AUTH[@]}" "$API/api/entities/clients/bulk" -H 'Content-Type: application/json' \
  -d '[{"name":"Bulk A","status":"draft"},{"name":"Bulk B","status":"draft"}]')
echo "$BULK" | grep -q 'Bulk A' && pass "clients bulkCreate" || fail "bulk create: $BULK"
B1=$(echo "$BULK" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")
B2=$(echo "$BULK" | python3 -c "import sys,json; print(json.load(sys.stdin)[1]['id'])")

echo ""
echo "=== CLEANUP ==="
for pair in \
  "reminders $RID" "reminder_settings $RSID" "tasks $TID" "quotes $QID" \
  "collection_events $CEID" "collection_dues $CDID" "invoices $INVOICEID" \
  "invoice_processes $INVID" "work_stages $WSID" "signed_proposals $SID" \
  "proposals $PRID" "projects $PID" "inquiries $IID" \
  "clients $CID" "clients $B1" "clients $B2"; do
  set -- $pair
  curl -s -X DELETE "${AUTH[@]}" "$API/api/entities/$1/$2" | grep -q ok && pass "delete $1" || fail "delete $1 $2"
done

echo ""
if [ "$FAILED" = "0" ]; then echo "🎉 ALL SMOKE TESTS PASSED"; else echo "⚠️ FAILURES DETECTED"; exit 1; fi
