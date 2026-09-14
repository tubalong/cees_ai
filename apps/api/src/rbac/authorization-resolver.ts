import { PrismaService } from '../database/prisma.service';
import { MembershipStatus, TenantStatus, UserStatus } from '@prisma/client';

/**
 * Long-running Assistant work must re-check the identity that created the
 * turn. JWT validation happens at request time, but a membership can be
 * disabled or deleted while a turn is still running.
 */
export async function isActiveMembership(
    prisma: PrismaService,
    tenantId: string,
    membershipId: string,
): Promise<boolean> {
    const membership = await prisma.tenantMembership.findUnique({
        where: { id: membershipId },
        select: {
            tenantId: true,
            status: true,
            deletedAt: true,
            tenant: { select: { status: true, deletedAt: true } },
            user: { select: { status: true, deletedAt: true } },
        },
    });
    return Boolean(
        membership
        && membership.tenantId === tenantId
        && membership.status === MembershipStatus.ACTIVE
        && !membership.deletedAt
        && membership.tenant.status === TenantStatus.ACTIVE
        && !membership.tenant.deletedAt
        && membership.user.status === UserStatus.ACTIVE
        && !membership.user.deletedAt,
    );
}

/**
 * Resolve the current tenant membership authorization from the database.
 *
 * JWT permissions are intentionally not used here: a long-running Assistant
 * turn may outlive a role change, so the execution boundary must be able to
 * re-check the current assignments without duplicating RBAC query logic.
 */
export async function resolveMembershipAuthorization(
    prisma: PrismaService,
    tenantId: string,
    membershipId: string,
): Promise<{ roles: string[]; permissions: string[] }> {
    const assignments = await prisma.membershipRole.findMany({
        where: { tenantId, membershipId },
        select: { roleId: true },
    });
    const roleIds = assignments.map((assignment) => assignment.roleId);
    if (roleIds.length === 0) return { roles: [], permissions: [] };

    const roles = await prisma.role.findMany({
        where: { tenantId, id: { in: roleIds }, deletedAt: null },
        select: { id: true, code: true },
    });
    const activeRoleIds = roles.map((role) => role.id);
    const rolePermissions = activeRoleIds.length === 0
        ? []
        : await prisma.rolePermission.findMany({
            where: { tenantId, roleId: { in: activeRoleIds } },
            select: { permissionId: true },
        });
    const permissionIds = [...new Set(rolePermissions.map((entry) => entry.permissionId))];
    const permissions = permissionIds.length === 0
        ? []
        : (await prisma.permission.findMany({
            where: { id: { in: permissionIds } },
            select: { code: true },
        })).map((permission) => permission.code);

    return {
        roles: roles.map((role) => role.code).sort(),
        permissions: [...new Set(permissions)].sort(),
    };
}
