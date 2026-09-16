/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { KnowledgeQueryCitation } from './KnowledgeQueryCitation';
export type KnowledgeQueryResponse = {
    /**
     * 基于证据的答案；证据不足时为空串
     */
    answer: string;
    /**
     * 答案是否由引用支撑；证据不足时恒为 false
     */
    grounded: boolean;
    /**
     * 检索无结果或模型判定证据不足以回答时为 true
     */
    insufficientEvidence: boolean;
    citations: Array<KnowledgeQueryCitation>;
};

