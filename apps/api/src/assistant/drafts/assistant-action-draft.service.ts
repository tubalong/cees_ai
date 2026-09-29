import {
    ConflictException,
    ForbiddenException,
    HttpException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { AuditOutcome, AssistantEventType, DraftStatus, Prisma, ToolCallStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../tenant/tenant-context';
import { isActiveMembership, resolveMembershipAuthorization } from '../../rbac/authorization-resolver';
import { EventService } from '../conversation/event.service';
import { ToolPolicyError, ToolPolicyService } from '../tools/tool-policy.service';
import { ToolRegistryService } from '../tools/tool-registry';
import { ToolExecutionError, type ToolConfirmationRequest, type ToolExecutionContext } from '../tools/tool.types';

/**
 * 待确认草稿的有效期。过期后确认接口返回 409，用户必须重新发起对话，
 * 避免用户在时过境迁（数据已变化）之后仍执行一份陈旧的参数快照。
 */
export const ACTION_DRAFT_TTL_MS = 15 * 60 * 1000;

const SUMMARY_MAX_LENGTH = 2000;

/** 对外暴露的草稿处理结果；结构与契约 AssistantActionDraftResolution 一致。 */
export interface ActionDraftResolution {
    draftId: string;
    status: 'PENDING_CONFIRMATION' | 'EXECUTED' | 'FAILED' | 'REJECTED' | 'EXPIRED';
    summary: string;
    resource: { type: 'IMAGE' | 'DOCUMENT'; id: string } | null;
}

interface DraftRow {
    id: string;
    tenantId: string;
    conversationId: string;
    turnId: string;
    membershipId: string;
    userId: string;
    requestId: string;
    toolCallId: string;
    toolName: string;
    toolVersion: string;
    riskLevel: string;
    arguments: Prisma.JsonValue;
    preview: Prisma.JsonValue;
    status: DraftStatus;
    expiresAt: Date;
}

/**
 * AI 写操作确认（写操作确认机制的唯一闸口）。
 *
 * 分工：
 * - TurnRunner 在写工具通过程序化批准后调用 `createDraft`，把参数快照与预览落库，
 *   并把 ToolCall 置为 AWAITING_CONFIRMATION；**此时不执行任何业务副作用**。
 * - 用户在对话里确认后由控制器调用 `confirm`：重新解析实时权限、重新校验参数，
 *   再用条件更新抢占草稿（双击 / 重试不会重复执行），最后才调用工具执行器。
 *
 * 安全约束（逐条对应契约说明）：
 * 1. 确认接口只接受 draftId，参数一律取草稿快照，客户端无法在确认时替换路径或业务参数；
 * 2. 权限在确认瞬间重新解析，创建草稿后被回收权限的成员会拿到 403；
 * 3. 只有草稿归属成员本人可确认或取消，他人一律 404（不泄露草稿是否存在）；
 * 4. 抢占式状态流转 + `toolCallId` 唯一约束共同保证幂等。
 */
@Injectable()
export class AssistantActionDraftService {
    private readonly logger = new Logger(AssistantActionDraftService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
        private readonly registry: ToolRegistryService,
        private readonly toolPolicy: ToolPolicyService,
        private readonly eventService: EventService,
    ) { }

    /** 由 TurnRunner 调用：写工具通过程序化批准后落草稿，返回给客户端展示的确认信息。 */
    async createDraft(input: {
        tenantId: string;
        conversationId: string;
        turnId: string;
        membershipId: string;
        userId: string;
        requestId: string;
        toolCallId: string;
        toolName: string;
        toolVersion: string;
        riskLevel: string;
        arguments: Record<string, unknown>;
        confirmation: ToolConfirmationRequest;
    }): Promise<{ draftId: string; expiresAt: Date }> {
        const expiresAt = new Date(Date.now() + ACTION_DRAFT_TTL_MS);
        const draft = await this.prisma.assistantActionDraft.create({
            data: {
                tenantId: input.tenantId,
                conversationId: input.conversationId,
                turnId: input.turnId,
                membershipId: input.membershipId,
                userId: input.userId,
                requestId: input.requestId,
                toolCallId: input.toolCallId,
                toolName: input.toolName,
                toolVersion: input.toolVersion,
                riskLevel: input.riskLevel,
                arguments: input.arguments as Prisma.InputJsonObject,
                preview: {
                    title: input.confirmation.title,
                    fields: input.confirmation.fields,
                } as unknown as Prisma.InputJsonObject,
                expiresAt,
            },
            select: { id: true, expiresAt: true },
        });
        this.logger.log(`action draft created: ${input.toolName} draft=${draft.id} toolCall=${input.toolCallId}`);
        return { draftId: draft.id, expiresAt: draft.expiresAt };
    }

    /** 用户确认：重新鉴权 + 重新校验参数 + 抢占草稿 + 执行 + 落审计与事件。 */
    async confirm(draftId: string): Promise<ActionDraftResolution> {
        const draft = await this.requireOwnedDraft(draftId);
        this.assertPending(draft);

        const definition = this.registry.get(draft.toolName);
        if (!definition) {
            // 工具已下线（例如版本回滚后移除了写工具）：把草稿标记失败，避免悬空。
            const summary = '该操作已下线，请重新发起对话。';
            await this.settleWithoutExecution(draft, DraftStatus.FAILED, 'TOOL_UNAVAILABLE', summary);
            return { draftId: draft.id, status: 'FAILED', summary, resource: null };
        }

        // 确认瞬间重新核对成员状态：草稿生成后成员可能被停用、删除或租户被停用，
        // 此时即使参数与权限看起来都对，也不能再落业务写入。
        if (!(await isActiveMembership(this.prisma, draft.tenantId, draft.membershipId))) {
            throw new ForbiddenException({ code: 'ACTION_DRAFT_MEMBERSHIP_INACTIVE', message: '成员身份已失效，无法执行该操作' });
        }

        // 只解析一次实时授权：权限用于重新批准，角色随执行上下文传给业务 Service。
        const authorization = await resolveMembershipAuthorization(this.prisma, draft.tenantId, draft.membershipId);
        try {
            this.toolPolicy.approve({
                name: draft.toolName,
                arguments: draft.arguments,
                permissions: authorization.permissions,
            });
        } catch (error) {
            if (error instanceof ToolPolicyError) {
                await this.settleWithoutExecution(draft, DraftStatus.REJECTED, error.code, error.userFacingSummary);
                throw new ForbiddenException({ code: `ACTION_DRAFT_${error.code}`, message: error.userFacingSummary });
            }
            throw error;
        }

        // 抢占：只有把 PENDING_CONFIRMATION 改成 CONFIRMED 的那次调用会真正执行。
        const claimed = await this.prisma.assistantActionDraft.updateMany({
            where: { id: draft.id, status: DraftStatus.PENDING_CONFIRMATION, expiresAt: { gt: new Date() } },
            data: {
                status: DraftStatus.CONFIRMED,
                resolvedAt: new Date(),
                resolvedBy: this.tenantContext.require().userId,
                version: { increment: 1 },
            },
        });
        if (claimed.count !== 1) {
            const latest = await this.requireOwnedDraft(draftId);
            throw new ConflictException({
                code: 'ACTION_DRAFT_NOT_PENDING',
                message: `该操作已处理（当前状态：${latest.status}），请刷新对话查看结果`,
            });
        }

        const context: ToolExecutionContext = {
            tenantId: draft.tenantId,
            userId: draft.userId,
            membershipId: draft.membershipId,
            requestId: draft.requestId,
            conversationId: draft.conversationId,
            turnId: draft.turnId,
            toolCallId: draft.toolCallId,
            // 确认执行没有轮次租约：用固定所有者与草稿 ID 作为执行令牌，
            // 业务服务可据此识别“这是一次用户确认触发的执行”。
            executionOwner: 'action-draft-confirmation',
            executionToken: draft.id,
            permissions: authorization.permissions,
            roles: authorization.roles,
            knowledgeBaseEnabled: false,
            webSearchEnabled: false,
        };

        try {
            const result = await definition.execute(context, draft.arguments as Record<string, unknown>);
            const modelSummary = truncate(result.summary);
            const userSummary = truncate(result.userSummary ?? result.summary);
            await this.settleExecuted(
                draft,
                DraftStatus.EXECUTED,
                userSummary,
                result.resourceType,
                result.resourceId,
                undefined,
                modelSummary,
            );
            return {
                draftId: draft.id,
                status: 'EXECUTED',
                summary: userSummary,
                resource: result.resourceId && result.resourceType ? { type: result.resourceType, id: result.resourceId } : null,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : '操作执行失败';
            // 业务服务抛出的 4xx 自带面向用户写好的文案（重名、版本冲突、参数不合法等），
            // 直接透出，让用户知道下一步该做什么；未识别的错误仍用通用文案，
            // 既不泄露约束名/上游响应等内部细节，也不假装知道原因。
            // 同时不能断言「未产生业务写入」：工具可能已提交写入、随后在结算阶段失败，
            // 旧措辞会诱导用户重试并产生重复数据。
            const userSummary = curatedUserMessage(error) ?? '操作执行失败，请刷新对话确认结果；若未生效可重试。';
            // 回喂模型的摘要必须是无细节的固定文案：权限码、约束名、上游响应不进模型上下文。
            const modelSummary = '该操作未能完成，请告知用户查看界面提示，或在用户提供新参数后重试';
            this.logger.error(`action draft execution failed: draft=${draft.id} tool=${draft.toolName} error=${message}`);
            await this.settleExecuted(draft, DraftStatus.FAILED, userSummary, null, null, 'ACTION_EXECUTION_FAILED', modelSummary);
            return { draftId: draft.id, status: 'FAILED', summary: userSummary, resource: null };
        }
    }

    /**
     * 列出当前成员待确认的草稿（未过期、未决策），按创建时间倒序。
     *
     * 存在的理由：确认卡片此前只随流式事件推给客户端，一旦刷新页面就消失，而服务端草稿
     * 仍在等待确认；用户看不到待确认项，只会重复发起，表现为「一次只能建一个」。
     * 这里提供常驻列表，客户端在输入框上方以抽屉统一展示与批量确认。
     *
     * 只返回展示字段（标题、预览字段、过期时间、所属会话），**不含**参数快照：
     * 参数只保存在服务端，确认时仍以快照为准，客户端无法借列表接口替换业务参数。
     */
    async listPending(): Promise<Array<{
        draftId: string;
        toolName: string;
        title: string;
        fields: ToolConfirmationRequest['fields'];
        expiresAt: Date;
        conversationId: string;
        createdAt: Date;
    }>> {
        const context = this.tenantContext.require();
        const rows = await this.prisma.assistantActionDraft.findMany({
            where: {
                tenantId: context.tenantId,
                membershipId: context.membershipId,
                status: DraftStatus.PENDING_CONFIRMATION,
                expiresAt: { gt: new Date() },
            },
            select: {
                id: true,
                toolName: true,
                preview: true,
                expiresAt: true,
                conversationId: true,
                createdAt: true,
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 50,
        });
        return rows.map((row) => {
            const preview = (row.preview ?? {}) as { title?: unknown; fields?: unknown };
            return {
                draftId: row.id,
                toolName: row.toolName,
                title: typeof preview.title === 'string' ? preview.title : '待确认操作',
                fields: Array.isArray(preview.fields) ? preview.fields as ToolConfirmationRequest['fields'] : [],
                expiresAt: row.expiresAt,
                conversationId: row.conversationId,
                createdAt: row.createdAt,
            };
        });
    }

    /** 用户取消：草稿进入 REJECTED 终态，事件与消息留痕，需重新发起对话才能再做同样的事。 */
    async cancel(draftId: string): Promise<ActionDraftResolution> {
        const draft = await this.requireOwnedDraft(draftId);
        this.assertPending(draft);
        const summary = '已取消，未执行任何变更。';
        await this.settleExecuted(draft, DraftStatus.REJECTED, summary, null, null, 'ACTION_CANCELLED');
        return { draftId: draft.id, status: 'REJECTED', summary, resource: null };
    }

    /** 读取草稿并要求归属当前成员；不存在或不属于本人时一律 404，不泄露草稿存在性。 */
    private async requireOwnedDraft(draftId: string): Promise<DraftRow> {
        const context = this.tenantContext.require();
        const draft = await this.prisma.assistantActionDraft.findFirst({
            where: { id: draftId, tenantId: context.tenantId, membershipId: context.membershipId, deletedAt: null },
            select: {
                id: true, tenantId: true, conversationId: true, turnId: true, membershipId: true, userId: true,
                requestId: true, toolCallId: true, toolName: true, toolVersion: true, riskLevel: true,
                arguments: true, preview: true, status: true, expiresAt: true,
            },
        });
        if (!draft) throw new NotFoundException({ code: 'ACTION_DRAFT_NOT_FOUND', message: '待确认操作不存在或已失效' });
        return draft;
    }

    /** 过期与终态统一在这里判定，保证确认与取消两条路径语义一致。 */
    private assertPending(draft: DraftRow): void {
        if (draft.status === DraftStatus.PENDING_CONFIRMATION && draft.expiresAt.getTime() <= Date.now()) {
            throw new ConflictException({ code: 'ACTION_DRAFT_EXPIRED', message: '该操作已过期，请重新发起对话。' });
        }
        if (draft.status !== DraftStatus.PENDING_CONFIRMATION) {
            throw new ConflictException({
                code: 'ACTION_DRAFT_NOT_PENDING',
                message: `该操作已处理（当前状态：${draft.status}），请刷新对话查看结果`,
            });
        }
    }

    /** 未执行就终止（工具下线 / 权限被回收）：草稿置终态并留下可解释的事件与消息。 */
    private async settleWithoutExecution(
        draft: DraftRow,
        status: DraftStatus,
        code: string,
        summary: string,
    ): Promise<void> {
        await this.prisma.assistantActionDraft.updateMany({
            where: { id: draft.id, status: DraftStatus.PENDING_CONFIRMATION },
            data: { status, resolvedAt: new Date(), resolvedBy: this.tenantContext.require().userId, errorCode: code, resultSummary: summary, version: { increment: 1 } },
        });
    }

    /**
     * 执行结束（成功 / 失败 / 用户取消）的统一收口：草稿终态、ToolCall 终态、
     * TOOL_RESULT 事件与历史消息在同一事务提交，保证刷新与重放后状态一致。
     * 成功时内部模型摘要写 TOOL 消息，用户摘要写 ASSISTANT 消息；客户端会隐藏 TOOL 正文。
     */
    private async settleExecuted(
        draft: DraftRow,
        status: DraftStatus,
        summary: string,
        resourceType: 'IMAGE' | 'DOCUMENT' | null,
        resourceId: string | null,
        errorCode?: string,
        modelSummary = summary,
    ): Promise<void> {
        const actorUserId = this.tenantContext.require().userId;
        const succeeded = status === DraftStatus.EXECUTED;
        const rejected = status === DraftStatus.REJECTED;
        const turnStatus = succeeded ? ToolCallStatus.COMPLETED : rejected ? ToolCallStatus.REJECTED : ToolCallStatus.FAILED;
        const eventStatus = succeeded ? 'completed' : rejected ? 'rejected' : 'failed';

        await this.prisma.$transaction(async (transaction) => {
            await transaction.assistantActionDraft.updateMany({
                where: { id: draft.id, status: { in: [DraftStatus.CONFIRMED, DraftStatus.PENDING_CONFIRMATION] } },
                data: {
                    status,
                    resolvedAt: new Date(),
                    resolvedBy: actorUserId,
                    resultSummary: summary,
                    errorCode: errorCode ?? null,
                    version: { increment: 1 },
                },
            });

            await transaction.toolCall.updateMany({
                where: { id: draft.toolCallId, status: ToolCallStatus.AWAITING_CONFIRMATION },
                data: {
                    status: turnStatus,
                    completedAt: new Date(),
                    // ToolCall 保留模型摘要，供后续轮次继续引用内部资源；用户消息只使用 summary。
                    result: { summary: modelSummary, resourceType, resourceId, sources: [], citations: [] } as unknown as Prisma.InputJsonObject,
                    executedResourceType: resourceType,
                    executedResourceId: resourceId,
                    errorCode: succeeded ? null : errorCode ?? 'ACTION_NOT_EXECUTED',
                    errorMessage: succeeded ? null : summary,
                },
            });

            if (succeeded) {
                // toolCallId 在 conversation_messages 上是唯一列，而草稿生成时 turn-state
                // 已经写过一条 TOOL 消息（内容为草稿摘要）。确认成功后必须原地更新这条消息，
                // 不能用 create 再插一条：唯一冲突会让整个结算事务回滚，而业务写入已经在
                // execute 里提交过了，结果就是「数据已写入、草稿被标记失败」，用户重试后
                // 产生重复数据（如重复建库）。
                await transaction.conversationMessage.upsert({
                    where: { toolCallId: draft.toolCallId },
                    update: { content: modelSummary },
                    create: {
                        tenantId: draft.tenantId,
                        conversationId: draft.conversationId,
                        turnId: draft.turnId,
                        role: 'TOOL',
                        toolCallId: draft.toolCallId,
                        content: modelSummary,
                    },
                });
            }
            await transaction.conversationMessage.create({
                data: {
                    tenantId: draft.tenantId,
                    conversationId: draft.conversationId,
                    turnId: draft.turnId,
                    role: 'ASSISTANT',
                    content: summary,
                },
            });

            await transaction.auditLog.create({
                data: {
                    tenantId: draft.tenantId,
                    actorUserId,
                    actorMembershipId: draft.membershipId,
                    action: succeeded ? 'ASSISTANT_ACTION_DRAFT_EXECUTED' : rejected ? 'ASSISTANT_ACTION_DRAFT_CANCELLED' : 'ASSISTANT_ACTION_DRAFT_FAILED',
                    outcome: succeeded ? AuditOutcome.SUCCESS : rejected ? AuditOutcome.SUCCESS : AuditOutcome.FAILURE,
                    resourceType: 'ASSISTANT_ACTION_DRAFT',
                    resourceId: draft.id,
                    requestId: draft.requestId,
                    metadata: {
                        // 只记工具名与业务资源 ID；参数快照可能含业务敏感信息，不进审计元数据。
                        toolName: draft.toolName,
                        toolVersion: draft.toolVersion,
                        toolCallId: draft.toolCallId,
                        executedResourceId: resourceId,
                        errorCode: errorCode ?? null,
                    },
                },
            });

            await this.eventsAppend(transaction, draft, {
                type: 'tool_result',
                toolCallId: draft.toolCallId,
                status: eventStatus,
                resource: resourceId && resourceType ? { type: resourceType, id: resourceId } : null,
                sources: [],
                citations: [],
                confirmation: null,
                error: succeeded || rejected ? null : { code: errorCode ?? 'ACTION_EXECUTION_FAILED', message: summary },
            });
        });
    }

    /**
     * 确认结果事件追加回**原轮次**，使客户端重放 `events?afterSeq=N` 时能看到
     * awaiting_confirmation → completed 的完整演化，而不是永远停在待确认。
     */
    private async eventsAppend(
        transaction: Prisma.TransactionClient,
        draft: DraftRow,
        payload: Record<string, unknown>,
    ): Promise<void> {
        await this.eventService.appendInTransaction(
            transaction,
            draft.turnId,
            draft.tenantId,
            AssistantEventType.TOOL_RESULT,
            payload,
        );
    }
}

function truncate(value: string): string {
    return value.length > SUMMARY_MAX_LENGTH ? `${value.slice(0, SUMMARY_MAX_LENGTH - 1)}…` : value;
}

/**
 * 取出可以直接展示给用户的业务文案。
 *
 * 只有「业务层自带的 4xx」与「工具层受控错误」才允许透出：这两类文案是
 * 为终端用户写的（如「当前租户下已存在同名知识库，请换一个名称」）。
 * 5xx、通用 Error 一律返回 undefined，由调用方使用通用兜底文案，
 * 避免 Prisma 约束名、上游响应或堆栈进到界面。
 */
function curatedUserMessage(error: unknown): string | undefined {
    if (error instanceof ToolExecutionError) {
        const message = error.message.trim();
        return message || undefined;
    }
    if (!(error instanceof HttpException) || error.getStatus() >= 500) return undefined;
    const response = error.getResponse();
    if (typeof response === 'object' && response !== null && !Array.isArray(response)) {
        const message = (response as { message?: unknown }).message;
        if (typeof message === 'string' && message.trim()) return message.trim();
    }
    return undefined;
}
