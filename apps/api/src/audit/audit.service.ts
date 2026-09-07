import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import { ListAuditEventsQueryDto } from './dto';
import { AuditEventListResult, AuditEventResult } from './audit.types';

@Injectable()
export class AuditService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
    ) { }

    async listEvents(query: ListAuditEventsQueryDto): Promise<AuditEventListResult> {
        const { tenantId } = this.tenantContext.require();
        const from = query.from ? new Date(query.from) : undefined;
        const to = query.to ? new Date(query.to) : undefined;
        if (from && to && from > to) {
            throw new BadRequestException({
                code: 'AUDIT_DATE_RANGE_INVALID',
                message: '审计查询开始时间不能晚于结束时间',
            });
        }
        if (query.cursor) {
            const cursorExists = await this.prisma.auditLog.findFirst({
                where: { id: query.cursor, tenantId },
                select: { id: true },
            });
            if (!cursorExists) {
                throw new BadRequestException({ code: 'PAGINATION_CURSOR_INVALID', message: '分页游标无效' });
            }
        }

        const where: Prisma.AuditLogWhereInput = {
            tenantId,
            action: query.action?.trim() || undefined,
            outcome: query.outcome,
            actorUserId: query.actorId,
            actorMembershipId: query.membershipId,
            resourceType: query.resourceType?.trim() || undefined,
            resourceId: query.resourceId,
            requestId: query.requestId?.trim() || undefined,
            createdAt: from || to ? { gte: from, lte: to } : undefined,
        };
        const events = await this.prisma.auditLog.findMany({
            where,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            cursor: query.cursor ? { id: query.cursor } : undefined,
            skip: query.cursor ? 1 : 0,
            take: query.limit + 1,
        });
        const hasNextPage = events.length > query.limit;
        const page = hasNextPage ? events.slice(0, query.limit) : events;
        return {
            items: page.map(toAuditEventResult),
            nextCursor: hasNextPage ? page[page.length - 1]?.id ?? null : null,
        };
    }

    async getEvent(auditEventId: string): Promise<AuditEventResult> {
        const { tenantId } = this.tenantContext.require();
        const event = await this.prisma.auditLog.findFirst({
            where: { id: auditEventId, tenantId },
        });
        if (!event) {
            throw new NotFoundException({
                code: 'AUDIT_EVENT_NOT_FOUND',
                message: '当前租户内审计事件不存在',
            });
        }
        return toAuditEventResult(event);
    }
}

function toAuditEventResult(event: {
    id: string;
    action: string;
    outcome: AuditEventResult['outcome'];
    actorUserId: string | null;
    actorMembershipId: string | null;
    resourceType: string;
    resourceId: string | null;
    requestId: string;
    ipAddress: string | null;
    userAgent: string | null;
    metadata: Prisma.JsonValue | null;
    createdAt: Date;
}): AuditEventResult {
    return {
        id: event.id,
        action: event.action,
        outcome: event.outcome,
        actorUserId: event.actorUserId,
        actorMembershipId: event.actorMembershipId,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        requestId: event.requestId,
        ipAddress: event.ipAddress,
        userAgent: event.userAgent,
        metadata: event.metadata,
        createdAt: event.createdAt,
    };
}
