import { Injectable, OnModuleInit } from '@nestjs/common';
import { AclSubjectType, DocumentVisibility, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { ToolRegistryService } from '../tool-registry';
import type { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from '../tool.types';

const MAX_LIST_LIMIT = 50;
const DEFAULT_LIST_LIMIT = 20;

/**
 * list_documents 工具执行器：列出当前用户可读的受管文档库（AI 生成/创建的文档）。
 * 可见性与桌面端「全部文档」一致：本人所有、租户公开、或 ACL 显式授权的文档；
 * document.manage_all 持有者可见全部文档。列出的 document_id 可作为
 * save_to_knowledge(sourceType=DOCUMENT) 的来源引用，由后端再次校验可读性后转存。
 * 只做查询与摘要构造；权限与批准由 ToolRegistry/ToolPolicy 统一处理。
 */
@Injectable()
export class ListDocumentsTool implements OnModuleInit {
    constructor(
        private readonly registry: ToolRegistryService,
        private readonly prisma: PrismaService,
    ) {}

    onModuleInit(): void {
        this.registry.register(this.definition);
    }

    private readonly definition: ToolDefinition = {
        name: 'list_documents',
        version: '1.0.0',
        displayName: '列出可读文档',
        description: '列出当前用户可读的文档库文档（AI 生成或用户创建的文档），支持按标题关键词筛选。'
            + '用户询问自己有哪些文档、或想把某篇已有文档转存进知识库时使用；'
            + '转存时调用 save_to_knowledge，sourceType 传 DOCUMENT、sourceId 传对应 document_id。'
            + '只展示用户可读范围内的文档，绝不引用未出现在结果中的文档 ID。',
        parameters: {
            type: 'object',
            properties: {
                keyword: {
                    type: 'string',
                    description: '标题关键词筛选；省略时列出全部可读文档',
                },
                limit: {
                    type: 'integer',
                    description: '返回条数上限，默认 20，最大 50',
                },
            },
            additionalProperties: false,
        },
        requiredPermissions: ['document.read'],
        riskLevel: 'READ',
        validate: validateListDocumentsArguments,
        execute: (context, input) => this.executeList(context, input),
    };

    private async executeList(
        context: ToolExecutionContext,
        input: Record<string, unknown>,
    ): Promise<ToolExecutionResult> {
        const keyword = typeof input.keyword === 'string' ? input.keyword.trim() : '';
        const limit = typeof input.limit === 'number' ? input.limit : DEFAULT_LIST_LIMIT;

        const roleIds = await this.resolveRoleIds(context.tenantId, context.membershipId);
        const where = this.buildAccessibleWhere(context, roleIds);
        if (keyword) {
            const titleFilter: Prisma.ManagedDocumentWhereInput = {
                title: { contains: keyword, mode: 'insensitive' },
            };
            where.AND = Array.isArray(where.AND)
                ? [...where.AND, titleFilter]
                : where.AND
                    ? [where.AND, titleFilter]
                    : [titleFilter];
        }

        const documents = await this.prisma.managedDocument.findMany({
            where,
            select: { id: true, title: true, createdAt: true, updatedAt: true },
            orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
            take: Math.min(Math.max(limit, 1), MAX_LIST_LIMIT),
        });

        const summary = JSON.stringify({
            type: 'document_candidates',
            candidates: documents.map((document) => ({
                document_id: document.id,
                title: document.title,
                updated_at: document.updatedAt.toISOString(),
            })),
            instruction: documents.length === 0
                ? '当前用户没有可读文档，请如实告知用户，不要调用 save_to_knowledge 转存文档。'
                : '用户询问有哪些文档时，如实列出标题与更新时间；'
                    + '用户想把其中某篇转存进知识库时，先经用户确认目标文档与目标知识库，'
                    + '再调用 save_to_knowledge 并传 sourceType=DOCUMENT、sourceId=对应 document_id。'
                    + '不要向用户展示 document_id。',
        });
        return { resourceType: null, resourceId: null, summary };
    }

    /** 与桌面端文档列表一致的可见性：本人所有 / 租户公开 / ACL 显式授权；manage_all 全量。 */
    private buildAccessibleWhere(
        context: ToolExecutionContext,
        roleIds: string[],
    ): Prisma.ManagedDocumentWhereInput {
        const base: Prisma.ManagedDocumentWhereInput = {
            tenantId: context.tenantId,
            deletedAt: null,
            resource: { is: { tenantId: context.tenantId, deletedAt: null } },
        };
        if (context.permissions.includes('document.manage_all')) return base;
        const now = new Date();
        return {
            AND: [
                base,
                {
                    OR: [
                        { resource: { is: { ownerMembershipId: context.membershipId } } },
                        { visibility: DocumentVisibility.TENANT },
                        {
                            resource: {
                                is: {
                                    acls: {
                                        some: {
                                            tenantId: context.tenantId,
                                            deletedAt: null,
                                            permissionCodes: { has: 'document.read' },
                                            AND: [
                                                {
                                                    OR: [
                                                        { subjectType: AclSubjectType.MEMBERSHIP, subjectId: context.membershipId },
                                                        ...(roleIds.length > 0
                                                            ? [{ subjectType: AclSubjectType.ROLE, subjectId: { in: roleIds } }]
                                                            : []),
                                                    ],
                                                },
                                                { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
                                            ],
                                        },
                                    },
                                },
                            },
                        },
                    ],
                },
            ],
        };
    }

    private async resolveRoleIds(tenantId: string, membershipId: string): Promise<string[]> {
        const assignments = await this.prisma.membershipRole.findMany({
            where: { tenantId, membershipId },
            select: { roleId: true },
        });
        return assignments.map((assignment) => assignment.roleId);
    }
}

function validateListDocumentsArguments(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('工具参数必须为对象');
    }
    const raw = input as Record<string, unknown>;
    const parsed: Record<string, unknown> = {};
    if (raw.keyword !== undefined && raw.keyword !== null) {
        if (typeof raw.keyword !== 'string') {
            throw new Error('keyword 必须为字符串');
        }
        const keyword = raw.keyword.trim();
        if (keyword.length > 100) {
            throw new Error('keyword 不能超过 100 字符');
        }
        if (keyword) parsed.keyword = keyword;
    }
    if (raw.limit !== undefined && raw.limit !== null) {
        if (typeof raw.limit !== 'number' || !Number.isInteger(raw.limit) || raw.limit < 1) {
            throw new Error('limit 必须是大于 0 的整数');
        }
        parsed.limit = raw.limit;
    }
    return parsed;
}
