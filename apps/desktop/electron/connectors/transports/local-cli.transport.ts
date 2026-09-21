import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const defaultExecFile = promisify(execFile);
const DEFAULT_MAX_BUFFER_BYTES = 16 * 1024 * 1024;

export interface LocalCliExecutable<Source extends string = string> {
    command: string;
    prefixArgs?: string[];
    source?: Source;
}

export interface LocalCliProcessOptions {
    encoding: 'utf8';
    timeout: number;
    windowsHide: boolean;
    shell: false;
    maxBuffer: number;
    env: NodeJS.ProcessEnv;
}

export interface LocalCliProcessResult {
    stdout: string;
    stderr?: string;
}

export type LocalCliProcessExecutor = (
    command: string,
    args: string[],
    options: LocalCliProcessOptions,
) => Promise<LocalCliProcessResult>;

export interface LocalCliTransportOptions {
    resolveExecutable: () => LocalCliExecutable;
    environment?: NodeJS.ProcessEnv;
    maxBufferBytes?: number;
    executeFile?: LocalCliProcessExecutor;
}

export interface LocalCliExecuteOptions {
    timeoutMs: number;
    envOverrides?: NodeJS.ProcessEnv;
    outputLabel?: string;
}

export interface LocalCliHealthResult {
    healthy: boolean;
    version: string | null;
    error: string | null;
}

export class LocalCliCommandError extends Error {
    readonly command: string;
    readonly args: string[];
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode: string | number | null;
    readonly signal: string | null;
    readonly timedOut: boolean;

    constructor(input: {
        message: string;
        command: string;
        args: string[];
        stdout?: string;
        stderr?: string;
        exitCode?: string | number | null;
        signal?: string | null;
        timedOut?: boolean;
    }) {
        super(input.message);
        this.name = 'LocalCliCommandError';
        this.command = input.command;
        this.args = [...input.args];
        this.stdout = input.stdout ?? '';
        this.stderr = input.stderr ?? '';
        this.exitCode = input.exitCode ?? null;
        this.signal = input.signal ?? null;
        this.timedOut = input.timedOut ?? false;
    }
}

export class LocalCliTransport {
    private readonly executeFile: LocalCliProcessExecutor;

    constructor(private readonly options: LocalCliTransportOptions) {
        this.executeFile = options.executeFile ?? (async (command, args, processOptions) => {
            const result = await defaultExecFile(command, args, processOptions);
            return {
                stdout: String(result.stdout),
                stderr: String(result.stderr),
            };
        });
    }

    async execute(args: string[], executeOptions: LocalCliExecuteOptions): Promise<string> {
        const normalizedArgs = validateArguments(args);
        const executable = this.options.resolveExecutable();
        validateExecutable(executable);
        const commandArgs = [...(executable.prefixArgs ?? []), ...normalizedArgs];
        const outputLabel = executeOptions.outputLabel ?? '本地 CLI';
        try {
            const result = await this.executeFile(executable.command, commandArgs, {
                encoding: 'utf8',
                timeout: executeOptions.timeoutMs,
                windowsHide: true,
                shell: false,
                maxBuffer: this.options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES,
                env: {
                    ...process.env,
                    ...this.options.environment,
                    ...executeOptions.envOverrides,
                },
            });
            return result.stdout;
        } catch (error) {
            throw toLocalCliCommandError(error, executable.command, commandArgs, outputLabel);
        }
    }

    async executeJson(args: string[], executeOptions: LocalCliExecuteOptions): Promise<unknown> {
        const output = await this.execute(args, executeOptions);
        return parseLocalCliJsonOutput(output, executeOptions.outputLabel ?? '本地 CLI');
    }

    async version(executeOptions: Omit<LocalCliExecuteOptions, 'outputLabel'>): Promise<string> {
        return (await this.execute(['--version'], { ...executeOptions, outputLabel: '本地 CLI' })).trim();
    }

    async healthCheck(executeOptions: Omit<LocalCliExecuteOptions, 'outputLabel'>): Promise<LocalCliHealthResult> {
        try {
            return {
                healthy: true,
                version: await this.version(executeOptions),
                error: null,
            };
        } catch (error) {
            return {
                healthy: false,
                version: null,
                error: error instanceof Error ? error.message : '本地 CLI 不可用',
            };
        }
    }
}

export function parseLocalCliJsonOutput(output: string, outputLabel = '本地 CLI'): unknown {
    const trimmed = output.trim();
    if (!trimmed) throw new Error(`${outputLabel} 未返回 JSON 数据`);
    try {
        return JSON.parse(trimmed) as unknown;
    } catch {
        const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        for (let index = lines.length - 1; index >= 0; index -= 1) {
            try {
                return JSON.parse(lines[index]!) as unknown;
            } catch {
                continue;
            }
        }
        const jsonStarts = [trimmed.indexOf('{'), trimmed.indexOf('[')]
            .filter((index) => index >= 0)
            .sort((left, right) => left - right);
        for (const jsonStart of jsonStarts) {
            try {
                return JSON.parse(trimmed.slice(jsonStart)) as unknown;
            } catch {
                continue;
            }
        }
        throw new Error(`${outputLabel} 返回了无法解析的 JSON 数据`);
    }
}

function validateArguments(args: string[]): string[] {
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
        throw new Error('本地 CLI 参数必须是字符串数组');
    }
    if (args.some((arg) => arg.includes('\0'))) {
        throw new Error('本地 CLI 参数包含非法控制字符');
    }
    return [...args];
}

function validateExecutable(executable: LocalCliExecutable): void {
    if (!executable || typeof executable.command !== 'string' || !executable.command.trim()) {
        throw new Error('本地 CLI 可执行文件无效');
    }
    if (executable.prefixArgs?.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) {
        throw new Error('本地 CLI 前置参数无效');
    }
}

function toLocalCliCommandError(
    error: unknown,
    command: string,
    args: string[],
    outputLabel: string,
): LocalCliCommandError {
    const record = isRecord(error) ? error : {};
    const stderr = typeof record.stderr === 'string' ? record.stderr : '';
    const stdout = typeof record.stdout === 'string' ? record.stdout : '';
    const exitCode = typeof record.code === 'string' || typeof record.code === 'number' ? record.code : null;
    const signal = typeof record.signal === 'string' ? record.signal : null;
    const timedOut = exitCode === 'ETIMEDOUT' || signal === 'SIGTERM';
    const message = timedOut
        ? `${outputLabel} 执行超时（timeout）`
        : error instanceof Error ? error.message : `${outputLabel} 执行失败`;
    return new LocalCliCommandError({
        message,
        command,
        args,
        stdout,
        stderr,
        exitCode,
        signal,
        timedOut,
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}
