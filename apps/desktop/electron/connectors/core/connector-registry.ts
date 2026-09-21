import type { ConnectorAdapter } from './connector-adapter';
import type { ConnectorManifest } from './connector.types';

export type ConnectorRegistryErrorCode = 'CONNECTOR_ALREADY_REGISTERED' | 'CONNECTOR_NOT_FOUND';

export class ConnectorRegistryError extends Error {
    constructor(
        readonly code: ConnectorRegistryErrorCode,
        message: string,
    ) {
        super(message);
        this.name = 'ConnectorRegistryError';
    }
}

export class ConnectorRegistry {
    private readonly adapters = new Map<string, ConnectorAdapter>();

    register(adapter: ConnectorAdapter): void {
        const connectorId = adapter.manifest.id;
        if (this.adapters.has(connectorId)) {
            throw new ConnectorRegistryError(
                'CONNECTOR_ALREADY_REGISTERED',
                `连接器已注册：${connectorId}`,
            );
        }
        this.adapters.set(connectorId, adapter);
    }

    get<Adapter extends ConnectorAdapter = ConnectorAdapter>(connectorId: string): Adapter {
        const adapter = this.adapters.get(connectorId);
        if (!adapter) {
            throw new ConnectorRegistryError(
                'CONNECTOR_NOT_FOUND',
                `连接器未注册：${connectorId}`,
            );
        }
        return adapter as Adapter;
    }

    has(connectorId: string): boolean {
        return this.adapters.has(connectorId);
    }

    list(): ConnectorManifest[] {
        return [...this.adapters.values()].map((adapter) => adapter.manifest);
    }
}
