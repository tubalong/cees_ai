/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 当前只公开推理中、回答中或工具执行中阶段，不公开模型原始推理正文
 */
export enum ChatStreamPhase {
    REASONING = 'reasoning',
    ANSWERING = 'answering',
    TOOL_EXECUTING = 'tool_executing',
}
