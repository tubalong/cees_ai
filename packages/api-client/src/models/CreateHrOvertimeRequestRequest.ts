/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type CreateHrOvertimeRequestRequest = {
    startAt: string;
    endAt: string;
    /**
     * 客户端一致性校验值；正式时长由服务端按起止时间折算
     */
    durationHours: number;
    reason: string;
};

