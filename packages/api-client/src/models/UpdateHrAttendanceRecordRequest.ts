/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { HrAttendanceStatus } from './HrAttendanceStatus';
export type UpdateHrAttendanceRecordRequest = {
    checkInAt?: string | null;
    checkOutAt?: string | null;
    status?: HrAttendanceStatus;
    note?: string | null;
    version: number;
};

