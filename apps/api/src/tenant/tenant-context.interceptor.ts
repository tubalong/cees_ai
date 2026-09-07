import { CallHandler, ExecutionContext, Injectable, NestInterceptor, UnauthorizedException } from '@nestjs/common';
import { Observable } from 'rxjs';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { TenantContext } from './tenant-context';

interface TenantRequest {
    user?: AuthenticatedPrincipal;
    headers: Record<string, string | string[] | undefined>;
}

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
    constructor(private readonly tenantContext: TenantContext) { }

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        const request = context.switchToHttp().getRequest<TenantRequest>();
        if (!request.user) {
            throw new UnauthorizedException({
                code: 'AUTH_TENANT_CONTEXT_MISSING',
                message: '缺少有效租户成员身份',
            });
        }
        const requestIdHeader = request.headers['x-request-id'];
        const requestId = Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader;
        return new Observable((subscriber) => {
            this.tenantContext.run(
                {
                    tenantId: request.user!.tenantId,
                    userId: request.user!.id,
                    membershipId: request.user!.membershipId,
                    requestId: requestId ?? '',
                    roles: request.user!.roles,
                    permissions: request.user!.permissions,
                },
                () => next.handle().subscribe(subscriber),
            );
        });
    }
}
