/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type TurnErrorDetail = {
    /**
     * 稳定错误码
     */
    code: string;
    /**
     * 可安全展示或记录的错误说明
     */
    message: string;
    /**
     * 是否适合由用户主动重试
     */
    retryable: boolean;
};

