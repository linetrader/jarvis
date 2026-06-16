#!/bin/bash
# generate-docs.sh [PROJECT]
# 에이전트 팀이 docs/ 문서를 생성하거나 업데이트한다.
#
# 사용법:
#   bash scripts/generate-docs.sh          # 루트 + 전체 서브프로젝트
#   bash scripts/generate-docs.sh subA     # subA 프로젝트만

set -eo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJ="${1:-}"

GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; RESET=$'\033[0m'
info() { echo "  ${YELLOW}▶${RESET} $*"; }
ok()   { echo "  ${GREEN}✅${RESET} $*"; }

if ! command -v claude >/dev/null 2>&1; then
    echo "❌ claude CLI 를 찾을 수 없습니다."
    echo "   Claude Code 를 설치하고 다시 실행하세요: https://claude.ai/code"
    exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  📄 docs/ 문서 생성 시작"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ -n "$PROJ" ]]; then
    # 특정 프로젝트만 생성
    PROJ_DIR="$ROOT/$PROJ"
    if [[ ! -d "$PROJ_DIR" ]]; then
        echo "❌ 프로젝트 디렉토리 없음: $PROJ_DIR"
        exit 1
    fi
    info "$PROJ docs/ 생성 중... (3~10분 소요)"
    cd "$PROJ_DIR"
    claude -p --permission-mode acceptEdits --output-format text \
        "이 디렉토리의 doc-generator 에이전트를 Agent 도구로 호출해 docs/ 전체를 생성해줘"
    ok "$PROJ docs/ 생성 완료"
else
    # 전체 생성 (루트 + 서브프로젝트)
    info "전체 docs/ 생성 중... (5~15분 소요)"
    cd "$ROOT"
    claude -p --permission-mode acceptEdits --output-format text \
        "루트 doc-generator 에이전트를 Agent 도구로 호출해 docs/ 와 각 서브프로젝트 docs/ 를 모두 생성해줘"
    ok "전체 docs/ 생성 완료"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ${GREEN}✅ 완료${RESET}"
echo "  나중에 다시 생성: bash scripts/generate-docs.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
