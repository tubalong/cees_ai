const CHINESE_CHARACTER = /[\u3400-\u9fff]/;
const ELECTRON_HANDLER_PREFIX = /^Error invoking remote method '[^']+':\s*/i;
const ERROR_PREFIX = /^(?:Error|TypeError|RangeError|NetworkError):\s*/i;

/**
 * 把底层网络、Electron IPC 和第三方 SDK 错误统一转成用户能理解的中文。
 * 详细堆栈仍保留在开发者工具中，不直接展示在 Toast 或聊天正文里。
 */
export function toUserErrorMessage(error: unknown, fallback = '操作未完成，请稍后重试'): string {
    const raw = readErrorText(error).replace(ELECTRON_HANDLER_PREFIX, '').replace(ERROR_PREFIX, '').trim();
    if (!raw) return fallback;
    if (CHINESE_CHARACTER.test(raw) && !looksLikeTechnicalDump(raw)) return raw;

    const normalized = raw.toLowerCase();
    if (normalized.includes('failed to fetch') || normalized.includes('networkerror') || normalized.includes('network request failed') || normalized.includes('err_connection')) {
        return '网络连接失败，请检查网络或服务是否已启动';
    }
    if (normalized.includes('timeout') || normalized.includes('timed out') || normalized.includes('etimedout')) {
        return '请求超时，请稍后重试';
    }
    if (normalized.includes('abort') || normalized.includes('canceled') || normalized.includes('cancelled')) {
        return '操作已取消';
    }
    if (normalized.includes('unauthorized') || normalized.includes('401')) {
        return '登录状态已失效，请重新登录';
    }
    if (normalized.includes('forbidden') || normalized.includes('permission') || normalized.includes('403')) {
        return '当前账号没有执行此操作的权限';
    }
    if (normalized.includes('not found') || normalized.includes('404')) {
        return '请求的内容不存在或已被删除';
    }
    if (normalized.includes('conflict') || normalized.includes('409')) {
        return '数据已发生变化，请刷新后重试';
    }
    if (/http\s*5\d\d/i.test(raw) || normalized.includes('internal server error') || normalized.includes('bad gateway') || normalized.includes('service unavailable')) {
        return '服务暂时不可用，请稍后重试';
    }
    if (/http\s*4\d\d/i.test(raw) || normalized.includes('bad request')) {
        return '请求内容不符合要求，请检查后重试';
    }
    return fallback;
}

function readErrorText(error: unknown): string {
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message;
    if (error && typeof error === 'object') {
        const record = error as Record<string, unknown>;
        for (const key of ['message', 'error', 'detail', 'reason']) {
            if (typeof record[key] === 'string') return record[key];
        }
    }
    return '';
}

function looksLikeTechnicalDump(value: string): boolean {
    return /(?:\bat\s+[^\n]+:\d+:\d+|node:electron|node_modules|[A-Z]:\\|file:\/\/|ERR_[A-Z_]+|\{\s*"(?:error|code)")/i.test(value);
}
