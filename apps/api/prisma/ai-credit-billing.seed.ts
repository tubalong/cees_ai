import {
    AICreditCapabilityKind,
    AICreditConfigStatus,
    AICreditMeterType,
    AICreditRateDimension,
    AICreditSubscriptionDuration,
    PrismaClient,
} from '@prisma/client';

/**
 * AI Credit 计费配置初始数据（实现清单 S3）。
 *
 * 幂等原则：结构性字段（能力目录、档位额度、功能集勾选）在重跑 seed 时复位为代码定义值；
 * 商务性数值（档位价格、单位单价、加油包价格、费率）只做兜底创建，不覆盖超管在后台的调整。
 */

/** 能力目录种子：code 与现有权限码的映射（chat / tool-calling 无独立权限码，对话工具集对每个账号默认可用）。 */
const AI_CREDIT_CAPABILITY_SEEDS = [
    {
        code: 'chat',
        name: 'AI 对话',
        meterType: AICreditMeterType.TOKEN,
        capabilityKind: AICreditCapabilityKind.UNIVERSAL,
        permissionCode: null,
        sortOrder: 1,
    },
    {
        code: 'rag',
        name: '知识库问答',
        meterType: AICreditMeterType.TOKEN,
        capabilityKind: AICreditCapabilityKind.TIER_GATED,
        permissionCode: 'knowledge_base.query',
        sortOrder: 2,
    },
    {
        code: 'image-gen',
        name: 'AI 图片生成',
        meterType: AICreditMeterType.PER_REQUEST,
        capabilityKind: AICreditCapabilityKind.TIER_GATED,
        permissionCode: 'ai.image.generate',
        sortOrder: 3,
    },
    {
        code: 'doc-gen',
        name: 'AI 文档生成',
        meterType: AICreditMeterType.PER_REQUEST,
        capabilityKind: AICreditCapabilityKind.TIER_GATED,
        permissionCode: 'ai.document.generate',
        sortOrder: 4,
    },
    {
        code: 'pdf-gen',
        name: 'AI PDF 生成',
        meterType: AICreditMeterType.PER_REQUEST,
        capabilityKind: AICreditCapabilityKind.TIER_GATED,
        permissionCode: 'ai.pdf.generate',
        sortOrder: 5,
    },
    {
        code: 'ppt-gen',
        name: 'AI PPT 生成',
        meterType: AICreditMeterType.PER_REQUEST,
        capabilityKind: AICreditCapabilityKind.TIER_GATED,
        permissionCode: 'ai.ppt.generate',
        sortOrder: 6,
    },
    {
        code: 'workflow',
        name: 'AI 工作流',
        meterType: AICreditMeterType.TOKEN,
        capabilityKind: AICreditCapabilityKind.TIER_GATED,
        permissionCode: 'ai.workflow.use',
        sortOrder: 7,
    },
    {
        code: 'web-search',
        name: 'AI 联网搜索',
        meterType: AICreditMeterType.TOKEN,
        capabilityKind: AICreditCapabilityKind.UNIVERSAL,
        permissionCode: 'ai.web.search',
        sortOrder: 8,
    },
    {
        code: 'tool-calling',
        name: 'AI 工具调用',
        meterType: AICreditMeterType.TOKEN,
        capabilityKind: AICreditCapabilityKind.UNIVERSAL,
        permissionCode: null,
        sortOrder: 9,
    },
] as const;

/** 费率种子：TOKEN 能力按输入/输出分开配置（倍率与比例初始均为 1），PER_REQUEST 能力按次配置。 */
const AI_CREDIT_RATE_SEEDS = [
    { capabilityCode: 'chat', dimension: AICreditRateDimension.TOKEN_INPUT, tokenMultiplier: '1', creditPerToken: '1' },
    { capabilityCode: 'chat', dimension: AICreditRateDimension.TOKEN_OUTPUT, tokenMultiplier: '1', creditPerToken: '1' },
    { capabilityCode: 'rag', dimension: AICreditRateDimension.TOKEN_INPUT, tokenMultiplier: '1', creditPerToken: '1' },
    { capabilityCode: 'rag', dimension: AICreditRateDimension.TOKEN_OUTPUT, tokenMultiplier: '1', creditPerToken: '1' },
    { capabilityCode: 'workflow', dimension: AICreditRateDimension.TOKEN_INPUT, tokenMultiplier: '1', creditPerToken: '1' },
    { capabilityCode: 'workflow', dimension: AICreditRateDimension.TOKEN_OUTPUT, tokenMultiplier: '1', creditPerToken: '1' },
    { capabilityCode: 'web-search', dimension: AICreditRateDimension.TOKEN_INPUT, tokenMultiplier: '1', creditPerToken: '1' },
    { capabilityCode: 'web-search', dimension: AICreditRateDimension.TOKEN_OUTPUT, tokenMultiplier: '1', creditPerToken: '1' },
    { capabilityCode: 'tool-calling', dimension: AICreditRateDimension.TOKEN_INPUT, tokenMultiplier: '1', creditPerToken: '1' },
    { capabilityCode: 'tool-calling', dimension: AICreditRateDimension.TOKEN_OUTPUT, tokenMultiplier: '1', creditPerToken: '1' },
    { capabilityCode: 'image-gen', dimension: AICreditRateDimension.PER_REQUEST, perRequestCredits: '500' },
    { capabilityCode: 'doc-gen', dimension: AICreditRateDimension.PER_REQUEST, perRequestCredits: '800' },
    { capabilityCode: 'pdf-gen', dimension: AICreditRateDimension.PER_REQUEST, perRequestCredits: '500' },
    { capabilityCode: 'ppt-gen', dimension: AICreditRateDimension.PER_REQUEST, perRequestCredits: '1000' },
] as const;

/** 档位种子：功能集勾选（仅功能开关类能力，通用能力全档开放）与三个持续时间的价格占位。 */
const AI_CREDIT_TIER_SEEDS = [
    {
        code: 'TIER_BASIC',
        name: '基础版',
        description: 'AI 对话 + Word 文档生成',
        monthlyBaseCredits: '5000',
        capabilities: ['doc-gen'],
    },
    {
        code: 'TIER_PREMIUM',
        name: '高级版',
        description: '基础版能力 + 知识库 RAG、图像/PDF/PPT 生成与工作流',
        monthlyBaseCredits: '10000',
        capabilities: ['rag', 'image-gen', 'doc-gen', 'pdf-gen', 'ppt-gen', 'workflow'],
    },
] as const;

/** 档位价格与单位单价的商务占位值（上线前由超级管理员在后台填写真实价格）。 */
const TIER_PRICE_PLACEHOLDER = '0';

/** 每个档位 × 三个持续时间的价格行；订阅总价 = (tierPrice + unitPrice × N) × 折扣。 */
const TIER_PRICE_DURATIONS = [
    AICreditSubscriptionDuration.ONE_MONTH,
    AICreditSubscriptionDuration.SIX_MONTHS,
    AICreditSubscriptionDuration.TWELVE_MONTHS,
] as const;

/** 加油包种子：永久有效（不设有效期字段），价格为商务占位值。 */
const AI_CREDIT_BOOSTER_SEEDS = [
    { name: '加油包 5,000', credits: '5000', description: '永久有效' },
    { name: '加油包 10,000', credits: '10000', description: '永久有效' },
    { name: '加油包 50,000', credits: '50000', description: '永久有效' },
] as const;

const BOOSTER_PRICE_PLACEHOLDER = '0';

/** 全局计费配置单行表主键。 */
const GLOBAL_BILLING_CONFIG_ID = 'default';

export async function seedAiCreditBillingConfig(prisma: PrismaClient): Promise<void> {
    await seedCapabilities(prisma);
    await seedRateCards(prisma);
    await seedTiers(prisma);
    await seedBoosters(prisma);
    await seedGlobalBillingConfig(prisma);
}

async function seedCapabilities(prisma: PrismaClient): Promise<void> {
    for (const seed of AI_CREDIT_CAPABILITY_SEEDS) {
        // code 的唯一性由数据库部分唯一索引保证（Prisma 客户端不感知），因此不用 upsert。
        const existing = await prisma.aICreditCapability.findFirst({ where: { code: seed.code } });
        if (existing) {
            await prisma.aICreditCapability.update({
                where: { id: existing.id },
                data: {
                    name: seed.name,
                    meterType: seed.meterType,
                    capabilityKind: seed.capabilityKind,
                    permissionCode: seed.permissionCode,
                    sortOrder: seed.sortOrder,
                    status: AICreditConfigStatus.ACTIVE,
                    deletedAt: null,
                },
            });
        } else {
            await prisma.aICreditCapability.create({ data: { ...seed } });
        }
    }
}

async function seedRateCards(prisma: PrismaClient): Promise<void> {
    for (const seed of AI_CREDIT_RATE_SEEDS) {
        const capability = await prisma.aICreditCapability.findFirst({ where: { code: seed.capabilityCode } });
        if (!capability) {
            throw new Error(`AI Credit 能力 ${seed.capabilityCode} 不存在，费率 seed 失败`);
        }
        // 只兜底创建初值：该组合已有任意版本行时不动，避免覆盖超管的调价历史。
        const existing = await prisma.aICreditRateCard.findFirst({
            where: { capabilityId: capability.id, modelGroup: 'default', dimension: seed.dimension },
            orderBy: { rateVersion: 'desc' },
        });
        if (existing) {
            continue;
        }
        await prisma.aICreditRateCard.create({
            data: {
                capabilityId: capability.id,
                modelGroup: 'default',
                dimension: seed.dimension,
                tokenMultiplier: 'tokenMultiplier' in seed ? seed.tokenMultiplier : undefined,
                creditPerToken: 'creditPerToken' in seed ? seed.creditPerToken : undefined,
                perRequestCredits: 'perRequestCredits' in seed ? seed.perRequestCredits : undefined,
                rateVersion: 1,
                status: AICreditConfigStatus.ACTIVE,
            },
        });
    }
}

async function seedTiers(prisma: PrismaClient): Promise<void> {
    for (const seed of AI_CREDIT_TIER_SEEDS) {
        // code 的唯一性由数据库部分唯一索引保证（Prisma 客户端不感知），因此不用 upsert。
        const existingTier = await prisma.aICreditTier.findFirst({ where: { code: seed.code } });
        const tier = existingTier
            ? await prisma.aICreditTier.update({
                where: { id: existingTier.id },
                data: {
                    name: seed.name,
                    description: seed.description,
                    monthlyBaseCredits: seed.monthlyBaseCredits,
                    status: AICreditConfigStatus.ACTIVE,
                    deletedAt: null,
                },
            })
            : await prisma.aICreditTier.create({
                data: {
                    code: seed.code,
                    name: seed.name,
                    description: seed.description,
                    monthlyBaseCredits: seed.monthlyBaseCredits,
                },
            });
        for (const duration of TIER_PRICE_DURATIONS) {
            // 价格是商务值：只兜底创建，不覆盖超管在后台的调整。
            await prisma.aICreditTierPrice.upsert({
                where: { tierId_duration: { tierId: tier.id, duration } },
                update: {},
                create: {
                    tierId: tier.id,
                    duration,
                    tierPrice: TIER_PRICE_PLACEHOLDER,
                    unitPrice: TIER_PRICE_PLACEHOLDER,
                },
            });
        }
        for (const capabilityCode of seed.capabilities) {
            const capability = await prisma.aICreditCapability.findFirst({ where: { code: capabilityCode } });
            if (!capability) {
                throw new Error(`AI Credit 能力 ${capabilityCode} 不存在，档位 ${seed.code} 功能集 seed 失败`);
            }
            await prisma.aICreditTierCapability.upsert({
                where: { tierId_capabilityId: { tierId: tier.id, capabilityId: capability.id } },
                update: {},
                create: { tierId: tier.id, capabilityId: capability.id },
            });
        }
    }
}

async function seedBoosters(prisma: PrismaClient): Promise<void> {
    for (const seed of AI_CREDIT_BOOSTER_SEEDS) {
        const existing = await prisma.aICreditBoosterTier.findFirst({ where: { name: seed.name } });
        if (existing) {
            // 额度复位为代码定义值；价格为商务值，不覆盖。
            await prisma.aICreditBoosterTier.update({
                where: { id: existing.id },
                data: { credits: seed.credits, status: AICreditConfigStatus.ACTIVE, deletedAt: null },
            });
        } else {
            await prisma.aICreditBoosterTier.create({
                data: {
                    name: seed.name,
                    credits: seed.credits,
                    price: BOOSTER_PRICE_PLACEHOLDER,
                    description: seed.description,
                },
            });
        }
    }
}

async function seedGlobalBillingConfig(prisma: PrismaClient): Promise<void> {
    // 单行表：其余字段（最小单位 0.1、重置日、时区模式、折扣、上限）使用 schema 默认值；已存在时不覆盖超管调整。
    await prisma.aICreditBillingConfig.upsert({
        where: { id: GLOBAL_BILLING_CONFIG_ID },
        update: {},
        create: {
            id: GLOBAL_BILLING_CONFIG_ID,
            subscriptionDurations: [
                AICreditSubscriptionDuration.ONE_MONTH,
                AICreditSubscriptionDuration.SIX_MONTHS,
                AICreditSubscriptionDuration.TWELVE_MONTHS,
            ],
        },
    });
}
