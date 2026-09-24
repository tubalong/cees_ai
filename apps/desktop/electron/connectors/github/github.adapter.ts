import type { ConnectorAdapter } from '../core/connector-adapter';
import {
    configureGitHubConnector,
    connectGitHubConnector,
    disconnectGitHubConnector,
    discoverGitHubTools,
    executeGitHubCalls,
    getGitHubConnectorStatus,
    resetGitHubTools,
    type GitHubConnectorContext,
    type GitHubConnectorPlannedCall,
    type GitHubConnectorStatus,
    type GitHubConnectorTool,
} from './github.connector';
import { GITHUB_CONNECTOR_MANIFEST } from './github.manifest';

export interface GitHubConnectorDependencies {
    configure(userDataPath: string): void;
    status(): Promise<GitHubConnectorStatus>;
    connect(): Promise<GitHubConnectorStatus>;
    disconnect(): Promise<GitHubConnectorStatus>;
    resetTools(): void;
    discoverTools(): Promise<GitHubConnectorTool[]>;
    execute(calls: GitHubConnectorPlannedCall[]): Promise<GitHubConnectorContext[]>;
}

const DEFAULT_DEPENDENCIES: GitHubConnectorDependencies = {
    configure: configureGitHubConnector,
    status: getGitHubConnectorStatus,
    connect: connectGitHubConnector,
    disconnect: disconnectGitHubConnector,
    resetTools: resetGitHubTools,
    discoverTools: discoverGitHubTools,
    execute: executeGitHubCalls,
};

export class GitHubConnectorAdapter implements ConnectorAdapter<
    GitHubConnectorStatus,
    GitHubConnectorTool,
    GitHubConnectorPlannedCall,
    GitHubConnectorContext
> {
    readonly manifest = GITHUB_CONNECTOR_MANIFEST;

    constructor(private readonly dependencies: GitHubConnectorDependencies = DEFAULT_DEPENDENCIES) {}

    configure(userDataPath: string): void { this.dependencies.configure(userDataPath); }
    status(): Promise<GitHubConnectorStatus> { return this.dependencies.status(); }
    connect(): Promise<GitHubConnectorStatus> { return this.dependencies.connect(); }
    disconnect(): Promise<GitHubConnectorStatus> { return this.dependencies.disconnect(); }
    resetTools(): void { this.dependencies.resetTools(); }
    discoverTools(): Promise<GitHubConnectorTool[]> { return this.dependencies.discoverTools(); }
    execute(calls: GitHubConnectorPlannedCall[]): Promise<GitHubConnectorContext[]> { return this.dependencies.execute(calls); }
}
