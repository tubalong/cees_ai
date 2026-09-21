/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DashboardTrendPoint } from './DashboardTrendPoint';
export type DashboardTrends = {
    period: DashboardTrends.period;
    items: Array<DashboardTrendPoint>;
};
export namespace DashboardTrends {
    export enum period {
        DAY = 'DAY',
        MONTH = 'MONTH',
    }
}

