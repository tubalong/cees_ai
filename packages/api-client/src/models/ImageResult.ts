/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type ImageResult = {
    /**
     * 图片资源 ID
     */
    id: string;
    /**
     * 统一资源 ID
     */
    resourceId: string;
    mimeType: ImageResult.mimeType;
    /**
     * 图片二进制大小
     */
    sizeBytes: number;
    /**
     * 短期访问 URL
     */
    url: string;
    /**
     * 生成该图片的原始提示词
     */
    prompt?: string | null;
    /**
     * 实际生成图片的模型名
     */
    model?: string | null;
    /**
     * 图片资源创建时间
     */
    createdAt: string;
};
export namespace ImageResult {
    export enum mimeType {
        IMAGE_PNG = 'image/png',
        IMAGE_JPEG = 'image/jpeg',
        IMAGE_WEBP = 'image/webp',
    }
}

