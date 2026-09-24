import { PlatformRole } from '@prisma/client';

export const PLATFORM_PERMISSIONS = [
    'platform.tenant.read',
    'platform.tenant.create',
    'platform.tenant.update',
    'platform.tenant.suspend',
    'platform.tenant.restore',
    'platform.tenant.admin.read',
    'platform.tenant.admin.assign',
    'platform.tenant.admin.remove',
    'platform.tenant.admin.credential.reset',
    'platform.audit.read',
    'platform.aiCredit.read',
    'platform.aiCredit.write',
] as const;

export function resolvePlatformPermissions(role: PlatformRole): string[] {
    return role === PlatformRole.SUPER_ADMIN ? [...PLATFORM_PERMISSIONS] : [];
}
