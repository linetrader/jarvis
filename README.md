# claude-harness-kit

Claude Code 하네스 엔지니어링 시스템 + 팀 에이전트를 어느 프로젝트에도 이식할 수 있는 패키지.

`install.sh` 한 번으로 다음을 설치합니다:

- **에이전트 팀** — 루트 10개 + 프로젝트 공통 10개 (Claude Code `.claude/agents/`)
- **CLAUDE.md 템플릿** — 루트 + 서브프로젝트 오케스트레이션 문서
- **자동화 스크립트** — 테스트 케이스 수 동기화, 배포 후 문서 정리
- **텔레그램 QA 봇** (선택) — 버그 리포트 → 트리아지 → 자동수정 → 배포 파이프라인

---

## 빠른 시작

```bash
# 1. 이 레포 클론
git clone https://github.com/YOUR_ORG/claude-harness-kit

# 2. 프로젝트 루트로 이동 후 설치
cd your-project
bash ../claude-harness-kit/install.sh
```

설치 마법사가 5가지를 물어봅니다:
1. 루트 프로젝트 이름
2. 서브프로젝트 목록 (콤마 구분, 없으면 단일 프로젝트 모드)
3. 각 프로젝트 테스트 명령
4. 텔레그램 봇 설치 여부
5. 배포 플랫폼 명령

---

## 설치 후 커스터마이징

### 필수 수정 항목 (⚙️ 표시)

| 파일 | 수정 내용 |
|---|---|
| `CLAUDE.md` | 에코시스템 토폴로지, 포트 배치 |
| `.claude/agents/integration-contract-expert.md` | 실제 계약(HMAC, API, WS) |
| `.claude/agents/mission-control.md` | 프로젝트별 도메인 라우팅 |
| `harness-kit.conf` | 포트 드리프트 검사 항목 |
| 각 프로젝트 `CLAUDE.md` | 기술 스택, 환경변수, 에이전트 목록 |

에이전트 파일 내 `⚙️` 표시가 있는 곳이 모두 수정 대상입니다.

---

## 에이전트 팀

### 루트 오케스트레이션 (`.claude/agents/`)

| 에이전트 | 모델 | 역할 |
|---|---|---|
| `pm` | sonnet | 상위 목표 → 프로젝트별 업무 패키지 분해 |
| `mission-control` | sonnet | 업무 패키지 → 각 프로젝트 디스패치 |
| `qa-lead` | sonnet | 전 프로젝트 교차검증 게이트 |
| `integration-contract-expert` | opus | 프로젝트 간 계약 소유, 대칭 변경 설계 |
| `ops-coordinator` | sonnet | 기동 순서·포트·env 충돌 관리 |
| `ecosystem-architect` | opus | 에코시스템 아키텍처 설계 (코드 수정 금지) |
| `code-compliance-checker` | haiku | 경계 위반·CLAUDE.md 경로 실존 탐지 |
| `telegram-bot-expert` | sonnet | 텔레그램 QA 봇 장애 진단·파이프라인 유지 |
| `doc-keeper` | haiku | 코드 변경 후 문서 자동 동기화 |
| `market-researcher` | sonnet | 경쟁사·시장 외부 리서치 (WebSearch) |

### 프로젝트 공통 (`<project>/.claude/agents/`)

| 에이전트 | 모델 | 역할 |
|---|---|---|
| `pm` | sonnet | 프로젝트 제품 기획·PRD |
| `qa-lead` | sonnet | 테스트 시나리오·리그레션·배포 판단 |
| `deploy-manager` | sonnet | git add·commit·push·배포 상태 체크 |
| `product-planner` | sonnet | FRD·화면 기획·플로우·에러 메시지 정의 |
| `growth-pm` | sonnet | 성장 전략·온보딩·리텐션·KPI |
| `ui-ux-designer` | sonnet | 디자인 시스템·UX 플로우·레이아웃 스펙 |
| `domain-expert` | opus | 도메인 로직 리뷰 전용 (코드 수정 안 함) |
| `routine-tasks` | haiku | 타입체크·로그 스캔·탐색·포맷 등 반복 작업 |
| `code-compliance-checker` | haiku | CLAUDE.md 규칙 위반·문서-코드 일치 검사 |
| `doc-keeper` | haiku | 코드 변경 후 문서 자동 동기화 |

---

## 자동화 스크립트

### sync-harness-docs.sh

테스트 실행 → qa-lead.md 케이스 수 동기화 → 드리프트 검사를 한 번에.

```bash
# 테스트 실행 + 케이스 수 동기화 + 드리프트 검사
bash scripts/sync-harness-docs.sh

# 드리프트 검사만 (테스트 실행 없음)
bash scripts/sync-harness-docs.sh --drift

# 실행 없이 현재 케이스 수만 출력
bash scripts/sync-harness-docs.sh --dry-run
```

### commit-docs.sh

배포 성공 후 `temp/` 정리 + 문서 업데이트.

```bash
bash scripts/commit-docs.sh
```

### harness-kit.conf

`sync-harness-docs.sh`가 참조하는 설정 파일. 프로젝트 목록과 테스트 명령, 포트 체크 항목을 정의합니다.

---

## temp/ 워크플로우

모든 실질적 변경은 다음 흐름으로 진행됩니다:

```
PM 호출 → temp/<timestamp>/ 생성 (changes.md + status.md)
  → mission-control 디스패치
  → 각 프로젝트 구현
  → qa-lead 검증 (QA_PASS)
  → PM이 STATUS: READY 기록
  → deploy-manager 배포 → commit-docs.sh 실행 (temp 삭제)
```

`temp/`는 `.gitignore`에 자동 추가됩니다.

---

## 텔레그램 QA 봇 (선택)

install.sh에서 "y"를 선택하면 `.telegram-bot/` (또는 지정한 이름)에 설치됩니다.

```bash
# 1. config 설정
cp .telegram-bot/config.example.json .telegram-bot/config.json
# → config.json에 botToken, adminChatIds, testerGroupIds 입력
# → dbq.sh에 실제 DB URL 입력
# → redisq.sh에 실제 Redis URL 입력

# 2. 봇 실행
node .telegram-bot/bot.mjs
```

### 봇 파이프라인

```
테스터 그룹에서 /bug 버그 리포트
  → 트리아지: 배포서버 log + DB + Redis 조사
  → BUG: 코드 수정 → 빌드·타입체크 → QA → 관리자에게 /approve 요청
  → USER_ERROR / EXPECTED: 설명 리포트 발송 (코드 수정 X)
  → /approve → 배포 (git push → 플랫폼 자동배포)
```

---

## 하네스 엔지니어링 원칙

이 키트가 강제하는 4가지 원칙:

1. **Test-Harness First** — 코드 변경 전 검증 시나리오·DoD 먼저 정의
2. **격리/의존성 주입** — `src/core/` (순수 로직) + `src/infra/` (실 의존성) 분리
3. **Observability** — 분담·진행·검증 결과를 세션 내 인라인 추적
4. **Validation** — PM이 정한 DoD를 QA Leader가 검증 후 배포 허가

---

## 파일 구조

```
claude-harness-kit/
├── install.sh                        # 대화형 설치 스크립트
├── harness-kit.conf                  # 설정 파일 (install.sh가 생성)
├── agents/
│   ├── jarvis/                       # 루트 오케스트레이션 에이전트 10개
│   └── project/                      # 프로젝트 공통 에이전트 10개
├── templates/
│   ├── CLAUDE.root.md.template       # 루트 CLAUDE.md 뼈대
│   └── CLAUDE.project.md.template    # 프로젝트 CLAUDE.md 뼈대
├── scripts/
│   ├── sync-harness-docs.sh          # 테스트 동기화 + 드리프트 검사
│   ├── commit-docs.sh                # 배포 후 문서 정리
│   └── sync-docs-helper.py           # 케이스 수 갱신 헬퍼
├── settings/
│   ├── settings.root.json.template   # 루트 .claude/settings.json
│   └── settings.project.json.template
└── telegram-bot/
    ├── bot.mjs                       # 봇 엔진 (Node.js, 무의존성)
    ├── config.example.json           # 설정 예시 (민감 정보 제거)
    ├── dbq.sh.template               # Postgres 읽기전용 쿼리 래퍼
    ├── redisq.sh.template            # Redis 읽기전용 명령 래퍼
    └── usercheck.sh.template         # 사용자 데이터 통합 조회
```

---

## 라이선스

MIT
