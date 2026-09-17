/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { HrAttendanceStatus } from './HrAttendanceStatus';
export type HrAttendanceRecord = {
    id: string;
    tenantId: string;
    membershipId: string;
    workDate: string;
    checkInAt?: string | null;
    checkOutAt?: string | null;
    status: HrAttendanceStatus;
    source?: HrAttendanceRecord.source;
    note?: string | null;
    reviewedBy?: string | null;
    reviewedAt?: string | null;
    version: number;
    createdAt: string;
    updatedAt: string;
};
export namespace HrAttendanceRecord {
    export enum source {
        MANUAL = 'MANUAL',
        IMPORT = 'IMPORT',
        DINGTALK = 'DINGTALK',
    }
}

