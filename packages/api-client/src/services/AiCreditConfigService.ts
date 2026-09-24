/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AICreditBillingConfigResponseEnvelope } from '../models/AICreditBillingConfigResponseEnvelope';
import type { AICreditBillingConfigUpdateRequest } from '../models/AICreditBillingConfigUpdateRequest';
import type { AICreditBoosterTierCreateRequest } from '../models/AICreditBoosterTierCreateRequest';
import type { AICreditBoosterTierListResponseEnvelope } from '../models/AICreditBoosterTierListResponseEnvelope';
import type { AICreditBoosterTierResponseEnvelope } from '../models/AICreditBoosterTierResponseEnvelope';
import type { AICreditBoosterTierUpdateRequest } from '../models/AICreditBoosterTierUpdateRequest';
import type { AICreditCapabilityCreateRequest } from '../models/AICreditCapabilityCreateRequest';
import type { AICreditCapabilityListResponseEnvelope } from '../models/AICreditCapabilityListResponseEnvelope';
import type { AICreditCapabilityResponseEnvelope } from '../models/AICreditCapabilityResponseEnvelope';
import type { AICreditCapabilityUpdateRequest } from '../models/AICreditCapabilityUpdateRequest';
import type { AICreditRateCardCreateRequest } from '../models/AICreditRateCardCreateRequest';
import type { AICreditRateCardListResponseEnvelope } from '../models/AICreditRateCardListResponseEnvelope';
import type { AICreditRateCardResponseEnvelope } from '../models/AICreditRateCardResponseEnvelope';
import type { AICreditRateCardUpdateRequest } from '../models/AICreditRateCardUpdateRequest';
import type { AICreditTierCreateRequest } from '../models/AICreditTierCreateRequest';
import type { AICreditTierListResponseEnvelope } from '../models/AICreditTierListResponseEnvelope';
import type { AICreditTierResponseEnvelope } from '../models/AICreditTierResponseEnvelope';
import type { AICreditTierUpdateRequest } from '../models/AICreditTierUpdateRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class AiCreditConfigService {
    /**
     * 查询 AI 计费能力目录
     * 返回全部未删除的能力（按 sortOrder 升序），供超级管理员后台维护档位功能集与费率表。
     *
     * @returns AICreditCapabilityListResponseEnvelope 能力目录列表
     * @throws ApiError
     */
    public static aiCreditCapabilityList(): CancelablePromise<AICreditCapabilityListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/platform/ai-credit/capabilities',
            errors: {
                403: `平台权限不足`,
            },
        });
    }
    /**
     * 创建 AI 计费能力
     * 注册新的可计费能力。meterType / capabilityKind / sortOrder 省略时使用默认值
     * （TOKEN / TIER_GATED / 0）；permissionCode 映射现有权限码，通用能力可留空。
     *
     * @returns AICreditCapabilityResponseEnvelope 创建成功的能力
     * @throws ApiError
     */
    public static aiCreditCapabilityCreate({
        requestBody,
    }: {
        requestBody: AICreditCapabilityCreateRequest,
    }): CancelablePromise<AICreditCapabilityResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/platform/ai-credit/capabilities',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                403: `平台权限不足`,
                409: `code 已被现有能力占用`,
            },
        });
    }
    /**
     * 获取 AI 计费能力详情
     * @returns AICreditCapabilityResponseEnvelope 能力详情
     * @throws ApiError
     */
    public static aiCreditCapabilityGet({
        capabilityId,
    }: {
        capabilityId: string,
    }): CancelablePromise<AICreditCapabilityResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/platform/ai-credit/capabilities/{capabilityId}',
            path: {
                'capabilityId': capabilityId,
            },
            errors: {
                403: `平台权限不足`,
                404: `能力不存在或已删除`,
            },
        });
    }
    /**
     * 修改 AI 计费能力
     * 修改能力资料。code 修改后部分唯一索引仍保证未删除记录不冲突；
     * permissionCode 变更不影响已授权成员的历史权限。
     *
     * @returns AICreditCapabilityResponseEnvelope 修改后的能力
     * @throws ApiError
     */
    public static aiCreditCapabilityUpdate({
        capabilityId,
        requestBody,
    }: {
        capabilityId: string,
        requestBody: AICreditCapabilityUpdateRequest,
    }): CancelablePromise<AICreditCapabilityResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/platform/ai-credit/capabilities/{capabilityId}',
            path: {
                'capabilityId': capabilityId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                403: `平台权限不足`,
                404: `能力不存在或已删除`,
                409: `code 已被现有能力占用，或乐观锁版本冲突`,
            },
        });
    }
    /**
     * 删除 AI 计费能力（软删除）
     * 软删除能力。被档位功能集或费率表引用的能力不可删除，需先移除引用。
     *
     * @returns void
     * @throws ApiError
     */
    public static aiCreditCapabilityDelete({
        capabilityId,
    }: {
        capabilityId: string,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/platform/ai-credit/capabilities/{capabilityId}',
            path: {
                'capabilityId': capabilityId,
            },
            errors: {
                403: `平台权限不足`,
                404: `能力不存在或已删除`,
                409: `能力仍被档位功能集或费率表引用`,
            },
        });
    }
    /**
     * 查询 AI 计费档位列表
     * 返回全部未删除的档位，含功能集（capabilityCodes）与各持续时间的价格。
     *
     * @returns AICreditTierListResponseEnvelope 档位列表
     * @throws ApiError
     */
    public static aiCreditTierList(): CancelablePromise<AICreditTierListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/platform/ai-credit/tiers',
            errors: {
                403: `平台权限不足`,
            },
        });
    }
    /**
     * 创建 AI 计费档位
     * 创建档位：功能集（功能开关类能力 code 列表）、每订阅单位基础额度、
     * 各持续时间档位价格与单位单价。code 兼作档位权限码，创建后不可修改。
     *
     * @returns AICreditTierResponseEnvelope 创建成功的档位
     * @throws ApiError
     */
    public static aiCreditTierCreate({
        requestBody,
    }: {
        requestBody: AICreditTierCreateRequest,
    }): CancelablePromise<AICreditTierResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/platform/ai-credit/tiers',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                403: `平台权限不足`,
                409: `code 已被现有档位占用`,
            },
        });
    }
    /**
     * 获取 AI 计费档位详情
     * @returns AICreditTierResponseEnvelope 档位详情
     * @throws ApiError
     */
    public static aiCreditTierGet({
        tierId,
    }: {
        tierId: string,
    }): CancelablePromise<AICreditTierResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/platform/ai-credit/tiers/{tierId}',
            path: {
                'tierId': tierId,
            },
            errors: {
                403: `平台权限不足`,
                404: `档位不存在或已删除`,
            },
        });
    }
    /**
     * 修改 AI 计费档位
     * 修改档位资料、基础额度、状态、功能集或价格。prices / capabilityCodes
     * 传入时整体替换对应子集；code 创建后不可修改。
     *
     * @returns AICreditTierResponseEnvelope 修改后的档位
     * @throws ApiError
     */
    public static aiCreditTierUpdate({
        tierId,
        requestBody,
    }: {
        tierId: string,
        requestBody: AICreditTierUpdateRequest,
    }): CancelablePromise<AICreditTierResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/platform/ai-credit/tiers/{tierId}',
            path: {
                'tierId': tierId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                403: `平台权限不足`,
                404: `档位不存在或已删除`,
                409: `乐观锁版本冲突`,
            },
        });
    }
    /**
     * 删除 AI 计费档位（软删除）
     * @returns void
     * @throws ApiError
     */
    public static aiCreditTierDelete({
        tierId,
    }: {
        tierId: string,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/platform/ai-credit/tiers/{tierId}',
            path: {
                'tierId': tierId,
            },
            errors: {
                403: `平台权限不足`,
                404: `档位不存在或已删除`,
            },
        });
    }
    /**
     * 查询 AI 计费费率表
     * 默认返回每个 能力 × 模型组 × 计量维度 的当前版本行（含 INACTIVE 状态行，便于后台显示已停用）。
     * includeHistory=true 时返回全部历史版本行（调价不追溯历史账目，历史行仅作审计展示）。
     *
     * @returns AICreditRateCardListResponseEnvelope 费率列表
     * @throws ApiError
     */
    public static aiCreditRateCardList({
        includeHistory = false,
    }: {
        includeHistory?: boolean,
    }): CancelablePromise<AICreditRateCardListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/platform/ai-credit/rate-cards',
            query: {
                'includeHistory': includeHistory,
            },
            errors: {
                403: `平台权限不足`,
            },
        });
    }
    /**
     * 创建 AI 计费费率行
     * 为 能力 × 模型组 × 计量维度 创建首个费率版本行。TOKEN_INPUT / TOKEN_OUTPUT 维度
     * 填写 tokenMultiplier 与 creditPerToken；PER_REQUEST 维度填写 perRequestCredits。
     * 同一组合已存在未删除行时返回 409。
     *
     * @returns AICreditRateCardResponseEnvelope 创建成功的费率行
     * @throws ApiError
     */
    public static aiCreditRateCardCreate({
        requestBody,
    }: {
        requestBody: AICreditRateCardCreateRequest,
    }): CancelablePromise<AICreditRateCardResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/platform/ai-credit/rate-cards',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                403: `平台权限不足`,
                409: `同一能力 × 模型组 × 计量维度已存在费率行`,
            },
        });
    }
    /**
     * 获取 AI 计费费率行详情
     * @returns AICreditRateCardResponseEnvelope 费率行详情
     * @throws ApiError
     */
    public static aiCreditRateCardGet({
        rateCardId,
    }: {
        rateCardId: string,
    }): CancelablePromise<AICreditRateCardResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/platform/ai-credit/rate-cards/{rateCardId}',
            path: {
                'rateCardId': rateCardId,
            },
            errors: {
                403: `平台权限不足`,
                404: `费率行不存在或已删除`,
            },
        });
    }
    /**
     * 修改 AI 计费费率行（调价版本化）
     * 修改费率。计量字段（tokenMultiplier / creditPerToken / perRequestCredits）任一变更时，
     * 服务端插入新版本行（rateVersion + 1），原行保留为历史、不追溯历史账目；
     * 仅修改 status 时更新原行。
     *
     * @returns AICreditRateCardResponseEnvelope 修改后（或新版本）的费率行
     * @throws ApiError
     */
    public static aiCreditRateCardUpdate({
        rateCardId,
        requestBody,
    }: {
        rateCardId: string,
        requestBody: AICreditRateCardUpdateRequest,
    }): CancelablePromise<AICreditRateCardResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/platform/ai-credit/rate-cards/{rateCardId}',
            path: {
                'rateCardId': rateCardId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                403: `平台权限不足`,
                404: `费率行不存在或已删除`,
                409: `乐观锁版本冲突`,
            },
        });
    }
    /**
     * 查询 AI 计费加油包档位列表
     * 返回全部未删除的加油包档位。加油包永久有效，只零售（买多个单价相同）。
     *
     * @returns AICreditBoosterTierListResponseEnvelope 加油包档位列表
     * @throws ApiError
     */
    public static aiCreditBoosterTierList(): CancelablePromise<AICreditBoosterTierListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/platform/ai-credit/booster-tiers',
            errors: {
                403: `平台权限不足`,
            },
        });
    }
    /**
     * 创建 AI 计费加油包档位
     * @returns AICreditBoosterTierResponseEnvelope 创建成功的加油包档位
     * @throws ApiError
     */
    public static aiCreditBoosterTierCreate({
        requestBody,
    }: {
        requestBody: AICreditBoosterTierCreateRequest,
    }): CancelablePromise<AICreditBoosterTierResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/platform/ai-credit/booster-tiers',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                403: `平台权限不足`,
            },
        });
    }
    /**
     * 获取 AI 计费加油包档位详情
     * @returns AICreditBoosterTierResponseEnvelope 加油包档位详情
     * @throws ApiError
     */
    public static aiCreditBoosterTierGet({
        boosterTierId,
    }: {
        boosterTierId: string,
    }): CancelablePromise<AICreditBoosterTierResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/platform/ai-credit/booster-tiers/{boosterTierId}',
            path: {
                'boosterTierId': boosterTierId,
            },
            errors: {
                403: `平台权限不足`,
                404: `加油包档位不存在或已删除`,
            },
        });
    }
    /**
     * 修改 AI 计费加油包档位
     * @returns AICreditBoosterTierResponseEnvelope 修改后的加油包档位
     * @throws ApiError
     */
    public static aiCreditBoosterTierUpdate({
        boosterTierId,
        requestBody,
    }: {
        boosterTierId: string,
        requestBody: AICreditBoosterTierUpdateRequest,
    }): CancelablePromise<AICreditBoosterTierResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/platform/ai-credit/booster-tiers/{boosterTierId}',
            path: {
                'boosterTierId': boosterTierId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                403: `平台权限不足`,
                404: `加油包档位不存在或已删除`,
                409: `乐观锁版本冲突`,
            },
        });
    }
    /**
     * 删除 AI 计费加油包档位（软删除）
     * @returns void
     * @throws ApiError
     */
    public static aiCreditBoosterTierDelete({
        boosterTierId,
    }: {
        boosterTierId: string,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/platform/ai-credit/booster-tiers/{boosterTierId}',
            path: {
                'boosterTierId': boosterTierId,
            },
            errors: {
                403: `平台权限不足`,
                404: `加油包档位不存在或已删除`,
            },
        });
    }
    /**
     * 获取全局 AI 计费配置
     * 全局计费配置为单行资源：最小计量单位、每月重置日与企业本地时区模式、
     * 未配置费率拒绝开关、订阅持续时间选项、半年/一年折扣、订阅单位上限。
     *
     * @returns AICreditBillingConfigResponseEnvelope 全局计费配置
     * @throws ApiError
     */
    public static aiCreditBillingConfigGet(): CancelablePromise<AICreditBillingConfigResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/platform/ai-credit/billing-config',
            errors: {
                403: `平台权限不足`,
            },
        });
    }
    /**
     * 修改全局 AI 计费配置
     * 修改全局计费配置（订阅参数与重置/拒绝策略均在此资源）。
     * subscriptionDurations 传入时整体替换；未配置费率的调用按 rejectUnconfiguredRate 拒绝。
     *
     * @returns AICreditBillingConfigResponseEnvelope 修改后的全局计费配置
     * @throws ApiError
     */
    public static aiCreditBillingConfigUpdate({
        requestBody,
    }: {
        requestBody: AICreditBillingConfigUpdateRequest,
    }): CancelablePromise<AICreditBillingConfigResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/platform/ai-credit/billing-config',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                403: `平台权限不足`,
                409: `乐观锁版本冲突`,
            },
        });
    }
}
