import type { ConnectorAdapter } from '../core/connector-adapter';
import {
    connectTencentMeetingConnector,
    discoverTencentMeetingReadTools,
    disconnectTencentMeetingConnector,
    executeTencentMeetingReadCalls,
    getTencentMeetingConnectorStatus,
    resetTencentMeetingConnectorTools,
    type TencentMeetingConnectorContext,
    type TencentMeetingConnectorPlannedCall,
    type TencentMeetingConnectorTool,
} from './tencent-meeting.connector';
import { TENCENT_MEETING_CONNECTOR_MANIFEST } from './tencent-meeting.manifest';
import type { ConnectorStatus } from '../core/connector.types';

export interface TencentMeetingConnectorDependencies {
    configure(userDataPath: string): void;
    status(): Promise<ConnectorStatus>;
    connect(): Promise<ConnectorStatus>;
    disconnect(): Promise<ConnectorStatus>;
    resetTools(): void;
    discoverTools(): Promise<TencentMeetingConnectorTool[]>;
    execute(calls: TencentMeetingConnectorPlannedCall[]): Promise<TencentMeetingConnectorContext[]>;
}

const DEFAULT_DEPENDENCIES: TencentMeetingConnectorDependencies = {
    configure: () => undefined,
    status: getTencentMeetingConnectorStatus,
    connect: connectTencentMeetingConnector,
    disconnect: disconnectTencentMeetingConnector,
    resetTools: resetTencentMeetingConnectorTools,
    discoverTools: discoverTencentMeetingReadTools,
    execute: executeTencentMeetingReadCalls,
};

export class TencentMeetingConnectorAdapter implements ConnectorAdapter<
    ConnectorStatus,
    TencentMeetingConnectorTool,
    TencentMeetingConnectorPlannedCall,
    TencentMeetingConnectorContext
> {
    readonly manifest = TENCENT_MEETING_CONNECTOR_MANIFEST;

    constructor(private readonly dependencies: TencentMeetingConnectorDependencies = DEFAULT_DEPENDENCIES) {}

    configure(userDataPath: string): void {
        this.dependencies.configure(userDataPath);
    }

    status(): Promise<ConnectorStatus> {
        return this.dependencies.status();
    }

    connect(): Promise<ConnectorStatus> {
        return this.dependencies.connect();
    }

    disconnect(): Promise<ConnectorStatus> {
        return this.dependencies.disconnect();
    }

    resetTools(): void {
        this.dependencies.resetTools();
    }

    discoverTools(): Promise<TencentMeetingConnectorTool[]> {
        return this.dependencies.discoverTools();
    }

    execute(calls: TencentMeetingConnectorPlannedCall[]): Promise<TencentMeetingConnectorContext[]> {
        return this.dependencies.execute(calls);
    }
}
