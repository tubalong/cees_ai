/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChatMode } from './ChatMode';
export type CreateTurnRequest = {
    /**
     * 本轮 user 消息正文；历史消息与摘要由服务端加载
     */
    content: string;
    mode?: ChatMode;
};

