/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { HrLeaveUnit } from './HrLeaveUnit';
export type UpdateHrLeaveTypeRequest = {
    code?: string;
    name?: string;
    unit?: HrLeaveUnit;
    paid?: boolean;
    defaultDays?: number | null;
    enabled?: boolean;
    version: number;
};

