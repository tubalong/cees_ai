import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const defaultExecFile = promisify(execFile);
const DEFAULT_MAX_BUFFER_BYTES = 16 * 1024 * 1024;

/**
 * `promisify(execFile)` 的声明在 `encoding: 'buffer'` 下推断不出 `Buffer`，
 * 这里收口成一个显式签名，避免在每个调用点重复断言。
 */
type ExecFileWithBuffer = (
    file: string,
    args: string[],
    options: LocalCliProcessOptions,
) => Promise<{ stdout: Buffer; stderr: Buffer }>;

/**
 * 本地 CLI 输出解码。
 *
 * 不能让 Node 用 `encoding: 'utf8'` 直接解码：中文 Windows 上部分 CLI（含 DWS）
 * 按系统 ANSI（GBK/GB18030）输出，强制按 UTF-8 解码会得到乱码。
 * 这里先以严格模式探测 UTF-8（`fatal: true`），失败则回退为 GB18030（仅 Windows），
 * 其余平台保留宽松 UTF-8。任何新接入的本地 CLI 都自动获得这一行为。
 */
export function decodeLocalCliOutput(output: string | Buffer): string {
    if (typeof output === 'string') return output;
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(output);
    } catch {
        if (process.platform === 'win32') return new TextDecoder('gb18030').decode(output);
        return output.toString('utf8');
    }
}

export interface LocalCliExecutable<Source extends string = string> {
    command: string;
    prefixArgs?: string[];
    source?: Source;
}

export interface LocalCliProcessOptions {
    /** 拿原始字节交给 decodeLocalCliOutput：编码判定需要看字节，不能在 Node 侧提前定死。 */
    encoding: 'buffer';
    timeout: number;
    windowsHide: boolean;
    shell: false;
    maxBuffer: number;
    env: NodeJS.ProcessEnv;
}

export interface LocalCliProcessResult {
    stdout: string | Buffer;
    stderr?: string | Buffer;
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
            const result = await (defaultExecFile as unknown as ExecFileWithBuffer)(command, args, processOptions);
            return {
                stdout: result.stdout ?? Buffer.alloc(0),
                stderr: result.stderr ?? Buffer.alloc(0),
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
                encoding: 'buffer',
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
            return decodeLocalCliOutput(result.stdout);
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
        const embedded = extractEmbeddedJsonValues(trimmed);
        if (embedded.length > 0) return embedded[embedded.length - 1]!.value;
        throw new Error(`${outputLabel} 返回了无法解析的 JSON 数据`);
    }
}

function extractEmbeddedJsonValues(output: string): Array<{ start: number; end: number; value: unknown }> {
    const values: Array<{ start: number; end: number; value: unknown }> = [];
    for (let start = 0; start < output.length; start += 1) {
        if (output[start] !== '{' && output[start] !== '[') continue;
        const end = findJsonValueEnd(output, start);
        if (end === null) continue;
        try {
            values.push({ start, end, value: JSON.parse(output.slice(start, end)) as unknown });
        } catch {
            continue;
        }
    }
    values.sort((left, right) => left.end - right.end || right.start - left.start);
    return values;
}

function findJsonValueEnd(output: string, start: number): number | null {
    const opening = output[start];
    const closing = opening === '{' ? '}' : opening === '[' ? ']' : null;
    if (!closing) return null;
    const stack = [closing];
    let inString = false;
    let escaped = false;
    for (let index = start + 1; index < output.length; index += 1) {
        const character = output[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === '"') inString = false;
            continue;
        }
        if (character === '"') {
            inString = true;
            continue;
        }
        if (character === '{') stack.push('}');
        else if (character === '[') stack.push(']');
        else if (character === '}' || character === ']') {
            if (stack[stack.length - 1] !== character) return null;
            stack.pop();
            if (stack.length === 0) return index + 1;
        }
    }
    return null;
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
    // 失败输出同样可能是 GBK：错误文案里出现乱码会直接暴露给用户，因此走同一套解码。
    const stderr = record.stderr === undefined ? '' : decodeLocalCliOutput(record.stderr as string | Buffer);
    const stdout = record.stdout === undefined ? '' : decodeLocalCliOutput(record.stdout as string | Buffer);
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
