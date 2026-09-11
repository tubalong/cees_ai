import type Redis from 'ioredis';
import { RedisJsonParseError, RedisService } from './redis.service';

describe('RedisService', () => {
    it('automatically prefixes string and JSON keys', async () => {
        const client = createClient({
            get: jest.fn().mockResolvedValue('{"enabled":true}'),
            set: jest.fn().mockResolvedValue('OK'),
        });
        const service = new RedisService(client, 'cees:staging:');

        await expect(service.getJson<{ enabled: boolean }>('tenant:1:feature')).resolves.toEqual({ enabled: true });
        await service.setJson('tenant:1:profile', { name: 'CEES' }, { ttlSeconds: 60 });

        expect(client.get).toHaveBeenCalledWith('cees:staging:tenant:1:feature');
        expect(client.set).toHaveBeenCalledWith(
            'cees:staging:tenant:1:profile',
            '{"name":"CEES"}',
            'EX',
            60,
        );
    });

    it('supports delete, existence, increment and set-if-absent operations', async () => {
        const client = createClient({
            del: jest.fn().mockResolvedValue(2),
            exists: jest.fn().mockResolvedValue(1),
            incrby: jest.fn().mockResolvedValue(3),
            set: jest.fn().mockResolvedValue('OK'),
            eval: jest.fn().mockResolvedValue(1),
        });
        const service = new RedisService(client, 'cees:local:');

        await expect(service.delete('a', 'b')).resolves.toBe(2);
        await expect(service.exists('a')).resolves.toBe(true);
        await expect(service.increment('counter', 2)).resolves.toBe(3);
        await expect(service.setIfAbsent('lock:1', 'owner', 10)).resolves.toBe(true);
        await expect(service.deleteIfValue('lock:1', 'owner')).resolves.toBe(true);

        expect(client.del).toHaveBeenCalledWith('cees:local:a', 'cees:local:b');
        expect(client.set).toHaveBeenCalledWith('cees:local:lock:1', 'owner', 'EX', 10, 'NX');
        expect(client.eval).toHaveBeenCalledWith(
            `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`,
            1,
            'cees:local:lock:1',
            'owner',
        );
    });

    it('rejects invalid keys and malformed JSON values', async () => {
        const client = createClient({ get: jest.fn().mockResolvedValue('{broken') });
        const service = new RedisService(client, 'cees:local:');

        await expect(service.getJson('payload')).rejects.toBeInstanceOf(RedisJsonParseError);
        await expect(service.get('has space')).rejects.toThrow(TypeError);
        await expect(service.set('key', 'value', { ttlSeconds: 0 })).rejects.toThrow(TypeError);
    });
});

function createClient(overrides: Record<string, jest.Mock>): Redis {
    return {
        status: 'ready',
        on: jest.fn(),
        connect: jest.fn(),
        quit: jest.fn(),
        ping: jest.fn().mockResolvedValue('PONG'),
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
        exists: jest.fn(),
        expire: jest.fn(),
        ttl: jest.fn(),
        incrby: jest.fn(),
        eval: jest.fn(),
        ...overrides,
    } as unknown as Redis;
}
