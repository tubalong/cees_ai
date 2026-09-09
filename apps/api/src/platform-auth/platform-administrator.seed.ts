import {
    PlatformAdministratorStatus,
    PlatformRole,
    PrismaClient,
    UserStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';
import {
    ACCOUNT_MAX_LENGTH,
    ACCOUNT_MIN_LENGTH,
    ACCOUNT_PATTERN,
    normalizeAccount,
} from '../auth/account';

const PLATFORM_ADMIN_PASSWORD_MIN_LENGTH = 8;
const PLATFORM_ADMIN_PASSWORD_MAX_LENGTH = 128;
const PLATFORM_ADMIN_DISPLAY_NAME_MAX_LENGTH = 100;

export interface PlatformAdministratorSeedConfig {
    account: string;
    password: string;
    displayName: string;
}

export interface PlatformAdministratorSeedResult {
    account: string;
    created: boolean;
}

export function readPlatformAdministratorSeedConfig(
    environment: NodeJS.ProcessEnv,
): PlatformAdministratorSeedConfig {
    const account = normalizeAccount(requireEnvironmentValue(environment, 'SEED_PLATFORM_ADMIN_ACCOUNT'));
    const password = requireEnvironmentValue(environment, 'SEED_PLATFORM_ADMIN_PASSWORD');
    const displayName = requireEnvironmentValue(environment, 'SEED_PLATFORM_ADMIN_DISPLAY_NAME').trim();

    if (
        account.length < ACCOUNT_MIN_LENGTH
        || account.length > ACCOUNT_MAX_LENGTH
        || !ACCOUNT_PATTERN.test(account)
    ) {
        throw new Error(
            `SEED_PLATFORM_ADMIN_ACCOUNT must contain ${ACCOUNT_MIN_LENGTH}-${ACCOUNT_MAX_LENGTH} letters or digits.`,
        );
    }

    if (
        password.length < PLATFORM_ADMIN_PASSWORD_MIN_LENGTH
        || password.length > PLATFORM_ADMIN_PASSWORD_MAX_LENGTH
    ) {
        throw new Error(
            `SEED_PLATFORM_ADMIN_PASSWORD must contain ${PLATFORM_ADMIN_PASSWORD_MIN_LENGTH}-${PLATFORM_ADMIN_PASSWORD_MAX_LENGTH} characters.`,
        );
    }

    if (displayName.length > PLATFORM_ADMIN_DISPLAY_NAME_MAX_LENGTH) {
        throw new Error(
            `SEED_PLATFORM_ADMIN_DISPLAY_NAME must contain at most ${PLATFORM_ADMIN_DISPLAY_NAME_MAX_LENGTH} characters.`,
        );
    }

    return { account, password, displayName };
}

export async function ensurePlatformAdministrator(
    prisma: PrismaClient,
    config: PlatformAdministratorSeedConfig,
): Promise<PlatformAdministratorSeedResult> {
    const account = normalizeAccount(config.account);
    const existingAdministrator = await prisma.platformAdministrator.findUnique({
        where: { normalizedAccount: account },
        select: { id: true },
    });
    if (existingAdministrator) {
        return { account, created: false };
    }

    const passwordHash = await argon2.hash(config.password);
    const created = await prisma.$transaction(async (transaction) => {
        const concurrentAdministrator = await transaction.platformAdministrator.findUnique({
            where: { normalizedAccount: account },
            select: { id: true },
        });
        if (concurrentAdministrator) return false;

        const user = await transaction.user.create({
            data: {
                displayName: config.displayName,
                status: UserStatus.ACTIVE,
            },
        });
        await transaction.platformAdministrator.create({
            data: {
                userId: user.id,
                account,
                normalizedAccount: account,
                passwordHash,
                role: PlatformRole.SUPER_ADMIN,
                status: PlatformAdministratorStatus.ACTIVE,
            },
        });
        return true;
    });

    return { account, created };
}

function requireEnvironmentValue(environment: NodeJS.ProcessEnv, key: string): string {
    const value = environment[key];
    if (!value || value.trim().length === 0) {
        throw new Error(`${key} is required.`);
    }
    if (value === 'change_me') {
        throw new Error(`${key} must not use the change_me placeholder.`);
    }
    return value;
}
