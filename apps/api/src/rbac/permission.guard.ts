import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const PERMISSIONS_KEY = 'required_permissions';
export const RequirePermissions = (...permissions: string[]): MethodDecorator & ClassDecorator =>
    SetMetadata(PERMISSIONS_KEY, permissions);

@Injectable()
export class PermissionGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) { }

    canActivate(context: ExecutionContext): boolean {
        const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]) ?? [];
        const request = context.switchToHttp().getRequest<{ user?: { permissions?: string[] } }>();
        const granted = new Set(request.user?.permissions ?? []);
        if (!required.every((permission) => granted.has(permission))) throw new ForbiddenException('Permission denied');
        return true;
    }
}