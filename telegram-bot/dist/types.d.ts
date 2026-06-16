import { z } from 'zod';
export type Verdict = 'BUG' | 'USER_ERROR' | 'EXPECTED' | 'NEED_INFO' | 'INFO' | 'ALREADY_FIXED';
export type FixStatus = 'idle' | 'preparing' | 'qa' | 'awaiting' | 'deploying';
export type AdminIntent = 'approve' | 'reject' | 'status' | 'ping' | 'logs' | 'rstatus' | 'redeploy' | 'query' | 'work' | 'deploy' | 'take_item' | 'drop_item' | 'help' | 'unknown';
export type ApprovalDecision = 'approve' | 'reject';
export type YesNoAnswer = 'yes' | 'no' | null;
export type Lang = '한국어' | 'Thai' | 'English' | 'Vietnamese' | 'Chinese' | 'Japanese' | 'Arabic' | 'Russian';
export interface ShellResult {
    ok: boolean;
    code: number;
    stdout: string;
    stderr: string;
}
export interface TriageResult {
    verdict: string;
    scopes: string[];
    summary: string;
    detail: string;
    severity: string;
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
export interface PendingConfirm {
    kind: 'approve' | 'redeploy' | 'deploy';
    project?: string;
    service?: string;
    source?: boolean;
}
export interface PerRepoResult {
    proj: ProjectInfo;
    delta: string[];
    tracked: string[];
    ok: boolean;
}
export declare const BotConfigSchema: z.ZodObject<{
    botToken: z.ZodString;
    botName: z.ZodOptional<z.ZodString>;
    adminChatIds: z.ZodDefault<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodNumber]>, "many">>;
    testerGroupIds: z.ZodDefault<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodNumber]>, "many">>;
    groupBrands: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    pollTimeoutSec: z.ZodOptional<z.ZodNumber>;
    taskTimeoutSec: z.ZodOptional<z.ZodNumber>;
    triageAllGroupText: z.ZodOptional<z.ZodBoolean>;
    primaryProject: z.ZodOptional<z.ZodString>;
    projects: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
        repoDir: z.ZodOptional<z.ZodString>;
        mode: z.ZodEnum<["fix", "report"]>;
        areaHint: z.ZodOptional<z.ZodString>;
        dbq: z.ZodOptional<z.ZodString>;
        redisq: z.ZodOptional<z.ZodString>;
        schemaHint: z.ZodOptional<z.ZodString>;
        deploy: z.ZodOptional<z.ZodObject<{
            branch: z.ZodOptional<z.ZodString>;
            remote: z.ZodOptional<z.ZodString>;
            statusCmd: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            branch?: string | undefined;
            remote?: string | undefined;
            statusCmd?: string | undefined;
        }, {
            branch?: string | undefined;
            remote?: string | undefined;
            statusCmd?: string | undefined;
        }>>;
        railway: z.ZodOptional<z.ZodObject<{
            services: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            logLines: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            services?: string[] | undefined;
            logLines?: number | undefined;
        }, {
            services?: string[] | undefined;
            logLines?: number | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        mode: "fix" | "report";
        deploy?: {
            branch?: string | undefined;
            remote?: string | undefined;
            statusCmd?: string | undefined;
        } | undefined;
        repoDir?: string | undefined;
        areaHint?: string | undefined;
        dbq?: string | undefined;
        redisq?: string | undefined;
        schemaHint?: string | undefined;
        railway?: {
            services?: string[] | undefined;
            logLines?: number | undefined;
        } | undefined;
    }, {
        mode: "fix" | "report";
        deploy?: {
            branch?: string | undefined;
            remote?: string | undefined;
            statusCmd?: string | undefined;
        } | undefined;
        repoDir?: string | undefined;
        areaHint?: string | undefined;
        dbq?: string | undefined;
        redisq?: string | undefined;
        schemaHint?: string | undefined;
        railway?: {
            services?: string[] | undefined;
            logLines?: number | undefined;
        } | undefined;
    }>>>;
    triageCmdBase: z.ZodOptional<z.ZodString>;
    fixCmd: z.ZodOptional<z.ZodString>;
    deployCmd: z.ZodOptional<z.ZodString>;
    adminTaskCmd: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    botToken: string;
    adminChatIds: (string | number)[];
    testerGroupIds: (string | number)[];
    groupBrands: Record<string, string>;
    projects: Record<string, {
        mode: "fix" | "report";
        deploy?: {
            branch?: string | undefined;
            remote?: string | undefined;
            statusCmd?: string | undefined;
        } | undefined;
        repoDir?: string | undefined;
        areaHint?: string | undefined;
        dbq?: string | undefined;
        redisq?: string | undefined;
        schemaHint?: string | undefined;
        railway?: {
            services?: string[] | undefined;
            logLines?: number | undefined;
        } | undefined;
    }>;
    botName?: string | undefined;
    pollTimeoutSec?: number | undefined;
    taskTimeoutSec?: number | undefined;
    triageAllGroupText?: boolean | undefined;
    primaryProject?: string | undefined;
    triageCmdBase?: string | undefined;
    fixCmd?: string | undefined;
    deployCmd?: string | undefined;
    adminTaskCmd?: string | undefined;
}, {
    botToken: string;
    botName?: string | undefined;
    adminChatIds?: (string | number)[] | undefined;
    testerGroupIds?: (string | number)[] | undefined;
    groupBrands?: Record<string, string> | undefined;
    pollTimeoutSec?: number | undefined;
    taskTimeoutSec?: number | undefined;
    triageAllGroupText?: boolean | undefined;
    primaryProject?: string | undefined;
    projects?: Record<string, {
        mode: "fix" | "report";
        deploy?: {
            branch?: string | undefined;
            remote?: string | undefined;
            statusCmd?: string | undefined;
        } | undefined;
        repoDir?: string | undefined;
        areaHint?: string | undefined;
        dbq?: string | undefined;
        redisq?: string | undefined;
        schemaHint?: string | undefined;
        railway?: {
            services?: string[] | undefined;
            logLines?: number | undefined;
        } | undefined;
    }> | undefined;
    triageCmdBase?: string | undefined;
    fixCmd?: string | undefined;
    deployCmd?: string | undefined;
    adminTaskCmd?: string | undefined;
}>;
export type BotConfig = z.infer<typeof BotConfigSchema>;
export interface ProjectInfo {
    name: string;
    dir: string;
    mode: 'fix' | 'report';
    repoDir?: string;
    areaHint?: string;
    dbq?: string;
    redisq?: string;
    schemaHint?: string;
    deploy?: {
        branch?: string;
        remote?: string;
        statusCmd?: string;
    };
    railway?: {
        services?: string[];
        logLines?: number;
    };
}
export type I18nFn = (...args: (string | number | boolean | undefined)[]) => string;
export type I18nValue = string | I18nFn;
export type I18nLangMap = {
    [K in Lang]?: I18nValue;
};
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
                    latestDeployment?: {
                        status?: string;
                        createdAt?: string;
                    };
                };
            }>;
        };
    };
}
export interface RailwayStatusResponse {
    environments?: {
        edges?: RailwayStatusEdge[];
    };
}
