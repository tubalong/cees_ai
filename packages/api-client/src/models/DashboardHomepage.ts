/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DashboardHomepageCard } from './DashboardHomepageCard';
import type { DashboardHomepageDomain } from './DashboardHomepageDomain';
import type { DashboardHomepageSkeleton } from './DashboardHomepageSkeleton';
export type DashboardHomepage = {
    archetype: {
        skeleton: DashboardHomepageSkeleton;
        domains: Array<DashboardHomepageDomain>;
        reason: Array<string>;
    };
    cards: Array<DashboardHomepageCard>;
    alerts: Array<{
        code: string;
        severity: 'HIGH' | 'MEDIUM' | 'LOW';
        title: string;
        detail: string;
        link?: string | null;
    }>;
    generatedAt: string;
};

