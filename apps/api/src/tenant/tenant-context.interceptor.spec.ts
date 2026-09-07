import { CallHandler, ExecutionContext } from '@nestjs/common';
import { defer, firstValueFrom, of } from 'rxjs';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { TenantContext } from './tenant-context';
import { TenantContextInterceptor } from './tenant-context.interceptor';

describe('TenantContextInterceptor', () => {
    it('keeps the tenant context available throughout the request observable', async () => {
        const tenantContext = new TenantContext();
        const interceptor = new TenantContextInterceptor(tenantContext);
        const principal = authenticatedPrincipal();
        const executionContext = {
            switchToHttp: () => ({
                getRequest: () => ({ user: principal, headers: { 'x-request-id': 'request-id' } }),
            }),
        } as unknown as ExecutionContext;
        const next = {
            handle: () => defer(() => of(tenantContext.require())),
        } as CallHandler;

        const result = await firstValueFrom(interceptor.intercept(executionContext, next));

        expect(result).toEqual({
            tenantId: principal.tenantId,
            userId: principal.id,
            membershipId: principal.membershipId,
            requestId: 'request-id',
            roles: principal.roles,
            permissions: principal.permissions,
        });
    });
});

function authenticatedPrincipal(): AuthenticatedPrincipal {
    return {
        id: '10000000-0000-0000-0000-000000000002',
        tenantId: '10000000-0000-0000-0000-000000000001',
        membershipId: '50000000-0000-0000-0000-000000000001',
        sessionId: '30000000-0000-0000-0000-000000000001',
        email: 'admin@example.com',
        displayName: 'Administrator',
        tenantCode: 'cees',
        tenantName: 'CEES',
        roles: ['tenant_admin'],
        permissions: ['tenant.read'],
    };
}
