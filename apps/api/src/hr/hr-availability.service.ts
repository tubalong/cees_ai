import { BadRequestException, Injectable } from '@nestjs/common';
import { HrLeaveRequestStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export interface AvailabilityWindow {
    startAt: Date;
    endAt: Date;
}

@Injectable()
export class HrAvailabilityService {
    constructor(private readonly prisma: PrismaService) { }

    async filterMembersOnApprovedLeave(
        tenantId: string,
        membershipIds: string[],
        window?: AvailabilityWindow,
    ): Promise<{ availableMembershipIds: string[]; skippedMembershipIds: string[]; applied: boolean }> {
        const uniqueMembershipIds = [...new Set(membershipIds)];
        if (!window || uniqueMembershipIds.length === 0) {
            return { availableMembershipIds: uniqueMembershipIds, skippedMembershipIds: [], applied: false };
        }
        if (window.startAt >= window.endAt) {
            throw new BadRequestException({ code: 'ASSIGNMENT_AVAILABILITY_WINDOW_INVALID', message: '可用时间窗口结束时间必须晚于开始时间' });
        }

        const leaveRequests = await this.prisma.hrLeaveRequest.findMany({
            where: {
                tenantId,
                membershipId: { in: uniqueMembershipIds },
                status: HrLeaveRequestStatus.APPROVED,
                deletedAt: null,
                startAt: { lt: window.endAt },
                endAt: { gt: window.startAt },
            },
            select: { membershipId: true },
        });
        const skipped = new Set(leaveRequests.map((request) => request.membershipId));
        return {
            availableMembershipIds: uniqueMembershipIds.filter((membershipId) => !skipped.has(membershipId)),
            skippedMembershipIds: [...skipped].sort(),
            applied: true,
        };
    }
}
