import { PrismaClient } from '@prisma/client';
import {
    ensurePlatformAdministrator,
    readPlatformAdministratorSeedConfig,
} from '../platform-auth/platform-administrator.seed';

const prisma = new PrismaClient();

async function main(): Promise<void> {
    const config = readPlatformAdministratorSeedConfig(process.env);
    const result = await ensurePlatformAdministrator(prisma, config);
    console.log(
        result.created
            ? `Platform administrator ${result.account} was created.`
            : `Platform administrator ${result.account} already exists; bootstrap skipped.`,
    );
}

main()
    .catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => prisma.$disconnect());
