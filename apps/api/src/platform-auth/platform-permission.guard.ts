import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

const PLATFORM_PERMISSIONS_KEY = 'required_platform_permissions';

export const RequirePlatformPermissions = (...permissions: string[]): MethodDecorator & ClassDecorator =>
    SetMetadata(PLATFORM_PERMISSIONS_KEY, permissions);

@Injectable()
export class PlatformPermissionGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) { }

    canActivate(context: ExecutionContext): boolean {
        const required = this.reflector.getAllAndOverride<string[]>(PLATFORM_PERMISSIONS_KEY, [
            context.getHandler(),
            context.getClass(),
        ]) ?? [];
        const request = context.switchToHttp().getRequest<{ user?: { permissions?: string[] } }>();
        const granted = new Set(request.user?.permissions ?? []);
        if (!required.every((permission) => granted.has(permission))) {
            throw new ForbiddenException({
                code: 'PLATFORM_PERMISSION_DENIED',
                message: '平台权限不足',
                details: { required },
            });
        }
        return true;
    }
}
