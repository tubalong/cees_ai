export interface UserProfileResult {
    userId: string;
    membershipId: string;
    tenantId: string;
    account: string;
    displayName: string;
    department: {
        id: string;
        name: string;
    } | null;
    version: number;
    updatedAt: Date;
}
