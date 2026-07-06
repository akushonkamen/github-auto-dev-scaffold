#!/usr/bin/env bash
# lang-detect.sh — Language detection unit test
#
# Tests the CJK character ratio heuristic used by clarify-loop.yml preflight
# and develop.yml preflight. Threshold: ≥30% CJK → "zh". Includes mixed-content
# edge case per OQ-11.
#
# Usage: ./scripts/test/lang-detect.sh

set -euo pipefail

pass_count=0
fail_count=0

assert_lang() {
  local desc="$1" input="$2" expected="$3"
  local total cjk ratio lang
  total=$(printf '%s' "$input" | tr -d '[:space:]' | wc -m | tr -d ' ')
  cjk=$(printf '%s' "$input" | LC_ALL=C grep -oE $'[\xe4-\xe9][\x80-\xbf][\x80-\xbf]' | wc -l | tr -d ' ' || true)
  lang="en"
  if [ "$total" -gt 0 ] && [ "$cjk" -gt 0 ]; then
    ratio=$((cjk * 100 / total))
    if [ "$ratio" -ge 30 ]; then lang="zh"; fi
  fi
  if [ "$lang" = "$expected" ]; then
    echo "PASS: $desc (cjk=$cjk total=$total ratio=${ratio:-0}% lang=$lang)"
    pass_count=$((pass_count + 1))
  else
    echo "FAIL: $desc — expected $expected, got $lang (cjk=$cjk total=$total ratio=${ratio:-0}%)"
    fail_count=$((fail_count + 1))
  fi
}

# ---- Test 1: pure English ----
assert_lang "pure English" "This is a bug report about the login page. It has detailed reproduction steps." "en"

# ---- Test 2: pure Chinese ----
assert_lang "pure Chinese" "这是一个关于登录页面的Bug报告，包含详细的复现步骤和预期行为描述。" "zh"

# ---- Test 3: English with a few Chinese characters (below threshold) ----
assert_lang "mostly English, few CJK" "Please add a 登录 button to the header. The rest of the page is in English." "en"

# ---- Test 4: Chinese with some English technical terms ----
assert_lang "mostly Chinese, English tech terms" "请修复API接口的bug。当用户点击提交按钮时，POST请求没有发送到后端服务器。" "zh"

# ---- Test 5: 50/50 mixed content (OQ-11 edge case) ----
assert_lang "50/50 mixed" "登录页面有bug需要修复请尽快处理这个问题 please fix ASAP" "zh"

# ---- Test 6: empty body ----
assert_lang "empty body" "" "en"

# ---- Test 7: whitespace only ----
assert_lang "whitespace only" "   \n  \t  " "en"

# ---- Test 8: code block with comments in Chinese ----
assert_lang "Chinese comments in code" '// 这是一个处理用户登录验证的函数
function login() {
  // 验证用户输入并返回结果
  return validateInput();
}
// 这个函数有bug需要修复因为登录逻辑错误' "zh"

# ---- Summary ----
echo ""
echo "============================================"
echo "Language detection: $pass_count passed, $fail_count failed"
echo "============================================"

if [ "$fail_count" -gt 0 ]; then
  exit 1
fi
