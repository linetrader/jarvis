#!/bin/bash
# install.sh — jarvis 대화형 설치 스크립트
#
# 사용법:
#   cd /path/to/your-project
#   bash /path/to/jarvis/install.sh
#
# 또는:
#   git clone https://github.com/linetrader/jarvis
#   cd your-project && bash ../jarvis/install.sh

set -euo pipefail

# 색상 출력
GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; CYAN=$'\033[0;36m'; RED=$'\033[0;31m'; RESET=$'\033[0m'
info()    { echo "${CYAN}  ▶${RESET} $*"; }
ok()      { echo "${GREEN}  ✅${RESET} $*"; }
warn()    { echo "${YELLOW}  ⚠️ ${RESET} $*"; }
heading() { echo ""; echo "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"; echo "${GREEN}  $*${RESET}"; echo "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"; }
prompt()  { printf "${YELLOW}  ? ${RESET}$* : "; }

# kit 디렉토리 (이 파일이 있는 곳)
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 설치 대상 (현재 디렉토리 또는 첫 번째 인수)
TARGET_DIR="${1:-$(pwd)}"

echo ""
echo "${GREEN}╔═══════════════════════════════════════╗${RESET}"
echo "${GREEN}║         jarvis 설치 마법사             ║${RESET}"
echo "${GREEN}╚═══════════════════════════════════════╝${RESET}"
echo ""
echo "  설치 위치: ${CYAN}$TARGET_DIR${RESET}"
echo ""

# ── 질문 1: 루트 프로젝트 이름 ────────────────────────────────
heading "1/5  루트 프로젝트 이름"
ROOT_PROJECT_DEFAULT="$(basename "$TARGET_DIR")"
prompt "루트 프로젝트 이름 (기본값: $ROOT_PROJECT_DEFAULT)"
read -r ROOT_PROJECT
ROOT_PROJECT="${ROOT_PROJECT:-$ROOT_PROJECT_DEFAULT}"
ok "루트 프로젝트: $ROOT_PROJECT"

# ── 질문 2: 서브프로젝트 목록 ──────────────────────────────────
heading "2/5  서브프로젝트 목록"
echo "  콤마로 구분 (예: backend,frontend,worker)"
echo "  서브프로젝트가 없으면 엔터 (단일 프로젝트 모드)"
prompt "서브프로젝트"
read -r PROJECTS_RAW

if [[ -z "$PROJECTS_RAW" ]]; then
    PROJECTS_ARRAY=()
    info "단일 프로젝트 모드 — 에이전트를 루트에만 설치합니다"
else
    IFS=',' read -ra PROJECTS_ARRAY <<< "$PROJECTS_RAW"
    # 공백 제거
    PROJECTS_CLEANED=()
    for p in "${PROJECTS_ARRAY[@]}"; do
        trimmed="${p// /}"
        PROJECTS_CLEANED+=("$trimmed")
    done
    PROJECTS_ARRAY=("${PROJECTS_CLEANED[@]}")
    ok "서브프로젝트: ${PROJECTS_ARRAY[*]}"
fi

# ── 질문 3: 테스트 명령 ──────────────────────────────────────────
heading "3/5  테스트 명령"
declare -A TEST_CMDS

if [[ ${#PROJECTS_ARRAY[@]} -eq 0 ]]; then
    prompt "테스트 명령 (예: npm test / pytest -q / cargo test)"
    read -r ROOT_TEST_CMD
    ROOT_TEST_CMD="${ROOT_TEST_CMD:-npm test}"
    TEST_CMDS["root"]="$ROOT_TEST_CMD"
    ok "테스트 명령: $ROOT_TEST_CMD"
else
    for proj in "${PROJECTS_ARRAY[@]}"; do
        prompt "$proj 테스트 명령 (기본값: npm test)"
        read -r test_cmd
        TEST_CMDS["$proj"]="${test_cmd:-npm test}"
        ok "$proj: ${TEST_CMDS[$proj]}"
    done
fi

# ── 질문 4: 텔레그램 봇 설치 여부 ──────────────────────────────
heading "4/5  텔레그램 QA 봇"
prompt "텔레그램 봇을 설치하시겠습니까? (y/N)"
read -r INSTALL_BOT
INSTALL_BOT="${INSTALL_BOT:-n}"

BOT_DIR_NAME=""
if [[ "${INSTALL_BOT,,}" == "y" ]]; then
    prompt "봇 폴더 이름 (기본값: .telegram-bot)"
    read -r BOT_DIR_NAME
    BOT_DIR_NAME="${BOT_DIR_NAME:-.telegram-bot}"
    ok "봇 폴더: $BOT_DIR_NAME"
else
    info "텔레그램 봇 설치 건너뜀"
fi

# ── 질문 5: 플랫폼 배포 명령 ──────────────────────────────────
heading "5/5  배포 플랫폼 (선택)"
echo "  배포 CLI 명령 (예: railway status, fly status, heroku ps)"
echo "  엔터로 건너뜀 (배포 없이 git push만 사용)"
prompt "배포 상태 확인 명령"
read -r DEPLOY_STATUS_CMD
DEPLOY_STATUS_CMD="${DEPLOY_STATUS_CMD:-echo 'git push origin main으로 배포'}"

# ══════════════════════════════════════════════════════════════
#  설치 시작
# ══════════════════════════════════════════════════════════════

heading "📦 설치 시작"

# ── 루트 .claude/ 생성 ───────────────────────────────────────
info "루트 .claude/agents/ 생성..."
mkdir -p "$TARGET_DIR/.claude/agents"

# sed 치환 함수 (macOS/Linux 공통)
sub() {
    local s="$1" from="$2" to="$3"
    if [[ "$(uname)" == "Darwin" ]]; then
        echo "$s" | sed "s|$from|$to|g"
    else
        echo "$s" | sed "s|$from|$to|g"
    fi
}

# 루트 에이전트 복사 + 플레이스홀더 치환
for src in "$KIT_DIR/agents/jarvis/"*.md; do
    fname="$(basename "$src")"
    dest="$TARGET_DIR/.claude/agents/$fname"
    # 플레이스홀더 치환
    PROJ_A="${PROJECTS_ARRAY[0]:-project_a}"
    PROJ_B="${PROJECTS_ARRAY[1]:-project_b}"
    PROJ_C="${PROJECTS_ARRAY[2]:-project_c}"
    sed -e "s/{{ROOT_PROJECT}}/$ROOT_PROJECT/g" \
        -e "s/{{PROJECT_A}}/$PROJ_A/g" \
        -e "s/{{PROJECT_B}}/$PROJ_B/g" \
        -e "s/{{PROJECT_C}}/$PROJ_C/g" \
        "$src" > "$dest"
done
ok "루트 에이전트 $(ls "$TARGET_DIR/.claude/agents/"*.md | wc -l | tr -d ' ')개 설치"

# 루트 CLAUDE.md 생성
info "루트 CLAUDE.md 생성..."
PROJ_A="${PROJECTS_ARRAY[0]:-project_a}"
PROJ_B="${PROJECTS_ARRAY[1]:-project_b}"
PROJ_C="${PROJECTS_ARRAY[2]:-project_c}"
sed -e "s/{{ROOT_PROJECT}}/$ROOT_PROJECT/g" \
    -e "s/{{PROJECT_A}}/$PROJ_A/g" \
    -e "s/{{PROJECT_B}}/$PROJ_B/g" \
    -e "s/{{PROJECT_C}}/$PROJ_C/g" \
    "$KIT_DIR/templates/CLAUDE.root.md.template" > "$TARGET_DIR/CLAUDE.md"
ok "CLAUDE.md 생성"

# 루트 .claude/settings.json 생성
info "루트 .claude/settings.json 생성..."
sed "s|{{ROOT_PATH}}|$TARGET_DIR|g" \
    "$KIT_DIR/settings/settings.root.json.template" > "$TARGET_DIR/.claude/settings.json"
ok ".claude/settings.json 생성"

# ── 서브프로젝트 에이전트 설치 ──────────────────────────────────
for proj in "${PROJECTS_ARRAY[@]}"; do
    proj_dir="$TARGET_DIR/$proj"
    if [[ ! -d "$proj_dir" ]]; then
        warn "$proj 디렉토리 없음 — 생성합니다"
        mkdir -p "$proj_dir"
    fi

    info "$proj .claude/agents/ 생성..."
    mkdir -p "$proj_dir/.claude/agents"

    # 프로젝트 에이전트 복사 + 치환
    for src in "$KIT_DIR/agents/project/"*.md; do
        fname="$(basename "$src")"
        dest="$proj_dir/.claude/agents/$fname"
        sed -e "s/{{THIS_PROJECT}}/$proj/g" \
            -e "s/{{ROOT_PROJECT}}/$ROOT_PROJECT/g" \
            "$src" > "$dest"
    done
    ok "$proj 에이전트 $(ls "$proj_dir/.claude/agents/"*.md | wc -l | tr -d ' ')개 설치"

    # 프로젝트 CLAUDE.md 생성
    sed -e "s/{{THIS_PROJECT}}/$proj/g" \
        -e "s/{{ROOT_PROJECT}}/$ROOT_PROJECT/g" \
        "$KIT_DIR/templates/CLAUDE.project.md.template" > "$proj_dir/CLAUDE.md"
    ok "$proj/CLAUDE.md 생성"

    # 프로젝트 settings.json 생성
    cp "$KIT_DIR/settings/settings.project.json.template" "$proj_dir/.claude/settings.json"
    ok "$proj/.claude/settings.json 생성"
done

# ── scripts/ 설치 ─────────────────────────────────────────────
info "scripts/ 설치..."
mkdir -p "$TARGET_DIR/scripts"
cp "$KIT_DIR/scripts/sync-harness-docs.sh" "$TARGET_DIR/scripts/"
cp "$KIT_DIR/scripts/commit-docs.sh" "$TARGET_DIR/scripts/"
cp "$KIT_DIR/scripts/sync-docs-helper.py" "$TARGET_DIR/scripts/"
chmod +x "$TARGET_DIR/scripts/sync-harness-docs.sh"
chmod +x "$TARGET_DIR/scripts/commit-docs.sh"
ok "스크립트 3개 설치"

# ── harness-kit.conf 생성 ─────────────────────────────────────
info "harness-kit.conf 생성..."
{
    echo "# harness-kit.conf — 자동 생성됨 ($ROOT_PROJECT)"
    echo ""
    if [[ ${#PROJECTS_ARRAY[@]} -eq 0 ]]; then
        echo "PROJECTS=()"
    else
        echo "PROJECTS=(${PROJECTS_ARRAY[*]/#/\"} )"
        # 따옴표 수정
        printf 'PROJECTS=(' > /dev/null
    fi
    echo ""
    # PROJECTS 배열 올바르게 출력
    printf 'PROJECTS=('
    for p in "${PROJECTS_ARRAY[@]}"; do
        printf '"%s" ' "$p"
    done
    printf ')\n'
    echo ""
    for proj in "${PROJECTS_ARRAY[@]}"; do
        var="${proj//-/_}"
        echo "TEST_CMD_${var}=\"${TEST_CMDS[$proj]:-npm test}\""
    done
    echo ""
    echo "PORT_CHECKS=("
    echo "    # \"project|project/start.sh|port\""
    echo ")"
} > "$TARGET_DIR/harness-kit.conf"
ok "harness-kit.conf 생성"

# ── temp/ 폴더 + .gitignore ──────────────────────────────────
mkdir -p "$TARGET_DIR/temp"
if [[ ! -f "$TARGET_DIR/.gitignore" ]]; then
    echo "temp/" > "$TARGET_DIR/.gitignore"
    echo ".env" >> "$TARGET_DIR/.gitignore"
    ok ".gitignore 생성"
else
    if ! grep -q "^temp/" "$TARGET_DIR/.gitignore"; then
        echo "temp/" >> "$TARGET_DIR/.gitignore"
        ok ".gitignore에 temp/ 추가"
    else
        ok ".gitignore 이미 temp/ 포함"
    fi
fi

# ── 텔레그램 봇 설치 (선택) ─────────────────────────────────────
if [[ -n "$BOT_DIR_NAME" ]]; then
    info "텔레그램 봇 설치 ($BOT_DIR_NAME/)..."
    mkdir -p "$TARGET_DIR/$BOT_DIR_NAME"
    cp "$KIT_DIR/telegram-bot/bot.mjs" "$TARGET_DIR/$BOT_DIR_NAME/"
    cp "$KIT_DIR/telegram-bot/config.example.json" "$TARGET_DIR/$BOT_DIR_NAME/"
    cp "$KIT_DIR/telegram-bot/dbq.sh.template" "$TARGET_DIR/$BOT_DIR_NAME/dbq.sh"
    cp "$KIT_DIR/telegram-bot/redisq.sh.template" "$TARGET_DIR/$BOT_DIR_NAME/redisq.sh"
    cp "$KIT_DIR/telegram-bot/usercheck.sh.template" "$TARGET_DIR/$BOT_DIR_NAME/usercheck.sh"
    chmod +x "$TARGET_DIR/$BOT_DIR_NAME/dbq.sh"
    chmod +x "$TARGET_DIR/$BOT_DIR_NAME/redisq.sh"
    chmod +x "$TARGET_DIR/$BOT_DIR_NAME/usercheck.sh"
    ok "텔레그램 봇 파일 5개 설치"
fi

# ── 완료 메시지 ─────────────────────────────────────────────────
echo ""
echo "${GREEN}╔═══════════════════════════════════════╗${RESET}"
echo "${GREEN}║          ✅ 설치 완료!                  ║${RESET}"
echo "${GREEN}╚═══════════════════════════════════════╝${RESET}"
echo ""
echo "  설치된 위치: ${CYAN}$TARGET_DIR${RESET}"
echo ""
echo "  📋 다음 단계:"
echo ""
echo "  1. ${YELLOW}CLAUDE.md${RESET} 열어서 ⚙️ 표시된 항목 수정"
echo "  2. 각 에이전트 파일에서 ⚙️ 항목 커스터마이즈"
echo "  3. ${YELLOW}harness-kit.conf${RESET} 에서 포트 드리프트 검사 항목 추가"
if [[ -n "$BOT_DIR_NAME" ]]; then
    echo ""
    echo "  📱 텔레그램 봇:"
    echo "     cp $BOT_DIR_NAME/config.example.json $BOT_DIR_NAME/config.json"
    echo "     → config.json 에 botToken, adminChatIds 등 입력"
    echo "     → dbq.sh, redisq.sh 에 실제 DB URL 입력"
    echo "     node $BOT_DIR_NAME/bot.mjs"
fi
echo ""
echo "  🔍 Claude Code에서 프로젝트 열기:"
echo "     code $TARGET_DIR"
echo "     (에이전트는 자동으로 .claude/agents/ 에서 로드됩니다)"
echo ""
