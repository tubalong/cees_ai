import { MembershipStatus, PrismaClient, TenantStatus, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const PERMISSIONS = [
    ['tenant.read', '查看当前租户'],
    ['tenant.update', '修改当前租户'],
    ['member.read', '查看租户成员'],
    ['member.update', '修改租户成员'],
    ['member.remove', '移除租户成员'],
    ['role.read', '查看权限和角色'],
    ['role.create', '创建租户角色'],
    ['role.update', '修改角色及权限'],
    ['role.delete', '删除租户角色'],
    ['role.assign', '为成员分配角色'],
    ['document.create', '创建文档'],
    ['document.read', '读取授权范围内文档'],
    ['document.update', '修改授权范围内文档'],
    ['document.delete', '删除授权范围内文档'],
    ['document.share', '管理文档资源级授权'],
    ['document.manage_all', '管理当前租户全部文档'],
    ['audit.read', '查询当前租户审计事件'],
] as const;

async function main(): Promise<void> {
    const tenantCode = process.env.SEED_TENANT_CODE?.trim().toLowerCase() || 'cees';
    const tenantName = process.env.SEED_TENANT_NAME?.trim() || 'CEES';
    const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase() || 'admin@example.com';
    const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'change_me';
    const adminDisplayName = process.env.SEED_ADMIN_DISPLAY_NAME?.trim() || 'Administrator';
    const passwordHash = await argon2.hash(adminPassword);

    const tenant = await prisma.tenant.upsert({
        where: { code: tenantCode },
        update: { name: tenantName, status: TenantStatus.ACTIVE, deletedAt: null },
        create: { code: tenantCode, name: tenantName, status: TenantStatus.ACTIVE },
    });
    const user = await prisma.user.upsert({
        where: { normalizedEmail: adminEmail },
        update: {
            email: adminEmail,
            passwordHash,
            displayName: adminDisplayName,
            status: UserStatus.ACTIVE,
            failedLoginCount: 0,
            lockedUntil: null,
            deletedAt: null,
        },
        create: {
            email: adminEmail,
            normalizedEmail: adminEmail,
            passwordHash,
            displayName: adminDisplayName,
            status: UserStatus.ACTIVE,
        },
    });
    const membership = await prisma.tenantMembership.upsert({
        where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
        update: {
            displayName: adminDisplayName,
            status: MembershipStatus.ACTIVE,
            deletedAt: null,
        },
        create: {
            tenantId: tenant.id,
            userId: user.id,
            displayName: adminDisplayName,
            status: MembershipStatus.ACTIVE,
        },
    });
    const role = await prisma.role.upsert({
        where: { tenantId_code: { tenantId: tenant.id, code: 'tenant_admin' } },
        update: {
            name: '租户管理员',
            description: '租户内置管理员角色',
            isSystem: true,
            dataScope: 'TENANT',
            deletedAt: null,
        },
        create: {
            tenantId: tenant.id,
            code: 'tenant_admin',
            name: '租户管理员',
            description: '租户内置管理员角色',
            isSystem: true,
            dataScope: 'TENANT',
        },
    });

    const permissions = await Promise.all(PERMISSIONS.map(([code, name]) => prisma.permission.upsert({
        where: { code },
        update: { name },
        create: { code, name },
    })));

    await prisma.membershipRole.upsert({
        where: {
            tenantId_membershipId_roleId: {
                tenantId: tenant.id,
                membershipId: membership.id,
                roleId: role.id,
            },
        },
        update: {},
        create: { tenantId: tenant.id, membershipId: membership.id, roleId: role.id },
    });
    await Promise.all(permissions.map((permission) => prisma.rolePermission.upsert({
        where: {
            tenantId_roleId_permissionId: {
                tenantId: tenant.id,
                roleId: role.id,
                permissionId: permission.id,
            },
        },
        update: {},
        create: { tenantId: tenant.id, roleId: role.id, permissionId: permission.id },
    })));
}

main()
    .catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => prisma.$disconnect());
