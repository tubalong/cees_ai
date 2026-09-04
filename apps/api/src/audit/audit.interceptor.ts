import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';

export interface AuditEventWriter {
  write(event: Record<string, unknown>): Promise<void>;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly writer: AuditEventWriter) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      method: string; url: string; ip?: string; headers: Record<string, string | undefined>;
      user?: { id: string; tenantId: string };
    }>();
    return next.handle().pipe(tap(() => {
      if (!request.user) return;
      void this.writer.write({
        tenantId: request.user.tenantId,
        actorUserId: request.user.id,
        action: `${request.method} ${request.url}`,
        requestId: request.headers['x-request-id'],
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });
    }));
  }
}