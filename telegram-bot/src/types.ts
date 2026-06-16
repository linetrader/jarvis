import { z } from 'zod';

// ── 도메인 유니온 타입 ─────────────────────────────────────────
export type Verdict = 'BUG' | 'USER_ERROR' | 'EXPECTED' | 'NEED_INFO' | 'INFO' | 'ALREADY_FIXED';
export type FixStatus = 'idle' | 'preparing' | 'qa' | 'awaiting' | 'deploying';
export type AdminIntent =
  | 'approve' | 'reject' | 'status' | 'ping' | 'logs' | 'rstatus' | 'redeploy'
  | 'query' | 'work' | 'deploy' | 'take_item' | 'drop_item' | 'help' | 'unknown';
export type ApprovalDecision = 'approve' | 'reject';
export type YesNoAnswer = 'yes' | 'no' | null;
export type Lang = '한국어' | 'Thai' | 'English' | 'Vietnamese' | 'Chinese' | 'Japanese' | 'Arabic' | 'Russian';

// ── shell 실행 결과 ────────────────────────────────────────────
export interface ShellResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

// ── 파서 반환 타입 ─────────────────────────────────────────────
export interface TriageResult {
  verdict: string;          // Verdict 상수 중 하나
  scopes: string[];
  summary: string;
  detail: string;
  severity: string;         // 'low' | 'med' | 'high'
  tail: string;
  raw: string;
}

export interface QaResult {
  pass: boolean;
  verdict: string;
}

export interface AdminIntentResult {
  intent: AdminIntent;
  project?: string;
  service?: string;
  task?: string;
  id?: number;
  lines?: number;
  source?: boolean;
}

// ── 큐 아이템 타입 (discriminated union) ─────────────────────
export interface TriageQueueItem {
  id: number;
  summary: string;
  chatId: string;
  reporter: string;
  text: string;
  imagePath: string | null;
  brand?: string;
}

export interface FixQueueItem {
  id: number;
  summary: string;
  kind: 'bug' | 'manual' | 'design';
  targets: string[];
  report: string;
  detail?: string;
  reporter?: string;
  srcChatId?: string;
  severity?: string;
  imagePath?: string | null;
  triageId?: number;
}

export interface AwaitingItem {
  id: number;
  summary: string;
  targets: string[];
  report: string;
}

// ── 상태 타입 ─────────────────────────────────────────────────
export interface PendingConfirm {
  kind: 'approve' | 'redeploy' | 'deploy';
  project?: string;
  service?: string;
  source?: boolean;
}

// ── 프로세스Fix 내 per-repo 결과 ──────────────────────────────
export interface PerRepoResult {
  proj: ProjectInfo;
  delta: string[];
  tracked: string[];
  ok: boolean;
}

// ── Config 타입 (Zod 스키마 기반 런타임 검증) ──────────────────
const DeployConfigSchema = z.object({
  branch: z.string().optional(),
  remote: z.string().optional(),
  statusCmd: z.string().optional(),
});

const RailwayConfigSchema = z.object({
  services: z.array(z.string()).optional(),
  logLines: z.number().optional(),
});

const ProjectConfigSchema = z.object({
  repoDir: z.string().optional(),
  mode: z.enum(['fix', 'report']),
  areaHint: z.string().optional(),
  dbq: z.string().optional(),
  redisq: z.string().optional(),
  schemaHint: z.string().optional(),
  deploy: DeployConfigSchema.optional(),
  railway: RailwayConfigSchema.optional(),
});

export const BotConfigSchema = z.object({
  botToken: z.string(),
  botName: z.string().optional(),
  adminChatIds: z.array(z.union([z.string(), z.number()])).default([]),
  testerGroupIds: z.array(z.union([z.string(), z.number()])).default([]),
  groupBrands: z.record(z.string()).default({}),
  pollTimeoutSec: z.number().optional(),
  taskTimeoutSec: z.number().optional(),
  triageAllGroupText: z.boolean().optional(),
  primaryProject: z.string().optional(),
  projects: z.record(ProjectConfigSchema).default({}),
  triageCmdBase: z.string().optional(),
  fixCmd: z.string().optional(),
  deployCmd: z.string().optional(),
  adminTaskCmd: z.string().optional(),
});

export type BotConfig = z.infer<typeof BotConfigSchema>;

// ProjectInfo: config.json 의 프로젝트 항목 + 런타임 계산 필드(name, dir)
export interface ProjectInfo {
  name: string;
  dir: string;
  mode: 'fix' | 'report';
  repoDir?: string;
  areaHint?: string;
  dbq?: string;
  redisq?: string;
  schemaHint?: string;
  deploy?: { branch?: string; remote?: string; statusCmd?: string };
  railway?: { services?: string[]; logLines?: number };
}

// ── I18N 타입 ─────────────────────────────────────────────────
export type I18nFn = (...args: (string | number | boolean | undefined)[]) => string;
export type I18nValue = string | I18nFn;
export type I18nLangMap = { [K in Lang]?: I18nValue };

// ── Telegram API 타입 ─────────────────────────────────────────
export interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
}

export interface TelegramPhotoSize {
  file_id: string;
  width: number;
  height: number;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  reply_to_message?: TelegramMessage;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramApiResponse<T = unknown> {
  ok: boolean;
  result: T;
  description?: string;
}

export interface TelegramFile {
  file_id: string;
  file_path?: string;
}

export interface RailwayStatusEdge {
  node: {
    serviceInstances: {
      edges: Array<{
        node: {
          serviceName: string;
          latestDeployment?: { status?: string; createdAt?: string };
        };
      }>;
    };
  };
}

export interface RailwayStatusResponse {
  environments?: { edges?: RailwayStatusEdge[] };
}
