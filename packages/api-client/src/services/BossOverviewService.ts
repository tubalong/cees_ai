/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BossOverviewResponseEnvelope } from '../models/BossOverviewResponseEnvelope';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class BossOverviewService {
    /**
     * 生成老板经营概况草稿
     * @returns BossOverviewResponseEnvelope 老板经营概况
     * @throws ApiError
     */
    public static getBossOverview(): CancelablePromise<BossOverviewResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/boss-overview',
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 dashboard.read 权限`,
            },
        });
    }
}
