import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import {
    ensurePlatformAdministrator,
    readPlatformAdministratorSeedConfig,
} from './platform-administrator.seed';

describe('platform administrator seed', () => {
    it('reads and normalizes the required environment variables', () => {
        expect(readPlatformAdministratorSeedConfig({
            SEED_PLATFORM_ADMIN_ACCOUNT: ' SuperAdmin ',
            SEED_PLATFORM_ADMIN_PASSWORD: 'strong-password',
            SEED_PLATFORM_ADMIN_DISPLAY_NAME: ' Platform Administrator ',
        })).toEqual({
            account: 'superadmin',
            password: 'strong-password',
            displayName: 'Platform Administrator',
        });
    });

    it.each([
        ['SEED_PLATFORM_ADMIN_ACCOUNT', undefined],
        ['SEED_PLATFORM_ADMIN_PASSWORD', 'change_me'],
        ['SEED_PLATFORM_ADMIN_DISPLAY_NAME', ''],
    ])('rejects an invalid %s value', (key, value) => {
        const environment: NodeJS.ProcessEnv = {
            SEED_PLATFORM_ADMIN_ACCOUNT: 'superadmin',
            SEED_PLATFORM_ADMIN_PASSWORD: 'strong-password',
            SEED_PLATFORM_ADMIN_DISPLAY_NAME: 'Platform Administrator',
            [key]: value,
        };

        expect(() => readPlatformAdministratorSeedConfig(environment)).toThrow(key);
    });

    it('does not overwrite an existing administrator', async () => {
        const transaction = jest.fn();
        const prisma = {
            platformAdministrator: {
                findUnique: jest.fn().mockResolvedValue({ id: 'existing-administrator' }),
            },
            $transaction: transaction,
        } as unknown as PrismaClient;

        await expect(ensurePlatformAdministrator(prisma, {
            account: 'superadmin',
            password: 'strong-password',
            displayName: 'Platform Administrator',
        })).resolves.toEqual({ account: 'superadmin', created: false });
        expect(transaction).not.toHaveBeenCalled();
    });

    it('creates the user and super administrator in one transaction', async () => {
        const administratorCreate = jest.fn().mockResolvedValue({ id: 'administrator-id' });
        const transactionClient = {
            platformAdministrator: {
                findUnique: jest.fn().mockResolvedValue(null),
                create: administratorCreate,
            },
            user: {
                create: jest.fn().mockResolvedValue({ id: 'user-id' }),
            },
        };
        const prisma = {
            platformAdministrator: {
                findUnique: jest.fn().mockResolvedValue(null),
            },
            $transaction: jest.fn(async (
                callback: (transaction: typeof transactionClient) => Promise<unknown>,
            ) => callback(transactionClient)),
        } as unknown as PrismaClient;

        await expect(ensurePlatformAdministrator(prisma, {
            account: 'superadmin',
            password: 'strong-password',
            displayName: 'Platform Administrator',
        })).resolves.toEqual({ account: 'superadmin', created: true });

        const createData = administratorCreate.mock.calls[0][0].data;
        expect(createData).toMatchObject({
            userId: 'user-id',
            account: 'superadmin',
            normalizedAccount: 'superadmin',
            role: 'SUPER_ADMIN',
            status: 'ACTIVE',
        });
        await expect(argon2.verify(createData.passwordHash, 'strong-password')).resolves.toBe(true);
    });
});
