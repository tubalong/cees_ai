export function requireAccessTokenSecret(): string {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) throw new Error('JWT_ACCESS_SECRET is required');
    if (process.env.NODE_ENV === 'production' && secret.startsWith('change_me')) {
        throw new Error('JWT_ACCESS_SECRET must be replaced in production');
    }
    return secret;
}

export function requirePlatformAccessTokenSecret(): string {
    const secret = process.env.JWT_PLATFORM_ACCESS_SECRET
        ?? (process.env.NODE_ENV === 'production' ? undefined : process.env.JWT_ACCESS_SECRET);
    if (!secret) throw new Error('JWT_PLATFORM_ACCESS_SECRET is required');
    if (process.env.NODE_ENV === 'production' && secret.startsWith('change_me')) {
        throw new Error('JWT_PLATFORM_ACCESS_SECRET must be replaced in production');
    }
    return secret;
}

export function jwtIssuer(): string {
    return process.env.JWT_ISSUER ?? 'cees-api';
}

export function jwtAudience(): string {
    return process.env.JWT_AUDIENCE ?? 'cees-client';
}

export function platformJwtIssuer(): string {
    return process.env.JWT_PLATFORM_ISSUER ?? 'cees-platform-api';
}

export function platformJwtAudience(): string {
    return process.env.JWT_PLATFORM_AUDIENCE ?? 'cees-platform-client';
}

export function parseDurationSeconds(value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const match = /^(\d+)(s|m|h|d)?$/.exec(value.trim());
    if (!match) throw new Error(`Invalid duration: ${value}`);
    const amount = Number(match[1]);
    const multipliers = { s: 1, m: 60, h: 3600, d: 86400 };
    return amount * multipliers[(match[2] ?? 's') as keyof typeof multipliers];
}
