#!/usr/bin/env bash
# Torah Social resilient Maestro orchestrator
# CRITICAL: This script NEVER exits on the first failure.
# It runs ALL flows, records pass/fail, then exits non-zero if any failed.

set -Eeuo pipefail

platform="${1:?usage: run-torah-e2e.sh <ios|android> <device-id>}"
device_id="${2:?usage: run-torah-e2e.sh <ios|android> <device-id>}"

artifact_dir="${GITHUB_WORKSPACE:-$PWD}/artifacts/$platform"
mkdir -p "$artifact_dir/flows"

phase() { printf '%s\n' "$1" > "$artifact_dir/phase.txt"; echo "==> $1"; }
log() { echo "[torah-e2e] $*"; }

TORAH_PDS_HOST="${EXPO_PUBLIC_TORAH_PDS_HOST:-https://pds-130-110-238-163.nip.io}"
E2E_RUN_ID="$(date +%s)"
E2E_USER_A_HANDLE="e2e-a-${E2E_RUN_ID}"
E2E_USER_A_EMAIL="e2e-a-${E2E_RUN_ID}@test.local"
E2E_USER_A_PASSWORD="E2ePass${E2E_RUN_ID}!"

TORAH_PDS_DOMAIN="${TORAH_PDS_HOST#*://}"
TORAH_PDS_DOMAIN="${TORAH_PDS_DOMAIN%/}"
E2E_USER_A_FULL_HANDLE="${E2E_USER_A_HANDLE}.${TORAH_PDS_DOMAIN}"

# Export for Maestro env substitution
export TORAH_PDS_HOST TORAH_PDS_DOMAIN E2E_RUN_ID E2E_USER_A_HANDLE E2E_USER_A_FULL_HANDLE E2E_USER_A_EMAIL E2E_USER_A_PASSWORD

log "Torah Social E2E run $E2E_RUN_ID"
log "PDS: $TORAH_PDS_HOST"
log "PDS domain: $TORAH_PDS_DOMAIN"
log "Test handle: $E2E_USER_A_FULL_HANDLE"
log "Device: $device_id ($platform)"

# -------------------------------------------------------------------------
# Seed test user via PDS API (no invite code required)
# -------------------------------------------------------------------------
phase "Seeding E2E test account"

PDS_HEALTH=$(curl -sf --max-time 5 "$TORAH_PDS_HOST/xrpc/_health" 2>/dev/null || echo '{}')
log "PDS health: $PDS_HEALTH"

ACCOUNT_JSON=$(curl -sf --max-time 30 \
  -X POST \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$E2E_USER_A_EMAIL\",\"handle\":\"$E2E_USER_A_FULL_HANDLE\",\"password\":\"$E2E_USER_A_PASSWORD\"}" \
  "$TORAH_PDS_HOST/xrpc/com.atproto.server.createAccount" 2>/dev/null || \
  echo '{"error":"createAccount failed"}')

if echo "$ACCOUNT_JSON" | grep -q '"error"'; then
  log "WARNING: Account creation returned error: $ACCOUNT_JSON"
  log "Continuing anyway — account may already exist or invite may be needed"
else
  log "Account created successfully: $E2E_USER_A_FULL_HANDLE"
fi

# -------------------------------------------------------------------------
# Flow list — run each independently, never stop on failure
# -------------------------------------------------------------------------
declare -a FLOW_RESULTS=()
declare -a FLOW_NAMES=()
OVERALL_PASS=true

run_flow() {
  local flow_name="$1"
  local flow_file="$2"
  local log_file="$artifact_dir/flows/${flow_name}.log"
  local screenshot_dir="$artifact_dir/flows/${flow_name}-screenshots"

  FLOW_NAMES+=("$flow_name")
  mkdir -p "$screenshot_dir"

  log "Running flow: $flow_name"

  set +e
  maestro test \
    --format JUNIT \
    --output "$artifact_dir/flows/${flow_name}.xml" \
    --debug-output "$screenshot_dir" \
    --flatten-debug-output \
    -e "TORAH_PDS_HOST=$TORAH_PDS_HOST" \
    -e "TORAH_PDS_DOMAIN=$TORAH_PDS_DOMAIN" \
    -e "E2E_RUN_ID=$E2E_RUN_ID" \
    -e "E2E_USER_A_HANDLE=$E2E_USER_A_HANDLE" \
    -e "E2E_USER_A_FULL_HANDLE=$E2E_USER_A_FULL_HANDLE" \
    -e "E2E_USER_A_EMAIL=$E2E_USER_A_EMAIL" \
    -e "E2E_USER_A_PASSWORD=$E2E_USER_A_PASSWORD" \
    "$flow_file" \
    2>&1 | tee "$log_file"
  local exit_code=${PIPESTATUS[0]}
  set -e

  # Check for app crash indicators in log
  local crash_found=false
  if grep -qE 'RCTExceptionsManager|Fatal|SIGABRT|EXC_CRASH|Invariant Violation|Application terminated' \
     "$log_file" 2>/dev/null; then
    crash_found=true
    log "WARNING: crash indicator found in $flow_name log"
    # Try to relaunch app for next flow
    xcrun simctl terminate "$device_id" com.davidpovarsky.torahsocial 2>/dev/null || true
    sleep 2
    xcrun simctl launch "$device_id" com.davidpovarsky.torahsocial 2>/dev/null || true
    sleep 3
  fi

  if [ "$exit_code" -eq 0 ] && [ "$crash_found" = false ]; then
    FLOW_RESULTS+=("PASS")
    log "PASS: $flow_name"
  else
    FLOW_RESULTS+=("FAIL")
    OVERALL_PASS=false
    log "FAIL: $flow_name (exit=$exit_code, crash=$crash_found)"
  fi
}

phase "Running Torah E2E flow suite"

# Run all Torah flows — in order of priority
FLOW_DIR="__e2e__/flows/torah"

if [ -d "$FLOW_DIR" ]; then
  run_flow "signup-noinvite" "$FLOW_DIR/torah-signup-noinvite.yml"
  run_flow "login-session" "$FLOW_DIR/torah-login-session.yml"
  run_flow "composer-english" "$FLOW_DIR/torah-composer-english.yml"
  run_flow "composer-hebrew" "$FLOW_DIR/torah-composer-hebrew.yml"
  run_flow "composer-reply" "$FLOW_DIR/torah-composer-reply.yml"
  run_flow "nav-tabs" "$FLOW_DIR/torah-nav-tabs.yml"
  run_flow "like-repost" "$FLOW_DIR/torah-like-repost.yml"
  run_flow "chat-dm" "$FLOW_DIR/torah-chat-dm.yml"
  run_flow "source-picker" "$FLOW_DIR/torah-source-picker.yml"
  run_flow "rtl-screenshots" "$FLOW_DIR/torah-rtl-screenshots.yml"
  run_flow "resilience" "$FLOW_DIR/torah-resilience.yml"
else
  log "ERROR: Torah flow directory not found: $FLOW_DIR"
  exit 1
fi

# -------------------------------------------------------------------------
# Summary matrix
# -------------------------------------------------------------------------
phase "Generating summary"

echo "" | tee "$artifact_dir/e2e-summary.txt"
echo "=== Torah Social E2E Summary (run $E2E_RUN_ID) ===" | tee -a "$artifact_dir/e2e-summary.txt"
echo "Device: $device_id ($platform)" | tee -a "$artifact_dir/e2e-summary.txt"
echo "" | tee -a "$artifact_dir/e2e-summary.txt"

PASS_COUNT=0
FAIL_COUNT=0
for i in "${!FLOW_NAMES[@]}"; do
  name="${FLOW_NAMES[$i]}"
  result="${FLOW_RESULTS[$i]}"
  if [ "$result" = "PASS" ]; then
    echo "  PASS: $name" | tee -a "$artifact_dir/e2e-summary.txt"
    ((PASS_COUNT++)) || true
  else
    echo "  FAIL: $name" | tee -a "$artifact_dir/e2e-summary.txt"
    ((FAIL_COUNT++)) || true
  fi
done

echo "" | tee -a "$artifact_dir/e2e-summary.txt"
echo "Total: ${#FLOW_NAMES[@]} flows | $PASS_COUNT passed | $FAIL_COUNT failed" | tee -a "$artifact_dir/e2e-summary.txt"

# Post summary to GitHub Actions job summary
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  echo "## Torah Social iOS E2E Summary" >> "$GITHUB_STEP_SUMMARY"
  cat "$artifact_dir/e2e-summary.txt" >> "$GITHUB_STEP_SUMMARY"
fi

# Scan all logs for fatal patterns
echo "" | tee -a "$artifact_dir/e2e-summary.txt"
echo "=== Fatal error scan ==" | tee -a "$artifact_dir/e2e-summary.txt"
grep -rh -E 'RCTExceptionsManager|Fatal|SIGABRT|EXC_CRASH|Unhandled|ReferenceError|TypeError|Invariant Violation|Internal Server Error|MethodNotImplemented|Suggestions agent not available|Topics agent not available' \
  "$artifact_dir/flows/" 2>/dev/null | sort | uniq | \
  tee -a "$artifact_dir/e2e-summary.txt" || \
  echo "No fatal patterns found" | tee -a "$artifact_dir/e2e-summary.txt"

# Exit non-zero ONLY after all flows have run
if [ "$OVERALL_PASS" = true ]; then
  phase "All flows passed"
  exit 0
else
  phase "$FAIL_COUNT flows failed (see summary)"
  exit 1
fi
