import { PlatformJwtAuthGuard } from '../platform-auth/platform-jwt-auth.guard';
import { PlatformPermissionGuard } from '../platform-auth/platform-permission.guard';
import { AICreditCapabilityController } from './platform-ai-credit.controller';
import { AICreditCapabilityService } from './platform-ai-credit.service';

/**
 * 鉴权边界静态断言（配合 platform-auth.service.spec 的 JWT scope 校验）：
 * 租户令牌在 PlatformJwtAuthGuard 处即被拒绝（401，与平台 JWT 独立密钥/issuer/audience 隔离）；
 * 本测试锁定能力接口的守卫挂载与平台权限码细分，防止后续改动意外拆掉边界。
 */
describe('AICreditCapabilityController 鉴权边界', () => {
    it('类级同时挂载平台 JWT 守卫与平台权限守卫', () => {
        const guards = Reflect.getMetadata('__guards__', AICreditCapabilityController) as Array<Function>;
        expect(guards).toEqual([PlatformJwtAuthGuard, PlatformPermissionGuard]);
    });

    it('读操作要求 platform.aiCredit.read', () => {
        expect(requiredPermissions(AICreditCapabilityController.prototype.listCapabilities))
            .toEqual(['platform.aiCredit.read']);
        expect(requiredPermissions(AICreditCapabilityController.prototype.getCapability))
            .toEqual(['platform.aiCredit.read']);
    });

    it('写操作要求 platform.aiCredit.write', () => {
        expect(requiredPermissions(AICreditCapabilityController.prototype.createCapability))
            .toEqual(['platform.aiCredit.write']);
        expect(requiredPermissions(AICreditCapabilityController.prototype.updateCapability))
            .toEqual(['platform.aiCredit.write']);
        expect(requiredPermissions(AICreditCapabilityController.prototype.deleteCapability))
            .toEqual(['platform.aiCredit.write']);
    });

    it('控制器路径为 platform/ai-credit/capabilities', () => {
        const path = Reflect.getMetadata('path', AICreditCapabilityController);
        expect(path).toBe('platform/ai-credit/capabilities');
        expect(AICreditCapabilityController.prototype).toBeDefined();
        expect(AICreditCapabilityService.prototype).toBeDefined();
    });
});

function requiredPermissions(target: object): string[] {
    return Reflect.getMetadata('required_platform_permissions', target) ?? [];
}
