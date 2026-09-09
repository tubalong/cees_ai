/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CreateUploadSessionRequest } from '../models/CreateUploadSessionRequest';
import type { FileMetadataResponseEnvelope } from '../models/FileMetadataResponseEnvelope';
import type { UploadSessionResponseEnvelope } from '../models/UploadSessionResponseEnvelope';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class FileService {
    /**
     * 创建单文件 COS 直传会话
     * 为当前登录成员生成仅绑定单一 COS 对象键的短时 PUT URL。对象键由服务端按照 cees/{environment}/tenants/{tenantId}/files/{yyyy}/{mm}/{fileId}/source 生成， 客户端不得指定租户、Bucket 或对象键。
     * @returns UploadSessionResponseEnvelope 已创建上传会话并签发短时 PUT URL
     * @throws ApiError
     */
    public static fileCreateUploadSession({
        idempotencyKey,
        requestBody,
    }: {
        /**
         * 同一成员重试同一请求时复用的幂等键
         */
        idempotencyKey: string,
        requestBody: CreateUploadSessionRequest,
    }): CancelablePromise<UploadSessionResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/upload-sessions',
            headers: {
                'Idempotency-Key': idempotencyKey,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段、文件类型或幂等键无效`,
                401: `登录状态无效或已过期`,
                409: `幂等键已用于不同请求或对应会话已不可继续上传`,
                410: `幂等键对应的待上传会话已经过期`,
                413: `文件超过当前技术上限`,
                502: `COS 上传地址签发失败`,
            },
        });
    }
    /**
     * 校验并完成 COS 直传会话
     * 向 COS 发起 HEAD 请求校验对象存在、大小和 Content-Type，校验通过后创建正式文件记录。 客户端调用本接口不代表服务端会信任客户端声明的上传结果。
     * @returns FileMetadataResponseEnvelope 上传对象校验通过并已登记为正式文件
     * @throws ApiError
     */
    public static fileCompleteUploadSession({
        uploadSessionId,
    }: {
        uploadSessionId: string,
    }): CancelablePromise<FileMetadataResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/upload-sessions/{uploadSessionId}/complete',
            path: {
                'uploadSessionId': uploadSessionId,
            },
            errors: {
                400: `上传会话 ID 不是有效 UUID`,
                401: `登录状态无效或已过期`,
                404: `当前成员的上传会话不存在`,
                409: `COS 对象不存在、元数据不匹配或会话状态冲突`,
                410: `上传会话已过期`,
                502: `COS 暂时不可用或返回无效响应`,
            },
        });
    }
}
