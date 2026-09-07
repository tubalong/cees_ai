import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

@Injectable()
export class ApiResponseInterceptor<T> implements NestInterceptor<T, { success: true; data: T; requestId?: string }> {
    intercept(context: ExecutionContext, next: CallHandler<T>): Observable<{ success: true; data: T; requestId?: string }> {
        const request = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>();
        const header = request.headers['x-request-id'];
        const requestId = Array.isArray(header) ? header[0] : header;
        return next.handle().pipe(map((data) => ({ success: true, data, requestId })));
    }
}
