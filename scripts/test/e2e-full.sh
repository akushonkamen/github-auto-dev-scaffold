#!/usr/bin/env bash
# ============================================================================
# LAYER 4 — Full End-to-End Test Runner (Master Orchestrator)
#
# Runs all 4 layers in order. Each layer gates the next — if a layer fails,
# subsequent layers are skipped with a clear report of what's blocked.
#
# Layers:
#   0. Static validation (bash -n, ruby -ryaml, actionlint, no secrets)
#   1. Unit tests (parse-clarify-state, lang-detect, boundary, coexistence)
#   2. Integration tests (extract.sh mock data, selfcheck.sh)
#   3. Workflow logic tests (decision trees, S1/S3 guards, triggers)
#
# Layer 4 (live) is NOT run automatically — it requires a real GitHub repo
# with configured Secrets/Variables. See the "Live E2E Checklist" printed
# at the end.
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PASS_LAYERS=0
FAIL_LAYERS=0
declare -a FAILED_LAYERS=()

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'

header() {
  echo ""
  echo -e "${BOLD}══════════════════════════════════════════════════════════════${NC}"
  echo -e "${BOLD}  $1${NC}"
  echo -e "${BOLD}══════════════════════════════════════════════════════════════${NC}"
  echo ""
}

run_layer() {
  local layer="$1" desc="$2" script="$3"
  header "LAYER $layer: $desc"
  if [ -f "$ROOT/$script" ]; then
    if bash "$ROOT/$script"; then
      echo ""
      echo -e "${GREEN}✓ LAYER $layer PASSED${NC}"
      PASS_LAYERS=$((PASS_LAYERS+1))
      return 0
    else
      echo ""
      echo -e "${RED}✗ LAYER $layer FAILED${NC}"
      FAIL_LAYERS=$((FAIL_LAYERS+1))
      FAILED_LAYERS+=("Layer $layer: $desc")
      return 1
    fi
  else
    echo -e "${YELLOW}⚠  Script not found: $script — skipping${NC}"
    return 0
  fi
}

# ─── Header ──────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║     GithubAutoDev — Full E2E Test Suite (Layers 0–3)         ║${NC}"
echo -e "${BOLD}║     $(date -u +"%Y-%m-%d %H:%M UTC")                                          ║${NC}"
echo -e "${BOLD}╚═══════════════════════════════════════════════════════════════╝${NC}"

# ─── Layer 0: Static Validation ──────────────────────────────────────────

header "LAYER 0: Static Validation"

L0_PASS=0
L0_FAIL=0

echo "── bash -n (syntax check on all scripts) ──"
while IFS= read -r -d '' script; do
  if bash -n "$script" 2>/dev/null; then
    L0_PASS=$((L0_PASS+1))
  else
    echo -e "  ${RED}FAIL${NC} bash -n: $script"
    L0_FAIL=$((L0_FAIL+1))
  fi
done < <(find "$ROOT/scripts" "$ROOT/.github" -name "*.sh" -print0)
echo "  $L0_PASS passed, $L0_FAIL failed"

echo ""
echo "── ruby -ryaml (YAML parse check) ──"
YAML_PASS=0; YAML_FAIL=0
while IFS= read -r -d '' yaml; do
  if ruby -ryaml -e "YAML.load_file('$yaml')" 2>/dev/null; then
    YAML_PASS=$((YAML_PASS+1))
  else
    echo -e "  ${RED}FAIL${NC} yaml parse: $yaml"
    YAML_FAIL=$((YAML_FAIL+1))
  fi
done < <(find "$ROOT/.github" \( -name "*.yml" -o -name "*.yaml" \) -print0)
echo "  $YAML_PASS passed, $YAML_FAIL failed"

echo ""
echo "── actionlint ──"
if command -v actionlint >/dev/null 2>&1; then
  if actionlint "$ROOT/.github/workflows/"*.yml 2>&1; then
    echo -e "  ${GREEN}PASS${NC} actionlint: 0 errors"
  else
    echo -e "  ${RED}FAIL${NC} actionlint: errors found"
    L0_FAIL=$((L0_FAIL+1))
  fi
else
  echo -e "  ${YELLOW}SKIP${NC} actionlint not installed (brew install actionlint)"
fi

echo ""
echo "── No secrets in source ──"
SECRET_HITS=$(grep -rE 'ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}' \
  "$ROOT/.github/" "$ROOT/scripts/" "$ROOT/docs/" 2>/dev/null | grep -v '.github/fixtures/' | grep -v '.omc/' || true)
if [ -z "$SECRET_HITS" ]; then
  echo -e "  ${GREEN}PASS${NC} no real secrets detected in source files"
else
  echo -e "  ${RED}FAIL${NC} possible secrets found:"
  echo "$SECRET_HITS" | sed 's/^/    /'
  L0_FAIL=$((L0_FAIL+1))
fi

if [ "$L0_FAIL" -gt 0 ]; then
  echo ""
  echo -e "${RED}✗ LAYER 0 FAILED ($L0_FAIL failures)${NC}"
  FAIL_LAYERS=$((FAIL_LAYERS+1))
  FAILED_LAYERS+=("Layer 0: static validation")
else
  echo ""
  echo -e "${GREEN}✓ LAYER 0 PASSED${NC}"
  PASS_LAYERS=$((PASS_LAYERS+1))
fi

# ─── Layer 1: Unit Tests ─────────────────────────────────────────────────

run_layer 1 "Unit Tests" "scripts/test/parse-clarify-state.sh" || true
run_layer 1b "Unit — Language Detection" "scripts/test/lang-detect.sh" || true
run_layer 1c "Unit — Boundary Round Counter" "scripts/test/boundary-round-counter.sh" || true
run_layer 1d "Unit — Coexistence v1/v2" "scripts/test/coexistence-v1v2.sh" || true

# ─── Layer 2: Integration Tests ──────────────────────────────────────────

run_layer 2 "Integration (extract.sh + selfcheck.sh)" "scripts/test/integration-extract.sh" || true

# ─── Layer 3: Workflow Logic Tests ───────────────────────────────────────

run_layer 3 "Workflow Logic (decision trees, guards)" "scripts/test/workflow-logic.sh" || true

# ─── Summary ─────────────────────────────────────────────────────────────

header "TEST SUITE SUMMARY"

echo "  Layers passed: $PASS_LAYERS"
echo "  Layers failed: $FAIL_LAYERS"

if [ ${#FAILED_LAYERS[@]} -gt 0 ]; then
  echo ""
  echo -e "${RED}Failed layers:${NC}"
  for fl in "${FAILED_LAYERS[@]}"; do
    echo "  - $fl"
  done
fi

echo ""
echo -e "${BOLD}──────────────────────────────────────────────────────────────${NC}"
echo ""
echo -e "${BOLD}  LAYER 4 (Live E2E) — Manual Checklist${NC}"
echo ""
echo "  Layer 4 requires a real GitHub repo with configured Secrets/Variables."
echo "  It is NOT run automatically. To execute it:"
echo ""
echo "  1. Push all code to GitHub:"
echo "     git push origin <branch>"
echo ""
echo "  2. Configure Secrets (Settings → Secrets and variables → Actions):"
echo "     - DEEPSEEK_API_KEY = your DeepSeek API key"
echo "     - CLAUDE_DEV_PAT   = fine-grained PAT (issues:write, contents:write, pull-requests:write)"
echo ""
echo "  3. Configure Variables (same page → Variables tab):"
echo "     - ANTHROPIC_BASE_URL     = https://api.deepseek.com/anthropic"
echo "     - CLAUDE_DEV_PAT_OWNER   = <your GitHub username>"
echo "     - TRIAGE_MODEL           = deepseek-v4-pro"
echo "     - DEVELOP_MODEL          = deepseek-v4-pro"
echo "     - CLARIFY_MAX_ROUNDS     = 3"
echo "     - CLARIFY_TIME_BUDGET_MIN = 30"
echo ""
echo "  4. Sync labels:"
echo "     gh label sync .github/labels.yml"
echo ""
echo "  5. Run live tests in order:"
echo ""
echo "     a) Single-module test — Triage:"
echo "        Open a test issue with a clear bug report."
echo "        Expected: comment from github-actions[bot] + 'triage' label."
echo ""
echo "     b) Single-module test — Clarify:"
echo "        Open a vague issue (e.g. 'make it faster')."
echo "        Expected: 'needs-clarify' label → claude asks a question."
echo "        Reply as the issue author → observe clarify-r-1 → accepted-by-claude."
echo ""
echo "     c) Single-module test — Develop:"
echo "        Apply 'accepted' label to a clear feature issue."
echo "        Expected: claude/issue-N-slug branch created + PR opened."
echo ""
echo "     d) Full pipeline:"
echo "        Open a well-specified bug report."
echo "        Expected: triage → (high conf) → accepted → develop → PR."
echo ""
echo "     e) Chinese issue:"
echo "        Open an issue in Chinese."
echo "        Expected: claude responds in Chinese at every stage."
echo ""
echo "     f) Prompt injection fixture:"
echo "        Submit the content of .github/fixtures/hostile-injection.md as an issue."
echo "        Expected: yielded (not accepted-by-claude)."
echo ""
echo "  6. Run fixture e2e script (requires live repo):"
echo "     bash scripts/test/clarify-e2e.sh"
echo ""
echo "  7. Verify PAT audit (requires gh CLI + live repo):"
echo "     bash scripts/audit/pat-rotation-check.sh"
echo "     bash scripts/audit/pat-actions.sh"
echo ""

if [ "$FAIL_LAYERS" -gt 0 ]; then
  echo -e "${RED}Some layers failed. Fix them before proceeding to Layer 4.${NC}"
  exit 1
else
  echo -e "${GREEN}All automated layers (0–3) passed. Ready for Layer 4 (live).${NC}"
  exit 0
fi
