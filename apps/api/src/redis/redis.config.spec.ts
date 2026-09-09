import { requireRedisKeyPrefix, requireRedisUrl } from './redis.config';

describe('Redis configuration', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = {
            ...originalEnv,
            NODE_ENV: 'test',
            REDIS_URL: 'redis://:password@127.0.0.1:6379/0',
            REDIS_KEY_PREFIX: 'cees:staging',
        };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('loads the URL and normalizes the namespace suffix', () => {
        expect(requireRedisUrl()).toBe('redis://:password@127.0.0.1:6379/0');
        expect(requireRedisKeyPrefix()).toBe('cees:staging:');
    });

    it('rejects an unsafe namespace', () => {
        process.env.REDIS_KEY_PREFIX = 'cees staging';
        expect(() => requireRedisKeyPrefix()).toThrow('unsupported characters');
    });
});
