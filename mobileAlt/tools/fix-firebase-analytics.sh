#!/usr/bin/env bash
# fix-firebase-analytics.sh
#
# Programmatically fix an iOS app whose GoogleService-Info.plist has
# IS_ANALYTICS_ENABLED=false despite the Firebase project being linked
# to Google Analytics. Uses the Firebase Management API.
#
# WHY THIS HAPPENS: the plist is baked at the moment the iOS app is
# registered. If Google Analytics wasn't fully provisioned to the iOS app
# at that time (common: the app was registered before GA was linked, or
# the "Enable Google Analytics for this app" checkbox was missed during
# registration), the plist gets `IS_ANALYTICS_ENABLED=false` permanently
# until the iOS app entry is re-registered.
#
# USAGE:
#   ./fix-firebase-analytics.sh                       # dry-run, inspect only
#   ./fix-firebase-analytics.sh --apply               # actually perform fix
#   ./fix-firebase-analytics.sh --ga-account=NNN      # supply GA account
#                                                       if addGoogleAnalytics
#                                                       needs to be called
#
# PREREQ:
#   1. gcloud auth login   (as inquiries@axiomtraining.io)
#   2. Firebase Management API enabled on the Firebase project
#      (the script will detect + print the enable URL if not)
#
# Script is idempotent — running with --apply twice is a no-op after fix.
set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────────
# Read these out of the plist so the script is portable across projects.
PLIST="$(dirname "$0")/../GoogleService-Info.plist"
if [ ! -f "$PLIST" ]; then
  echo "ERROR: GoogleService-Info.plist not found at $PLIST" >&2
  exit 1
fi

PROJECT_ID=$(plutil -extract PROJECT_ID raw -o - "$PLIST" 2>/dev/null \
  || grep -A1 "PROJECT_ID" "$PLIST" | tail -1 | sed -E 's/.*<string>(.*)<\/string>.*/\1/')
GOOGLE_APP_ID=$(plutil -extract GOOGLE_APP_ID raw -o - "$PLIST" 2>/dev/null \
  || grep -A1 "GOOGLE_APP_ID" "$PLIST" | tail -1 | sed -E 's/.*<string>(.*)<\/string>.*/\1/')
BUNDLE_ID=$(plutil -extract BUNDLE_ID raw -o - "$PLIST" 2>/dev/null \
  || grep -A1 "BUNDLE_ID" "$PLIST" | tail -1 | sed -E 's/.*<string>(.*)<\/string>.*/\1/')

# Parse flags
APPLY=0
GA_ACCOUNT=""
for arg in "$@"; do
  case "$arg" in
    --apply)         APPLY=1 ;;
    --ga-account=*)  GA_ACCOUNT="${arg#*=}" ;;
    -h|--help)       sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "Unknown flag: $arg" >&2; exit 1 ;;
  esac
done

# ─── Helpers ─────────────────────────────────────────────────────────────────
section() { printf "\n\033[1m── %s ──\033[0m\n" "$*"; }
err()     { printf "\033[31m%s\033[0m\n" "$*" >&2; }
ok()      { printf "\033[32m%s\033[0m\n" "$*"; }
warn()    { printf "\033[33m%s\033[0m\n" "$*"; }

api() {
  local method=$1 path=$2 body=${3:-}
  local args=(-s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -X "$method")
  [ -n "$body" ] && args+=(-d "$body")
  curl "${args[@]}" "https://firebase.googleapis.com/v1beta1/$path"
}

confirm() {
  [ "$APPLY" -eq 1 ] || { warn "Skipping (dry-run). Re-run with --apply to perform."; return 1; }
  read -r -p "Confirm: $1 [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]]
}

# ─── Pre-flight ──────────────────────────────────────────────────────────────
section "Pre-flight"
echo "Project ID:     $PROJECT_ID"
echo "iOS app ID:     $GOOGLE_APP_ID"
echo "Bundle ID:      $BUNDLE_ID"

TOKEN=$(gcloud auth print-access-token 2>/dev/null) || {
  err "gcloud auth not active. Run: gcloud auth login"; exit 1;
}
ok "Got gcloud access token."

# ─── 1. Check API is enabled ─────────────────────────────────────────────────
section "1. Firebase Management API status"
APIS=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "https://serviceusage.googleapis.com/v1/projects/$PROJECT_ID/services/firebase.googleapis.com")
STATE=$(echo "$APIS" | python3 -c "import sys, json; print(json.load(sys.stdin).get('state', 'UNKNOWN'))")
echo "State: $STATE"

if [ "$STATE" != "ENABLED" ]; then
  warn "Firebase Management API not enabled. Enabling..."
  if [ "$APPLY" -eq 1 ]; then
    curl -s -X POST -H "Authorization: Bearer $TOKEN" \
      "https://serviceusage.googleapis.com/v1/projects/$PROJECT_ID/services/firebase.googleapis.com:enable"
    ok "Enable request sent. Wait ~30s for propagation, then re-run."
    exit 0
  else
    warn "Would enable. Re-run with --apply, or enable manually at:"
    echo "    https://console.developers.google.com/apis/api/firebase.googleapis.com/overview?project=$PROJECT_ID"
    exit 0
  fi
fi
ok "API enabled."

# ─── 2. Inspect current iOS app state on Firebase ────────────────────────────
section "2. Current iOS app config (from Firebase)"
LIST=$(api GET "projects/$PROJECT_ID/iosApps")
echo "$LIST" | python3 -m json.tool

APP_NAME=$(echo "$LIST" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for a in d.get('apps', []):
  if a.get('appId') == '$GOOGLE_APP_ID':
    print(a['name']); break
")
if [ -z "$APP_NAME" ]; then
  err "iOS app $GOOGLE_APP_ID not found in project $PROJECT_ID."
  err "Either the plist's PROJECT_ID is wrong, or the app was deleted."
  exit 1
fi
echo "API name: $APP_NAME"

# Fetch the LIVE config (what the Console download button would give)
section "3. Fetch live plist from API (this is what re-download from Console gets you)"
LIVE_CONFIG=$(api GET "$APP_NAME/config")
LIVE_PLIST=$(echo "$LIVE_CONFIG" | python3 -c "
import sys, json, base64
d = json.load(sys.stdin)
print(base64.b64decode(d['configFileContents']).decode('utf-8'))
")
LIVE_ANALYTICS=$(echo "$LIVE_PLIST" | grep -A1 IS_ANALYTICS_ENABLED | tail -1 | tr -d ' \t/')
echo "Live plist IS_ANALYTICS_ENABLED: $LIVE_ANALYTICS"

if echo "$LIVE_PLIST" | grep -q "MEASUREMENT_ID\|TRACKING_ID"; then
  ok "Live plist HAS MEASUREMENT_ID/TRACKING_ID — Analytics IS provisioned on this iOS app."
  echo "Fix: just save the live plist over the local file."
  if confirm "Overwrite local $PLIST with live plist from API?"; then
    echo "$LIVE_PLIST" > "$PLIST"
    ok "Replaced. Rebuild your app — Analytics will fire."
  fi
  exit 0
fi

warn "Live plist is MISSING MEASUREMENT_ID/TRACKING_ID."
warn "→ This iOS app was never provisioned with Analytics, even though the project is linked."
warn "→ Only fix: delete this iOS app entry + recreate it (with Analytics enabled at create time)."

# ─── 4. Check project-level GA linkage ───────────────────────────────────────
section "4. Project-level Analytics linkage"
GA_DETAILS=$(api GET "projects/$PROJECT_ID/analyticsDetails")
echo "$GA_DETAILS" | python3 -m json.tool
HAS_GA=$(echo "$GA_DETAILS" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('YES' if d.get('analyticsProperty') else 'NO')
")
echo "Project linked to GA property: $HAS_GA"

if [ "$HAS_GA" = "NO" ] && [ -z "$GA_ACCOUNT" ]; then
  err "Project not linked to GA, and no --ga-account=NNN supplied."
  err "Find your GA Account ID at https://analytics.google.com → Admin → Account Settings"
  exit 1
fi

# ─── 5. The fix: delete + recreate iOS app ───────────────────────────────────
section "5. Delete + recreate iOS app entry (the actual fix)"
warn "ABOUT TO DELETE: $APP_NAME ($BUNDLE_ID)"
warn "The app entry will be SOFT-DELETED. Builds shipped with the old plist will keep working;"
warn "they just won't send Analytics events. New builds need the new plist."

if ! confirm "Soft-delete iOS app $GOOGLE_APP_ID?"; then
  warn "Aborting — no changes made."
  exit 0
fi

DEL=$(api POST "$APP_NAME:remove" '{"allowMissing":false,"immediate":false}')
echo "$DEL" | python3 -m json.tool

ok "Soft-delete initiated. Waiting 30s for propagation..."
sleep 30

# Recreate iOS app — Firebase auto-provisions Analytics on creation if the
# project has GA linked.
section "6. Recreate iOS app"
CREATE_BODY=$(cat <<EOF
{
  "bundleId": "$BUNDLE_ID",
  "displayName": "Axiom iOS"
}
EOF
)
CREATE_RESP=$(api POST "projects/$PROJECT_ID/iosApps" "$CREATE_BODY")
echo "$CREATE_RESP" | python3 -m json.tool

# Operation polling — iOS app creation is async
OP_NAME=$(echo "$CREATE_RESP" | python3 -c "import sys, json; print(json.load(sys.stdin).get('name', ''))")
if [ -n "$OP_NAME" ]; then
  echo "Polling operation $OP_NAME ..."
  for i in $(seq 1 60); do
    OP=$(api GET "$OP_NAME")
    DONE=$(echo "$OP" | python3 -c "import sys, json; print(json.load(sys.stdin).get('done', False))")
    if [ "$DONE" = "True" ]; then
      ok "Operation complete."
      echo "$OP" | python3 -m json.tool
      break
    fi
    sleep 5
  done
fi

# Fetch the fresh plist
section "7. Save the fresh plist"
NEW_LIST=$(api GET "projects/$PROJECT_ID/iosApps")
NEW_APP_NAME=$(echo "$NEW_LIST" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for a in d.get('apps', []):
  if a.get('bundleId') == '$BUNDLE_ID':
    print(a['name']); break
")
NEW_CONFIG=$(api GET "$NEW_APP_NAME/config")
NEW_PLIST=$(echo "$NEW_CONFIG" | python3 -c "
import sys, json, base64
d = json.load(sys.stdin)
print(base64.b64decode(d['configFileContents']).decode('utf-8'))
")
NEW_ANALYTICS=$(echo "$NEW_PLIST" | grep -A1 IS_ANALYTICS_ENABLED | tail -1 | tr -d ' \t/')
echo "New plist IS_ANALYTICS_ENABLED: $NEW_ANALYTICS"

if echo "$NEW_PLIST" | grep -q "MEASUREMENT_ID\|TRACKING_ID"; then
  ok "SUCCESS — new plist has MEASUREMENT_ID/TRACKING_ID."
  cp "$PLIST" "$PLIST.bak.$(date +%s)"
  echo "$NEW_PLIST" > "$PLIST"
  ok "Saved to $PLIST (old file backed up)."
  echo
  echo "Next: rebuild the iOS app (EAS build) and Analytics will fire."
else
  err "Fresh plist STILL missing MEASUREMENT_ID."
  err "GA may not actually be linked at the project level. Check console manually."
fi
