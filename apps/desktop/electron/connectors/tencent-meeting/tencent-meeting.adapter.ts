import type { ConnectorAdapter } from '../core/connector-adapter';
import {
    configureTencentMeetingConnector,
    discoverTencentMeetingTools,
    disconnectTencentMeetingConnector,
    executeTencentMeetingCalls,
    getTencentMeetingConnectorStatus,
    installAndAuthorizeTencentMeetingConnector,
    resetTencentMeetingConnectorTools,
    type TencentMeetingConnectorContext,
    type TencentMeetingConnectorPlannedCall,
    type TencentMeetingConnectorStatus,
    type TencentMeetingConnectorTool,
} from './tencent-meeting.connector';
import { TENCENT_MEETING_CONNECTOR_MANIFEST } from './tencent-meeting.manifest';

export interface TencentMeetingConnectorDependencies {
    configure(userDataPath: string): void;
    status(): Promise<TencentMeetingConnectorStatus>;
    connect(): Promise<TencentMeetingConnectorStatus>;
    disconnect(): Promise<TencentMeetingConnectorStatus>;
    resetTools(): void;
    discoverTools(): Promise<TencentMeetingConnectorTool[]>;
    execute(calls: TencentMeetingConnectorPlannedCall[]): Promise<TencentMeetingConnectorContext[]>;
}

const DEFAULT_DEPENDENCIES: TencentMeetingConnectorDependencies = {
    configure: configureTencentMeetingConnector,
    status: getTencentMeetingConnectorStatus,
    connect: installAndAuthorizeTencentMeetingConnector,
    disconnect: disconnectTencentMeetingConnector,
    resetTools: resetTencentMeetingConnectorTools,
    discoverTools: discoverTencentMeetingTools,
    execute: executeTencentMeetingCalls,
};

export class TencentMeetingConnectorAdapter implements ConnectorAdapter<
    TencentMeetingConnectorStatus,
    TencentMeetingConnectorTool,
    TencentMeetingConnectorPlannedCall,
    TencentMeetingConnectorContext
> {
    readonly manifest = TENCENT_MEETING_CONNECTOR_MANIFEST;

    constructor(private readonly dependencies: TencentMeetingConnectorDependencies = DEFAULT_DEPENDENCIES) {}

    configure(userDataPath: string): void {
        this.dependencies.configure(userDataPath);
    }

    status(): Promise<TencentMeetingConnectorStatus> {
        return this.dependencies.status();
    }

    connect(): Promise<TencentMeetingConnectorStatus> {
        return this.dependencies.connect();
    }

    disconnect(): Promise<TencentMeetingConnectorStatus> {
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
