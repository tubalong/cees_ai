import { ConnectorRegistry } from './connector-registry';
import type {
    ConnectorContext,
    ConnectorManifest,
    ConnectorPlannedCall,
    ConnectorStatus,
    ConnectorTool,
} from './connector.types';

export interface ConnectorStatusChangedEvent {
    connectorId: string;
    status: ConnectorStatus;
}

export type ConnectorStatusPublisher = (event: ConnectorStatusChangedEvent) => void;

export class ConnectorHost {
    constructor(
        private readonly registry: ConnectorRegistry,
        private readonly publish: ConnectorStatusPublisher = () => undefined,
    ) {}

    list(): ConnectorManifest[] {
        return this.registry.list();
    }

    async status(connectorId: string): Promise<ConnectorStatus> {
        const normalizedId = normalizeConnectorId(connectorId);
        const adapter = this.registry.get(normalizedId);
        const status = await adapter.status();
        if (status.state !== 'READY') adapter.resetTools();
        this.publishStatus(normalizedId, status);
        return status;
    }

    async connect(connectorId: string): Promise<ConnectorStatus> {
        const normalizedId = normalizeConnectorId(connectorId);
        const status = await this.registry.get(normalizedId).connect();
        this.publishStatus(normalizedId, status);
        return status;
    }

    async disconnect(connectorId: string): Promise<ConnectorStatus> {
        const normalizedId = normalizeConnectorId(connectorId);
        const adapter = this.registry.get(normalizedId);
        try {
            const status = await adapter.disconnect();
            adapter.resetTools();
            this.publishStatus(normalizedId, status);
            return status;
        } catch (error) {
            await this.refreshAfterFailure(normalizedId);
            throw error;
        }
    }

    async tools(connectorId: string): Promise<ConnectorTool[]> {
        const normalizedId = normalizeConnectorId(connectorId);
        try {
            return await this.registry.get(normalizedId).discoverTools();
        } catch (error) {
            await this.refreshAfterFailure(normalizedId);
            throw error;
        }
    }

    async execute(connectorId: string, calls: unknown): Promise<ConnectorContext[]> {
        const normalizedId = normalizeConnectorId(connectorId);
        const adapter = this.registry.get(normalizedId);
        const normalizedCalls = normalizeCalls(calls);
        try {
            return await adapter.execute(normalizedCalls);
        } catch (error) {
            adapter.resetTools();
            await this.refreshAfterFailure(normalizedId);
            throw error;
        }
    }

    publishStatus(connectorId: string, status: ConnectorStatus): void {
        this.publish({ connectorId: normalizeConnectorId(connectorId), status });
    }

    private async refreshAfterFailure(connectorId: string): Promise<void> {
        try {
            await this.status(connectorId);
        } catch {
        }
    }
}

function normalizeConnectorId(connectorId: string): string {
    if (typeof connectorId !== 'string' || !connectorId.trim() || connectorId !== connectorId.trim()) {
        throw new Error('连接器 ID 无效');
    }
    return connectorId;
}

function normalizeCalls(calls: unknown): ConnectorPlannedCall[] {
    if (!Array.isArray(calls)) throw new Error('连接器调用计划无效');
    return calls.map((call) => {
        if (!isRecord(call)
            || typeof call.toolId !== 'string'
            || !call.toolId.trim()
            || !isRecord(call.arguments)) {
            throw new Error('连接器调用计划无效');
        }
        return {
            toolId: call.toolId,
            arguments: { ...call.arguments },
            ...(call.confirmed === true ? { confirmed: true } : {}),
        };
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
