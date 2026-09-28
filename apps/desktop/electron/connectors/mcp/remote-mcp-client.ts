import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { RemoteMcpConnectorDefinition } from './mcp.config';

export interface RemoteMcpClientOptions {
    definition: RemoteMcpConnectorDefinition;
    authProvider: OAuthClientProvider;
    requestHeaders?: Record<string, string>;
    clientName: string;
    clientVersion: string;
}

export function createRemoteMcpClient(options: RemoteMcpClientOptions): {
    client: Client;
    transport: StreamableHTTPClientTransport;
} {
    const client = new Client({ name: options.clientName, version: options.clientVersion }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(options.definition.url), {
        authProvider: options.authProvider,
        requestInit: {
            headers: {
                Accept: 'application/json, text/event-stream',
                ...(options.requestHeaders ?? {}),
            },
        },
        reconnectionOptions: {
            initialReconnectionDelay: 1000,
            maxReconnectionDelay: 10_000,
            reconnectionDelayGrowFactor: 1.5,
            maxRetries: 2,
        },
    });
    return { client, transport };
}
