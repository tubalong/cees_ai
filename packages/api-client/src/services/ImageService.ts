/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ImageResponseEnvelope } from '../models/ImageResponseEnvelope';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class ImageService {
    /**
     * 获取 AI 生成图片的访问信息
     * 返回当前租户内授权图片的元数据与短期访问 URL。
     * @returns ImageResponseEnvelope 图片访问信息
     * @throws ApiError
     */
    public static getImage({
        imageId,
    }: {
        /**
         * 图片资源 ID
         */
        imageId: string,
    }): CancelablePromise<ImageResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/images/{imageId}',
            path: {
                'imageId': imageId,
            },
            errors: {
                401: `登录状态无效、已过期或缺少有效租户成员身份`,
                403: `缺少 image.read 权限或图片不在授权范围内`,
                404: `图片不存在或已被删除`,
            },
        });
    }
}
