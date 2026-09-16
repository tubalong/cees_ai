/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BossOverviewFinance } from './BossOverviewFinance';
import type { BossOverviewHr } from './BossOverviewHr';
import type { BossOverviewLegal } from './BossOverviewLegal';
import type { BossOverviewTask } from './BossOverviewTask';
export type BossOverview = {
    generatedAt: string;
    periodStart: string;
    periodEnd: string;
    hr: BossOverviewHr;
    finance: BossOverviewFinance;
    legal: BossOverviewLegal;
    task: BossOverviewTask;
};

