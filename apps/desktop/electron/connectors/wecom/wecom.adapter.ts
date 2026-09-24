import type { ConnectorAdapter } from '../core/connector-adapter';
import {
    configureWeComConnector,
    discoverWeComTools,
    disconnectWeComConnector,
    executeWeComCalls,
    getWeComConnectorStatus,
    installAndAuthorizeWeComConnector,
    resetWeComConnectorTools,
    type WeComConnectorContext,
    type WeComConnectorPlannedCall,
    type WeComConnectorStatus,
    type WeComConnectorTool,
} from './wecom.connector';
import { WECOM_CONNECTOR_MANIFEST } from './wecom.manifest';

export interface WeComConnectorDependencies {
    configure(userDataPath: string): void;
    status(): Promise<WeComConnectorStatus>;
    connect(): Promise<WeComConnectorStatus>;
    disconnect(): Promise<WeComConnectorStatus>;
    resetTools(): void;
    discoverTools(): Promise<WeComConnectorTool[]>;
    execute(calls: WeComConnectorPlannedCall[]): Promise<WeComConnectorContext[]>;
}

const DEFAULT_DEPENDENCIES: WeComConnectorDependencies = {
    configure: configureWeComConnector,
    status: getWeComConnectorStatus,
    connect: installAndAuthorizeWeComConnector,
    disconnect: disconnectWeComConnector,
    resetTools: resetWeComConnectorTools,
    discoverTools: discoverWeComTools,
    execute: executeWeComCalls,
};

export class WeComConnectorAdapter implements ConnectorAdapter<
    WeComConnectorStatus,
    WeComConnectorTool,
    WeComConnectorPlannedCall,
    WeComConnectorContext
> {
    readonly manifest = WECOM_CONNECTOR_MANIFEST;

    constructor(private readonly dependencies: WeComConnectorDependencies = DEFAULT_DEPENDENCIES) {}

    configure(userDataPath: string): void { this.dependencies.configure(userDataPath); }
    status(): Promise<WeComConnectorStatus> { return this.dependencies.status(); }
    connect(): Promise<WeComConnectorStatus> { return this.dependencies.connect(); }
    disconnect(): Promise<WeComConnectorStatus> { return this.dependencies.disconnect(); }
    resetTools(): void { this.dependencies.resetTools(); }
    discoverTools(): Promise<WeComConnectorTool[]> { return this.dependencies.discoverTools(); }
    execute(calls: WeComConnectorPlannedCall[]): Promise<WeComConnectorContext[]> { return this.dependencies.execute(calls); }
}
