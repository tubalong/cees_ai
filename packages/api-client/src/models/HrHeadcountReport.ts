/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type HrHeadcountReport = {
    asOf: string;
    total: number;
    byDepartment: Array<{
        departmentId: string;
        departmentName: string;
        headcount: number;
    }>;
};

