/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { UserMemoryType } from './UserMemoryType';
export type UpdateUserMemoryRequest = {
    /**
     * 记忆正文；与 type 至少提供一个
     */
    content?: string;
    /**
     * 记忆类型；与 content 至少提供一个
     */
    type?: UserMemoryType;
    version: number;
};

