#!/bin/bash
# sync-harness-docs.sh
# 테스트 실행 후 qa-lead.md 케이스 수 자동 동기화 + 전체 드리프트 검사
#
# 사용법:
#   ./sync-harness-docs.sh           # 테스트 실행 + 동기화 + 드리프트 검사
#   ./sync-harness-docs.sh --dry-run # 실행 없이 현재 케이스 수만 출력
#   ./sync-harness-docs.sh --drift   # 드리프트 검사만 (테스트 실행 없음)

set -eo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# harness-kit.conf 로드 (프로젝트별 설정)
CONF="$ROOT/harness-kit.conf"
if [[ -f "$CONF" ]]; then
    # shellcheck source=/dev/null
    source "$CONF"
else
    echo "⚠️  harness-kit.conf 없음 — install.sh를 먼저 실행하거나 harness-kit.conf를 생성하세요."
    exit 1
fi

# 멀티 세션 동시 실행 방지 — mkdir은 POSIX 원자 연산, macOS/Linux 모두 호환
LOCK_DIR="/tmp/sync-harness-docs.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "⚠️  sync-harness-docs 이미 실행 중 — 스킵"
    exit 0
fi
trap 'rm -rf "$LOCK_DIR"' EXIT

CHANGED=0
DRY_RUN=false
DRIFT_ONLY=false

# ── 인수 파싱 ──────────────────────────────────────────────────
for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=true ;;
        --drift)   DRIFT_ONLY=true ;;
    esac
done

# ── 색상 출력 ──────────────────────────────────────────────────
GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; RED=$'\033[0;31m'; RESET=$'\033[0m'
info()  { echo "  ${YELLOW}▶${RESET} $*"; }
ok()    { echo "  ${GREEN}✅${RESET} $*"; }
warn()  { echo "  ${RED}⚠️ ${RESET} $*"; }

# ── sed 인플레이스 (macOS/Linux 공통) ─────────────────────────
sed_inplace() {
    if [[ "$(uname)" == "Darwin" ]]; then
        sed -i '' "$@"
    else
        sed -i "$@"
    fi
}

# ═══════════════════════════════════════════════════════════════
# 1. 케이스 수 파싱 (드리프트 전용 모드 제외)
# ═══════════════════════════════════════════════════════════════

if [[ "$DRIFT_ONLY" == "false" ]]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  🔢 케이스 수 동기화"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # PROJECTS 배열: harness-kit.conf에서 로드됨
    # 예: PROJECTS=("project_a" "project_b" "project_c")
    #
    # TEST_CMD_<프로젝트명>: 각 프로젝트 테스트 명령
    # 예: TEST_CMD_project_a="npm test"
    #     TEST_CMD_project_b="pytest -q"
    declare -A PROJECT_COUNTS

    for proj in "${PROJECTS[@]}"; do
        proj_dir="$ROOT/$proj"
        if [[ ! -d "$proj_dir" ]]; then
            warn "$proj 디렉토리 없음 — 스킵"
            continue
        fi

        # 프로젝트별 테스트 명령 조회 (변수명: TEST_CMD_<proj>)
        var_name="TEST_CMD_${proj//-/_}"
        test_cmd="${!var_name:-npm test}"

        info "$proj 테스트 실행 중... ($test_cmd)"
        proj_out=$(cd "$proj_dir" && eval "$test_cmd" 2>&1 || true)

        # 테스트 프레임워크별 케이스 수 파싱
        # Jest: "Tests: N passed"
        jest_count=$(echo "$proj_out" | grep -E "^Tests:" | grep -oE "[0-9]+ passed" | awk '{sum+=$1} END{print sum+0}')
        # node:test: "ℹ pass N"
        node_count=$(echo "$proj_out" | grep -E "^ℹ pass" | awk '{sum+=$3} END{print sum+0}')
        # pytest: "N passed"
        pytest_count=$(echo "$proj_out" | grep -oE "^[0-9]+ passed" | awk '{print $1}' | tail -1)
        pytest_count=${pytest_count:-0}

        total_count=$(( jest_count + node_count + pytest_count ))
        PROJECT_COUNTS[$proj]=$total_count
        ok "$proj: ${total_count}케이스 (jest:${jest_count} node:${node_count} pytest:${pytest_count})"
    done

    if [[ "$DRY_RUN" == "true" ]]; then
        echo ""
        echo "  [dry-run] 케이스 수:"
        for proj in "${PROJECTS[@]}"; do
            echo "    $proj=${PROJECT_COUNTS[$proj]:-0}"
        done
        echo ""
    else
        # sync-docs-helper.py 호출
        _args=("$ROOT")
        for proj in "${PROJECTS[@]}"; do
            _args+=("$proj" "${PROJECT_COUNTS[$proj]:-0}")
        done
        _py_out=$(python3 "$ROOT/scripts/sync-docs-helper.py" "${_args[@]}" 2>&1) || true
        echo "$_py_out" | grep -v "SYNC_CHANGED=" || true
        _py_changed=$(echo "$_py_out" | grep "SYNC_CHANGED=" | grep -oE "[0-9]+" || echo 0)
        CHANGED=$((CHANGED + _py_changed))
    fi
fi

# ═══════════════════════════════════════════════════════════════
# 2. 포트 드리프트 검사
# ═══════════════════════════════════════════════════════════════

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🔌 포트 드리프트 검사"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

PORT_DRIFT=0
check_port() {
    local label="$1" script="$2" port="$3"
    if [[ ! -f "$script" ]]; then
        warn "$label: $script 없음 (검사 스킵)"
        return
    fi
    if grep -qE "(:|PORT[=\s]+)$port" "$script" 2>/dev/null || grep -q ":$port" "$script" 2>/dev/null; then
        ok "$label :$port — 정상"
    else
        warn "PORT DRIFT: $label 포트 :$port 가 $(basename "$script") 에 없음"
        PORT_DRIFT=$((PORT_DRIFT+1))
    fi
}

# harness-kit.conf에서 포트 드리프트 체크 항목 로드
# 예: PORT_CHECKS=("project_a|start.sh|4000" "project_b|start.sh|3000")
if [[ -n "${PORT_CHECKS[*]+x}" ]]; then
    for entry in "${PORT_CHECKS[@]}"; do
        IFS='|' read -r proj script port <<< "$entry"
        check_port "$proj" "$ROOT/$proj/$script" "$port"
    done
else
    ok "포트 드리프트 검사 항목 없음 (harness-kit.conf에 PORT_CHECKS 추가 가능)"
fi

# ═══════════════════════════════════════════════════════════════
# 3. 에이전트 선언 ↔ 파일 일치 검사
# ═══════════════════════════════════════════════════════════════

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🤖 에이전트 선언 드리프트 검사"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

AGENT_DRIFT=0
check_agents() {
    local project_dir="$1" project_name="$2"
    local agents_dir="$project_dir/.claude/agents"
    local claude_md="$project_dir/CLAUDE.md"

    if [[ ! -d "$agents_dir" ]]; then return; fi
    if [[ ! -f "$claude_md" ]]; then return; fi

    for f in "$agents_dir"/*.md; do
        [[ -f "$f" ]] || continue
        local name
        name=$(basename "$f" .md)
        if ! grep -q "$name" "$claude_md" 2>/dev/null; then
            warn "UNDECLARED: [$project_name] $name (파일은 있으나 CLAUDE.md 에 선언 없음)"
            AGENT_DRIFT=$((AGENT_DRIFT+1))
        fi
    done
}

check_agents "$ROOT" "루트"
for proj in ${PROJECTS[@]+"${PROJECTS[@]}"}; do
    check_agents "$ROOT/$proj" "$proj"
done

[[ $AGENT_DRIFT -eq 0 ]] && ok "모든 에이전트 선언 정상"

# ═══════════════════════════════════════════════════════════════
# 4. 결과 요약
# ═══════════════════════════════════════════════════════════════

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [[ $PORT_DRIFT -gt 0 ]] || [[ $AGENT_DRIFT -gt 0 ]]; then
    echo "  ${RED}⚠️  드리프트 발견: 포트 ${PORT_DRIFT}건, 에이전트 선언 ${AGENT_DRIFT}건${RESET}"
    echo "  doc-keeper 에이전트를 호출하거나 위 경고를 수동으로 수정하세요."
else
    echo "  ${GREEN}✅ sync-harness-docs 완료 (문서 ${CHANGED}건 업데이트, 드리프트 없음)${RESET}"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
