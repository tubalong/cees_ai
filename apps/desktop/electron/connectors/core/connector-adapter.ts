import type {
    ConnectorContext,
    ConnectorManifest,
    ConnectorPlannedCall,
    ConnectorStatus,
    ConnectorTool,
} from './connector.types';

export interface ConnectorAdapter<
    Status extends ConnectorStatus = ConnectorStatus,
    Tool extends ConnectorTool = ConnectorTool,
    PlannedCall extends ConnectorPlannedCall = ConnectorPlannedCall,
    Context extends ConnectorContext = ConnectorContext,
> {
    readonly manifest: ConnectorManifest;
    configure(userDataPath: string): void;
    status(): Promise<Status>;
    connect(options?: unknown): Promise<Status>;
    disconnect(): Promise<Status>;
    resetTools(): void;
    discoverTools(): Promise<Tool[]>;
    execute(calls: PlannedCall[]): Promise<Context[]>;
}

export interface ProfileConnectorAdapter<Status extends ConnectorStatus = ConnectorStatus> {
    login(): Promise<Status>;
    selectProfile(profile: string): Promise<Status>;
}

export interface OrganizationConnectorAdapter<Snapshot = unknown> {
    fetchOrganization(): Promise<Snapshot>;
}

export interface VersionManagedConnectorAdapter<ReleaseStatus = unknown> {
    getRelease(): Promise<ReleaseStatus>;
    checkForUpdates(): Promise<ReleaseStatus>;
    upgrade(targetVersion?: string): Promise<{ release: ReleaseStatus; status: ConnectorStatus }>;
    rollback(): Promise<{ release: ReleaseStatus; status: ConnectorStatus }>;
}
