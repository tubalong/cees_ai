import { BadRequestException } from '@nestjs/common';
import { HrLeaveRequestStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { HrAvailabilityService } from './hr-availability.service';

describe('HrAvailabilityService', () => {
    it('filters members with approved leave overlapping the requested window', async () => {
        const prisma = createPrismaMock();
        prisma.hrLeaveRequest.findMany.mockResolvedValue([{ membershipId: SECOND_MEMBERSHIP_ID }]);
        const service = new HrAvailabilityService(prisma as unknown as PrismaService);
        const window = {
            startAt: new Date('2026-09-21T01:00:00.000Z'),
            endAt: new Date('2026-09-21T09:00:00.000Z'),
        };

        const result = await service.filterMembersOnApprovedLeave(
            TENANT_ID,
            [MEMBERSHIP_ID, SECOND_MEMBERSHIP_ID],
            window,
        );

        expect(result).toEqual({
            availableMembershipIds: [MEMBERSHIP_ID],
            skippedMembershipIds: [SECOND_MEMBERSHIP_ID],
            applied: true,
        });
        expect(prisma.hrLeaveRequest.findMany).toHaveBeenCalledWith({
            where: {
                tenantId: TENANT_ID,
                membershipId: { in: [MEMBERSHIP_ID, SECOND_MEMBERSHIP_ID] },
                status: HrLeaveRequestStatus.APPROVED,
                deletedAt: null,
                startAt: { lt: window.endAt },
                endAt: { gt: window.startAt },
            },
            select: { membershipId: true },
        });
    });

    it('does not query leave data when no availability window is provided', async () => {
        const prisma = createPrismaMock();
        const service = new HrAvailabilityService(prisma as unknown as PrismaService);

        await expect(service.filterMembersOnApprovedLeave(TENANT_ID, [MEMBERSHIP_ID]))
            .resolves.toEqual({ availableMembershipIds: [MEMBERSHIP_ID], skippedMembershipIds: [], applied: false });
        expect(prisma.hrLeaveRequest.findMany).not.toHaveBeenCalled();
    });

    it('rejects an invalid availability window', async () => {
        const prisma = createPrismaMock();
        const service = new HrAvailabilityService(prisma as unknown as PrismaService);

        await expect(service.filterMembersOnApprovedLeave(TENANT_ID, [MEMBERSHIP_ID], {
            startAt: new Date('2026-09-21T09:00:00.000Z'),
            endAt: new Date('2026-09-21T01:00:00.000Z'),
        })).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.hrLeaveRequest.findMany).not.toHaveBeenCalled();
    });
});

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000001';
const SECOND_MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000002';

function createPrismaMock(): Record<string, any> {
    return { hrLeaveRequest: { findMany: jest.fn() } };
}
