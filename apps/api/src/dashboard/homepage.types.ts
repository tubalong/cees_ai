export type DashboardSkeleton = 'EXECUTIVE' | 'MANAGER' | 'EMPLOYEE';
export type DashboardDomain = 'FINANCE' | 'LEGAL' | 'HR' | 'PROJECT';
export type DashboardCardSpan = 'FULL' | 'HALF' | 'THIRD';

export interface DashboardHomepageCard {
    key: string;
    span: DashboardCardSpan;
    payload: unknown;
    link?: string;
    empty?: 'NEW_TENANT' | 'NO_DATA' | null;
}

export interface DashboardHomepageResult {
    archetype: {
        skeleton: DashboardSkeleton;
        domains: DashboardDomain[];
        reason: string[];
    };
    cards: DashboardHomepageCard[];
    alerts: Array<{ code: string; severity: 'HIGH' | 'MEDIUM' | 'LOW'; title: string; detail: string; link?: string }>;
    generatedAt: Date;
}

export interface DashboardTrendPoint {
    periodStart: Date;
    metricKey: string;
    value: string;
    scopeKey: string;
    meta?: unknown;
}

export interface DashboardTrendsResult {
    period: 'DAY' | 'MONTH';
    items: DashboardTrendPoint[];
}