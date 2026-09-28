import { readFileSync } from 'node:fs';
import path from 'node:path';

const DESKTOP_ENV_KEYS = [
    'CEES_GITHUB_OAUTH_CLIENT_ID',
    'CEES_GITHUB_OAUTH_CLIENT_SECRET',
] as const;

type DesktopEnvKey = (typeof DESKTOP_ENV_KEYS)[number];

export function loadDesktopEnvironment(isPackaged: boolean, environmentFiles?: readonly string[]): void {
    if (isPackaged) return;
    const candidates = environmentFiles ?? [
        path.resolve(process.cwd(), '.env'),
        path.resolve(__dirname, '../../../.env'),
    ];
    for (const filePath of candidates) {
        const values = readDesktopEnvFile(filePath);
        if (!values) continue;
        for (const key of DESKTOP_ENV_KEYS) {
            if (process.env[key] === undefined && values[key] !== undefined) {
                process.env[key] = values[key];
            }
        }
        if (hasAllDesktopEnvironment(values)) return;
    }
}

function readDesktopEnvFile(filePath: string): Partial<Record<DesktopEnvKey, string>> | undefined {
    let content: string;
    try {
        content = readFileSync(filePath, 'utf8');
    } catch {
        return undefined;
    }
    const result: Partial<Record<DesktopEnvKey, string>> = {};
    for (const line of content.split(/\r?\n/u)) {
        const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/u);
        if (!match) continue;
        const key = match[1] as DesktopEnvKey;
        if (!DESKTOP_ENV_KEYS.includes(key)) continue;
        result[key] = unquoteEnvValue(match[2]);
    }
    return result;
}

function unquoteEnvValue(value: string): string {
    if (value.length >= 2) {
        const first = value[0];
        const last = value[value.length - 1];
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
            return value.slice(1, -1);
        }
    }
    return value.replace(/\s+#.*$/u, '').trim();
}

function hasAllDesktopEnvironment(values: Partial<Record<DesktopEnvKey, string>>): boolean {
    return DESKTOP_ENV_KEYS.every((key) => values[key] !== undefined);
}
