/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { UserMemoryType } from './UserMemoryType';
export type UserMemory = {
    id: string;
    type: UserMemoryType;
    /**
     * 记忆正文，一条自包含的关于用户本人的陈述
     */
    content: string;
    version: number;
    createdAt: string;
    updatedAt: string;
};

