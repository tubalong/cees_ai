import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT, REDIS_KEY_PREFIX } from './redis.tokens';

export interface RedisSetOptions {
    ttlSeconds?: number;
}

export class RedisJsonParseError extends Error {
    constructor(logicalKey: string, options?: ErrorOptions) {
        super(`Redis value for "${logicalKey}" is not valid JSON`, options);
        this.name = 'RedisJsonParseError';
    }
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(RedisService.name);

    constructor(
        @Inject(REDIS_CLIENT) private readonly client: Redis,
        @Inject(REDIS_KEY_PREFIX) private readonly keyPrefix: string,
    ) { }

    async onModuleInit(): Promise<void> {
        this.client.on('error', (error: Error) => {
            this.logger.error(`Redis connection error: ${error.message}`);
        });
        if (this.client.status === 'wait') await this.client.connect();
        await this.client.ping();
    }

    async onModuleDestroy(): Promise<void> {
        if (this.client.status === 'end') return;
        await this.client.quit();
    }

    async get(logicalKey: string): Promise<string | null> {
        return this.client.get(this.qualify(logicalKey));
    }

    async set(logicalKey: string, value: string, options: RedisSetOptions = {}): Promise<void> {
        const key = this.qualify(logicalKey);
        if (options.ttlSeconds === undefined) {
            await this.client.set(key, value);
            return;
        }
        await this.client.set(key, value, 'EX', validateTtl(options.ttlSeconds));
    }

    async getJson<T>(logicalKey: string): Promise<T | null> {
        const value = await this.get(logicalKey);
        if (value === null) return null;
        try {
            return JSON.parse(value) as T;
        } catch (error) {
            throw new RedisJsonParseError(logicalKey, { cause: error });
        }
    }

    async setJson<T>(logicalKey: string, value: T, options: RedisSetOptions = {}): Promise<void> {
        const serialized = JSON.stringify(value);
        if (serialized === undefined) throw new TypeError('Redis JSON value must be serializable');
        await this.set(logicalKey, serialized, options);
    }

    async delete(...logicalKeys: string[]): Promise<number> {
        if (logicalKeys.length === 0) return 0;
        return this.client.del(...logicalKeys.map((key) => this.qualify(key)));
    }

    async exists(logicalKey: string): Promise<boolean> {
        return (await this.client.exists(this.qualify(logicalKey))) === 1;
    }

    async expire(logicalKey: string, ttlSeconds: number): Promise<boolean> {
        return (await this.client.expire(this.qualify(logicalKey), validateTtl(ttlSeconds))) === 1;
    }

    async ttl(logicalKey: string): Promise<number> {
        return this.client.ttl(this.qualify(logicalKey));
    }

    async increment(logicalKey: string, amount = 1): Promise<number> {
        if (!Number.isSafeInteger(amount)) throw new TypeError('Redis increment amount must be a safe integer');
        return this.client.incrby(this.qualify(logicalKey), amount);
    }

    async setIfAbsent(logicalKey: string, value: string, ttlSeconds: number): Promise<boolean> {
        const result = await this.client.set(
            this.qualify(logicalKey),
            value,
            'EX',
            validateTtl(ttlSeconds),
            'NX',
        );
        return result === 'OK';
    }

    async ping(): Promise<boolean> {
        return (await this.client.ping()) === 'PONG';
    }

    private qualify(logicalKey: string): string {
        const normalized = logicalKey.trim();
        if (!normalized || normalized.length > 512 || /[\u0000-\u001f\u007f\s]/u.test(normalized)) {
            throw new TypeError('Redis logical key must be 1-512 visible non-whitespace characters');
        }
        return `${this.keyPrefix}${normalized}`;
    }
}

function validateTtl(ttlSeconds: number): number {
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
        throw new TypeError('Redis TTL must be a positive integer number of seconds');
    }
    return ttlSeconds;
}
