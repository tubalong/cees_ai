import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { Observable, map } from 'rxjs';

type Envelope<T> = { success: true; data: T; requestId?: string };

@Injectable()
export class ApiResponseInterceptor<T> implements NestInterceptor<T, Envelope<T> | T> {
    intercept(context: ExecutionContext, next: CallHandler<T>): Observable<Envelope<T> | T> {
        const request = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>();
        const header = request.headers['x-request-id'];
        const requestId = Array.isArray(header) ? header[0] : header;
        return next.handle().pipe(map((data) => {
            // 文件/二进制响应（StreamableFile，例如 DOCX/PDF/PPTX 导出）必须原样透传，
            // 不能被包进 JSON 包络：否则 Nest 会把文件字节序列化成 JSON，客户端下载后
            // 得到的是 JSON 文本而不是真正的 PDF/PPTX，阅读器（如 WPS）无法打开。
            if (isBinaryPassthrough(data)) return data;
            return { success: true, data, requestId };
        }));
    }
}

/**
 * 判定需要原样透传的二进制/流式响应。
 * 除 `instanceof StreamableFile` 外再做一次鸭子类型判断，避免同一依赖
 * （@nestjs/common）在 node_modules 中存在多份副本时 `instanceof` 失效，
 * 从而把文件字节错误地序列化成 JSON 包络。
 */
function isBinaryPassthrough(data: unknown): boolean {
    if (data instanceof StreamableFile) return true;
    if (data === null || typeof data !== 'object') return false;
    const candidate = data as { getStream?: unknown; options?: unknown };
    return typeof candidate.getStream === 'function';
}
