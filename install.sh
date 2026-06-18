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

set -eo pipefail

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
# bash 3 호환 (macOS 기본 bash): declare -A 대신 eval 동적 변수 사용

if [[ ${#PROJECTS_ARRAY[@]} -eq 0 ]]; then
    prompt "테스트 명령 (예: npm test / pytest -q / cargo test)"
    read -r ROOT_TEST_CMD
    ROOT_TEST_CMD="${ROOT_TEST_CMD:-npm test}"
    ok "테스트 명령: $ROOT_TEST_CMD"
else
    for proj in "${PROJECTS_ARRAY[@]}"; do
        prompt "$proj 테스트 명령 (기본값: npm test)"
        read -r test_cmd
        _var="${proj//-/_}"
        eval "_TESTCMD_${_var}=\"${test_cmd:-npm test}\""
        eval "_val=\${_TESTCMD_${_var}}"
        ok "$proj: $_val"
    done
fi

# ── 질문 4: 텔레그램 봇 설치 여부 ──────────────────────────────
heading "4/5  텔레그램 QA 봇"
prompt "텔레그램 봇을 설치하시겠습니까? (y/N)"
read -r INSTALL_BOT
INSTALL_BOT="${INSTALL_BOT:-n}"

BOT_DIR_NAME=""
if [[ "$(echo "$INSTALL_BOT" | tr '[:upper:]' '[:lower:]')" == "y" ]]; then
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

# 동적 프로젝트 플레이스홀더 주입 (bash 3 호환, python3 사용)
# CLAUDE.root.md.template의 {{PROJECTS_SUMMARY}}/{{ECOSYSTEM_TOPOLOGY}}/{{PROJECTS_TABLE}}/{{PROJECT_LINKS}} 치환
_inject_projects_into_claude_md() {
    local dest="$1"
    local summary topology projects_table project_links p

    if [[ ${#PROJECTS_ARRAY[@]} -eq 0 ]]; then
        summary="단일 프로젝트"
        topology="단일 프로젝트 — 서브프로젝트 없이 루트에서 모든 에이전트가 동작합니다."$'\n'"서브프로젝트 추가 시 project-bootstrapper 에이전트를 사용하세요."
        projects_table="| (단일 프로젝트) | ./ | ⚙️ 기술 스택 | ⚙️ 역할 |"
        project_links="(서브프로젝트 없음 — project-bootstrapper로 추가하세요)"
    else
        summary=""
        for p in "${PROJECTS_ARRAY[@]}"; do
            summary="${summary}\`${p}\`, "
        done
        summary="${summary%, }"

        topology="⚙️ 프로젝트 구조에 맞게 다이어그램을 수정하세요."$'\n'
        topology="${topology}"$'\n'"등록 프로젝트:"
        for p in "${PROJECTS_ARRAY[@]}"; do
            topology="${topology}"$'\n'"  ${p}/"
        done

        projects_table=""
        for p in "${PROJECTS_ARRAY[@]}"; do
            projects_table="${projects_table}| ${p} | ${p}/ | ⚙️ 스택 | ⚙️ 역할 |"$'\n'
        done
        projects_table="${projects_table%$'\n'}"

        project_links=""
        for p in "${PROJECTS_ARRAY[@]}"; do
            project_links="${project_links}- [${p}/CLAUDE.md](${p}/CLAUDE.md)"$'\n'
        done
        project_links="${project_links%$'\n'}"
    fi

    python3 - "$dest" "$summary" "$topology" "$projects_table" "$project_links" << 'PYEOF'
import sys
dest = sys.argv[1]
summary, topology, table, links = sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
content = open(dest).read()
content = content.replace('{{PROJECTS_SUMMARY}}', summary)
content = content.replace('{{ECOSYSTEM_TOPOLOGY}}', topology)
content = content.replace('{{PROJECTS_TABLE}}', table)
content = content.replace('{{PROJECT_LINKS}}', links)
open(dest, 'w').write(content)
PYEOF
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
_inject_projects_into_claude_md "$TARGET_DIR/CLAUDE.md"
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

    # ① 에이전트 — 기존 있으면 건너뜀
    if [[ -d "$proj_dir/.claude/agents" ]] && ls "$proj_dir/.claude/agents/"*.md 2>/dev/null | grep -q .; then
        cnt=$(ls "$proj_dir/.claude/agents/"*.md | wc -l | tr -d ' ')
        warn "$proj 에이전트 ${cnt}개 이미 있음 — 건너뜀 (기존 보존)"
        warn "  덮어쓰려면: rm -rf \"$proj_dir/.claude/agents\" 후 install.sh 재실행"
    else
        info "$proj .claude/agents/ 생성..."
        mkdir -p "$proj_dir/.claude/agents"
        for src in "$KIT_DIR/agents/project/"*.md; do
            fname="$(basename "$src")"
            sed -e "s/{{THIS_PROJECT}}/$proj/g" \
                -e "s/{{ROOT_PROJECT}}/$ROOT_PROJECT/g" \
                "$src" > "$proj_dir/.claude/agents/$fname"
        done
        ok "$proj 에이전트 $(ls "$proj_dir/.claude/agents/"*.md | wc -l | tr -d ' ')개 설치"
    fi

    # ② CLAUDE.md — 기존 있으면 건너뜀
    if [[ -f "$proj_dir/CLAUDE.md" ]]; then
        warn "$proj/CLAUDE.md 이미 있음 — 건너뜀"
    else
        sed -e "s/{{THIS_PROJECT}}/$proj/g" \
            -e "s/{{ROOT_PROJECT}}/$ROOT_PROJECT/g" \
            "$KIT_DIR/templates/CLAUDE.project.md.template" > "$proj_dir/CLAUDE.md"
        ok "$proj/CLAUDE.md 생성"
    fi

    # ③ settings.json — 기존 있으면 건너뜀
    if [[ -f "$proj_dir/.claude/settings.json" ]]; then
        warn "$proj/.claude/settings.json 이미 있음 — 건너뜀"
    else
        mkdir -p "$proj_dir/.claude"
        cp "$KIT_DIR/settings/settings.project.json.template" "$proj_dir/.claude/settings.json"
        ok "$proj/.claude/settings.json 생성"
    fi
done

# ── scripts/ 설치 ─────────────────────────────────────────────
info "scripts/ 설치..."
mkdir -p "$TARGET_DIR/scripts"
cp "$KIT_DIR/scripts/sync-harness-docs.sh" "$TARGET_DIR/scripts/"
cp "$KIT_DIR/scripts/commit-docs.sh" "$TARGET_DIR/scripts/"
cp "$KIT_DIR/scripts/sync-docs-helper.py" "$TARGET_DIR/scripts/"
cp "$KIT_DIR/scripts/generate-docs.sh" "$TARGET_DIR/scripts/"
chmod +x "$TARGET_DIR/scripts/sync-harness-docs.sh"
chmod +x "$TARGET_DIR/scripts/commit-docs.sh"
chmod +x "$TARGET_DIR/scripts/generate-docs.sh"
ok "스크립트 4개 설치"

# ── harness-kit.conf 생성 ─────────────────────────────────────
info "harness-kit.conf 생성..."
{
    echo "# harness-kit.conf — 자동 생성됨 ($ROOT_PROJECT)"
    echo ""
    # PROJECTS 배열 출력 (bash 3 호환)
    printf 'PROJECTS=('
    for p in "${PROJECTS_ARRAY[@]}"; do
        printf '"%s" ' "$p"
    done
    printf ')\n'
    echo ""
    if [[ ${#PROJECTS_ARRAY[@]} -eq 0 ]]; then
        echo "ROOT_TEST_CMD=\"${ROOT_TEST_CMD:-npm test}\""
    fi
    echo ""
    for proj in "${PROJECTS_ARRAY[@]}"; do
        var="${proj//-/_}"
        eval "_cmd=\${_TESTCMD_${var}:-npm test}"
        echo "TEST_CMD_${var}=\"$_cmd\""
    done
    echo ""
    echo "PORT_CHECKS=("
    echo "    # \"project|project/start.sh|port\""
    echo ")"
} > "$TARGET_DIR/harness-kit.conf"
ok "harness-kit.conf 생성"

# ── docs/ 폴더 기본 구조 생성 ────────────────────────────────
info "docs/ 기본 구조 생성..."
if [[ ${#PROJECTS_ARRAY[@]} -eq 0 ]]; then
    # 단일 프로젝트 모드: 루트에 전체 docs/ 구조 생성
    mkdir -p "$TARGET_DIR/docs/specs"
    mkdir -p "$TARGET_DIR/docs/design"
    mkdir -p "$TARGET_DIR/docs/qa"
    mkdir -p "$TARGET_DIR/docs/deployment"
    mkdir -p "$TARGET_DIR/docs/ops"
    printf '# %s 문서\n\n<!-- 에이전트 팀이 자동 생성한 문서 인덱스입니다 -->\n<!-- 생성: bash scripts/generate-docs.sh -->\n' \
        "$ROOT_PROJECT" > "$TARGET_DIR/docs/README.md"
    ok "docs/ 구조 생성 (단일 프로젝트 모드)"
else
    # 멀티프로젝트 모드: 각 서브프로젝트 + 루트 architecture/
    for proj in "${PROJECTS_ARRAY[@]}"; do
        mkdir -p "$TARGET_DIR/$proj/docs/specs"
        mkdir -p "$TARGET_DIR/$proj/docs/design"
        mkdir -p "$TARGET_DIR/$proj/docs/qa"
        mkdir -p "$TARGET_DIR/$proj/docs/deployment"
        mkdir -p "$TARGET_DIR/$proj/docs/ops"
        printf '# %s 문서\n\n<!-- 에이전트 팀이 자동 생성한 문서 인덱스입니다 -->\n<!-- 생성: bash scripts/generate-docs.sh %s -->\n' \
            "$proj" "$proj" > "$TARGET_DIR/$proj/docs/README.md"
    done
    mkdir -p "$TARGET_DIR/docs/architecture"
    printf '# %s 전체 아키텍처 문서\n\n<!-- 에이전트 팀이 자동 생성한 문서 인덱스입니다 -->\n<!-- 생성: bash scripts/generate-docs.sh -->\n' \
        "$ROOT_PROJECT" > "$TARGET_DIR/docs/README.md"
    ok "docs/ 구조 생성 (서브프로젝트 ${#PROJECTS_ARRAY[@]}개 + 루트 architecture/)"
fi

# ── tests/ 폴더 스캐폴드 생성 ────────────────────────────────
# 테스트 커맨드에서 언어·프레임워크를 추론해 적합한 폴더 + 샘플 파일 생성
# bash 3 호환: ${var,,} 금지 → tr 사용
_create_test_scaffold() {
    local dir="$1" test_cmd="$2"
    local cmd_lower
    cmd_lower=$(echo "$test_cmd" | tr '[:upper:]' '[:lower:]')

    if echo "$cmd_lower" | grep -qE "pytest|python -m pytest|python3 -m pytest"; then
        mkdir -p "$dir/tests"
        [ ! -f "$dir/tests/__init__.py" ] && printf '' > "$dir/tests/__init__.py"
        if [ ! -f "$dir/tests/test_sample.py" ]; then
            printf '# sample test — 실제 테스트로 교체하세요\n\ndef test_placeholder():\n    assert True\n' \
                > "$dir/tests/test_sample.py"
        fi
    elif echo "$cmd_lower" | grep -qE "cargo test|cargo nextest"; then
        mkdir -p "$dir/tests"
        if [ ! -f "$dir/tests/integration_test.rs" ]; then
            printf '// integration test — 실제 테스트로 교체하세요\n#[test]\nfn placeholder() {\n    assert!(true);\n}\n' \
                > "$dir/tests/integration_test.rs"
        fi
    elif echo "$cmd_lower" | grep -qE "go test"; then
        # Go: 테스트는 소스와 같은 패키지에 위치 (tests/ 는 통합 테스트용)
        mkdir -p "$dir/tests"
        [ ! -f "$dir/tests/.gitkeep" ] && printf '' > "$dir/tests/.gitkeep"
    elif echo "$cmd_lower" | grep -qE "jest|vitest|npm|pnpm|yarn|bun"; then
        mkdir -p "$dir/__tests__"
        if [ ! -f "$dir/__tests__/sample.test.js" ]; then
            printf '// sample test — 실제 테스트로 교체하세요\ndescribe("placeholder", () => {\n  it("passes", () => {\n    expect(true).toBe(true);\n  });\n});\n' \
                > "$dir/__tests__/sample.test.js"
        fi
    else
        # 기타(rspec, mocha, pytest 변형 등): 범용 tests/
        mkdir -p "$dir/tests"
        [ ! -f "$dir/tests/.gitkeep" ] && printf '' > "$dir/tests/.gitkeep"
    fi
}

info "tests/ 스캐폴드 생성..."
if [[ ${#PROJECTS_ARRAY[@]} -eq 0 ]]; then
    _create_test_scaffold "$TARGET_DIR" "$ROOT_TEST_CMD"
    ok "tests/ 스캐폴드 생성 (단일 프로젝트 모드)"
else
    for proj in "${PROJECTS_ARRAY[@]}"; do
        _var="${proj//-/_}"
        eval "_cmd=\${_TESTCMD_${_var}:-npm test}"
        _create_test_scaffold "$TARGET_DIR/$proj" "$_cmd"
    done
    ok "tests/ 스캐폴드 생성 (서브프로젝트 ${#PROJECTS_ARRAY[@]}개)"
fi

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
    # 컴파일된 JS 복사 (고객은 node dist/bot.js 로 바로 실행)
    cp "$KIT_DIR/telegram-bot/dist/bot.js" "$TARGET_DIR/$BOT_DIR_NAME/"
    cp "$KIT_DIR/telegram-bot/config.example.json" "$TARGET_DIR/$BOT_DIR_NAME/"
    cp "$KIT_DIR/telegram-bot/dbq.sh.template" "$TARGET_DIR/$BOT_DIR_NAME/dbq.sh"
    cp "$KIT_DIR/telegram-bot/redisq.sh.template" "$TARGET_DIR/$BOT_DIR_NAME/redisq.sh"
    cp "$KIT_DIR/telegram-bot/usercheck.sh.template" "$TARGET_DIR/$BOT_DIR_NAME/usercheck.sh"
    chmod +x "$TARGET_DIR/$BOT_DIR_NAME/dbq.sh"
    chmod +x "$TARGET_DIR/$BOT_DIR_NAME/redisq.sh"
    chmod +x "$TARGET_DIR/$BOT_DIR_NAME/usercheck.sh"
    ok "텔레그램 봇 파일 5개 설치 (dist/bot.js 포함)"
fi

# ── 초기 docs/ 문서 자동 생성 ────────────────────────────────
echo ""
if command -v claude >/dev/null 2>&1; then
    info "초기 docs/ 문서 자동 생성 중... (claude 에이전트 팀 실행, 3~10분 소요)"
    cd "$TARGET_DIR"
    claude -p --permission-mode acceptEdits --output-format text \
        "doc-generator 에이전트를 Agent 도구로 호출해 docs/ 전체를 생성해줘" 2>/dev/null \
        && ok "초기 docs/ 문서 생성 완료" \
        || warn "문서 자동 생성 실패 — 나중에 'bash scripts/generate-docs.sh' 실행"
else
    warn "claude CLI 없음 — 설치 후 'bash scripts/generate-docs.sh' 로 문서를 생성하세요"
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
echo "  4. 문서 재생성 필요 시: ${YELLOW}bash scripts/generate-docs.sh${RESET}"
if [[ -n "$BOT_DIR_NAME" ]]; then
    echo ""
    echo "  📱 텔레그램 봇:"
    echo "     cp $BOT_DIR_NAME/config.example.json $BOT_DIR_NAME/config.json"
    echo "     → config.json 에 botToken, adminChatIds 등 입력"
    echo "     → dbq.sh, redisq.sh 에 실제 DB URL 입력"
    echo "     node $BOT_DIR_NAME/bot.js"
fi
echo ""
echo "  🔍 Claude Code에서 프로젝트 열기:"
echo "     code $TARGET_DIR"
echo "     (에이전트는 자동으로 .claude/agents/ 에서 로드됩니다)"
echo ""
