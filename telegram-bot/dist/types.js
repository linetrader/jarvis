import { z } from 'zod';
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
