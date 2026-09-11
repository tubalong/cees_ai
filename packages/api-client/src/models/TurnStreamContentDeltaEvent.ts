/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type TurnStreamContentDeltaEvent = {
    type: 'content_delta';
    /**
     * 轮次内递增的事件序号
     */
    seq: number;
    /**
     * 本次新增的回答正文片段
     */
    text: string;
};

