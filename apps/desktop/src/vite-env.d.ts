/// <reference types="vite/client" />

interface Window {
    cees?: {
        platform: string;
        version: string;
        setZoomFactor: (factor: number) => void;
        openDevTools: () => void;
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
            dingtalk: {
                status: () => Promise<DingTalkConnectorStatus>;
                connect: () => Promise<DingTalkConnectorStatus>;
                selectProfile: (profile: string) => Promise<DingTalkConnectorStatus>;
                tools: () => Promise<DingTalkConnectorTool[]>;
                execute: (calls: DingTalkConnectorPlannedCall[]) => Promise<DingTalkConnectorContext[]>;
                release: () => Promise<{ version: string; license: string }>;
                onStatusChanged: (listener: (status: DingTalkConnectorStatus) => void) => () => void;
            };
        };
    };
}

interface DingTalkConnectorStatus {
    state: DingTalkConnectorState;
    installed: boolean;
    authenticated: boolean;
    source: 'MANAGED' | 'SYSTEM' | null;
    installSupported: boolean;
    version: string | null;
    profile: string | null;
    corpId: string | null;
    corpName: string | null;
    externalUserId: string | null;
    externalUserName: string | null;
    profiles: DingTalkDwsProfile[];
    checkedAt: string;
    issueCode: string | null;
    recoveryAction: DingTalkConnectorRecoveryAction;
    error: string | null;
}

type DingTalkConnectorState = 'NOT_INSTALLED' | 'AUTH_REQUIRED' | 'PROFILE_REQUIRED' | 'READY' | 'ERROR';
type DingTalkConnectorRecoveryAction = 'INSTALL' | 'MANUAL_INSTALL' | 'AUTHORIZE' | 'SELECT_PROFILE' | 'RETRY' | 'NONE';

interface DingTalkDwsProfile {
    profile: string;
    corpId: string | null;
    corpName: string | null;
    externalUserId: string | null;
    externalUserName: string | null;
    current: boolean;
    organizationCurrent: boolean;
}

interface DingTalkConnectorContext {
    provider: 'DINGTALK';
    toolId: string;
    toolName: string;
    fetchedAt: string;
    data: Record<string, unknown>;
}

interface DingTalkConnectorTool {
    toolId: string;
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

interface DingTalkConnectorPlannedCall {
    toolId: string;
    arguments: Record<string, unknown>;
}
