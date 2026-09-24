import { PlatformJwtAuthGuard } from '../platform-auth/platform-jwt-auth.guard';
import { PlatformPermissionGuard } from '../platform-auth/platform-permission.guard';
import { AICreditTierController } from './tier.controller';

/**
 * 鉴权边界静态断言：锁定档位接口的守卫挂载与平台权限码细分，
 * 防止后续改动意外拆掉边界（与能力接口相同的平台鉴权体系）。
 */
describe('AICreditTierController 鉴权边界', () => {
    it('类级同时挂载平台 JWT 守卫与平台权限守卫', () => {
        const guards = Reflect.getMetadata('__guards__', AICreditTierController) as Array<Function>;
        expect(guards).toEqual([PlatformJwtAuthGuard, PlatformPermissionGuard]);
    });

    it('读操作要求 platform.aiCredit.read', () => {
        expect(requiredPermissions(AICreditTierController.prototype.listTiers))
            .toEqual(['platform.aiCredit.read']);
        expect(requiredPermissions(AICreditTierController.prototype.getTier))
            .toEqual(['platform.aiCredit.read']);
    });

    it('写操作要求 platform.aiCredit.write', () => {
        expect(requiredPermissions(AICreditTierController.prototype.createTier))
            .toEqual(['platform.aiCredit.write']);
        expect(requiredPermissions(AICreditTierController.prototype.updateTier))
            .toEqual(['platform.aiCredit.write']);
        expect(requiredPermissions(AICreditTierController.prototype.deleteTier))
            .toEqual(['platform.aiCredit.write']);
    });

    it('控制器路径为 platform/ai-credit/tiers', () => {
        const path = Reflect.getMetadata('path', AICreditTierController);
        expect(path).toBe('platform/ai-credit/tiers');
    });
});

function requiredPermissions(target: object): string[] {
    return Reflect.getMetadata('required_platform_permissions', target) ?? [];
}
