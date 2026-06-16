#!/usr/bin/env node
// Telegram QA 트리아지 + 자동수정 파이프라인 (makemoney 멀티프로젝트, config 기반)
// 무의존성: Node 24+ 내장 fetch / child_process
// 위치: makemoney/.telegram-<name>/bot.mjs  (REPO_BASE = makemoney 루트 = 한 단계 위)
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmdirSync } from 'node:fs';
import { exec } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BotConfigSchema, } from './types.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_BASE = join(__dirname, '..', '..'); // makemoney 루트 (dist/ 에서 두 단계 위)
const CONFIG_PATH = join(__dirname, '..', 'config.json');
const OFFSET_PATH = join(__dirname, '..', '.offset');
const UPLOAD_DIR = join(__dirname, '..', 'uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });
// ── config ───────────────────────────────────────────────
if (!existsSync(CONFIG_PATH)) {
    console.error(`[FATAL] config.json 없음. cp config.example.json config.json 후 토큰 입력.`);
    process.exit(1);
}
const rawCfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
const cfgParse = BotConfigSchema.safeParse(rawCfg);
if (!cfgParse.success) {
    console.error('[FATAL] config.json 유효성 오류:', JSON.stringify(cfgParse.error.format(), null, 2));
    process.exit(1);
}
const cfg = cfgParse.data;
if (!cfg.botToken || cfg.botToken.includes('PASTE_')) {
    console.error('[FATAL] config.json 의 botToken 을 설정하세요.');
    process.exit(1);
}
const API = `https://api.telegram.org/bot${cfg.botToken}`;
const ADMIN = new Set((cfg.adminChatIds).map(String));
const GROUPS = new Set((cfg.testerGroupIds).map(String));
// 테스터 그룹 → 거래소 브랜드 매핑
const BRAND_GROUPS = {};
for (const [k, v] of Object.entries(cfg.groupBrands))
    BRAND_GROUPS[String(k)] = String(v);
const BRAND_TENANT = {
    realbit: 'a96a70ca-f1e8-4ce9-a79a-fe08701bd41b',
    dunex: '22b5ccdf-5b81-4509-ac77-09aeada71815',
    riobx: '6a07fd1d-58f4-47a6-8a77-5510d7d26d71',
    vcdao: 'f848f249-700c-4c7c-be91-2d5d0e44538e',
};
const POLL_TIMEOUT = cfg.pollTimeoutSec ?? 30;
const TASK_TIMEOUT = (cfg.taskTimeoutSec ?? 1800) * 1000;
const TRIAGE_ALL = !!cfg.triageAllGroupText;
const BOT_NAME = cfg.botName || '자비스';
const FIX_CMD = cfg.fixCmd || 'claude -p --permission-mode acceptEdits --output-format text';
// 프로젝트 맵 (repoDir → 절대경로)
const PROJECTS = {};
for (const [name, p] of Object.entries(cfg.projects)) {
    PROJECTS[name] = { ...p, name, dir: join(REPO_BASE, p.repoDir || name) };
}
const COVERED = Object.values(PROJECTS);
const COVERED_NAMES = COVERED.map((p) => p.name);
const FIX_PROJECTS = COVERED.filter((p) => p.mode === 'fix');
const REPORT_PROJECTS = COVERED.filter((p) => p.mode === 'report');
if (!COVERED.length) {
    console.error('[FATAL] config.json 에 projects 가 비어있습니다.');
    process.exit(1);
}
const DEFAULT_FIX = FIX_PROJECTS[0]?.name || COVERED_NAMES[0] || '';
const DBQ = join(__dirname, '..', 'dbq.sh');
const REDISQ = join(__dirname, '..', 'redisq.sh');
const USERCHECK = join(__dirname, '..', 'usercheck.sh');
const DIAG_TOOLS = `'Bash(${DBQ}:*)' 'Bash(${REDISQ}:*)' 'Bash(${USERCHECK}:*)'`;
const DATASOURCES = `★ 특정 회원의 거래/주문/잔고/포지션 통합 조회는 이 한 줄이면 끝(빠름, 권장):\n` +
    `   \`${USERCHECK} <brand> <email|userId>\`  (brand: realbit|dunex|riobx|vcdao) → 회원+최근주문+자산(ExchangeBalance)+포지션+거래(Trade) 한 번에.\n` +
    `   여러 dbq 를 직접 돌리지 말고 이걸 우선 사용. 결과를 한국어로 요약.\n` +
    `[그 외 집계/목록/임의 조회 — \`${DBQ} <ds> "SELECT ... LIMIT N"\` (읽기전용)]\n` +
    `  hub-core: 주문 Order(수량=amount)/포지션 Position/자산 ExchangeBalance/마켓 Market  · hub-log: 거래 Trade  · hub-kline: 캔들\n` +
    `  realbit/dunex/riobx/vcdao: 각 브랜드 회원 User/API키/레퍼럴/수수료 CommissionHistory  · trading: 자동매매 회원/카피\n` +
    `[Redis — \`${REDISQ} <ds> "GET <key>"\` (읽기명령만)]\n` +
    `  hub-market: 시세/호가/24h  · hub-state: 큐/락/세션  · realbit/dunex/riobx/vcdao: 브랜드 redis  · trading: trading redis\n` +
    `※ 브랜드는 tenantId(브로커ID)로 hub 와 연결. 회원·인증=브랜드 DB, 실제 주문·거래·잔고·포지션=hub.`;
// ⚠️ --allowedTools 는 variadic 이라 그 뒤에 바로 프롬프트를 두면 프롬프트까지 도구로 먹는다.
const TRIAGE_CMD = `claude -p --model sonnet --allowedTools Read Grep Glob ${DIAG_TOOLS} 'Bash(railway logs:*)' --output-format text`;
const QA_CMD = `claude -p --model opus --allowedTools Read Grep Glob Agent --output-format text`;
const DEPLOY_CMD = cfg.deployCmd || `claude -p --permission-mode acceptEdits --allowedTools Read Grep Glob 'Bash(git:*)' 'Bash(railway:*)' --output-format text`;
const ADMIN_TASK_CMD = cfg.adminTaskCmd || `claude -p --permission-mode bypassPermissions --output-format text`;
const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
const escSh = (s) => String(s).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$').replace(/"/g, '\\"');
const PRIMARY = PROJECTS[cfg.primaryProject ?? ''] || FIX_PROJECTS[0] || COVERED[0];
let offset = 0;
if (existsSync(OFFSET_PATH))
    offset = Number(readFileSync(OFFSET_PATH, 'utf8')) || 0;
let BOT_USERNAME = '';
let BOT_ID = '';
// ── telegram helpers ─────────────────────────────────────
async function tg(method, body) {
    const res = await fetch(`${API}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    return res.json();
}
async function send(chatId, text) {
    const chunks = String(text).match(/[\s\S]{1,3800}/g) || [''];
    for (const c of chunks)
        await tg('sendMessage', { chat_id: chatId, text: c, disable_web_page_preview: true });
}
async function notifyAdmins(text) {
    for (const id of ADMIN)
        await send(id, text);
}
function typing(chatId) {
    const tick = () => { tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => { }); };
    tick();
    const id = setInterval(tick, 4000);
    return () => clearInterval(id);
}
async function downloadPhoto(fileId) {
    try {
        const r = await tg('getFile', { file_id: fileId });
        if (!r.ok)
            return null;
        const fp = r.result.file_path;
        if (!fp)
            return null;
        const res = await fetch(`https://api.telegram.org/file/bot${cfg.botToken}/${fp}`);
        if (!res.ok)
            return null;
        const buf = Buffer.from(await res.arrayBuffer());
        const ext = (fp.split('.').pop() || 'jpg').replace(/[^a-z0-9]/gi, '') || 'jpg';
        const out = join(UPLOAD_DIR, `${Date.now()}-${fileId.slice(-8)}.${ext}`);
        writeFileSync(out, buf);
        return out;
    }
    catch (e) {
        console.error('downloadPhoto', e.message);
        return null;
    }
}
// ── 언어 감지 (Unicode 범위 기반) ───────────────────────────
function detectLang(text) {
    if (!text)
        return '한국어';
    if (/[฀-๿]/.test(text))
        return 'Thai';
    if (/[぀-ヿㇰ-ㇿ]/.test(text))
        return 'Japanese';
    if (/[가-힣]/.test(text))
        return '한국어';
    if (/[一-鿿㐀-䶿]/.test(text))
        return 'Chinese';
    if (/[؀-ۿ]/.test(text))
        return 'Arabic';
    if (/[Ѐ-ӿ]/.test(text))
        return 'Russian';
    if (/[àáâãèéêìíòóôõùúýăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(text))
        return 'Vietnamese';
    return 'English';
}
// ── 진행 메시지 번역 테이블 ──────────────────────────────────
const I18N = {
    checking: {
        '한국어': (id, brand) => `🔎 #${id} 확인 중이에요…${brand ? ` [${brand}]` : ''} 잠시만 기다려 주세요 🙏`,
        'Thai': (id, brand) => `🔎 #${id} กำลังตรวจสอบ…${brand ? ` [${brand}]` : ''} กรุณารอสักครู่ 🙏`,
        'English': (id, brand) => `🔎 #${id} Checking…${brand ? ` [${brand}]` : ''} Hang tight 🙏`,
        'Vietnamese': (id, brand) => `🔎 #${id} Đang kiểm tra…${brand ? ` [${brand}]` : ''} Vui lòng đợi một chút 🙏`,
        'Chinese': (id, brand) => `🔎 #${id} 检查中…${brand ? ` [${brand}]` : ''} 请稍等 🙏`,
        'Japanese': (id, brand) => `🔎 #${id} 確認中…${brand ? ` [${brand}]` : ''} しばらくお待ちください 🙏`,
        'Arabic': (id, brand) => `🔎 #${id} جارٍ التحقق…${brand ? ` [${brand}]` : ''} يرجى الانتظار 🙏`,
        'Russian': (id, brand) => `🔎 #${id} Проверяем…${brand ? ` [${brand}]` : ''} Пожалуйста, подождите 🙏`,
    },
    outsideScope: {
        '한국어': '확인 결과 담당 외 영역 이슈로 보여 담당팀(루트)에 전달했습니다. 확인 후 반영됩니다 🙏',
        'Thai': 'ผลการตรวจสอบพบว่าปัญหานี้อยู่นอกขอบเขต ได้ส่งต่อให้ทีมที่รับผิดชอบแล้ว จะดำเนินการหลังตรวจสอบ 🙏',
        'English': 'This issue appears to be outside our scope and has been forwarded to the responsible team. 🙏',
        'Vietnamese': 'Vấn đề này nằm ngoài phạm vi của chúng tôi, đã chuyển cho nhóm phụ trách xử lý. 🙏',
        'Chinese': '此问题超出本组负责范围，已转交相关团队处理。🙏',
        'Japanese': '担当範囲外の問題と判断し、担当チームに転送しました。確認後対応します 🙏',
        'Arabic': 'يبدو أن المشكلة خارج نطاقنا، وقد تم إرسالها للفريق المسؤول 🙏',
        'Russian': 'Проблема вне нашей зоны ответственности, передана ответственной команде 🙏',
    },
    queryChecking: {
        '한국어': '🔎 확인 중이에요… 잠시만 기다려 주세요',
        'Thai': '🔎 กำลังตรวจสอบ… โปรดรอสักครู่',
        'English': '🔎 Checking… hang tight',
        'Vietnamese': '🔎 Đang kiểm tra… chờ một chút nhé',
        'Chinese': '🔎 确认中… 请稍等',
        'Japanese': '🔎 確認中… しばらくお待ちください',
        'Arabic': '🔎 جارٍ التحقق… يرجى الانتظار',
        'Russian': '🔎 Проверяем… подождите',
    },
    taskStarting: {
        '한국어': (proj) => `⚙️ [${proj}] 작업 시작…`,
        'Thai': (proj) => `⚙️ [${proj}] กำลังเริ่มดำเนินการ…`,
        'English': (proj) => `⚙️ [${proj}] Starting task…`,
        'Vietnamese': (proj) => `⚙️ [${proj}] Đang bắt đầu xử lý…`,
        'Chinese': (proj) => `⚙️ [${proj}] 开始处理…`,
        'Japanese': (proj) => `⚙️ [${proj}] 作業開始…`,
        'Arabic': (proj) => `⚙️ [${proj}] بدء المهمة…`,
        'Russian': (proj) => `⚙️ [${proj}] Начинаем работу…`,
    },
    understanding: {
        '한국어': '🧠 이해 중…',
        'Thai': '🧠 กำลังวิเคราะห์…',
        'English': '🧠 Processing…',
        'Vietnamese': '🧠 Đang xử lý…',
        'Chinese': '🧠 处理中…',
        'Japanese': '🧠 解析中…',
        'Arabic': '🧠 جارٍ المعالجة…',
        'Russian': '🧠 Обрабатываем…',
    },
    confirmApprove: {
        '한국어': '🚀 지금 준비된 수정을 배포할까요? (예/아니오)',
        'Thai': '🚀 ต้องการ deploy การแก้ไขที่เตรียมไว้ตอนนี้เลยไหม? (ใช่/ไม่)',
        'English': '🚀 Deploy the pending fix now? (yes/no)',
        'Vietnamese': '🚀 Deploy bản sửa lỗi đang chờ ngay bây giờ? (có/không)',
        'Chinese': '🚀 现在部署准备好的修复吗？(是/否)',
        'Japanese': '🚀 準備済みの修正を今デプロイしますか？(はい/いいえ)',
        'Arabic': '🚀 هل تريد نشر الإصلاح الجاهز الآن؟ (نعم/لا)',
        'Russian': '🚀 Задеплоить готовые исправления сейчас? (да/нет)',
    },
    confirmRedeploy: {
        '한국어': (proj, svc, src) => `⚠️ 프로덕션 ${proj}/${svc} 재배포${src ? '(최신 커밋 재빌드)' : ''}할까요? (예/아니오)`,
        'Thai': (proj, svc, src) => `⚠️ redeploy ${proj}/${svc}${src ? ' (build ใหม่)' : ''} ใน production ไหม? (ใช่/ไม่)`,
        'English': (proj, svc, src) => `⚠️ Redeploy ${proj}/${svc}${src ? ' (rebuild from source)' : ''} in production? (yes/no)`,
        'Vietnamese': (proj, svc, src) => `⚠️ Redeploy ${proj}/${svc}${src ? ' (build lại)' : ''} trên production? (có/không)`,
        'Chinese': (proj, svc, src) => `⚠️ 重新部署 ${proj}/${svc}${src ? '（重新构建）' : ''} 到生产环境？(是/否)`,
        'Japanese': (proj, svc, src) => `⚠️ ${proj}/${svc}${src ? '（ソース再ビルド）' : ''}を本番環境に再デプロイしますか？(はい/いいえ)`,
        'Arabic': (proj, svc, src) => `⚠️ إعادة نشر ${proj}/${svc}${src ? ' (إعادة البناء)' : ''} في production؟ (نعم/لا)`,
        'Russian': (proj, svc, src) => `⚠️ Переразвернуть ${proj}/${svc}${src ? ' (пересборка)' : ''} в production? (да/нет)`,
    },
    confirmDeploy: {
        '한국어': (proj) => `🚀 [${proj}] 현재 워킹트리를 Railway에 직접 배포할까요? (예/아니오)`,
        'Thai': (proj) => `🚀 [${proj}] deploy working tree ปัจจุบันขึ้น Railway เลยไหม? (ใช่/ไม่)`,
        'English': (proj) => `🚀 [${proj}] Deploy current working tree to Railway? (yes/no)`,
        'Vietnamese': (proj) => `🚀 [${proj}] Deploy working tree hiện tại lên Railway? (có/không)`,
        'Chinese': (proj) => `🚀 [${proj}] 将当前工作树直接部署到 Railway？(是/否)`,
        'Japanese': (proj) => `🚀 [${proj}] 現在のワーキングツリーをRailwayにデプロイしますか？(はい/いいえ)`,
        'Arabic': (proj) => `🚀 [${proj}] نشر شجرة العمل الحالية على Railway؟ (نعم/لا)`,
        'Russian': (proj) => `🚀 [${proj}] Задеплоить текущее рабочее дерево на Railway? (да/нет)`,
    },
};
function tr(lang, key, ...args) {
    const map = I18N[key];
    if (!map)
        return key;
    const val = map[lang] ?? map['English'];
    if (!val)
        return key;
    return typeof val === 'function' ? val(...args) : val;
}
// ── shell helper (cwd 지정) ──────────────────────────────
function sh(cmd, cwd = REPO_BASE, timeout = 120000) {
    return new Promise((resolve) => {
        exec(cmd, { cwd, timeout, maxBuffer: 1024 * 1024 * 32, shell: '/bin/zsh' }, (err, stdout, stderr) => resolve({ ok: !err, code: err?.code ?? 0, stdout: stdout || '', stderr: stderr || '' }));
    });
}
// ── git delta helpers (repo 별) ──────────────────────────
async function statusLines(dir) {
    const r = await sh('git -c core.quotepath=false status --porcelain', dir);
    return r.stdout.split('\n').filter(Boolean);
}
const linePath = (l) => l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop() ?? '';
// ── triage 파싱 (SCOPE = 담당 프로젝트 중 하나 이상, 쉼표 구분) ──
function parseTriage(out) {
    const grab = (re) => (out.match(re)?.[1] || '').trim();
    const verdict = (grab(/VERDICT:\s*(BUG|USER_ERROR|EXPECTED|NEED_INFO|INFO|ALREADY_FIXED)/i) || 'NEED_INFO').toUpperCase();
    const scopeRaw = (grab(/SCOPE:\s*([A-Za-z, ]+)/i) || '').toLowerCase();
    const scopes = [...new Set(scopeRaw.split(/[,\s]+/).map((s) => s.trim()).filter((s) => COVERED_NAMES.includes(s)))];
    const summary = grab(/SUMMARY_KO:\s*([\s\S]*?)(?:\nDETAIL:|\nSEVERITY:|\nSCOPE:|$)/i);
    const detail = grab(/DETAIL:\s*([\s\S]*?)(?:\nSEVERITY:|$)/i);
    const severity = grab(/SEVERITY:\s*(low|med|high)/i).toLowerCase();
    const tail = grab(/TAIL:\s*([\s\S]*?)(?:\n[A-Z_]+:|$)/i);
    return { verdict, scopes, summary, detail, severity, tail, raw: out };
}
const VERDICT_LABEL = {
    BUG: '🐛 코드 버그',
    USER_ERROR: '🙋 사용자 조작/오해',
    EXPECTED: '✅ 정상 동작(사양)',
    NEED_INFO: '❓ 정보 부족',
    INFO: 'ℹ️ 데이터 조회',
    ALREADY_FIXED: '🔄 이미 수정 완료 (배포 대기)',
};
// ── triage 워커 ──────────────────────────────────────────
const triageQ = [];
let triageRunning = false;
let currentTriageItem = null;
let issueSeq = 0;
const awaitingApprovalItems = [];
function enqueueTriage(rawItem) {
    const item = {
        ...rawItem,
        id: ++issueSeq,
        summary: (rawItem.text || '').slice(0, 50),
    };
    triageQ.push(item);
    notifyAdmins(`📥 #${item.id} 리포트 접수${item.brand ? ` [${item.brand}]` : ''}: "${item.summary}${item.text?.length > 50 ? '…' : ''}"`);
    pumpTriage();
}
async function pumpTriage() {
    if (triageRunning)
        return;
    triageRunning = true;
    while (triageQ.length) {
        currentTriageItem = triageQ.shift();
        try {
            await processTriage(currentTriageItem);
        }
        catch (e) {
            console.error('triage err', e);
        }
        currentTriageItem = null;
    }
    triageRunning = false;
}
function buildPendingSection() {
    const lines = [];
    if (currentFixItem) {
        lines.push(`  · #${currentFixItem.id} [수정 진행 중] 대상: ${currentFixItem.targets.join(',')} — "${currentFixItem.report.slice(0, 80)}"`);
    }
    for (const item of fixQ) {
        lines.push(`  · #${item.id} [수정 대기] 대상: ${item.targets.join(',')} — "${item.report.slice(0, 80)}"`);
    }
    for (const item of awaitingApprovalItems) {
        lines.push(`  · #${item.id} [승인 대기] 대상: ${item.targets.join(',')} — "${item.report.slice(0, 80)}"`);
    }
    if (!lines.length)
        return '';
    return `[현재 수정 중/승인 대기 이슈 — 동일한 버그 재리포트라면 ALREADY_FIXED 로 판별]\n${lines.join('\n')}\n\n`;
}
function buildTriagePrompt(text, imagePath, brand, lang = '한국어') {
    const areaLines = COVERED.map((p) => `- ${p.name}: ${p.areaHint || ''}`).join('\n');
    const brandLine = brand
        ? `★ 이 리포트는 '${brand}' 거래소(브랜드)에서 왔습니다. 회원/인증/API키/레퍼럴/수수료정산 데이터는 '${brand}' datasource 로 조회하고, ` +
            `주문·거래·잔고·포지션은 hub-core/hub-log 에서 '${brand}' tenantId${BRAND_TENANT[brand] ? `(${BRAND_TENANT[brand]})` : '(모르면 브랜드 DB 또는 hub 에서 먼저 확인)'} 로 필터해 조회하세요.\n\n`
        : '';
    return (`당신은 지금 ${PRIMARY.name} 프로젝트 디렉토리의 QA 담당(오너)입니다. 이 프로젝트의 CLAUDE.md 규칙·트러블슈팅 절차를 따르세요.\n` +
        `연관 담당 범위: ${COVERED_NAMES.join(', ')} (스포크 exchange/trading → 중앙 엔진 hub). 근본원인이 다른 repo 에 있으면 그쪽도 조사하세요.\n\n` +
        brandLine +
        `비개발자 테스터가 다음 문제를 리포트했습니다:\n"${text}"\n\n` +
        (imagePath ? `테스터가 스크린샷을 첨부했습니다. 먼저 Read 도구로 이 이미지를 확인하세요: ${imagePath}\n\n` : '') +
        `**테스터는 배포서버(production, Railway)에서 테스트합니다. 1차로 배포서버의 DB·Redis 를 직접 조사해 원인을 파악하세요** (코드만 보지 말 것). 모두 읽기전용:\n` +
        DATASOURCES + '\n' +
        `  (DB: 테이블/컬럼명은 큰따옴표, SELECT/WITH/EXPLAIN 단일 statement. Redis: 읽기 명령만.)\n` +
        `- 코드: 담당 repo 들의 소스를 Read/Grep 으로 확인. 리포트의 식별자(이메일/userId/주문ID/심볼/금액)로 ` +
        `**그 유저의 실제 기록**을 조회하고 코드의 기대 계산과 수치로 비교하세요.\n` +
        `- 식별자가 없어 특정 유저 조회 불가하면 NEED_INFO 로 이메일/주문ID 요청.\n` +
        `- 파일 수정·DB 쓰기 절대 금지(읽기전용).\n\n` +
        buildPendingSection() +
        `판별(VERDICT):\n` +
        `- BUG: 실제 코드 결함 (데이터가 기대값과 다름 + 원인이 코드)\n- USER_ERROR: 사용자 조작/오해\n` +
        `- EXPECTED: 사양상 정상 (데이터가 규칙대로 맞음)\n- NEED_INFO: 정보 부족\n` +
        `- INFO: 버그가 아니라 **본인 데이터 조회 질문**(예: "방금 거래 체결됐어?", "내 잔고 얼마야", "내 최근 주문")\n` +
        `- ALREADY_FIXED: 이 리포트와 동일한 버그가 이미 수정되어 관리자 승인 대기 중 (위 "[현재 수정 중/승인 대기]" 목록의 이슈와 같은 문제)\n\n` +
        `■ 데이터 조회(INFO) 처리 규칙 — 테스터는 '자기 데이터'만 볼 수 있다(엄격):\n` +
        `  · 메시지에 본인 식별자(이메일 또는 userId)가 있으면 → **\`${USERCHECK} ${brand || '<brand>'} <이메일|userId>\` 를 한 번 실행**(여러 쿼리 직접 금지)하고, 그 결과(주문/자산/포지션/거래)를 ${lang}로 요약해 VERDICT: INFO.\n` +
        `  · **결과가 0건이어도 INFO** — '내역이 없습니다'라고 답할 것 (NEED_INFO 아님). usercheck 가 '계정을 찾지 못했습니다'면 그대로 안내.\n` +
        `  · 식별자가 없으면 → VERDICT: NEED_INFO, '본인 계정 이메일 또는 주문ID 를 알려달라'고 요청(조회하지 말 것).\n` +
        `  · **전체/집계/다른 유저 조회는 거부**(예: "전체 거래량", "모든 유저", "남의 잔고") → VERDICT: NEED_INFO, '본인 이메일/주문ID 기준만 조회 가능'이라고 안내. 절대 광역 조회 금지.\n\n` +
        `BUG 라면 어느 repo 소관인지(SCOPE) 판단:\n` +
        areaLines + '\n' +
        `- 여러 repo 를 고쳐야 정상화되면 쉼표로 나열 (예: exchange,hub).\n` +
        `- 값 자체가 hub(중앙 엔진)에서 틀렸으면 hub, 게이트웨이/표시/변환 문제면 해당 스포크.\n\n` +
        `반드시 아래 형식 그대로, 각 항목 한 줄씩 출력(다른 말 금지):\n` +
        `VERDICT: <BUG|USER_ERROR|EXPECTED|NEED_INFO|INFO>\n` +
        `SCOPE: <${COVERED_NAMES.join('|')} 중 하나 이상, 쉼표 구분>  (BUG 일 때만)\n` +
        `SUMMARY_KO: <테스터에게 보여줄 ${lang}. 비개발자(일반인)가 읽으므로 "코드", "DB", "서버", "배포", "API", "QA", "스키마", "워커", "엔진" 같은 개발 용어는 절대 쓰지 말 것. 텔레그램 평문(plain text) 전송이므로 마크다운 표(| 파이프)도 절대 사용 금지.\n` +
        `  · INFO(거래 목록 등): 한 줄에 한 건씩 "06-08 15:14 BTC_USDT 매수 8개 @ 64,171.2 | 수수료 0.008 BNB | 실현손익 +12.3 USDT" 형식으로 나열. 헤더 행 불필요.\n` +
        `  · 잔고/포지션: "BTC 선물 잔고: 5,599.12 USDT (주문잠금 1,052.72)" 처럼 라벨: 값 형식.\n` +
        `  · 정상/실수면 실제 수치로 '왜 맞는지'. 친절하고 쉬운 말로>\n` +
        `DETAIL: <관리자용. 실행 쿼리/조회 데이터 요약 + 의심 파일 경로(repo 명시)/근본 원인/수정 방향. 한국어>\n` +
        `SEVERITY: <low|med|high>  (BUG 일 때만)\n` +
        `TAIL: <verdict에 맞는 마무리 한 문장. BUG이면 수정 진행 안내, NEED_INFO이면 이메일/주문ID 요청, ALREADY_FIXED이면 "이미 수정이 완료되어 곧 반영될 예정이에요. 잠시 후 다시 확인해 주세요.", 그 외면 추가 질문 안내. 개발 용어(배포·서버·코드·DB 등) 쓰지 말고 일반인이 이해할 수 있는 말로. 반드시 ${lang}로>`);
}
async function processTriage(item) {
    const { id, chatId, reporter: _reporter, text, imagePath, brand } = item;
    const lang = detectLang(text);
    await send(chatId, tr(lang, 'checking', id, brand));
    const prompt = buildTriagePrompt(text, imagePath, brand, lang);
    const esc = escSh(prompt);
    const stopTyping = typing(chatId);
    const r = await sh(`${TRIAGE_CMD} "${esc}"`, PRIMARY.dir, TASK_TIMEOUT);
    stopTyping();
    const t = parseTriage(r.stdout || r.stderr);
    if (t.verdict === 'INFO') {
        await send(chatId, `ℹ️ ${t.summary || '(조회 결과 없음)'}`);
        await notifyAdmins(`ℹ️ [데이터 조회]${brand ? ` [${brand}]` : ''}\n"${text}"\n→ ${t.summary || ''}`);
        return;
    }
    if (t.verdict === 'ALREADY_FIXED') {
        const tail = t.tail || '이미 수정이 완료되어 곧 반영될 예정이에요. 잠시 후 다시 확인해 주세요.';
        await send(chatId, `🔄 ${t.summary || tail}`);
        await notifyAdmins(`🔄 #${id} 중복 리포트 (ALREADY_FIXED)${brand ? ` [${brand}]` : ''}\n"${text}"\n→ ${t.detail || '동일 이슈 승인 대기 중'}`);
        return;
    }
    const tail = t.tail ? `\n\n${t.tail}` : '';
    const userIcon = { BUG: '🔧', USER_ERROR: '💡', EXPECTED: '✅', NEED_INFO: '🙋' };
    await send(chatId, `${userIcon[t.verdict] ? userIcon[t.verdict] + ' ' : ''}${t.summary || '(내용을 확인하고 있어요)'}${tail}`);
    await notifyAdmins(`📨 #${id} 테스터 리포트${brand ? ` [${brand}]` : ''}\n"${text}"\n\n` +
        `판별: ${VERDICT_LABEL[t.verdict] || t.verdict}${t.verdict === 'BUG' && t.scopes.length ? ` · 범위 ${t.scopes.join(',')}` : ''}${t.severity ? ` · 심각도 ${t.severity}` : ''}\n` +
        `상세: ${t.detail || t.raw.slice(-1500)}`);
    if (t.verdict !== 'BUG')
        return;
    let scopes = t.scopes.length ? t.scopes : (DEFAULT_FIX ? [DEFAULT_FIX] : []);
    const fixTargets = scopes.filter((n) => PROJECTS[n]?.mode === 'fix');
    const reportTargets = scopes.filter((n) => PROJECTS[n]?.mode === 'report');
    for (const n of reportTargets) {
        await notifyAdmins(`🔁 이 버그는 ${n} 소관 — 이 봇의 자동수정 대상이 아님(report). 루트(PM/mission-control)에서 ${n} 으로 분담하세요.\n` +
            `심각도 ${t.severity || 'n/a'}\n원문: "${text}"\n분석: ${t.detail || '(없음)'}`);
    }
    if (fixTargets.length) {
        enqueueFix({ kind: 'bug', targets: fixTargets, report: text, detail: t.detail, reporter: item.reporter, srcChatId: chatId, severity: t.severity, imagePath, triageId: id });
    }
    if (!fixTargets.length && reportTargets.length) {
        await send(chatId, tr(lang, 'outsideScope'));
    }
    if (!fixTargets.length && !reportTargets.length) {
        await notifyAdmins('⚠️ 범위(SCOPE) 판별 실패 — 수동 확인 필요.');
    }
}
// ── fix 워커 (직렬, 배포 승인 게이트) ────────────────────
const fixQ = [];
let fixRunning = false;
let fixStatus = 'idle';
let approvalResolver = null;
const fixingProjects = new Set();
let currentFixItem = null;
function enqueueFix(rawItem) {
    const item = {
        kind: rawItem.kind,
        targets: rawItem.targets ?? [DEFAULT_FIX],
        report: rawItem.report ?? '',
        detail: rawItem.detail,
        reporter: rawItem.reporter,
        srcChatId: rawItem.srcChatId,
        severity: rawItem.severity,
        imagePath: rawItem.imagePath,
        triageId: rawItem.triageId,
        id: rawItem.id ?? ++issueSeq,
        summary: rawItem.summary ?? (rawItem.report || '').slice(0, 50),
    };
    fixQ.push(item);
    notifyAdmins(`⚙️ #${item.id} 수정 큐 등록 (대상: ${item.targets.join(', ')}, 대기 ${fixQ.length}건). 준비되면 diff 와 함께 승인 요청합니다.`);
    pumpFix();
}
async function pumpFix() {
    if (fixRunning)
        return;
    fixRunning = true;
    while (fixQ.length) {
        currentFixItem = fixQ.shift();
        const item = currentFixItem;
        const cbLocks = [];
        const cbTargets = item.targets.map((n) => PROJECTS[n]).filter((p) => !!p && p.mode === 'fix');
        let cbBlocked = false;
        for (const proj of cbTargets) {
            const lp = `/tmp/telegram-bot-fix-${proj.name}.lock`;
            try {
                mkdirSync(lp);
                cbLocks.push(lp);
            }
            catch {
                for (const l of cbLocks)
                    try {
                        rmdirSync(l);
                    }
                    catch { }
                cbLocks.length = 0;
                cbBlocked = true;
                await notifyAdmins(`⚠️ #${item.id} 다른 봇이 [${proj.name}] 수정 중입니다. 완료 후 재시도하세요.`);
                break;
            }
        }
        if (!cbBlocked) {
            try {
                await processFix(item);
            }
            catch (e) {
                console.error('fix err', e);
                await notifyAdmins(`💥 #${item.id} 수정 작업 오류: ${e.message}`);
            }
            finally {
                item.targets.forEach((n) => fixingProjects.delete(n));
                for (const l of cbLocks)
                    try {
                        rmdirSync(l);
                    }
                    catch { }
                currentFixItem = null;
            }
        }
        else {
            item.targets.forEach((n) => fixingProjects.delete(n));
            currentFixItem = null;
        }
        fixStatus = 'idle';
        approvalResolver = null;
    }
    fixRunning = false;
}
function buildFixPrompt(item, proj) {
    const imgLine = item.imagePath ? `먼저 Read 도구로 첨부 이미지를 확인하세요: ${item.imagePath}\n\n` : '';
    if (item.kind === 'design') {
        return (`참고 디자인 이미지를 바탕으로 UI 를 수정하세요. 이 repo(${proj.name})의 CLAUDE.md 규칙을 준수하세요.\n\n` +
            imgLine +
            `요청: "${item.report || '첨부 이미지의 디자인에 맞춰 해당 화면 UI 를 조정'}"\n\n` +
            `대상 화면을 코드에서 찾아 이미지에 가깝게 수정한 뒤 무엇을 왜 바꿨는지 1~3줄로 요약하세요. 로직은 건드리지 말고 표현/레이아웃 위주로.`);
    }
    if (item.kind === 'manual')
        return imgLine + item.report;
    return (`테스터가 리포트한 버그를 ${proj.name} repo 에서 수정하세요. 변경은 최소화하고 이 repo 의 CLAUDE.md 규칙을 지키세요.\n` +
        `이 프로젝트의 .claude/agents/ 에 전문 에이전트가 있으면 Agent 도구로 적극 활용하세요.\n` +
        `(영역: ${proj.areaHint || ''})\n\n` +
        imgLine +
        `테스터 리포트: "${item.report}"\n` +
        `트리아지 분석: ${item.detail || '(없음)'}\n\n` +
        `이 repo 소관 부분의 원인을 찾아 코드를 수정한 뒤, 무엇을 왜 바꿨는지 1~3줄로 요약하세요. (다른 프로젝트 소관이면 수정하지 말고 그 사실을 알리세요.)`);
}
async function validateRepo(proj, delta) {
    const apps = new Set();
    let outsideApps = false;
    for (const f of delta.map(linePath)) {
        const m = f.match(/^apps\/([^/]+)\//);
        if (m)
            apps.add(m[1]);
        else
            outsideApps = true;
    }
    const reports = [];
    let ok = true;
    if (outsideApps && apps.size === 0)
        reports.push(`⚠️ ${proj.name}: apps 외부 변경 — tsc 건너뜀(수동 확인)`);
    for (const app of apps) {
        const cmd = app === 'mobile' ? 'cd apps/mobile && flutter analyze' : `cd apps/${app} && npx tsc --noEmit`;
        const tscResult = await sh(cmd, proj.dir, 300000);
        reports.push(`${tscResult.ok ? '✅' : '❌'} ${proj.name}/${app} ${app === 'mobile' ? 'analyze' : 'tsc'}${tscResult.ok ? '' : '\n' + (tscResult.stdout + tscResult.stderr).slice(-1200)}`);
        ok &&= tscResult.ok;
    }
    return { ok, reports };
}
function parseQa(out) {
    const verdict = out.match(/QA:\s*(PASS|FAIL[^\n]*)/i)?.[0] || '(QA 결론 미검출 — FAIL 처리)';
    const pass = /QA:\s*PASS/i.test(out) && !/QA:\s*FAIL/i.test(out);
    return { pass, verdict };
}
async function qaReview(perRepo) {
    const reports = [];
    let allPass = true;
    const diffs = {};
    const qaResults = await Promise.all(perRepo
        .filter(({ tracked }) => tracked.length > 0)
        .map(async ({ proj, tracked }) => {
        const quoted = tracked.map((p) => shq(p)).join(' ');
        const d = await sh(`git -c core.quotepath=false diff HEAD -- ${quoted}`, proj.dir, 60000);
        const diff = (d.stdout || '').slice(0, 12000);
        if (!diff.trim())
            return null;
        const prompt = `당신은 ${proj.name} 프로젝트의 오케스트레이터입니다. Agent 도구로 이 프로젝트의 qa-lead 에이전트를 호출해 검증을 위임하세요.\n` +
            `qa-lead 에이전트 지시: CLAUDE.md 규칙·도메인 불변식(금액 Decimal·보안·스키마·심볼형식·회귀) 기준으로 아래 diff 검증. 코드 수정 금지.\n` +
            `에이전트 응답 후 마지막 줄에 반드시 'QA: PASS' 또는 'QA: FAIL — <사유>' 한 줄.\n\n${diff}`;
        const esc = escSh(prompt);
        const r = await sh(`${QA_CMD} "${esc}"`, proj.dir, TASK_TIMEOUT);
        const { pass, verdict } = parseQa(r.stdout || r.stderr || '');
        return { proj, diff, pass, verdict };
    }));
    for (const result of qaResults.filter((r) => r !== null)) {
        diffs[result.proj.name] = result.diff;
        allPass = allPass && result.pass;
        reports.push(`🧪 [${result.proj.name}] QA Leader: ${result.verdict}`);
    }
    if (!Object.keys(diffs).length)
        return { pass: true, reports: ['🧪 QA: diff 없음 — 통과'] };
    if (Object.keys(diffs).length > 1) {
        const combined = Object.entries(diffs).map(([n, d]) => `### ${n}\n${d}`).join('\n\n');
        const prompt = `당신은 makemoney 루트 오케스트레이터입니다. Agent 도구로 루트 qa-lead 에이전트를 호출해 다중 프로젝트 계약 정합 검증을 위임하세요.\n` +
            `qa-lead 에이전트 지시: 여러 프로젝트에 걸친 변경의 계약 정합(exchange↔hub HMAC/스키마/심볼형식, trading↔hub META_API, fill/liquidation WS payload) 검토. 코드 수정 금지.\n` +
            `에이전트 응답 후 마지막 줄에 'QA: PASS' 또는 'QA: FAIL — <사유>'.\n\n${combined}`;
        const esc = escSh(prompt);
        const r = await sh(`${QA_CMD} "${esc}"`, REPO_BASE, TASK_TIMEOUT);
        const { pass, verdict } = parseQa(r.stdout || r.stderr || '');
        allPass = allPass && pass;
        reports.push(`🔗 [root] 프로젝트 간 계약 정합: ${verdict}`);
    }
    return { pass: allPass, reports };
}
async function processFix(item) {
    const targets = item.targets.map((n) => PROJECTS[n]).filter((p) => !!p && p.mode === 'fix');
    if (!targets.length) {
        await notifyAdmins('⚠️ 유효한 수정 대상이 없습니다.');
        return;
    }
    const who = item.kind === 'manual' ? '개발자 직접 작업' : item.kind === 'design' ? '디자인 변경' : '버그 수정';
    fixStatus = 'preparing';
    targets.forEach((p) => fixingProjects.add(p.name));
    await notifyAdmins(`🛠️ #${item.id} ${who} 시작… 대상: ${targets.map((t) => t.name).join(', ')}`);
    const fixResults = await Promise.all(targets.map(async (proj) => {
        const baseline = new Set(await statusLines(proj.dir));
        const prompt = buildFixPrompt(item, proj);
        const esc = escSh(prompt);
        const r = await sh(`${FIX_CMD} "${esc}"`, proj.dir, TASK_TIMEOUT);
        await notifyAdmins(`📝 [${proj.name}] 수정 결과:\n${(r.stdout || r.stderr).slice(-2000) || '(출력 없음)'}`);
        const delta = (await statusLines(proj.dir)).filter((l) => !baseline.has(l));
        if (delta.length === 0) {
            await notifyAdmins(`ℹ️ [${proj.name}] 변경 없음 — 이 repo 는 수정 불필요로 판단.`);
            return null;
        }
        const v = await validateRepo(proj, delta);
        for (const line of v.reports)
            await notifyAdmins(line);
        const tracked = delta.filter((l) => !l.startsWith('??')).map(linePath);
        return { proj, delta, tracked, ok: v.ok };
    }));
    const perRepo = fixResults.filter((r) => r !== null);
    const anyChange = perRepo.length > 0;
    const allTestsOk = perRepo.every((r) => r.ok);
    if (!anyChange) {
        await notifyAdmins('⚠️ 어느 repo 에도 변경이 없습니다 — 수정 불가/불필요로 판단. 배포 안 함.');
        if (item.srcChatId)
            await send(item.srcChatId, '확인해 봤는데 별도 조치가 필요 없는 건으로 판단됐어요. 혹시 추가로 알려주실 내용이 있으면 말씀해 주세요.');
        return;
    }
    if (!allTestsOk) {
        await notifyAdmins('❌ 빌드/타입체크 실패 — 배포 안 함. 워킹트리 변경은 유지(수동 확인 필요).');
        return;
    }
    fixStatus = 'qa';
    await notifyAdmins('🧪 QA: 각 프로젝트 QA Leader 에게 검증 분배 중 (+ 루트 계약 정합)…');
    const qa = await qaReview(perRepo);
    for (const line of qa.reports)
        await notifyAdmins(line);
    if (!qa.pass) {
        await notifyAdmins('❌ QA Leader 검증 실패 — 배포 안 함. 워킹트리 변경은 유지(수동 확인 필요).');
        return;
    }
    let summary = '';
    for (const { proj, delta, tracked } of perRepo) {
        let diffPart = '';
        if (tracked.length) {
            const quoted = tracked.map((p) => `'${p.replace(/'/g, "'\\''")}'`).join(' ');
            diffPart = (await sh(`git -c core.quotepath=false diff --stat HEAD -- ${quoted}`, proj.dir)).stdout.trim();
        }
        summary += `\n[${proj.name}] (${delta.length}건)\n${delta.join('\n')}${diffPart ? '\n' + diffPart : ''}\n`;
    }
    fixStatus = 'awaiting';
    const awaitingEntry = { id: item.id, summary: item.summary, targets: item.targets, report: item.report };
    awaitingApprovalItems.push(awaitingEntry);
    await notifyAdmins(`📊 #${item.id} 수정 + QA Leader 통과:${summary}\n승인 시 배포관리자가 git push → Railway 배포합니다. /approve (승인/배포) · /reject (거부).`);
    const decision = await new Promise((resolve) => { approvalResolver = resolve; });
    const idx = awaitingApprovalItems.findIndex((e) => e.id === item.id);
    if (idx !== -1)
        awaitingApprovalItems.splice(idx, 1);
    if (decision === 'approve') {
        await Promise.all(perRepo.map(({ proj }) => deploy(proj, item)));
        if (item.srcChatId)
            await send(item.srcChatId, '🎉 알려주신 문제가 해결됐어요! 다시 확인해 주시면 감사하겠습니다 😊');
    }
    else {
        await notifyAdmins('🚫 배포 보류. 워킹트리 변경은 유지됩니다.');
    }
}
async function deploy(proj, item) {
    fixStatus = 'deploying';
    const dep = proj.deploy || {};
    const branch = dep.branch || 'main';
    const remote = dep.remote || 'origin';
    const msg = `fix: ${(item.report || '자동수정').slice(0, 60).replace(/\n/g, ' ')} [자비스]`;
    await notifyAdmins(`🚀 [${proj.name}] 배포관리자(deploy-manager) 호출 — runbook 따라 push ${remote} ${branch} → Railway…`);
    const prompt = `당신은 ${proj.name} 프로젝트의 배포관리자(deploy-manager)입니다. 이 프로젝트의 docs/runbooks/deploy.md 와 CLAUDE.md 절차를 따르세요.\n` +
        `현재 워킹트리의 변경(자비스 자동수정)을 배포하세요:\n` +
        `1) git stash → git pull --rebase ${remote} ${branch} → git stash pop → (충돌 시 수정·테스트) → git add . → git commit -m "${msg}" → git push ${remote} ${branch}\n` +
        `2) Railway 자동배포가 트리거되면 서비스별 배포 상태를 railway 로 확인·보고. (멀티 브랜드 등 특이사항은 runbook 준수)\n` +
        `작업 결과를 한국어로 요약하고, 마지막 줄에 반드시 'DEPLOY: OK' 또는 'DEPLOY: FAIL — <사유>' 한 줄.`;
    const esc = escSh(prompt);
    const r = await sh(`${DEPLOY_CMD} "${esc}"`, proj.dir, 900000);
    const out = r.stdout || r.stderr || '';
    const ok = /DEPLOY:\s*OK/i.test(out) && !/DEPLOY:\s*FAIL/i.test(out);
    const verdict = out.match(/DEPLOY:\s*(OK|FAIL[^\n]*)/i)?.[0] || '(배포 결론 미검출)';
    await notifyAdmins(`${ok ? '🎉' : '⚠️'} [${proj.name}] 배포관리자: ${verdict}\n${out.slice(-1500)}`);
}
// ── 멘션/인사 헬퍼 ───────────────────────────────────────
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function isGreeting(s) {
    const t = (s || '').trim();
    if (t.length < 5)
        return true;
    return /^(안녕|안녕하세요|하이|hi+|hello|헬로|반가워?요?|자비스|jarvis|야|여보세요|ㅎㅇ)[\s!,.~?ㅎㅋ]*$/i.test(t);
}
function normalize(text) {
    const t = text.trim();
    if (['/approve', '승인', '배포', 'ㅇㅋ', 'ok', 'OK'].includes(t))
        return '/approve';
    if (['/reject', '거부', '취소', '거절', 'no'].includes(t))
        return '/reject';
    if (['/status', '상태'].includes(t))
        return '/status';
    if (['/help', '도움말', '명령'].includes(t))
        return '/help';
    return t;
}
const PREFIX_RE = new RegExp(`^(${COVERED_NAMES.join('|')})\\s*[:：]\\s*([\\s\\S]+)`, 'i');
function parseProjectPrefix(raw) {
    const m = raw.match(PREFIX_RE);
    if (m)
        return { project: m[1].toLowerCase(), rest: m[2].trim() };
    return { project: DEFAULT_FIX, rest: raw };
}
const railwayProjects = () => COVERED.filter((x) => (x.railway?.services || []).length > 0);
async function doHelp(chatId) {
    await send(chatId, `🤖 ${BOT_NAME} [관리자] — 담당: ${COVERED_NAMES.join(', ')}\n` +
        `자연어로 말하면 됩니다(또는 \`/bot <말>\`). 코드 수정·분석·배포 등 폭넓은 작업이 가능합니다.\n예) "지금 상태 어때", "exchange 게이트웨이 로그 50줄", "hub 청산 버그 고쳐줘", "hub 배포해줘", "realbit 오늘 거래량 알려줘".\n\n` +
        `· 자유 작업(평문/자연어): 코드 수정·조회·분석 등 거의 모든 작업. 프리픽스 "<프로젝트>: <작업>" (기본 ${DEFAULT_FIX})\n` +
        `· 직접 배포: "hub 배포해줘" → git push → Railway (승인 게이트 없이)\n` +
        `· 이슈 번호 관리: "3번 처리해줘" (큐에서 꺼내 직접 처리) · "3번 취소" (큐에서 제거)\n` +
        `· 승인(fix 파이프라인 대기 시) · 보류/거부 · 상태(번호 목록) · 핑\n` +
        `· 로그 <프로젝트> <서비스> [줄수] · 배포현황 <프로젝트> · 재배포 <프로젝트> <서비스>\n` +
        `(슬래시 /approve /reject /status /ping /logs /rstatus /redeploy 도 그대로 동작)`);
}
const STATUS_KO = {
    idle: '유휴(작업 없음)',
    preparing: '수정 준비 중',
    qa: 'QA 검증 중',
    awaiting: '배포 승인 대기',
    deploying: '배포 중',
};
const statusKo = () => STATUS_KO[fixStatus];
async function doPing(chatId) {
    await send(chatId, `${BOT_NAME} 살아 있어요 🟢\n작업 상태: ${statusKo()} · 분석 대기 ${triageQ.length}건 · 수정 대기 ${fixQ.length}건${fixingProjects.size ? ` · 수정 중: ${[...fixingProjects].join(', ')}` : ''}`);
}
async function doStatus(chatId) {
    const lines = [`작업 상태: ${statusKo()}  |  담당: ${COVERED_NAMES.join(', ')}`];
    if (currentTriageItem)
        lines.push(`\n🔎 분석 중:  #${currentTriageItem.id}${currentTriageItem.brand ? ` [${currentTriageItem.brand}]` : ''} "${currentTriageItem.summary}"`);
    if (currentFixItem)
        lines.push(`\n🛠️ 수정 중:  #${currentFixItem.id} [${currentFixItem.targets.join(',')}] "${currentFixItem.summary}" (${statusKo()})`);
    if (triageQ.length) {
        lines.push(`\n📋 분석 대기 ${triageQ.length}건:`);
        triageQ.forEach((i) => lines.push(`  #${i.id}${i.brand ? ` [${i.brand}]` : ''} "${i.summary}"`));
    }
    if (fixQ.length) {
        lines.push(`\n🔧 수정 대기 ${fixQ.length}건:`);
        fixQ.forEach((i) => lines.push(`  #${i.id} [${i.targets.join(',')}] "${i.summary}"`));
    }
    if (!currentTriageItem && !currentFixItem && !triageQ.length && !fixQ.length)
        lines.push('\n(대기 중인 이슈 없음)');
    lines.push(`\n\n"N번 처리해줘" → 해당 이슈를 큐에서 꺼내 관리자 직접 처리\n"N번 취소" → 큐에서 제거`);
    await send(chatId, lines.join(''));
}
async function doTakeItem(chatId, id, reporter) {
    let item = null;
    let idx = triageQ.findIndex((i) => i.id === id);
    if (idx !== -1) {
        item = triageQ.splice(idx, 1)[0];
    }
    else {
        idx = fixQ.findIndex((i) => i.id === id);
        if (idx !== -1)
            item = fixQ.splice(idx, 1)[0];
    }
    if (!item) {
        await send(chatId, `#${id} 를 대기 큐에서 찾을 수 없습니다. (/status 로 목록 확인)`);
        return;
    }
    const triageOrFix = item;
    const task = [triageOrFix.detail ? `트리아지 분석: ${triageOrFix.detail}` : '', triageOrFix.report || triageOrFix.text || ''].filter(Boolean).join('\n\n');
    const projName = (triageOrFix.targets?.[0]) || DEFAULT_FIX;
    await send(chatId, `✅ #${id} 큐에서 제거 → 직접 처리합니다.`);
    await doAdminTask(chatId, projName, task, triageOrFix.imagePath ?? null);
}
async function doDropItem(chatId, id) {
    let removed = false;
    let idx = triageQ.findIndex((i) => i.id === id);
    if (idx !== -1) {
        triageQ.splice(idx, 1);
        removed = true;
    }
    else {
        idx = fixQ.findIndex((i) => i.id === id);
        if (idx !== -1) {
            fixQ.splice(idx, 1);
            removed = true;
        }
    }
    await send(chatId, removed ? `🗑️ #${id} 큐에서 제거했습니다.` : `#${id} 를 대기 큐에서 찾을 수 없습니다.`);
}
async function doApprove(chatId) {
    if (fixStatus === 'awaiting' && approvalResolver) {
        const r = approvalResolver;
        approvalResolver = null;
        r('approve');
    }
    else
        await send(chatId, `지금은 배포 승인 대기 중인 수정이 없어요 (현재 상태: ${statusKo()}).`);
}
async function doReject(chatId) {
    if (fixStatus === 'awaiting' && approvalResolver) {
        const r = approvalResolver;
        approvalResolver = null;
        r('reject');
    }
    else
        await send(chatId, `지금은 보류할 수정이 없어요 (현재 상태: ${statusKo()}).`);
}
async function doLogs(chatId, projName, svc, n) {
    const proj = projName ? PROJECTS[projName] : undefined;
    if (!proj) {
        await send(chatId, `로그 볼 프로젝트를 알려주세요: ${COVERED_NAMES.join(', ')}`);
        return;
    }
    const svcs = proj.railway?.services || [];
    if (!svcs.length) {
        await send(chatId, `${proj.name} 은 railway 서비스가 설정돼 있지 않습니다(로컬 운영).`);
        return;
    }
    if (!svc || !svcs.includes(svc)) {
        await send(chatId, `[${proj.name}] 서비스를 골라주세요: ${svcs.join(', ')}`);
        return;
    }
    const lines = Math.min(parseInt(n ?? '', 10) || (proj.railway?.logLines ?? 25), 60);
    await send(chatId, `📜 [${proj.name}] ${svc} 최근 ${lines}줄…`);
    const r = await sh(`railway logs -s ${svc} --lines ${lines}`, proj.dir, 60000);
    await send(chatId, (r.stdout || r.stderr).slice(-3500) || '(로그 없음)');
}
async function doRstatus(chatId, projName) {
    const proj = projName ? PROJECTS[projName] : undefined;
    if (!proj || !(proj.railway?.services || []).length) {
        await send(chatId, `배포현황 볼 프로젝트를 알려주세요(railway 사용): ${railwayProjects().map((x) => x.name).join(', ') || '없음'}`);
        return;
    }
    await send(chatId, `📊 [${proj.name}] 배포 현황…`);
    const r = await sh('railway status --json', proj.dir, 30000);
    try {
        const j = JSON.parse(r.stdout);
        const lines = [];
        for (const e of (j.environments?.edges || [])) {
            for (const si of (e.node.serviceInstances?.edges || [])) {
                const nd = si.node, d = nd.latestDeployment || {};
                const em = d.status === 'SUCCESS' ? '🟢' : (d.status === 'CRASHED' || d.status === 'FAILED') ? '🔴' : '🟡';
                lines.push(`${em} ${nd.serviceName}: ${d.status || '?'} (${(d.createdAt || '').slice(0, 10)})`);
            }
        }
        await send(chatId, `${proj.name} / production\n${lines.join('\n') || '(서비스 없음)'}`);
    }
    catch {
        await send(chatId, (r.stdout || r.stderr).slice(-1500) || '조회 실패');
    }
}
async function doRedeploy(chatId, projName, svc, source) {
    const proj = projName ? PROJECTS[projName] : undefined;
    const svcs = proj?.railway?.services || [];
    if (!proj || !svc || !svcs.includes(svc)) {
        await send(chatId, `재배포할 프로젝트/서비스를 알려주세요. railway: ${railwayProjects().map((x) => x.name).join(', ')}, 서비스: ${svcs.join(', ') || '?'}`);
        return;
    }
    await send(chatId, `🚀 [${proj.name}] ${svc} 재배포${source ? '(최신 커밋 재빌드)' : ''} 중…`);
    const r = await sh(`railway redeploy -s ${svc} -y${source ? ' --from-source' : ''}`, proj.dir, 180000);
    await send(chatId, `${r.ok ? '✅' : '❌'} ${proj.name}/${svc} 재배포\n${(r.stdout || r.stderr).slice(-1200)}`);
}
async function doWork(chatId, projName, task, imagePath, reporter) {
    const project = PROJECTS[projName] && PROJECTS[projName].mode === 'fix' ? projName : DEFAULT_FIX;
    if (!PROJECTS[project] || PROJECTS[project].mode !== 'fix') {
        await send(chatId, `자동수정 대상이 아닙니다(가능: ${FIX_PROJECTS.map((x) => x.name).join(', ')}).`);
        return;
    }
    enqueueFix({ kind: imagePath ? 'design' : 'manual', targets: [project], report: task, reporter, imagePath });
    await send(chatId, `📥 [${project}] ${imagePath ? '디자인 변경' : '작업'} 큐 등록 (대기 ${fixQ.length}건).`);
}
async function doQuery(chatId, question) {
    const lang = detectLang(question);
    await send(chatId, tr(lang, 'queryChecking'));
    const prompt = `관리자가 배포서버(production, Railway) 데이터를 조회 요청했습니다:\n"${question}"\n\n` +
        `읽기전용으로 조사해 ${lang}로 간결하게 답하세요(목록/표 환영). 코드 수정·DB 쓰기 절대 금지.\n` +
        `반드시 아래 datasource 래퍼만 사용하세요 — raw psql / railway connect 직접 호출 금지:\n` +
        DATASOURCES + '\n\n' +
        `결과를 사람이 읽기 쉬운 ${lang}로 요약하세요(필드명·수치는 그대로).\n` +
        `텔레그램 평문 전송이므로 마크다운 표(| 파이프)는 사용 금지. 목록은 한 줄에 한 건씩 "날짜 방향 수량 @ 가격" 또는 "라벨: 값" 형식으로 나열하세요.`;
    const esc = escSh(prompt);
    const stopTyping = typing(chatId);
    const r = await sh(`${TRIAGE_CMD} "${esc}"`, PRIMARY.dir, TASK_TIMEOUT);
    stopTyping();
    await send(chatId, ((r.stdout || r.stderr || '').trim()).slice(-3800) || '(결과 없음)');
}
async function _execAdminTask(chatId, proj, task, imagePath, conflictHint = '') {
    const imgLine = imagePath ? `첨부 이미지를 먼저 확인하세요: ${imagePath}\n\n` : '';
    const lang = detectLang(task);
    const prompt = `관리자 직접 요청입니다.\n` +
        imgLine +
        conflictHint +
        `요청: "${task}"\n\n` +
        `루트 에이전트 팀(.claude/agents/: pm, mission-control, qa-lead, integration-contract-expert 등)을 Agent 도구로 적극 활용하세요.\n` +
        `배포서버(production) 조회가 필요하면:\n${DATASOURCES}\n\n` +
        `작업 결과를 ${lang}로 요약하세요.`;
    const esc = escSh(prompt);
    await send(chatId, tr(lang, 'taskStarting', proj.name));
    const stopTyping = typing(chatId);
    const r = await sh(`${ADMIN_TASK_CMD} "${esc}"`, REPO_BASE, TASK_TIMEOUT);
    stopTyping();
    const out = (r.stdout || r.stderr || '').trim();
    await send(chatId, out.slice(-3800) || '(출력 없음)');
}
async function doAdminTask(chatId, projName, task, imagePath) {
    const proj = PROJECTS[projName] || FIX_PROJECTS[0] || COVERED[0];
    if (!proj) {
        await send(chatId, `대상 프로젝트를 알 수 없습니다: ${COVERED_NAMES.join(', ')}`);
        return;
    }
    let conflictHint = '';
    if (fixingProjects.has(proj.name)) {
        const modified = (await statusLines(proj.dir)).map(linePath).filter(Boolean);
        if (modified.length) {
            conflictHint =
                `⚠️ 자동수정 파이프라인이 현재 다음 파일을 수정 중입니다. 이 파일들은 건드리지 말고 다른 방법으로 우회하세요.\n` +
                    `우회가 불가능하면 작업을 중단하고 '작업 불가: <파일명> 충돌'을 출력하세요:\n` +
                    modified.map((f) => `  - ${f}`).join('\n') + '\n\n';
            await send(chatId, `⚡ [${proj.name}] 자동수정 파이프라인과 병렬 실행합니다. (충돌 회피 파일 ${modified.length}개)`);
        }
        else {
            conflictHint =
                `⚠️ 자동수정 파이프라인이 이 프로젝트를 처리 중이지만 아직 수정된 파일이 없습니다. 가능하면 다른 영역을 우선 작업하세요.\n\n`;
            await send(chatId, `⚡ [${proj.name}] 자동수정 파이프라인과 병렬 실행합니다.`);
        }
    }
    await _execAdminTask(chatId, proj, task, imagePath, conflictHint);
}
async function doAdminDeploy(chatId, projName) {
    const proj = PROJECTS[projName] || PROJECTS[DEFAULT_FIX];
    if (!proj) {
        await send(chatId, `배포 대상을 알 수 없습니다: ${COVERED_NAMES.join(', ')}`);
        return;
    }
    await deploy(proj, { report: '관리자 직접 배포 요청' });
}
function yesNo(s) {
    const t = (s || '').trim().toLowerCase();
    if (/^(예|네|응|어|ㅇ|ㅇㅇ|yes|y|ok|오케이|좋아|해|해줘|진행|고고|ㄱㄱ|맞아)\b/.test(t) || ['예', '네', '응', 'ㅇㅇ'].includes(t))
        return 'yes';
    if (/^(아니|아뇨|아니오|노|no|n|취소|하지마|멈춰|그만|stop)\b/.test(t) || ['아니', '노', '취소'].includes(t))
        return 'no';
    return null;
}
let pendingConfirm = null;
async function interpretAdmin(raw) {
    const svcHint = railwayProjects().map((p) => `${p.name}:[${(p.railway?.services || []).join(',')}]`).join(' ') || '없음';
    const prompt = `너는 텔레그램 봇 관리자 명령 해석기다. 관리자의 한국어/영어 자유 문장을 아래 intent 중 하나로 분류하고 인자를 뽑아 JSON 한 줄로만 출력해라(다른 말·코드블록 금지).\n` +
        `intent 종류:\n` +
        `- approve: 대기중 수정 배포 승인 ("배포해줘","올려","반영해","ㄱㄱ")\n` +
        `- reject: 배포 보류/거부 ("보류","하지마","아직")\n` +
        `- status: 상태/큐 ("상태 어때","지금 뭐해")\n` +
        `- ping: 생존확인\n` +
        `- logs: railway 로그 {project,service,lines}\n` +
        `- rstatus: 배포현황 {project}\n` +
        `- redeploy: railway 재배포 {project,service,source(bool, '최신커밋/소스재빌드'면 true)}\n` +
        `- query: 배포서버 데이터/현황 조회·질문(코드수정 아님) {task=질문원문}. "최근 거래 10개 보여줘","유저 X 잔고 얼마","realbit 오늘 거래량","대기 주문 몇 건"\n` +
        `- work: 코드 수정/작업 요청 {project,task} (버그수정·기능추가·UI변경 등 — 코드를 고치는 것)\n` +
        `- deploy: 프로젝트를 Railway에 직접 배포(git push→Railway, 승인 게이트 없이) {project}. "hub 배포해줘","exchange 올려줘"\n` +
        `- take_item: 특정 번호 이슈를 큐에서 꺼내 관리자가 직접 처리 {id(number)}. "3번 내가 처리할게","#5 처리해줘","2번 직접 할게"\n` +
        `- drop_item: 특정 번호 이슈를 큐에서 제거(처리 안 함) {id(number)}. "3번 취소","#2 제거해줘","4번 버려"\n` +
        `- help: 도움말\n` +
        `- unknown: 모르겠음\n` +
        `구분 팁: "보여줘/얼마/몇 건/조회/알려줘(데이터)" = query, "고쳐/수정/추가/바꿔(코드)" = work, "배포/올려/push(deploy 문맥, 특정 프로젝트)" = deploy, "N번 처리/직접/내가" = take_item, "N번 취소/제거/버려" = drop_item.\n` +
        `프로젝트: ${COVERED_NAMES.join(', ')} (기본 ${DEFAULT_FIX}). railway 서비스: ${svcHint}.\n` +
        `출력 예: {"intent":"logs","project":"exchange","service":"api-gateway","lines":50}\n` +
        `출력 예: {"intent":"query","task":"realbit 브랜드 최근 거래 10개"}\n` +
        `출력 예: {"intent":"work","project":"hub","task":"청산 로직에서 markPrice 0일 때 청산 안되는 버그 수정"}\n` +
        `관리자 문장: "${raw.replace(/"/g, "'")}"`;
    const esc = escSh(prompt);
    const r = await sh(`${cfg.triageCmdBase || 'claude -p --output-format text'} "${esc}"`, REPO_BASE, 120000);
    const out = r.stdout || r.stderr || '';
    const m = out.match(/\{[\s\S]*\}/);
    if (!m)
        return { intent: 'unknown' };
    try {
        return JSON.parse(m[0]);
    }
    catch {
        return { intent: 'unknown' };
    }
}
function roleOf(msg) {
    const id = String(msg.chat.id);
    const type = msg.chat.type;
    if (type === 'private' && ADMIN.has(id))
        return 'admin';
    if ((type === 'group' || type === 'supergroup') && GROUPS.has(id))
        return 'tester';
    return null;
}
async function onMessage(msg) {
    const chatId = String(msg.chat.id);
    const photo = msg.photo?.length ? msg.photo[msg.photo.length - 1] : null;
    const raw = (msg.text || msg.caption || '').trim();
    const text = normalize(raw);
    const reporter = msg.from?.username ? `@${msg.from.username}` : (msg.from?.first_name || '익명');
    console.log(`[msg] chat=${chatId}/${msg.chat.type} from=${reporter} photo=${!!photo} text=${JSON.stringify(raw).slice(0, 80)}`);
    if (raw === '/id') {
        await send(chatId, `chat id: ${chatId}\ntype: ${msg.chat.type}\n` +
            (msg.chat.type === 'private' ? 'config.json → adminChatIds 에 추가' : 'config.json → testerGroupIds 에 추가'));
        return;
    }
    const role = roleOf(msg);
    if (!role) {
        if (msg.chat.type === 'private')
            await send(chatId, `⛔ 미인가 (${chatId}).`);
        return;
    }
    if (role === 'admin') {
        // 0) 확인 대기(예/아니오) 우선 처리
        if (pendingConfirm) {
            const ans = yesNo(raw);
            if (ans === 'yes') {
                const c = pendingConfirm;
                pendingConfirm = null;
                if (c.kind === 'approve') {
                    await send(chatId, '✅ 배포 승인합니다.');
                    await doApprove(chatId);
                }
                else if (c.kind === 'redeploy')
                    await doRedeploy(chatId, c.project, c.service, !!c.source);
                else if (c.kind === 'deploy') {
                    await send(chatId, `🚀 [${c.project}] 배포 시작합니다.`);
                    await doAdminDeploy(chatId, c.project ?? DEFAULT_FIX);
                }
                return;
            }
            if (ans === 'no') {
                pendingConfirm = null;
                await send(chatId, '취소했습니다.');
                return;
            }
            pendingConfirm = null;
        }
        if (yesNo(raw) !== null) {
            await send(chatId, '⚠️ 확인 대기 중인 요청이 없습니다 (봇 재시작으로 초기화됨). 요청을 다시 보내주세요.');
            return;
        }
        const botPrefixed = /^\/bot\b/i.test(raw);
        const body = botPrefixed ? raw.replace(/^\/bot(@\w+)?\s*/i, '').trim() : raw;
        if (botPrefixed && !body) {
            await doHelp(chatId);
            return;
        }
        if (!botPrefixed) {
            if (text === '/help') {
                await doHelp(chatId);
                return;
            }
            if (text === '/ping') {
                await doPing(chatId);
                return;
            }
            if (text === '/status') {
                await doStatus(chatId);
                return;
            }
            if (text === '/approve') {
                await doApprove(chatId);
                return;
            }
            if (text === '/reject') {
                await doReject(chatId);
                return;
            }
            if (text.startsWith('/logs')) {
                const p = raw.split(/\s+/);
                await doLogs(chatId, p[1], p[2], p[3]);
                return;
            }
            if (text.startsWith('/rstatus')) {
                const p = raw.split(/\s+/);
                await doRstatus(chatId, p[1]);
                return;
            }
            if (text.startsWith('/redeploy')) {
                const p = raw.split(/\s+/);
                if (p[3] !== 'ok') {
                    await send(chatId, `⚠️ 프로덕션 재배포는 확인 필요: /redeploy ${p[1] || '<프로젝트>'} ${p[2] || '<서비스>'} ok`);
                    return;
                }
                await doRedeploy(chatId, p[1], p[2], p[4] === 'source');
                return;
            }
            if (text.startsWith('/')) {
                await send(chatId, `알 수 없는 명령: ${text}`);
                return;
            }
            if (photo) {
                const imagePath = await downloadPhoto(photo.file_id);
                if (!imagePath) {
                    await send(chatId, '⚠️ 이미지 다운로드 실패.');
                    return;
                }
                const { project, rest } = parseProjectPrefix(raw);
                await doWork(chatId, project, rest || '첨부 이미지대로 UI 조정', imagePath, reporter);
                return;
            }
        }
        if (PREFIX_RE.test(body)) {
            const { project, rest } = parseProjectPrefix(body);
            await doWork(chatId, project, rest, null, reporter);
            return;
        }
        const lang = detectLang(body);
        await send(chatId, tr(lang, 'understanding'));
        const it = await interpretAdmin(body);
        const intent = it.intent || 'unknown';
        switch (intent) {
            case 'ping':
                await doPing(chatId);
                break;
            case 'status':
                await doStatus(chatId);
                break;
            case 'help':
                await doHelp(chatId);
                break;
            case 'logs':
                await doLogs(chatId, it.project || DEFAULT_FIX, it.service, String(it.lines ?? ''));
                break;
            case 'rstatus':
                await doRstatus(chatId, it.project || DEFAULT_FIX);
                break;
            case 'reject':
                await doReject(chatId);
                break;
            case 'approve':
                if (fixStatus === 'awaiting' && approvalResolver) {
                    pendingConfirm = { kind: 'approve' };
                    await send(chatId, tr(lang, 'confirmApprove'));
                }
                else
                    await send(chatId, `지금은 배포 승인 대기 중인 수정이 없어요 (현재 상태: ${statusKo()}).`);
                break;
            case 'redeploy': {
                const proj = it.project ? PROJECTS[it.project] : undefined;
                const svcs = proj?.railway?.services || [];
                if (!proj || !it.service || !svcs.includes(it.service)) {
                    await send(chatId, `재배포 대상이 불명확합니다. railway: ${railwayProjects().map((x) => x.name).join(', ')}, ${proj ? `서비스: ${svcs.join(', ')}` : ''}`);
                    break;
                }
                pendingConfirm = { kind: 'redeploy', project: it.project, service: it.service, source: !!it.source };
                await send(chatId, tr(lang, 'confirmRedeploy', it.project, it.service, !!it.source));
                break;
            }
            case 'query':
                await doQuery(chatId, it.task || body);
                break;
            case 'work':
                await doAdminTask(chatId, it.project || DEFAULT_FIX, it.task || body, null);
                break;
            case 'take_item':
                if (it.id)
                    await doTakeItem(chatId, Number(it.id), reporter);
                else
                    await send(chatId, '처리할 이슈 번호를 알려주세요. 예) "3번 처리해줘"');
                break;
            case 'drop_item':
                if (it.id)
                    await doDropItem(chatId, Number(it.id));
                else
                    await send(chatId, '제거할 이슈 번호를 알려주세요. 예) "3번 취소"');
                break;
            case 'deploy': {
                const dProj = it.project || DEFAULT_FIX;
                pendingConfirm = { kind: 'deploy', project: dProj };
                await send(chatId, tr(lang, 'confirmDeploy', dProj));
                break;
            }
            default:
                await doAdminTask(chatId, DEFAULT_FIX, body, null);
                break;
        }
        return;
    }
    // ── 테스터(그룹) ──
    if (role === 'tester') {
        if (text === '/help' || raw === '/start') {
            await send(chatId, `🤖 ${BOT_NAME}입니다.\n\`/bot\` 뒤에 평소 말투로 적어 보내세요:\n· 불편 사항: /bot 출금 화면에서 수수료가 두 번 빠져요\n· 내 거래 확인: /bot 내 주문 12345 처리됐나요? (본인 이메일 또는 주문번호 알려주세요)\n\n(저를 멘션하거나 제 메시지에 답장으로도 됩니다. 스크린샷 첨부 OK)`);
            return;
        }
        const mentioned = BOT_USERNAME ? new RegExp(`@${escapeRe(BOT_USERNAME)}\\b`, 'i').test(raw) : false;
        const repliedToBot = BOT_ID ? String(msg.reply_to_message?.from?.id || '') === BOT_ID : false;
        let report = null;
        if (/^\/(bot|bug)\b/i.test(raw))
            report = raw.replace(/^\/(bot|bug)(@\w+)?\s*/i, '').trim();
        else if (mentioned || repliedToBot)
            report = raw.replace(new RegExp(`@${escapeRe(BOT_USERNAME)}`, 'ig'), '').trim();
        else if (TRIAGE_ALL && !raw.startsWith('/'))
            report = raw;
        if (report === null)
            return;
        const imagePath = photo ? await downloadPhoto(photo.file_id) : null;
        if (!imagePath && isGreeting(report)) {
            await send(chatId, `안녕하세요! ${BOT_NAME}입니다 🤖\n\`/bot\` 뒤에 내용을 적어주세요.\n· 불편 사항: /bot 출금 화면에서 수수료가 두 번 빠져요\n· 내 거래 확인: /bot 주문 12345 처리됐나요? (본인 이메일 또는 주문번호 알려주세요)`);
            return;
        }
        if (!report && imagePath)
            report = '(첨부 스크린샷 참고)';
        enqueueTriage({ chatId, reporter, text: report, imagePath, brand: BRAND_GROUPS[chatId] });
        return;
    }
}
// ── poll loop ────────────────────────────────────────────
async function poll() {
    try {
        const r = await tg('getUpdates', { offset, timeout: POLL_TIMEOUT, allowed_updates: ['message'] });
        if (r.ok && r.result.length) {
            for (const u of r.result) {
                offset = u.update_id + 1;
                if (u.message && (u.message.text || u.message.photo)) {
                    try {
                        await onMessage(u.message);
                    }
                    catch (e) {
                        console.error('onMessage', e);
                    }
                }
            }
            writeFileSync(OFFSET_PATH, String(offset));
        }
    }
    catch (e) {
        console.error('poll', e.message);
        await new Promise((res) => setTimeout(res, 3000));
    }
    setImmediate(poll);
}
console.log(`[telegram-bot] 시작 (${BOT_NAME}). base=${REPO_BASE}`);
console.log(`  담당=${COVERED_NAMES.join(',')}  fix=${FIX_PROJECTS.map((p) => p.name).join(',') || '없음'}  report=${REPORT_PROJECTS.map((p) => p.name).join(',') || '없음'}  진단오너=${PRIMARY?.name}`);
console.log(`  admins=${[...ADMIN].join(',') || '(없음)'} groups=${[...GROUPS].join(',') || '(없음)'}`);
(async () => {
    try {
        const me = await tg('getMe', {});
        if (me.ok) {
            BOT_USERNAME = me.result.username || '';
            BOT_ID = String(me.result.id || '');
        }
    }
    catch (e) {
        console.error('getMe 실패', e.message);
    }
    console.log(`  username=@${BOT_USERNAME || '?'} id=${BOT_ID || '?'} (멘션·답장으로 작동)`);
    poll();
})();
