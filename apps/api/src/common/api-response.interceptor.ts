import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

@Injectable()
export class ApiResponseInterceptor<T> implements NestInterceptor<T, { success: true; data: T; requestId?: string }> {
    intercept(context: ExecutionContext, next: CallHandler<T>): Observable<{ success: true; data: T; requestId?: string }> {
        const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
        return next.handle().pipe(map((data) => ({ success: true, data, requestId: request.headers['x-request-id'] })));
    }
}