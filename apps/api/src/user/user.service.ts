import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuditOutcome, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import { UpdateUserProfileDto } from './dto';
import { UserProfileResult } from './user.types';

const profileSelect = {
    id: true,
    tenantId: true,
    userId: true,
    account: true,
    displayName: true,
    version: true,
    updatedAt: true,
    user: { select: { displayName: true } },
    department: { select: { id: true, name: true } },
} satisfies Prisma.TenantMembershipSelect;

type ProfileRecord = Prisma.TenantMembershipGetPayload<{ select: typeof profileSelect }>;

@Injectable()
export class UserService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
    ) { }

    async getCurrentProfile(): Promise<UserProfileResult> {
        const context = this.tenantContext.require();
        const membership = await this.requireCurrentMembership(
            context.tenantId,
            context.userId,
            context.membershipId,
        );
        return toUserProfileResult(membership);
    }

    async updateCurrentProfile(input: UpdateUserProfileDto): Promise<UserProfileResult> {
        const context = this.tenantContext.require();
        const membership = await this.requireCurrentMembership(
            context.tenantId,
            context.userId,
            context.membershipId,
        );
        const displayName = input.displayName.trim();
        if (!displayName) {
            throw new BadRequestException({
                code: 'USER_PROFILE_DISPLAY_NAME_INVALID',
                message: '展示名称不能为空',
            });
        }
        const currentDisplayName = resolveDisplayName(membership);
        if (displayName === currentDisplayName && input.version === membership.version) {
            return toUserProfileResult(membership);
        }

        await this.prisma.$transaction(async (transaction) => {
            const updated = await transaction.tenantMembership.updateMany({
                where: {
                    id: context.membershipId,
                    tenantId: context.tenantId,
                    userId: context.userId,
                    version: input.version,
                    deletedAt: null,
                },
                data: {
                    displayName,
                    updatedBy: context.userId,
                    version: { increment: 1 },
                },
            });
            if (updated.count !== 1) {
                throw new ConflictException({
                    code: 'USER_PROFILE_VERSION_CONFLICT',
                    message: '个人资料已被修改，请刷新后重试',
                });
            }
            await transaction.auditLog.create({
                data: {
                    tenantId: context.tenantId,
                    actorUserId: context.userId,
                    actorMembershipId: context.membershipId,
                    action: 'USER_PROFILE_UPDATED',
                    outcome: AuditOutcome.SUCCESS,
                    resourceType: 'TENANT_MEMBERSHIP',
                    resourceId: context.membershipId,
                    requestId: context.requestId,
                    metadata: {
                        before: { displayName: currentDisplayName },
                        after: { displayName },
                    },
                },
            });
        });

        return this.getCurrentProfile();
    }

    private async requireCurrentMembership(
        tenantId: string,
        userId: string,
        membershipId: string,
    ): Promise<ProfileRecord> {
        const membership = await this.prisma.tenantMembership.findFirst({
            where: { id: membershipId, tenantId, userId, deletedAt: null },
            select: profileSelect,
        });
        if (!membership) {
            throw new UnauthorizedException({
                code: 'AUTH_TENANT_CONTEXT_INVALID',
                message: '当前租户成员身份无效',
            });
        }
        return membership;
    }
}

function toUserProfileResult(membership: ProfileRecord): UserProfileResult {
    return {
        userId: membership.userId,
        membershipId: membership.id,
        tenantId: membership.tenantId,
        account: membership.account,
        displayName: resolveDisplayName(membership),
        department: membership.department,
        version: membership.version,
        updatedAt: membership.updatedAt,
    };
}

function resolveDisplayName(membership: ProfileRecord): string {
    return membership.displayName ?? membership.user.displayName;
}
