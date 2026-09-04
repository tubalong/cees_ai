import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { TenantContext } from './tenant-context';

interface AuthenticatedRequest {
    user?: { id: string; tenantId: string; permissions?: string[] };
    headers: Record<string, string | undefined>;
}

@Injectable()
export class TenantGuard implements CanActivate {
    constructor(private readonly tenantContext: TenantContext) { }

    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
        if (!request.user?.tenantId) throw new UnauthorizedException('Missing verified tenant identity');
        this.tenantContext.run(
            {
                tenantId: request.user.tenantId,
                userId: request.user.id,
                permissions: request.user.permissions ?? [],
                requestId: request.headers['x-request-id'] ?? randomUUID(),
            },
            () => undefined,
        );
        return true;
    }
}