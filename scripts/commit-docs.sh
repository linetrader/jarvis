#!/bin/bash
# commit-docs.sh [temp-dir]
# deploy-manager가 배포 성공 확인 후 호출.
# STATUS: READY 상태인 temp의 변경 사항을 실제 파일에 적용하고 temp 삭제.
#
# 인수 있음: 지정된 temp 하나만 처리 (단일 세션)
# 인수 없음: temp/ 아래 모든 항목을 순서대로 처리 (멀티 세션 안전)

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# 동시 실행 방지 락 — 두 창이 동시에 배포해도 문서 파일 충돌 없이 순차 처리
LOCK_DIR="/tmp/commit-docs.lock"
LOCK_WAIT=0
until mkdir "$LOCK_DIR" 2>/dev/null; do
    if [[ $LOCK_WAIT -eq 0 ]]; then
        echo "⏳ commit-docs.sh 이미 실행 중 — 완료 대기..."
    fi
    sleep 1
    LOCK_WAIT=$((LOCK_WAIT + 1))
    if [[ $LOCK_WAIT -ge 60 ]]; then
        echo "❌ 락 대기 60초 초과 — 강제 해제 후 진행"
        rm -rf "$LOCK_DIR"
    fi
done
trap 'rm -rf "$LOCK_DIR"' EXIT

process_temp() {
    local TEMP_DIR="$1"

    if [[ -z "$TEMP_DIR" ]] || [[ ! -d "$TEMP_DIR" ]]; then
        return 0
    fi

    # READY 게이트 — STATUS: READY 없으면 아직 작업 중인 temp → 건드리지 않음
    # 다른 세션의 배포가 이 temp를 실수로 처리하는 것을 방지
    if ! grep -q "STATUS: READY" "$TEMP_DIR/status.md" 2>/dev/null; then
        echo "⏭  $(basename "$TEMP_DIR") — STATUS: READY 아님, 스킵 (아직 작업 중이거나 미확정)"
        return 0
    fi

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  📄 배포 성공 후 문서 업데이트"
    echo "  temp: $(basename "$TEMP_DIR")"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # 케이스 수 동기화 (테스트 케이스가 바뀐 경우)
    if grep -q "케이스" "$TEMP_DIR/changes.md" 2>/dev/null; then
        bash "$ROOT/scripts/sync-harness-docs.sh" 2>/dev/null || true
    fi

    # status 업데이트
    echo "STATUS: COMMITTED" >> "$TEMP_DIR/status.md" 2>/dev/null || true

    # temp 삭제
    rm -rf "$TEMP_DIR"
    echo ""
    echo "  ✅ 완료 ($(basename "$TEMP_DIR") 삭제)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
}

if [[ -n "${1:-}" ]]; then
    # 특정 temp dir 지정 시 그것만 처리
    process_temp "$1"
else
    # 인수 없으면 모든 temp를 오래된 순(생성 순)으로 처리
    # 멀티 세션 시 여러 temp가 쌓여도 모두 소비됨
    TEMP_LIST=$(ls -t "$ROOT/temp/" 2>/dev/null | grep -v "^$" || true)
    if [[ -z "$TEMP_LIST" ]]; then
        echo "⚠️  temp 항목 없음 — 문서 업데이트 스킵"
        exit 0
    fi
    # 오래된 것부터 처리 (tail -r: macOS/BSD / tac: Linux)
    if command -v tac &>/dev/null; then
        SORTED=$(echo "$TEMP_LIST" | tac)
    else
        SORTED=$(echo "$TEMP_LIST" | tail -r)
    fi
    echo "$SORTED" | while read -r entry; do
        TEMP_DIR="$ROOT/temp/$entry"
        [[ -d "$TEMP_DIR" ]] && process_temp "$TEMP_DIR"
    done
fi
