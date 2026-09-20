/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type TurnStreamRelatedQuestionsEvent = {
    type: 'related_questions';
    /**
     * 轮次内递增的事件序号；位于 completed 之后
     */
    seq: number;
    /**
     * 基于本轮答复生成的简短追问建议，每个不超过 30 字
     */
    questions: Array<string>;
};

