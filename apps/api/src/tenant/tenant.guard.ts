import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
interface AuthenticatedRequest {
    user?: { id: string; tenantId: string; membershipId: string };
}

@Injectable()
export class TenantGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
        if (!request.user?.tenantId || !request.user.membershipId) {
            throw new UnauthorizedException({
                code: 'AUTH_TENANT_CONTEXT_MISSING',
                message: '缺少有效租户成员身份',
            });
        }
        return true;
    }
}
