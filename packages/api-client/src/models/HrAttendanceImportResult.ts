/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type HrAttendanceImportResult = {
    total: number;
    imported: number;
    failed: number;
    failures: Array<{
        index: number;
        code: string;
        message: string;
    }>;
};

