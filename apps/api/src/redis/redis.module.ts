import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { requireRedisKeyPrefix, requireRedisUrl } from './redis.config';
import { RedisService } from './redis.service';
import { REDIS_CLIENT, REDIS_KEY_PREFIX } from './redis.tokens';

@Global()
@Module({
    providers: [
        {
            provide: REDIS_CLIENT,
            useFactory: (): Redis => new Redis(requireRedisUrl(), {
                lazyConnect: true,
                enableReadyCheck: true,
                maxRetriesPerRequest: 2,
                connectTimeout: 5_000,
            }),
        },
        {
            provide: REDIS_KEY_PREFIX,
            useFactory: requireRedisKeyPrefix,
        },
        RedisService,
    ],
    exports: [RedisService],
})
export class RedisModule { }
