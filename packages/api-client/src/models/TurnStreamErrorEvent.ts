/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type TurnStreamErrorEvent = {
    type: 'error';
    /**
     * 轮次内递增的事件序号
     */
    seq: number;
    /**
     * 终止本轮的错误信息，结构同 TurnErrorDetail
     */
    error: Record<string, any>;
};

