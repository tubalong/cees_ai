import type { Request } from 'express';
import { randomUUID } from 'node:crypto';

export function getRequestMetadata(request: Request): { requestId: string; ipAddress?: string; userAgent?: string } {
    return {
        requestId: getHeader(request, 'x-request-id') ?? randomUUID(),
        ipAddress: request.ip,
        userAgent: getHeader(request, 'user-agent'),
    };
}

function getHeader(request: Request, name: string): string | undefined {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
}
