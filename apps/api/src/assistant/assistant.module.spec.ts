import { DatabaseModule } from '../database/database.module';
import { RbacModule } from '../rbac/rbac.module';
import { RedisModule } from '../redis/redis.module';
import { TenantModule } from '../tenant/tenant.module';
import { AssistantModule } from './assistant.module';

/**
 * 应用内所有 @Global() 模块。
 *
 * 全局模块不需要写进 imports 就能被注入，因此必须显式纳入可解析集合，
 * 否则本守卫会产生误报。新增全局模块时同步补充这里。
 */
const GLOBAL_MODULES: ModuleType[] = [DatabaseModule, RbacModule, RedisModule, TenantModule];

type ModuleType = new (...args: never[]) => unknown;

/**
 * 模块装配守卫。
 *
 * `nest build` 只做类型检查，不做依赖注入解析；控制器少注册一个 provider
 * 时编译与单测都可能通过，直到运行时 `Nest can't resolve dependencies` 才炸。
 * 该问题在合并 PR 时被 squash 覆盖过一次，因此这里用反射对装配做静态校验：
 * 模块内每个控制器与 provider 的构造参数，都必须能在本模块的 providers
 * 或其 imports 的 exports 中找到。
 */
function metadataOf<T>(moduleType: ModuleType, key: 'controllers' | 'providers' | 'imports' | 'exports'): T[] {
    return (Reflect.getMetadata(key, moduleType) ?? []) as T[];
}

/** 从 provider/export 条目中取出可注入的类；令牌对象返回 undefined。 */
function classOf(entry: unknown): ModuleType | undefined {
    if (typeof entry !== 'function') return undefined;
    return entry as ModuleType;
}

/** 是否是 Nest 模块（带 providers 元数据的类）。 */
function isNestModule(value: unknown): value is ModuleType {
    return typeof value === 'function' && Array.isArray(Reflect.getMetadata('providers', value));
}

/** 递归收集本模块 providers 与 imports 的 exports，得到可解析的注入目标。 */
function collectResolvable(moduleType: ModuleType, visited = new Set<ModuleType>()): Set<unknown> {
    if (visited.has(moduleType)) return new Set();
    visited.add(moduleType);

    const resolvable = new Set<unknown>();
    for (const provider of metadataOf<unknown>(moduleType, 'providers')) {
        resolvable.add(classOf(provider) ?? provider);
    }
    for (const entry of metadataOf<unknown>(moduleType, 'exports')) {
        // exports 既可以是 provider，也可以是（重）导出的模块。
        if (isNestModule(entry)) {
            for (const value of collectResolvable(entry, visited)) resolvable.add(value);
            for (const provider of metadataOf<unknown>(entry, 'providers')) {
                resolvable.add(classOf(provider) ?? provider);
            }
            continue;
        }
        resolvable.add(classOf(entry) ?? entry);
    }
    for (const imported of metadataOf<ModuleType>(moduleType, 'imports')) {
        if (!isNestModule(imported)) continue;
        for (const value of collectResolvable(imported, visited)) resolvable.add(value);
    }
    return resolvable;
}

function injectionTargetsOf(target: ModuleType): ModuleType[] {
    const paramTypes = (Reflect.getMetadata('design:paramtypes', target) ?? []) as unknown[];
    // TypeScript 对接口、类型别名与 `object` 只会发出 `Object`，这类依赖走
    // @Inject(TOKEN) 注入，无法据此静态判断，因此跳过而不是误报。
    return paramTypes.filter(
        (type): type is ModuleType => typeof type === 'function' && type !== Object,
    );
}

describe('AssistantModule 依赖装配', () => {
    const resolvable = collectResolvable(AssistantModule);
    for (const globalModule of GLOBAL_MODULES) {
        for (const entry of metadataOf<unknown>(globalModule, 'exports')) {
            resolvable.add(classOf(entry) ?? entry);
        }
    }

    it('模块自身的 providers 与 controllers 均可解析', () => {
        expect(metadataOf<unknown>(AssistantModule, 'providers').length).toBeGreaterThan(0);
        expect(metadataOf<unknown>(AssistantModule, 'controllers').length).toBeGreaterThan(0);
    });

    it.each(metadataOf<ModuleType>(AssistantModule, 'controllers'))(
        '控制器 %p 的构造依赖已注册',
        (controller) => {
            const missing = injectionTargetsOf(controller).filter((type) => !resolvable.has(type));
            expect(missing.map((type) => type.name)).toEqual([]);
        },
    );

    it.each(metadataOf<ModuleType>(AssistantModule, 'providers'))(
        'provider %p 的构造依赖已注册',
        (provider) => {
            const missing = injectionTargetsOf(provider).filter((type) => !resolvable.has(type));
            expect(missing.map((type) => type.name)).toEqual([]);
        },
    );
});
