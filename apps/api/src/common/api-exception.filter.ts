import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
    catch(exception: unknown, host: ArgumentsHost): void {
        const request = host.switchToHttp().getRequest<Request>();
        const response = host.switchToHttp().getResponse<Response>();
        const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
        const exceptionResponse = exception instanceof HttpException ? exception.getResponse() : undefined;
        const payload = typeof exceptionResponse === 'object' && exceptionResponse !== null
            ? exceptionResponse as Record<string, unknown>
            : undefined;
        const validationMessages = Array.isArray(payload?.message) ? payload.message : undefined;
        const code = typeof payload?.code === 'string' ? payload.code : `HTTP_${status}`;
        const message = typeof payload?.message === 'string'
            ? payload.message
            : status >= 500
                ? '请求处理失败'
                : '请求参数或状态不合法';
        const details = payload?.details ?? validationMessages;
        const requestId = Array.isArray(request.headers['x-request-id'])
            ? request.headers['x-request-id'][0]
            : request.headers['x-request-id'];

        response.status(status).json({
            success: false,
            error: { code, message, details },
            requestId,
        });
    }
}
