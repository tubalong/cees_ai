import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestTenantContext {
    tenantId: string;
    userId: string;
    membershipId: string;
    requestId: string;
    roles: string[];
    permissions: string[];
}

@Injectable()
export class TenantContext {
    private readonly storage = new AsyncLocalStorage<RequestTenantContext>();

    run<T>(context: RequestTenantContext, callback: () => T): T {
        return this.storage.run(context, callback);
    }

    require(): RequestTenantContext {
        const context = this.storage.getStore();
        if (!context) throw new Error('TenantContext is not initialized');
        return context;
    }
}
