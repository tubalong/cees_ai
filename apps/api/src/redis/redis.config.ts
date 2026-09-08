export function requireRedisUrl(): string {
    const url = process.env.REDIS_URL?.trim();
    if (!url) throw new Error('REDIS_URL is required');
    if (process.env.NODE_ENV === 'production' && url.includes('change_me')) {
        throw new Error('REDIS_URL must not contain the example password in production');
    }
    return url;
}

export function requireRedisKeyPrefix(): string {
    const configured = process.env.REDIS_KEY_PREFIX?.trim();
    if (!configured) throw new Error('REDIS_KEY_PREFIX is required');
    const normalized = configured.endsWith(':') ? configured : `${configured}:`;
    if (!/^[A-Za-z0-9:_-]{1,128}$/.test(normalized)) {
        throw new Error('REDIS_KEY_PREFIX contains unsupported characters');
    }
    return normalized;
}
