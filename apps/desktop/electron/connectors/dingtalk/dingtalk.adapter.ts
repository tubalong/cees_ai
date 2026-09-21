import {
    checkDingTalkConnectorUpdate,
    configureDingTalkConnector,
    discoverDingTalkReadTools,
    executeDingTalkReadCalls,
    getDingTalkConnectorRelease,
    installAndAuthorizeDingTalkConnector,
    resetDingTalkConnectorTools,
    rollbackDingTalkConnector,
    upgradeDingTalkConnector,
    type DingTalkConnectorContext,
    type DingTalkConnectorPlannedCall,
    type DingTalkConnectorReleaseResult,
    type DingTalkConnectorReleaseStatus,
    type DingTalkConnectorTool,
} from '../../dingtalk-connector';
import {
    fetchDingTalkVisibleOrganization,
    getDingTalkDwsStatus,
    loginDingTalkDws,
    logoutDingTalkDws,
    selectDingTalkDwsProfile,
    type DingTalkDwsSnapshot,
    type DingTalkDwsStatus,
} from '../../dingtalk-dws';
import type {
    ConnectorAdapter,
    OrganizationConnectorAdapter,
    ProfileConnectorAdapter,
    VersionManagedConnectorAdapter,
} from '../core/connector-adapter';
import { DINGTALK_CONNECTOR_MANIFEST } from './dingtalk.manifest';

export interface DingTalkConnectorDependencies {
    configure(userDataPath: string): void;
    status(): Promise<DingTalkDwsStatus>;
    login(): Promise<DingTalkDwsStatus>;
    connect(): Promise<DingTalkDwsStatus>;
    disconnect(): Promise<DingTalkDwsStatus>;
    selectProfile(profile: string): Promise<DingTalkDwsStatus>;
    fetchOrganization(): Promise<DingTalkDwsSnapshot>;
    resetTools(): void;
    discoverTools(): Promise<DingTalkConnectorTool[]>;
    execute(calls: DingTalkConnectorPlannedCall[]): Promise<DingTalkConnectorContext[]>;
    getRelease(): Promise<DingTalkConnectorReleaseStatus>;
    checkForUpdates(): Promise<DingTalkConnectorReleaseStatus>;
    upgrade(targetVersion?: string): Promise<DingTalkConnectorReleaseResult>;
    rollback(): Promise<DingTalkConnectorReleaseResult>;
}

const DEFAULT_DEPENDENCIES: DingTalkConnectorDependencies = {
    configure: configureDingTalkConnector,
    status: getDingTalkDwsStatus,
    login: loginDingTalkDws,
    connect: installAndAuthorizeDingTalkConnector,
    disconnect: logoutDingTalkDws,
    selectProfile: selectDingTalkDwsProfile,
    fetchOrganization: fetchDingTalkVisibleOrganization,
    resetTools: resetDingTalkConnectorTools,
    discoverTools: discoverDingTalkReadTools,
    execute: executeDingTalkReadCalls,
    getRelease: getDingTalkConnectorRelease,
    checkForUpdates: checkDingTalkConnectorUpdate,
    upgrade: upgradeDingTalkConnector,
    rollback: rollbackDingTalkConnector,
};

export class DingTalkConnectorAdapter implements
    ConnectorAdapter<DingTalkDwsStatus, DingTalkConnectorTool, DingTalkConnectorPlannedCall, DingTalkConnectorContext>,
    ProfileConnectorAdapter<DingTalkDwsStatus>,
    OrganizationConnectorAdapter<DingTalkDwsSnapshot>,
    VersionManagedConnectorAdapter<DingTalkConnectorReleaseStatus> {
    readonly manifest = DINGTALK_CONNECTOR_MANIFEST;

    constructor(private readonly dependencies: DingTalkConnectorDependencies = DEFAULT_DEPENDENCIES) {}

    configure(userDataPath: string): void {
        this.dependencies.configure(userDataPath);
    }

    status(): Promise<DingTalkDwsStatus> {
        return this.dependencies.status();
    }

    login(): Promise<DingTalkDwsStatus> {
        return this.dependencies.login();
    }

    connect(): Promise<DingTalkDwsStatus> {
        return this.dependencies.connect();
    }

    disconnect(): Promise<DingTalkDwsStatus> {
        return this.dependencies.disconnect();
    }

    selectProfile(profile: string): Promise<DingTalkDwsStatus> {
        return this.dependencies.selectProfile(profile);
    }

    fetchOrganization(): Promise<DingTalkDwsSnapshot> {
        return this.dependencies.fetchOrganization();
    }

    resetTools(): void {
        this.dependencies.resetTools();
    }

    discoverTools(): Promise<DingTalkConnectorTool[]> {
        return this.dependencies.discoverTools();
    }

    execute(calls: DingTalkConnectorPlannedCall[]): Promise<DingTalkConnectorContext[]> {
        return this.dependencies.execute(calls);
    }

    getRelease(): Promise<DingTalkConnectorReleaseStatus> {
        return this.dependencies.getRelease();
    }

    checkForUpdates(): Promise<DingTalkConnectorReleaseStatus> {
        return this.dependencies.checkForUpdates();
    }

    upgrade(targetVersion?: string): Promise<DingTalkConnectorReleaseResult> {
        return this.dependencies.upgrade(targetVersion);
    }

    rollback(): Promise<DingTalkConnectorReleaseResult> {
        return this.dependencies.rollback();
    }
}
