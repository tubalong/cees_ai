import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { DataScopeConstraint } from './access-control';

@Injectable()
export class DataScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ dataScope?: DataScopeConstraint }>();
    if (!request.dataScope) throw new ForbiddenException('Data scope was not resolved');
    return true;
  }
}