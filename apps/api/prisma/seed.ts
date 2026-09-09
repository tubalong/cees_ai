import {
    DataScope,
    MembershipStatus,
    PrismaClient,
    TenantStatus,
    UserStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { normalizeAccount } from '../src/auth/account';
import { ensurePlatformAdministrator } from '../src/platform-auth/platform-administrator.seed';
import { TENANT_ADMIN_ROLE_CODE, TENANT_PERMISSION_DEFINITIONS } from '../src/rbac/permission-catalog';

const prisma = new PrismaClient();

async function main(): Promise<void> {
    assertFullSeedIsNotRunningInProduction();

    const tenantCode = process.env.SEED_TENANT_CODE?.trim().toLowerCase() || 'cees';
    const tenantName = process.env.SEED_TENANT_NAME?.trim() || 'CEES';
    const adminAccount = normalizeAccount(process.env.SEED_ADMIN_ACCOUNT || 'admin');
    const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'change_me';
    const adminDisplayName = process.env.SEED_ADMIN_DISPLAY_NAME?.trim() || 'Administrator';
    const platformAdminAccount = normalizeAccount(process.env.SEED_PLATFORM_ADMIN_ACCOUNT || 'superadmin');
    const platformAdminPassword = process.env.SEED_PLATFORM_ADMIN_PASSWORD || 'change_me';
    const platformAdminDisplayName = process.env.SEED_PLATFORM_ADMIN_DISPLAY_NAME?.trim() || 'Platform Administrator';

    const tenant = await prisma.tenant.upsert({
        where: { code: tenantCode },
        update: { name: tenantName, status: TenantStatus.ACTIVE, deletedAt: null },
        create: { code: tenantCode, name: tenantName, status: TenantStatus.ACTIVE },
    });
    const adminPasswordHash = await argon2.hash(adminPassword);
    const existingMembership = await prisma.tenantMembership.findUnique({
        where: { tenantId_normalizedAccount: { tenantId: tenant.id, normalizedAccount: adminAccount } },
        include: { user: true },
    });
    const membership = existingMembership
        ? await prisma.tenantMembership.update({
            where: { id: existingMembership.id },
            data: {
                account: adminAccount,
                normalizedAccount: adminAccount,
                passwordHash: adminPasswordHash,
                displayName: adminDisplayName,
                status: MembershipStatus.ACTIVE,
                failedLoginCount: 0,
                lockedUntil: null,
                deletedAt: null,
            },
        })
        : await prisma.$transaction(async (transaction) => {
            const user = await transaction.user.create({
                data: { displayName: adminDisplayName, status: UserStatus.ACTIVE },
            });
            return transaction.tenantMembership.create({
                data: {
                    tenantId: tenant.id,
                    userId: user.id,
                    account: adminAccount,
                    normalizedAccount: adminAccount,
                    passwordHash: adminPasswordHash,
                    displayName: adminDisplayName,
                    status: MembershipStatus.ACTIVE,
                },
            });
        });
    await prisma.user.update({
        where: { id: membership.userId },
        data: { displayName: adminDisplayName, status: UserStatus.ACTIVE, deletedAt: null },
    });

    const role = await prisma.role.upsert({
        where: { tenantId_code: { tenantId: tenant.id, code: TENANT_ADMIN_ROLE_CODE } },
        update: {
            name: '租户管理员',
            description: '租户内置管理员角色',
            isSystem: true,
            dataScope: DataScope.TENANT,
            deletedAt: null,
        },
        create: {
            tenantId: tenant.id,
            code: TENANT_ADMIN_ROLE_CODE,
            name: '租户管理员',
            description: '租户内置管理员角色',
            isSystem: true,
            dataScope: DataScope.TENANT,
        },
    });
    const permissions = await Promise.all(TENANT_PERMISSION_DEFINITIONS.map(([code, name]) => prisma.permission.upsert({
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

    await ensurePlatformAdministrator(prisma, {
        account: platformAdminAccount,
        password: platformAdminPassword,
        displayName: platformAdminDisplayName,
    });
}

function assertFullSeedIsNotRunningInProduction(): void {
    if (process.env.NODE_ENV?.trim().toLowerCase() === 'production') {
        throw new Error(
            'The full Prisma seed is development-only and must not run with NODE_ENV=production. '
            + 'Use prisma:seed:platform-admin for deployment bootstrap.',
        );
    }
}

main()
    .catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => prisma.$disconnect());
