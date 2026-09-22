/// <reference types="vite/client" />

import type {
    ConnectorContext,
    ConnectorManifest,
    ConnectorPlannedCall,
    ConnectorRecoveryAction,
    ConnectorState,
    ConnectorStatus,
    ConnectorTool,
} from '../electron/connectors/core/connector.types';

declare global {
interface Window {
    cees?: {
        platform: string;
        version: string;
        setZoomFactor: (factor: number) => void;
        openDevTools: () => void;
        openExternal: (url: string) => Promise<boolean>;
        dingtalkDws?: {
            status: () => Promise<DingTalkConnectorStatus>;
            login: () => Promise<DingTalkConnectorStatus>;
            selectProfile: (profile: string) => Promise<DingTalkConnectorStatus>;
            fetchOrganization: () => Promise<{
                corpId: string;
                externalUserId: string;
                externalUserName: string;
                profile: string;
                fetchedAt: string;
                capabilities: string[];
                departments: Array<{
                    externalDepartmentId: string;
                    parentExternalDepartmentId: string | null;
                    name: string;
                    displayOrder: number;
                }>;
                users: Array<{
                    externalUserId: string;
                    unionId: string | null;
                    name: string;
                    title: string | null;
                    jobNumber: string | null;
                    departmentExternalIds: string[];
                    active: boolean;
                    admin: boolean;
                    boss: boolean;
                }>;
            }>;
        };
        connectors?: {
            list: () => Promise<ConnectorManifest[]>;
            status: (connectorId: string) => Promise<ConnectorStatus>;
            connect: (connectorId: string) => Promise<ConnectorStatus>;
            disconnect: (connectorId: string) => Promise<ConnectorStatus>;
            tools: (connectorId: string) => Promise<ConnectorTool[]>;
            execute: (connectorId: string, calls: ConnectorPlannedCall[]) => Promise<ConnectorContext[]>;
            onStatusChanged: (listener: (event: ConnectorStatusChangedEvent) => void) => () => void;
            dingtalk: {
                status: () => Promise<DingTalkConnectorStatus>;
                connect: () => Promise<DingTalkConnectorStatus>;
                disconnect: () => Promise<DingTalkConnectorStatus>;
                selectProfile: (profile: string) => Promise<DingTalkConnectorStatus>;
                tools: () => Promise<DingTalkConnectorTool[]>;
                execute: (calls: DingTalkConnectorPlannedCall[]) => Promise<DingTalkConnectorContext[]>;
                release: () => Promise<DingTalkConnectorReleaseStatus>;
                checkForUpdates: () => Promise<DingTalkConnectorReleaseStatus>;
                upgrade: (targetVersion?: string) => Promise<DingTalkConnectorReleaseStatus>;
                rollback: () => Promise<DingTalkConnectorReleaseStatus>;
                onStatusChanged: (listener: (status: DingTalkConnectorStatus) => void) => () => void;
            };
        };
    };
}

interface DingTalkConnectorStatus extends ConnectorStatus {
    source: 'MANAGED' | 'SYSTEM' | null;
    installSupported: boolean;
    profile: string | null;
    corpId: string | null;
    corpName: string | null;
    externalUserId: string | null;
    externalUserName: string | null;
    profiles: DingTalkDwsProfile[];
}

type DingTalkConnectorState = ConnectorState;
type DingTalkConnectorRecoveryAction = ConnectorRecoveryAction;

interface DingTalkDwsProfile {
    profile: string;
    corpId: string | null;
    corpName: string | null;
    externalUserId: string | null;
    externalUserName: string | null;
    current: boolean;
    organizationCurrent: boolean;
}

interface DingTalkConnectorReleaseStatus {
    version: string;
    license: string;
    channel: 'stable';
    installedVersion: string | null;
    latestVersion: string | null;
    updateAvailable: boolean;
    checkSupported: boolean;
    upgradeSupported: boolean;
    rollbackAvailable: boolean;
    rollbackVersion: string | null;
    checkedAt: string | null;
    releaseDate: string | null;
    releaseUrl: string | null;
    changelog: string[];
    error: string | null;
    lastOperation: {
        type: 'UPGRADE' | 'ROLLBACK';
        status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'ROLLED_BACK';
        fromVersion: string | null;
        targetVersion: string | null;
        startedAt: string;
        completedAt: string | null;
        message: string | null;
    } | null;
}

type DingTalkConnectorContext = ConnectorContext<'DINGTALK'>;

type DingTalkConnectorTool = ConnectorTool;

type DingTalkConnectorPlannedCall = ConnectorPlannedCall;

type DesktopConnectorManifest = ConnectorManifest;

type DesktopConnectorStatus = ConnectorStatus;

interface TencentMeetingConnectorStatus extends ConnectorStatus {
    account: {
        externalUserId: string;
        displayName: string | null;
        organizationId: string | null;
        organizationName: string | null;
    } | null;
    grantedScopes: string[];
    tokenStatus: 'MISSING' | 'VALID' | 'EXPIRING' | 'REFRESH_FAILED' | 'REVOKED';
    authorizedAt: string | null;
    tokenExpiresAt: string | null;
}

interface ConnectorStatusChangedEvent {
    connectorId: string;
    status: ConnectorStatus;
}
}

export {};
