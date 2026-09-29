/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssistantTaskClarificationOption } from './AssistantTaskClarificationOption';
export type AssistantTaskClarification = {
    /**
     * 待定项标识；确认答复按 key 提交
     */
    key: string;
    question: string;
    options: Array<AssistantTaskClarificationOption>;
    /**
     * 用户答复（所选选项 id）；未答复为 null
     */
    answer?: string | null;
};

