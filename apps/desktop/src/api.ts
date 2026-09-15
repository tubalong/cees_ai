// export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://132.232.159.186:3000/api/';
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://192.168.5.29:3000/api/';
// http://192.168.5.29:3000/api/
// http://132.232.159.186:3000/api/
const ACCESS_TOKEN_KEY = 'cees.accessToken';
const REFRESH_TOKEN_KEY = 'cees.refreshToken';
const PLATFORM_ACCESS_TOKEN_KEY = 'cees.platformAccessToken';
const PLATFORM_REFRESH_TOKEN_KEY = 'cees.platformRefreshToken';

export interface LoginInput {
    tenantCode: string;
    account: string;
    password: string;
}

export interface TokenPair {
    accessToken: string;
    accessTokenExpiresIn: number;
    refreshToken: string;
    refreshTokenExpiresIn: number;
}

export interface AuthContext {
    user: { id: string; displayName: string };
    tenant: { id: string; code: string; name: string };
    membership: {
        id: string;
        account: string;
        status: 'ACTIVE';
        roles: string[];
    };
}

export interface LoginResult extends TokenPair, AuthContext { }

export interface MeResult extends AuthContext {
    permissions: string[];
}

export interface PlatformLoginInput {
    account: string;
    password: string;
}

export interface PlatformAdministrator {
    id: string;
    account: string;
    user: { id: string; displayName: string };
    role: 'SUPER_ADMIN';
    permissions: string[];
}

export interface PlatformLoginResult extends TokenPair {
    administrator: PlatformAdministrator;
}

export interface PlatformMeResult {
    administrator: PlatformAdministrator;
}

export interface PlatformTenant {
    id: string;
    code: string;
    name: string;
    status: 'PENDING_ACTIVATION' | 'ACTIVE' | 'SUSPENDED';
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
    version: number;
    activeAdministratorCount: number;
    pendingInvitationCount: number;
}

export interface CreatePlatformTenantInput {
    code: string;
    name: string;
    initialAdministrator: {
        account?: string;
        displayName: string;
    };
}

export interface PlatformTenantAdministrator {
    id?: string;
    membershipId?: string;
    account: string;
    displayName?: string;
    user?: { id?: string; displayName?: string };
    status?: string;
    joinedAt?: string;
}

export interface AssignPlatformTenantAdministratorInput {
    account: string;
    displayName?: string;
}

export interface TenantPermission {
    id: string;
    code: string;
    name: string;
}

export type DataScope = 'SELF' | 'DEPARTMENT' | 'DEPARTMENT_TREE' | 'PROJECT' | 'CUSTOM' | 'TENANT';

export interface TenantRole {
    id: string;
    code: string;
    name: string;
    description?: string | null;
    isSystem: boolean;
    dataScope: DataScope;
    permissions: TenantPermission[];
    memberCount: number;
    version: number;
    createdAt?: string;
    updatedAt?: string;
}

export interface CreateRoleInput {
    code: string;
    name: string;
    description?: string | null;
    dataScope: DataScope;
}

export interface UpdateRoleInput {
    name?: string;
    description?: string | null;
    dataScope?: DataScope;
    version: number;
}

export interface TenantInvitation {
    id: string;
    account: string;
    displayName: string;
    status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
    isInitialAdministrator: boolean;
    expiresAt: string;
    acceptedAt?: string | null;
    revokedAt?: string | null;
    roles?: TenantRole[];
    createdAt: string;
}

export interface CreateTenantInvitationInput {
    account?: string;
    displayName: string;
    roleIds: string[];
}

export interface AccountSuggestionResult {
    account?: string;
    suggestedAccount?: string;
    alternatives?: string[];
    suggestions?: string[];
}

export interface ActivateTenantInvitationInput {
    tenantCode: string;
    account: string;
    invitationToken: string;
    password: string;
}

export interface TenantMember {
    id: string;
    account: string;
    user: { id: string; displayName: string };
    departmentId: string | null;
    status: 'PENDING_ACTIVATION' | 'ACTIVE' | 'DISABLED';
    roles: Array<{ id: string; code: string; name: string }>;
    joinedAt: string;
    version: number;
}

export type DepartmentStatus = 'ACTIVE' | 'DISABLED';

export interface DepartmentNode {
    id: string;
    name: string;
    parentId: string | null;
    status: DepartmentStatus;
    memberCount?: number;
    children: DepartmentNode[];
    createdAt?: string;
    updatedAt?: string;
    version: number;
}

export interface CreateDepartmentInput {
    name: string;
    parentId?: string;
}

export interface UpdateDepartmentInput {
    name?: string;
    parentId?: string | null;
    status?: DepartmentStatus;
    version: number;
}

export interface AssignMemberDepartmentInput {
    departmentId: string;
    version: number;
}

export interface UserProfile {
    userId: string;
    membershipId: string;
    tenantId: string;
    account: string;
    displayName: string;
    department: { id: string; name: string } | null;
    version: number;
    updatedAt: string;
}

export interface UpdateUserProfileInput {
    displayName: string;
    version: number;
}

export interface ChangePasswordInput {
    currentPassword: string;
    newPassword: string;
}

export interface ManagedDocumentSummary {
    id: string;
    title: string;
    visibility: 'PRIVATE' | 'TENANT';
    ownerMembershipId?: string;
    owner?: { id?: string; displayName?: string };
    currentPermissions?: string[];
    createdAt: string;
    updatedAt: string;
    version: number;
}

export interface ManagedDocumentDetail extends ManagedDocumentSummary {
    resourceId: string;
    content: string;
    effectivePermissions: string[];
}

interface CursorPage<T> {
    items: T[];
    nextCursor: string | null;
}

interface ApiSuccess<T> {
    success: true;
    data: T;
    requestId?: string;
}

interface ApiErrorBody {
    message?: string | string[];
    error?: { code?: string; message?: string; details?: unknown };
}

let refreshPromise: Promise<TokenPair> | undefined;
let platformRefreshPromise: Promise<TokenPair> | undefined;

export function hasStoredSession(): boolean {
    return Boolean(getStoredValue(ACCESS_TOKEN_KEY) && getStoredValue(REFRESH_TOKEN_KEY));
}

export function persistLogin(result: LoginResult, remember: boolean): void {
    clearPlatformSession();
    const storage = remember ? localStorage : sessionStorage;
    const otherStorage = remember ? sessionStorage : localStorage;
    clearStorage(otherStorage);
    storage.setItem(ACCESS_TOKEN_KEY, result.accessToken);
    storage.setItem(REFRESH_TOKEN_KEY, result.refreshToken);
}

export function clearSession(): void {
    clearStorage(localStorage);
    clearStorage(sessionStorage);
}

export async function login(input: LoginInput): Promise<LoginResult> {
    return publicRequest<LoginResult>('v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({
            tenantCode: input.tenantCode.trim(),
            account: input.account.trim().toLowerCase(),
            password: input.password,
            deviceName: 'CEES AI Desktop',
        }),
    });
}

export async function getMe(): Promise<MeResult> {
    return authorizedRequest<MeResult>('v1/auth/me');
}

export async function getUserProfile(): Promise<UserProfile> {
    return authorizedRequest<UserProfile>('v1/users/me/profile');
}

export async function updateUserProfile(input: UpdateUserProfileInput): Promise<UserProfile> {
    return authorizedRequest<UserProfile>('v1/users/me/profile', {
        method: 'PATCH',
        body: JSON.stringify({ displayName: input.displayName.trim(), version: input.version }),
    });
}

export async function changePassword(input: ChangePasswordInput): Promise<void> {
    return authorizedRequest<void>('v1/auth/change-password', {
        method: 'POST',
        body: JSON.stringify(input),
    });
}

export async function logout(): Promise<void> {
    try {
        await authorizedRequest<void>('v1/auth/logout', { method: 'POST' });
    } finally {
        clearSession();
    }
}

export async function listTenantMembers(keyword?: string): Promise<CursorPage<TenantMember>> {
    const query = new URLSearchParams({ limit: '100' });
    if (keyword?.trim()) query.set('keyword', keyword.trim());
    return authorizedRequest<CursorPage<TenantMember>>(`v1/tenants/current/members?${query}`);
}

export async function listDocuments(keyword?: string): Promise<CursorPage<ManagedDocumentSummary>> {
    const query = new URLSearchParams({ limit: '100' });
    if (keyword?.trim()) query.set('keyword', keyword.trim());
    return authorizedRequest<CursorPage<ManagedDocumentSummary>>(`v1/documents?${query}`);
}

export async function getDocument(documentId: string): Promise<ManagedDocumentDetail> {
    return authorizedRequest<ManagedDocumentDetail>(`v1/documents/${encodeURIComponent(documentId)}`);
}

async function authorizedRequest<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const accessToken = getStoredValue(ACCESS_TOKEN_KEY);
    if (!accessToken) throw new Error('登录状态已失效，请重新登录');
    const response = await fetch(new URL(path, API_BASE_URL), {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
            ...init.headers,
        },
    });
    if (response.status === 401 && retry) {
        await refreshTokens();
        return authorizedRequest<T>(path, init, false);
    }
    return readResponse<T>(response);
}

async function publicRequest<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(new URL(path, API_BASE_URL), {
        ...init,
        headers: { 'Content-Type': 'application/json', ...init.headers },
    });
    return readResponse<T>(response);
}

async function refreshTokens(): Promise<TokenPair> {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
        const refreshToken = getStoredValue(REFRESH_TOKEN_KEY);
        if (!refreshToken) throw new Error('登录状态已失效，请重新登录');
        try {
            const tokens = await publicRequest<TokenPair>('v1/auth/refresh', {
                method: 'POST',
                body: JSON.stringify({ refreshToken }),
            });
            const storage = getSessionStorage();
            storage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
            storage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
            return tokens;
        } catch (error) {
            clearSession();
            throw error;
        }
    })();
    try {
        return await refreshPromise;
    } finally {
        refreshPromise = undefined;
    }
}

async function readResponse<T>(response: Response): Promise<T> {
    if (response.status === 204) return undefined as T;
    const body = await readBody(response);
    if (!response.ok) throw new Error(getErrorMessage(body));
    return (body as ApiSuccess<T>).data;
}

async function readBody(response: Response): Promise<ApiSuccess<unknown> | ApiErrorBody | undefined> {
    try {
        return await response.json() as ApiSuccess<unknown> | ApiErrorBody;
    } catch {
        return undefined;
    }
}

function getErrorMessage(body: ApiSuccess<unknown> | ApiErrorBody | undefined): string {
    if (!body || 'success' in body) return '请求失败，请稍后重试';
    const details = body.error?.details;
    if (Array.isArray(details) && typeof details[0] === 'string') return details[0];
    const message = body.message ?? body.error?.message;
    if (Array.isArray(message)) return message[0] ?? '请求失败，请稍后重试';
    return message ?? '请求失败，请稍后重试';
}

function getStoredValue(key: string): string | null {
    return localStorage.getItem(key) ?? sessionStorage.getItem(key);
}

function getSessionStorage(): Storage {
    return localStorage.getItem(REFRESH_TOKEN_KEY) ? localStorage : sessionStorage;
}

function clearStorage(storage: Storage): void {
    storage.removeItem(ACCESS_TOKEN_KEY);
    storage.removeItem(REFRESH_TOKEN_KEY);
}

export function hasStoredPlatformSession(): boolean {
    return Boolean(getStoredValue(PLATFORM_ACCESS_TOKEN_KEY) && getStoredValue(PLATFORM_REFRESH_TOKEN_KEY));
}

export function persistPlatformLogin(result: PlatformLoginResult, remember: boolean): void {
    clearSession();
    const storage = remember ? localStorage : sessionStorage;
    const otherStorage = remember ? sessionStorage : localStorage;
    clearPlatformStorage(otherStorage);
    storage.setItem(PLATFORM_ACCESS_TOKEN_KEY, result.accessToken);
    storage.setItem(PLATFORM_REFRESH_TOKEN_KEY, result.refreshToken);
}

export function clearPlatformSession(): void {
    clearPlatformStorage(localStorage);
    clearPlatformStorage(sessionStorage);
}

export async function platformLogin(input: PlatformLoginInput): Promise<PlatformLoginResult> {
    return publicRequest<PlatformLoginResult>('v1/platform/auth/login', {
        method: 'POST',
        body: JSON.stringify({
            account: input.account.trim().toLowerCase(),
            password: input.password,
            deviceName: 'CEES AI Desktop Platform',
        }),
    });
}

export async function getPlatformMe(): Promise<PlatformMeResult> {
    return platformAuthorizedRequest<PlatformMeResult>('v1/platform/auth/me');
}

export async function platformLogout(): Promise<void> {
    try {
        await platformAuthorizedRequest<void>('v1/platform/auth/logout', { method: 'POST' });
    } finally {
        clearPlatformSession();
    }
}

export async function listPlatformTenants(): Promise<CursorPage<PlatformTenant>> {
    return platformAuthorizedRequest<CursorPage<PlatformTenant>>('v1/platform/tenants?limit=100');
}

export async function getPlatformTenant(tenantId: string): Promise<PlatformTenant> {
    return platformAuthorizedRequest<PlatformTenant>(`v1/platform/tenants/${encodeURIComponent(tenantId)}`);
}

export async function updatePlatformTenant(tenantId: string, name: string, version: number): Promise<PlatformTenant> {
    return platformAuthorizedRequest<PlatformTenant>(`v1/platform/tenants/${encodeURIComponent(tenantId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: name.trim(), version }),
    });
}

export async function suspendPlatformTenant(tenantId: string, reason: string, version: number): Promise<PlatformTenant> {
    return platformAuthorizedRequest<PlatformTenant>(`v1/platform/tenants/${encodeURIComponent(tenantId)}/suspend`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim(), version }),
    });
}

export async function restorePlatformTenant(tenantId: string, version: number): Promise<PlatformTenant> {
    return platformAuthorizedRequest<PlatformTenant>(`v1/platform/tenants/${encodeURIComponent(tenantId)}/restore`, {
        method: 'POST',
        body: JSON.stringify({ version }),
    });
}

export async function listPlatformTenantAdministrators(tenantId: string): Promise<{ items: PlatformTenantAdministrator[] }> {
    return platformAuthorizedRequest<{ items: PlatformTenantAdministrator[] }>(`v1/platform/tenants/${encodeURIComponent(tenantId)}/administrators`);
}

export async function assignPlatformTenantAdministrator(tenantId: string, input: AssignPlatformTenantAdministratorInput): Promise<unknown> {
    return platformAuthorizedRequest<unknown>(`v1/platform/tenants/${encodeURIComponent(tenantId)}/administrators`, {
        method: 'POST',
        body: JSON.stringify({
            account: input.account.trim().toLowerCase(),
            ...(input.displayName?.trim() ? { displayName: input.displayName.trim() } : {}),
        }),
    });
}

export async function removePlatformTenantAdministrator(tenantId: string, membershipId: string): Promise<void> {
    return platformAuthorizedRequest<void>(`v1/platform/tenants/${encodeURIComponent(tenantId)}/administrators/${encodeURIComponent(membershipId)}`, { method: 'DELETE' });
}

async function platformAuthorizedRequest<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const accessToken = getStoredValue(PLATFORM_ACCESS_TOKEN_KEY);
    if (!accessToken) throw new Error('平台登录状态已失效，请重新登录');
    const response = await fetch(new URL(path, API_BASE_URL), {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
            ...init.headers,
        },
    });
    if (response.status === 401 && retry) {
        await refreshPlatformTokens();
        return platformAuthorizedRequest<T>(path, init, false);
    }
    return readResponse<T>(response);
}

async function refreshPlatformTokens(): Promise<TokenPair> {
    if (platformRefreshPromise) return platformRefreshPromise;
    platformRefreshPromise = (async () => {
        const refreshToken = getStoredValue(PLATFORM_REFRESH_TOKEN_KEY);
        if (!refreshToken) throw new Error('平台登录状态已失效，请重新登录');
        try {
            const tokens = await publicRequest<TokenPair>('v1/platform/auth/refresh', {
                method: 'POST',
                body: JSON.stringify({ refreshToken }),
            });
            const storage = getPlatformSessionStorage();
            storage.setItem(PLATFORM_ACCESS_TOKEN_KEY, tokens.accessToken);
            storage.setItem(PLATFORM_REFRESH_TOKEN_KEY, tokens.refreshToken);
            return tokens;
        } catch (error) {
            clearPlatformSession();
            throw error;
        }
    })();
    try {
        return await platformRefreshPromise;
    } finally {
        platformRefreshPromise = undefined;
    }
}

function getPlatformSessionStorage(): Storage {
    return localStorage.getItem(PLATFORM_REFRESH_TOKEN_KEY) ? localStorage : sessionStorage;
}

function clearPlatformStorage(storage: Storage): void {
    storage.removeItem(PLATFORM_ACCESS_TOKEN_KEY);
    storage.removeItem(PLATFORM_REFRESH_TOKEN_KEY);
}

export async function activateTenantInvitation(input: ActivateTenantInvitationInput): Promise<AuthContext> {
    return publicRequest<AuthContext>('v1/auth/activate', {
        method: 'POST',
        body: JSON.stringify({
            tenantCode: input.tenantCode.trim(),
            account: input.account.trim().toLowerCase(),
            invitationToken: input.invitationToken.trim(),
            password: input.password,
        }),
    });
}

export async function suggestTenantAccount(displayName: string): Promise<AccountSuggestionResult> {
    return authorizedRequest<AccountSuggestionResult>('v1/tenants/current/account-suggestions', {
        method: 'POST',
        body: JSON.stringify({ displayName: displayName.trim() }),
    });
}

export async function listTenantRoles(): Promise<CursorPage<TenantRole>> {
    return authorizedRequest<CursorPage<TenantRole>>('v1/roles?limit=100');
}

export async function listTenantPermissions(): Promise<{ items: TenantPermission[] }> {
    return authorizedRequest<{ items: TenantPermission[] }>('v1/permissions');
}

export async function getTenantRole(roleId: string): Promise<TenantRole> {
    return authorizedRequest<TenantRole>(`v1/roles/${encodeURIComponent(roleId)}`);
}

export async function createTenantRole(input: CreateRoleInput): Promise<TenantRole> {
    return authorizedRequest<TenantRole>('v1/roles', {
        method: 'POST',
        body: JSON.stringify({
            code: input.code.trim().toLowerCase(),
            name: input.name.trim(),
            description: input.description?.trim() || null,
            dataScope: input.dataScope,
        }),
    });
}

export async function updateTenantRole(roleId: string, input: UpdateRoleInput): Promise<TenantRole> {
    return authorizedRequest<TenantRole>(`v1/roles/${encodeURIComponent(roleId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
            ...(input.name?.trim() ? { name: input.name.trim() } : {}),
            ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
            ...(input.dataScope ? { dataScope: input.dataScope } : {}),
            version: input.version,
        }),
    });
}

export async function replaceTenantRolePermissions(roleId: string, permissionIds: string[], version: number): Promise<TenantRole> {
    const uniquePermissionIds = [...new Set(permissionIds)];
    return authorizedRequest<TenantRole>(`v1/roles/${encodeURIComponent(roleId)}/permissions`, {
        method: 'PUT',
        body: JSON.stringify({ permissionIds: uniquePermissionIds, version }),
    });
}

export async function deleteTenantRole(roleId: string, version: number): Promise<void> {
    const query = new URLSearchParams({ version: String(version) });
    return authorizedRequest<void>(`v1/roles/${encodeURIComponent(roleId)}?${query}`, { method: 'DELETE' });
}

export async function listTenantInvitations(): Promise<CursorPage<TenantInvitation>> {
    return authorizedRequest<CursorPage<TenantInvitation>>('v1/tenants/current/invitations?limit=100');
}

export async function createTenantInvitation(input: CreateTenantInvitationInput): Promise<unknown> {
    return authorizedRequest<unknown>('v1/tenants/current/invitations', {
        method: 'POST',
        body: JSON.stringify({
            ...(input.account?.trim() ? { account: input.account.trim().toLowerCase() } : {}),
            displayName: input.displayName.trim(),
            roleIds: input.roleIds,
        }),
    });
}

export async function revokeTenantInvitation(invitationId: string): Promise<void> {
    return authorizedRequest<void>(`v1/tenants/current/invitations/${encodeURIComponent(invitationId)}`, { method: 'DELETE' });
}

export async function createPlatformTenant(input: CreatePlatformTenantInput): Promise<unknown> {
    return platformAuthorizedRequest<unknown>('v1/platform/tenants', {
        method: 'POST',
        body: JSON.stringify({
            code: input.code.trim().toLowerCase(),
            name: input.name.trim(),
            initialAdministrator: {
                ...(input.initialAdministrator.account?.trim() ? { account: input.initialAdministrator.account.trim().toLowerCase() } : {}),
                displayName: input.initialAdministrator.displayName.trim(),
            },
        }),
    });
}

export async function listDepartments(status?: DepartmentStatus): Promise<{ items: DepartmentNode[] }> {
    const query = new URLSearchParams();
    if (status) query.set('status', status);
    const suffix = query.size ? `?${query}` : '';
    return authorizedRequest<{ items: DepartmentNode[] }>(`v1/tenants/current/departments${suffix}`);
}

export async function createDepartment(input: CreateDepartmentInput): Promise<DepartmentNode> {
    return authorizedRequest<DepartmentNode>('v1/tenants/current/departments', {
        method: 'POST',
        body: JSON.stringify({
            name: input.name.trim(),
            ...(input.parentId ? { parentId: input.parentId } : {}),
        }),
    });
}

export async function getDepartment(departmentId: string): Promise<DepartmentNode> {
    return authorizedRequest<DepartmentNode>(`v1/tenants/current/departments/${encodeURIComponent(departmentId)}`);
}

export async function updateDepartment(departmentId: string, input: UpdateDepartmentInput): Promise<DepartmentNode> {
    return authorizedRequest<DepartmentNode>(`v1/tenants/current/departments/${encodeURIComponent(departmentId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
            ...(input.name?.trim() ? { name: input.name.trim() } : {}),
            ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
            ...(input.status ? { status: input.status } : {}),
            version: input.version,
        }),
    });
}

export async function deleteDepartment(departmentId: string, version: number): Promise<void> {
    const query = new URLSearchParams({ version: String(version) });
    return authorizedRequest<void>(`v1/tenants/current/departments/${encodeURIComponent(departmentId)}?${query}`, { method: 'DELETE' });
}

export async function listDepartmentMembers(departmentId: string, keyword?: string): Promise<CursorPage<TenantMember>> {
    const query = new URLSearchParams({ limit: '100' });
    if (keyword?.trim()) query.set('keyword', keyword.trim());
    return authorizedRequest<CursorPage<TenantMember>>(`v1/tenants/current/departments/${encodeURIComponent(departmentId)}/members?${query}`);
}

export async function assignMemberDepartment(membershipId: string, input: AssignMemberDepartmentInput): Promise<TenantMember> {
    return authorizedRequest<TenantMember>(`v1/tenants/current/members/${encodeURIComponent(membershipId)}/department`, {
        method: 'PUT',
        body: JSON.stringify(input),
    });
}

// ---------------------------------------------------------------------------
// 组织架构与成员批量导入（0.12.0）
// ---------------------------------------------------------------------------

export interface OrganizationImportDepartmentInput {
    clientRef: string;
    name: string;
    parentClientRef: string | null;
    sortOrder?: number;
    description?: string | null;
}

export interface OrganizationImportMemberInput {
    clientRef: string;
    account: string;
    displayName: string;
    departmentClientRef: string;
    roleIds?: string[];
}

export interface OrganizationImportRequest {
    defaultRoleIds: string[];
    departments: OrganizationImportDepartmentInput[];
    members: OrganizationImportMemberInput[];
    activationExpiresInDays: number;
}

export interface OrganizationImportIssue {
    scope: string;
    clientRef: string;
    field?: string;
    code: string;
    message: string;
}

export interface OrganizationImportValidation {
    valid: boolean;
    summary: {
        departmentCount: number;
        departmentCreateCount: number;
        departmentReuseCount: number;
        memberCount: number;
    };
    departments: Array<{
        clientRef: string;
        action: 'CREATE' | 'REUSE';
        departmentId: string | null;
        path: string;
    }>;
    members: Array<{
        clientRef: string;
        account: string;
        displayName: string;
        departmentClientRef: string;
        departmentPath: string;
        effectiveRoleIds: string[];
    }>;
    issues: OrganizationImportIssue[];
}

export interface OrganizationImportResult {
    summary: OrganizationImportValidation['summary'];
    departments: Array<{
        clientRef: string;
        action: 'CREATE' | 'REUSE';
        departmentId: string;
        path: string;
    }>;
    members: Array<{
        clientRef: string;
        membershipId: string;
        displayName: string;
        account: string;
        departmentId: string | null;
        departmentPath: string;
        tenantCode: string;
        activationToken: string;
        activationExpiresAt: string;
    }>;
}

export async function validateOrganizationImport(input: OrganizationImportRequest): Promise<OrganizationImportValidation> {
    return authorizedRequest<OrganizationImportValidation>('v1/tenants/current/organization-imports/validate', {
        method: 'POST',
        body: JSON.stringify(input),
    });
}

export async function confirmOrganizationImport(input: OrganizationImportRequest): Promise<OrganizationImportResult> {
    return authorizedRequest<OrganizationImportResult>('v1/tenants/current/organization-imports/confirm', {
        method: 'POST',
        body: JSON.stringify(input),
    });
}

// ---------------------------------------------------------------------------
// 文件上传（0.9.0，短时预签名 PUT 直传 COS）
// ---------------------------------------------------------------------------

export interface CreateUploadSessionInput {
    purpose: 'attachment';
    fileName: string;
    contentType: string;
    sizeBytes: number;
}

export interface UploadSessionCreated {
    uploadSessionId: string;
    fileObjectId: string;
    uploadUrl: string;
    uploadHeaders: Record<string, string>;
    expiresAt?: string;
}

export interface UploadSessionCompleted {
    fileObjectId: string;
    fileName?: string;
    sizeBytes?: number;
}

function readUploadSession(data: Record<string, unknown>): UploadSessionCreated {
    const uploadUrl = (data.uploadUrl ?? data.putUrl ?? data.url) as string | undefined;
    if (!uploadUrl) throw new Error('上传会话响应缺少直传地址');
    const rawHeaders = (data.uploadHeaders ?? data.headers ?? data.requiredHeaders ?? {}) as Record<string, unknown>;
    const uploadHeaders: Record<string, string> = {};
    Object.entries(rawHeaders).forEach(([key, value]) => {
        if (typeof value === 'string') uploadHeaders[key] = value;
    });
    return {
        uploadSessionId: String(data.id ?? data.uploadSessionId ?? ''),
        fileObjectId: String(data.fileObjectId ?? data.fileId ?? ''),
        uploadUrl,
        uploadHeaders,
        expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : undefined,
    };
}

export async function createUploadSession(input: CreateUploadSessionInput, idempotencyKey: string): Promise<UploadSessionCreated> {
    const data = await authorizedRequest<Record<string, unknown>>('v1/upload-sessions', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
            purpose: input.purpose,
            fileName: input.fileName,
            contentType: input.contentType,
            sizeBytes: input.sizeBytes,
        }),
    });
    return readUploadSession(data);
}

export async function uploadToPresignedUrl(url: string, headers: Record<string, string>, blob: Blob): Promise<void> {
    const response = await fetch(url, { method: 'PUT', headers, body: blob });
    if (!response.ok) throw new Error(`文件直传失败（HTTP ${response.status}）`);
}

export async function completeUploadSession(uploadSessionId: string): Promise<UploadSessionCompleted> {
    return authorizedRequest<UploadSessionCompleted>(`v1/upload-sessions/${encodeURIComponent(uploadSessionId)}/complete`, {
        method: 'POST',
    });
}

/** 组合直传流程：创建会话 → PUT 直传 COS → 登记正式文件，返回 fileObjectId。 */
export async function uploadAttachmentFile(file: File): Promise<string> {
    const idempotencyKey = `desktop-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const session = await createUploadSession({
        purpose: 'attachment',
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
    }, idempotencyKey);
    await uploadToPresignedUrl(session.uploadUrl, session.uploadHeaders, file);
    const completed = await completeUploadSession(session.uploadSessionId);
    return completed.fileObjectId || session.fileObjectId;
}

// ---------------------------------------------------------------------------
// AI 对话（0.19.0，服务端会话与 SSE 事件流）
// ---------------------------------------------------------------------------

export type ChatMode = 'standard' | 'ultra';

export interface Conversation { id: string; title: string; mode: ChatMode; visibility: 'PRIVATE'; version: number; createdAt: string; updatedAt: string; lastTurnAt?: string | null; }
export interface ConversationMessage { id: string; role: 'USER' | 'ASSISTANT' | 'TOOL'; content: string; createdAt: string; turnId?: string | null; toolCallId?: string | null; resources?: Array<{ id: string; resourceId?: string; type: 'IMAGE' | 'DOCUMENT'; url?: string | null; resourceUrl?: string | null }> | null; }
export interface ConversationDetail { conversation: Conversation; messages: ConversationMessage[]; }
export interface Turn { id: string; conversationId: string; status: 'RECEIVED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'; mode: ChatMode; error?: Record<string, unknown> | null; createdAt: string; completedAt?: string | null; }
export interface ImageAccess { id: string; resourceId: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; sizeBytes: number; url: string; prompt?: string | null; model?: string | null; createdAt: string; }
export type TurnStreamEvent =
    | { type: 'started'; seq: number; requestId: string; conversationId: string; turnId: string; mode: ChatMode; contextUsage: Record<string, unknown> }
    | { type: 'status'; seq: number; phase: 'reasoning' | 'answering' | 'tool_executing' }
    | { type: 'content_delta'; seq: number; text: string }
    | { type: 'tool_call'; seq: number; toolCallId: string; name: string; arguments: Record<string, unknown> }
    | { type: 'tool_result'; seq: number; toolCallId: string; status: 'completed' | 'failed' | 'rejected'; resourceId?: string | null; resourceUrl?: string | null; resource?: { id: string; type: 'IMAGE' | 'DOCUMENT' } | null; sources?: Array<{ id: string; title: string; url: string; domain: string; snippet: string; publishedAt?: string | null }>; error?: Record<string, unknown> | null }
    | { type: 'usage'; seq: number; tokenUsage: Record<string, number | null> }
    | { type: 'completed'; seq: number; latencyMs: number; finishReason: string | null }
    | { type: 'error'; seq: number; error: { code: string; message: string; retryable: boolean } };

export function parseSseFrames(input: string): { events: TurnStreamEvent[]; rest: string } {
    const normalized = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const frames = normalized.split('\n\n');
    const rest = frames.pop() ?? '';
    const events: TurnStreamEvent[] = [];
    for (const frame of frames) {
        const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).replace(/^ /, '')).join('\n');
        if (!data || data === '[DONE]') continue;
        const value: unknown = JSON.parse(data);
        if (!value || typeof value !== 'object' || !('type' in value) || !('seq' in value) || typeof (value as { seq: unknown }).seq !== 'number') throw new Error('SSE 事件格式无效');
        events.push(value as TurnStreamEvent);
    }
    return { events, rest };
}

export async function createConversation(title?: string, mode: ChatMode = 'standard'): Promise<Conversation> { return authorizedRequest<Conversation>('v1/conversations', { method: 'POST', body: JSON.stringify({ ...(title ? { title } : {}), mode }) }); }
export async function listConversations(limit = 100): Promise<{ items: Conversation[]; nextCursor: string | null }> { return authorizedRequest<{ items: Conversation[]; nextCursor: string | null }>(`v1/conversations?limit=${limit}`); }
export async function getConversation(conversationId: string): Promise<ConversationDetail> { return authorizedRequest<ConversationDetail>(`v1/conversations/${encodeURIComponent(conversationId)}`); }
export async function getImage(imageId: string): Promise<ImageAccess> { return authorizedRequest<ImageAccess>(`v1/images/${encodeURIComponent(imageId)}`); }
export async function updateConversation(conversationId: string, title: string, version: number): Promise<Conversation> { return authorizedRequest<Conversation>(`v1/conversations/${encodeURIComponent(conversationId)}`, { method: 'PATCH', body: JSON.stringify({ title, version }) }); }
export async function deleteConversation(conversationId: string, version: number): Promise<void> { await authorizedRequest<unknown>(`v1/conversations/${encodeURIComponent(conversationId)}?version=${encodeURIComponent(String(version))}`, { method: 'DELETE' }); }

async function streamSse(path: string, init: RequestInit, onEvent: (event: TurnStreamEvent) => void, retry = true): Promise<void> {
    const accessToken = getStoredValue(ACCESS_TOKEN_KEY);
    if (!accessToken) throw new Error('登录状态已失效，请重新登录');
    const response = await fetch(new URL(path, API_BASE_URL), { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, ...init.headers } });
    if (response.status === 401 && retry) { await refreshTokens(); return streamSse(path, init, onEvent, false); }
    if (!response.ok) { const error = new Error(getErrorMessage(await readBody(response))); (error as Error & { status?: number }).status = response.status; throw error; }
    if (!response.body) throw new Error('服务器未返回事件流');
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
    const consume = (chunk: string) => { const parsed = parseSseFrames(buffer += chunk); buffer = parsed.rest; for (const event of parsed.events) onEvent(event); };
    try { while (true) { const { value, done } = await reader.read(); if (done) { consume(decoder.decode()); if (buffer.trim()) throw new Error('事件流意外中断'); break; } consume(decoder.decode(value, { stream: true })); } } finally { reader.releaseLock(); }
}

export function createTurn(conversationId: string, input: { content: string; mode: ChatMode; imageFileIds?: string[] }, idempotencyKey: string, onEvent: (event: TurnStreamEvent) => void, signal?: AbortSignal): Promise<void> { return streamSse(`v1/conversations/${encodeURIComponent(conversationId)}/turns`, { method: 'POST', body: JSON.stringify({ content: input.content, mode: input.mode, ...(input.imageFileIds?.length ? { imageFileIds: input.imageFileIds } : {}) }), signal, headers: { 'Idempotency-Key': idempotencyKey } }, onEvent); }
export function replayTurnEvents(conversationId: string, turnId: string, afterSeq: number, onEvent: (event: TurnStreamEvent) => void, signal?: AbortSignal): Promise<void> { return streamSse(`v1/conversations/${encodeURIComponent(conversationId)}/turns/${encodeURIComponent(turnId)}/events?afterSeq=${afterSeq}`, { method: 'GET', signal }, onEvent); }
export async function cancelTurn(conversationId: string, turnId: string): Promise<Turn> { return authorizedRequest<Turn>(`v1/conversations/${encodeURIComponent(conversationId)}/turns/${encodeURIComponent(turnId)}/cancel`, { method: 'POST' }); }

export interface ChatMessageInput {
    id: string;
    role: 'user' | 'assistant';
    content: string;
}

export interface InvokeChatInput {
    conversationId: string;
    turnId: string;
    mode?: ChatMode;
    conversationSummary?: string | null;
    messages: ChatMessageInput[];
}

export interface ChatInvokeResult {
    conversationId: string;
    turnId: string;
    answer?: string;
    content?: string;
    tokenUsage?: {
        inputTokens?: number | null;
        outputTokens?: number | null;
        totalTokens?: number | null;
    };
    latencyMs?: number;
    finishReason?: string;
}

export interface ChatCompactInput {
    conversationId: string;
    turnId: string;
    messages: ChatMessageInput[];
    previousSummary?: string | null;
}

export interface ChatCompactResult {
    conversationId: string;
    turnId: string;
    summary: string;
    summarizedThroughMessageId: string;
    tokenUsage?: ChatInvokeResult['tokenUsage'];
}

export async function invokeChat(input: InvokeChatInput): Promise<ChatInvokeResult> {
    return authorizedRequest<ChatInvokeResult>('v1/chat/invoke', {
        method: 'POST',
        body: JSON.stringify({
            conversationId: input.conversationId,
            turnId: input.turnId,
            ...(input.mode ? { mode: input.mode } : {}),
            ...(input.conversationSummary ? { conversationSummary: input.conversationSummary } : {}),
            messages: input.messages,
        }),
    });
}

export async function compactChat(input: ChatCompactInput): Promise<ChatCompactResult> {
    return authorizedRequest<ChatCompactResult>('v1/chat/compact', {
        method: 'POST',
        body: JSON.stringify({
            conversationId: input.conversationId,
            turnId: input.turnId,
            messages: input.messages,
            ...(input.previousSummary ? { previousSummary: input.previousSummary } : {}),
        }),
    });
}

// ---------------------------------------------------------------------------
// 通知中心（0.17.0）
// ---------------------------------------------------------------------------

export interface NotificationItem {
    id: string;
    title: string;
    content?: string | null;
    channel?: string;
    relationType?: string | null;
    relationId?: string | null;
    readAt?: string | null;
    createdAt?: string;
}

export interface NotificationList {
    items: NotificationItem[];
    nextCursor: string | null;
    unreadCount: number;
}

export async function listNotifications(unreadOnly = false): Promise<NotificationList> {
    const query = new URLSearchParams({ limit: '50', ...(unreadOnly ? { unreadOnly: 'true' } : {}) });
    return authorizedRequest<NotificationList>(`v1/notifications?${query}`);
}

export async function getUnreadNotificationCount(): Promise<number> {
    const data = await authorizedRequest<{ unreadCount: number }>('v1/notifications/unread-count');
    return data.unreadCount ?? 0;
}

export async function markAllNotificationsRead(): Promise<number> {
    const data = await authorizedRequest<{ updatedCount: number }>('v1/notifications/read-all', { method: 'POST' });
    return data.updatedCount ?? 0;
}

export async function markNotificationRead(notificationId: string): Promise<NotificationItem> {
    return authorizedRequest<NotificationItem>(`v1/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// 工作台与数据看板（0.18.0）
// ---------------------------------------------------------------------------

export interface DashboardOverview {
    generatedAt?: string;
    projects?: { total?: number; active?: number; completed?: number;[key: string]: unknown };
    tasks?: { total?: number; inProgress?: number; overdue?: number; done?: number;[key: string]: unknown };
    reports?: { total?: number; submitted?: number; approved?: number;[key: string]: unknown };
    meetings?: { total?: number; upcoming?: number;[key: string]: unknown };
    notifications?: { unread?: number;[key: string]: unknown };
    [key: string]: unknown;
}

export interface DashboardTaskStatistics {
    statusBreakdown?: Array<{ status: string; count: number }>;
    overdueCount?: number;
    completionRate?: number;
    [key: string]: unknown;
}

export interface DashboardTodoItem {
    type?: string;
    id?: string;
    title?: string;
    dueDate?: string | null;
    projectId?: string | null;
    [key: string]: unknown;
}

export interface DashboardTodos {
    tasks?: DashboardTodoItem[];
    reports?: DashboardTodoItem[];
    meetings?: DashboardTodoItem[];
    unreadNotificationCount?: number;
}

export interface DashboardUpcomingMeeting {
    id?: string;
    title?: string;
    startsAt?: string;
    durationMinutes?: number;
    status?: string;
    myRole?: string | null;
    myResponseStatus?: string | null;
    [key: string]: unknown;
}

export async function getDashboardOverview(): Promise<DashboardOverview> {
    return authorizedRequest<DashboardOverview>('v1/dashboard/overview');
}

export async function getDashboardTaskStatistics(params: { projectId?: string; from?: string; to?: string } = {}): Promise<DashboardTaskStatistics> {
    const query = new URLSearchParams();
    if (params.projectId) query.set('projectId', params.projectId);
    if (params.from) query.set('from', params.from);
    if (params.to) query.set('to', params.to);
    const suffix = query.size ? `?${query}` : '';
    return authorizedRequest<DashboardTaskStatistics>(`v1/dashboard/task-statistics${suffix}`);
}

export async function getDashboardTodos(params: { taskLimit?: number; reportLimit?: number; meetingLimit?: number } = {}): Promise<DashboardTodos> {
    const query = new URLSearchParams();
    if (params.taskLimit) query.set('taskLimit', String(params.taskLimit));
    if (params.reportLimit) query.set('reportLimit', String(params.reportLimit));
    if (params.meetingLimit) query.set('meetingLimit', String(params.meetingLimit));
    const suffix = query.size ? `?${query}` : '';
    return authorizedRequest<DashboardTodos>(`v1/dashboard/todos${suffix}`);
}

export async function getDashboardUpcomingMeetings(limit = 5): Promise<{ items: DashboardUpcomingMeeting[] }> {
    return authorizedRequest<{ items: DashboardUpcomingMeeting[] }>(`v1/dashboard/upcoming-meetings?limit=${limit}`);
}

// ---------------------------------------------------------------------------
// 项目与项目成员（0.11.0）
// ---------------------------------------------------------------------------

export type ProjectStatus = 'PLANNING' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED' | 'ARCHIVED';
export type ProjectMemberRole = 'OWNER' | 'MANAGER' | 'MEMBER';

export interface ProjectSummary {
    id: string;
    code: string;
    name: string;
    description?: string | null;
    departmentId?: string | null;
    status: ProjectStatus;
    ownerMembershipId?: string | null;
    owner?: { membershipId?: string; account?: string; displayName?: string } | null;
    myRole?: ProjectMemberRole | null;
    memberCount?: number;
    taskCount?: number;
    startsAt?: string | null;
    endsAt?: string | null;
    completedAt?: string | null;
    completionSummary?: string | null;
    createdAt?: string;
    updatedAt?: string;
    version: number;
}

export interface CreateProjectInput {
    code: string;
    name: string;
    description?: string;
    departmentId?: string | null;
    ownerMembershipId?: string;
    startsAt?: string | null;
    endsAt?: string | null;
}

export interface UpdateProjectInput extends Partial<CreateProjectInput> {
    version: number;
}

export interface ProjectMemberSummary {
    id: string;
    membershipId: string;
    account: string;
    displayName: string;
    departmentId?: string | null;
    role: ProjectMemberRole;
    version: number;
}

export interface ListProjectsParams {
    keyword?: string;
    status?: ProjectStatus;
    departmentId?: string;
    ownerMembershipId?: string;
    includeArchived?: boolean;
}

export async function listProjects(params: ListProjectsParams = {}): Promise<CursorPage<ProjectSummary>> {
    const query = new URLSearchParams({ limit: '100' });
    if (params.keyword?.trim()) query.set('keyword', params.keyword.trim());
    if (params.status) query.set('status', params.status);
    if (params.departmentId) query.set('departmentId', params.departmentId);
    if (params.ownerMembershipId) query.set('ownerMembershipId', params.ownerMembershipId);
    if (params.includeArchived) query.set('includeArchived', 'true');
    return authorizedRequest<CursorPage<ProjectSummary>>(`v1/projects?${query}`);
}

export async function createProject(input: CreateProjectInput): Promise<ProjectSummary> {
    return authorizedRequest<ProjectSummary>('v1/projects', {
        method: 'POST',
        body: JSON.stringify({
            code: input.code.trim(),
            name: input.name.trim(),
            ...(input.description?.trim() ? { description: input.description.trim() } : {}),
            ...(input.departmentId ? { departmentId: input.departmentId } : {}),
            ...(input.ownerMembershipId ? { ownerMembershipId: input.ownerMembershipId } : {}),
            ...(input.startsAt ? { startsAt: input.startsAt } : {}),
            ...(input.endsAt ? { endsAt: input.endsAt } : {}),
        }),
    });
}

export async function getProject(projectId: string): Promise<ProjectSummary> {
    return authorizedRequest<ProjectSummary>(`v1/projects/${encodeURIComponent(projectId)}`);
}

export async function updateProject(projectId: string, input: UpdateProjectInput): Promise<ProjectSummary> {
    return authorizedRequest<ProjectSummary>(`v1/projects/${encodeURIComponent(projectId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
            ...(input.code?.trim() ? { code: input.code.trim() } : {}),
            ...(input.name?.trim() ? { name: input.name.trim() } : {}),
            ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
            ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
            ...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}),
            ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
            version: input.version,
        }),
    });
}

export async function deleteProject(projectId: string, version: number): Promise<void> {
    return authorizedRequest<void>(`v1/projects/${encodeURIComponent(projectId)}?version=${version}`, { method: 'DELETE' });
}

export async function listProjectMembers(projectId: string): Promise<{ items: ProjectMemberSummary[] }> {
    return authorizedRequest<{ items: ProjectMemberSummary[] }>(`v1/projects/${encodeURIComponent(projectId)}/members`);
}

export async function addProjectMember(projectId: string, membershipId: string, role: 'MANAGER' | 'MEMBER' = 'MEMBER'): Promise<ProjectMemberSummary> {
    return authorizedRequest<ProjectMemberSummary>(`v1/projects/${encodeURIComponent(projectId)}/members`, {
        method: 'POST',
        body: JSON.stringify({ membershipId, role }),
    });
}

export async function updateProjectMember(projectId: string, membershipId: string, role: 'MANAGER' | 'MEMBER', version: number): Promise<ProjectMemberSummary> {
    return authorizedRequest<ProjectMemberSummary>(`v1/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(membershipId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ role, version }),
    });
}

export async function removeProjectMember(projectId: string, membershipId: string, version: number): Promise<void> {
    return authorizedRequest<void>(`v1/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(membershipId)}?version=${version}`, { method: 'DELETE' });
}

export async function transferProjectOwner(projectId: string, membershipId: string, version: number): Promise<ProjectSummary> {
    return authorizedRequest<ProjectSummary>(`v1/projects/${encodeURIComponent(projectId)}/owner`, {
        method: 'PUT',
        body: JSON.stringify({ membershipId, version }),
    });
}

export type ProjectTransitionAction = 'start' | 'pause' | 'resume' | 'complete' | 'reopen' | 'cancel' | 'archive' | 'restore';

export async function transitionProject(projectId: string, action: ProjectTransitionAction, body: { version: number; reason?: string; completionSummary?: string }): Promise<ProjectSummary> {
    const payload: Record<string, unknown> = { version: body.version };
    if (body.reason?.trim()) payload.reason = body.reason.trim();
    if (body.completionSummary?.trim()) payload.completionSummary = body.completionSummary.trim();
    return authorizedRequest<ProjectSummary>(`v1/projects/${encodeURIComponent(projectId)}/${action}`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

// ---------------------------------------------------------------------------
// 任务、评论、附件和动态（0.13.0）
// ---------------------------------------------------------------------------

export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface TaskAssignee {
    membershipId: string;
    account?: string;
    displayName?: string;
    departmentId?: string | null;
    type?: 'OWNER' | 'COLLABORATOR';
}

export interface TaskSummary {
    id: string;
    projectId: string;
    parentId: string | null;
    title: string;
    description?: string | null;
    status: TaskStatus;
    priority: TaskPriority;
    dueDate?: string | null;
    owner?: TaskAssignee | null;
    collaborators?: TaskAssignee[];
    subtaskCount?: number;
    commentCount?: number;
    attachmentCount?: number;
    createdAt?: string;
    updatedAt?: string;
    version: number;
}

export interface CreateTaskInput {
    title: string;
    description?: string;
    parentId?: string | null;
    priority?: TaskPriority;
    dueDate?: string | null;
    ownerMembershipId: string;
    collaboratorMembershipIds?: string[];
}

export interface UpdateTaskInput {
    title?: string;
    description?: string | null;
    parentId?: string | null;
    priority?: TaskPriority;
    dueDate?: string | null;
    version: number;
}

export interface ListTasksParams {
    status?: TaskStatus;
    priority?: TaskPriority;
    assigneeMembershipId?: string;
    parentId?: string;
    rootOnly?: boolean;
}

export async function listTasks(projectId: string, params: ListTasksParams = {}): Promise<CursorPage<TaskSummary>> {
    const query = new URLSearchParams({ limit: '100' });
    if (params.status) query.set('status', params.status);
    if (params.priority) query.set('priority', params.priority);
    if (params.assigneeMembershipId) query.set('assigneeMembershipId', params.assigneeMembershipId);
    if (params.parentId) query.set('parentId', params.parentId);
    if (params.rootOnly) query.set('rootOnly', 'true');
    return authorizedRequest<CursorPage<TaskSummary>>(`v1/projects/${encodeURIComponent(projectId)}/tasks?${query}`);
}

export async function createTask(projectId: string, input: CreateTaskInput): Promise<TaskSummary> {
    return authorizedRequest<TaskSummary>(`v1/projects/${encodeURIComponent(projectId)}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
            title: input.title.trim(),
            ...(input.description?.trim() ? { description: input.description.trim() } : {}),
            ...(input.parentId ? { parentId: input.parentId } : {}),
            ...(input.priority ? { priority: input.priority } : {}),
            ...(input.dueDate ? { dueDate: input.dueDate } : {}),
            ownerMembershipId: input.ownerMembershipId,
            collaboratorMembershipIds: input.collaboratorMembershipIds ?? [],
        }),
    });
}

export async function getTask(projectId: string, taskId: string): Promise<TaskSummary> {
    return authorizedRequest<TaskSummary>(`v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`);
}

export async function updateTask(projectId: string, taskId: string, input: UpdateTaskInput): Promise<TaskSummary> {
    return authorizedRequest<TaskSummary>(`v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
            ...(input.title?.trim() ? { title: input.title.trim() } : {}),
            ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
            ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
            ...(input.priority ? { priority: input.priority } : {}),
            ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
            version: input.version,
        }),
    });
}

export async function deleteTask(projectId: string, taskId: string, version: number): Promise<void> {
    return authorizedRequest<void>(`v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}?version=${version}`, { method: 'DELETE' });
}

export async function transitionTask(projectId: string, taskId: string, status: TaskStatus, version: number, reason?: string): Promise<TaskSummary> {
    return authorizedRequest<TaskSummary>(`v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/transitions`, {
        method: 'POST',
        body: JSON.stringify({
            status,
            ...(reason?.trim() ? { reason: reason.trim() } : {}),
            version,
        }),
    });
}

export async function replaceTaskAssignees(projectId: string, taskId: string, ownerMembershipId: string, collaboratorMembershipIds: string[], version: number): Promise<TaskSummary> {
    return authorizedRequest<TaskSummary>(`v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/assignees`, {
        method: 'PUT',
        body: JSON.stringify({ ownerMembershipId, collaboratorMembershipIds: [...new Set(collaboratorMembershipIds)], version }),
    });
}

export interface TaskComment {
    id: string;
    taskId: string;
    content: string;
    author?: { membershipId: string; account?: string; displayName?: string } | null;
    createdAt?: string;
    updatedAt?: string;
    version: number;
}

export async function listTaskComments(projectId: string, taskId: string): Promise<CursorPage<TaskComment>> {
    return authorizedRequest<CursorPage<TaskComment>>(`v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/comments?limit=50`);
}

export async function createTaskComment(projectId: string, taskId: string, content: string): Promise<TaskComment> {
    return authorizedRequest<TaskComment>(`v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content: content.trim() }),
    });
}

export async function updateTaskComment(projectId: string, taskId: string, commentId: string, content: string, version: number): Promise<TaskComment> {
    return authorizedRequest<TaskComment>(`v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/comments/${encodeURIComponent(commentId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ content: content.trim(), version }),
    });
}

export async function deleteTaskComment(projectId: string, taskId: string, commentId: string, version: number): Promise<void> {
    return authorizedRequest<void>(`v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/comments/${encodeURIComponent(commentId)}?version=${version}`, { method: 'DELETE' });
}

export interface TaskAttachment {
    id: string;
    taskId: string;
    fileObjectId: string;
    fileName: string;
    contentType?: string;
    sizeBytes?: number;
    createdByMembershipId?: string;
    createdAt?: string;
    version: number;
}

export async function listTaskAttachments(projectId: string, taskId: string): Promise<{ items: TaskAttachment[] }> {
    return authorizedRequest<{ items: TaskAttachment[] }>(`v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/attachments`);
}

export async function addTaskAttachment(projectId: string, taskId: string, fileObjectId: string): Promise<TaskAttachment> {
    return authorizedRequest<TaskAttachment>(`v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/attachments`, {
        method: 'POST',
        body: JSON.stringify({ fileObjectId }),
    });
}

export async function removeTaskAttachment(projectId: string, taskId: string, attachmentId: string, version: number): Promise<void> {
    return authorizedRequest<void>(`v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(attachmentId)}?version=${version}`, { method: 'DELETE' });
}

export interface TaskActivity {
    id: string;
    taskId: string;
    action: string;
    actor?: { membershipId: string; account?: string; displayName?: string } | null;
    metadata?: Record<string, unknown> | null;
    createdAt?: string;
}

export async function listTaskActivities(projectId: string, taskId: string): Promise<CursorPage<TaskActivity>> {
    return authorizedRequest<CursorPage<TaskActivity>>(`v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/activities?limit=50`);
}

// ---------------------------------------------------------------------------
// 会议管理（0.14.0）
// ---------------------------------------------------------------------------

export type MeetingStatus = 'DRAFT' | 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type MeetingParticipantRole = 'HOST' | 'RECORDER' | 'PARTICIPANT';
export type MeetingResponseStatus = 'INVITED' | 'ACCEPTED' | 'DECLINED' | 'TENTATIVE';
export type MeetingAttendanceStatus = 'PENDING' | 'ATTENDED' | 'ABSENT';

export interface MeetingAgendaItem {
    title: string;
    description?: string | null;
    sortOrder?: number;
}

export interface Meeting {
    id: string;
    projectId?: string | null;
    departmentId?: string | null;
    organizerMembershipId?: string;
    organizer?: { membershipId?: string; account?: string; displayName?: string } | null;
    title: string;
    description?: string | null;
    startsAt: string;
    durationMinutes: number;
    location?: string | null;
    meetingUrl?: string | null;
    agenda?: MeetingAgendaItem[] | null;
    status: MeetingStatus;
    cancelReason?: string | null;
    participantCount?: number;
    myRole?: MeetingParticipantRole | null;
    myResponseStatus?: MeetingResponseStatus | null;
    createdAt?: string;
    updatedAt?: string;
    version: number;
}

export interface CreateMeetingInput {
    title: string;
    startsAt: string;
    durationMinutes: number;
    description?: string;
    projectId?: string | null;
    departmentId?: string | null;
    location?: string;
    meetingUrl?: string;
    agenda?: MeetingAgendaItem[];
}

export interface ListMeetingsParams {
    keyword?: string;
    status?: MeetingStatus;
    projectId?: string;
    departmentId?: string;
    from?: string;
    to?: string;
}

export async function listMeetings(params: ListMeetingsParams = {}): Promise<CursorPage<Meeting>> {
    const query = new URLSearchParams({ limit: '50' });
    if (params.keyword?.trim()) query.set('keyword', params.keyword.trim());
    if (params.status) query.set('status', params.status);
    if (params.projectId) query.set('projectId', params.projectId);
    if (params.departmentId) query.set('departmentId', params.departmentId);
    if (params.from) query.set('from', params.from);
    if (params.to) query.set('to', params.to);
    return authorizedRequest<CursorPage<Meeting>>(`v1/meetings?${query}`);
}

export async function createMeeting(input: CreateMeetingInput): Promise<Meeting> {
    return authorizedRequest<Meeting>('v1/meetings', {
        method: 'POST',
        body: JSON.stringify({
            title: input.title.trim(),
            startsAt: input.startsAt,
            durationMinutes: input.durationMinutes,
            ...(input.description?.trim() ? { description: input.description.trim() } : {}),
            ...(input.projectId ? { projectId: input.projectId } : {}),
            ...(input.departmentId ? { departmentId: input.departmentId } : {}),
            ...(input.location?.trim() ? { location: input.location.trim() } : {}),
            ...(input.meetingUrl?.trim() ? { meetingUrl: input.meetingUrl.trim() } : {}),
            ...(input.agenda?.length ? { agenda: input.agenda } : {}),
        }),
    });
}

export async function getMeeting(meetingId: string): Promise<Meeting> {
    return authorizedRequest<Meeting>(`v1/meetings/${encodeURIComponent(meetingId)}`);
}

export async function updateMeeting(meetingId: string, input: Partial<CreateMeetingInput> & { version: number }): Promise<Meeting> {
    return authorizedRequest<Meeting>(`v1/meetings/${encodeURIComponent(meetingId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
            ...(input.title?.trim() ? { title: input.title.trim() } : {}),
            ...(input.startsAt ? { startsAt: input.startsAt } : {}),
            ...(input.durationMinutes ? { durationMinutes: input.durationMinutes } : {}),
            ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
            ...(input.location !== undefined ? { location: input.location?.trim() || null } : {}),
            ...(input.meetingUrl !== undefined ? { meetingUrl: input.meetingUrl?.trim() || null } : {}),
            ...(input.agenda ? { agenda: input.agenda } : {}),
            version: input.version,
        }),
    });
}

export async function deleteMeeting(meetingId: string, version: number): Promise<void> {
    return authorizedRequest<void>(`v1/meetings/${encodeURIComponent(meetingId)}?version=${version}`, { method: 'DELETE' });
}

export async function transitionMeeting(meetingId: string, status: MeetingStatus, version: number, reason?: string): Promise<Meeting> {
    return authorizedRequest<Meeting>(`v1/meetings/${encodeURIComponent(meetingId)}/transitions`, {
        method: 'POST',
        body: JSON.stringify({
            status,
            ...(reason?.trim() ? { reason: reason.trim() } : {}),
            version,
        }),
    });
}

export interface MeetingParticipant {
    id: string;
    member: { membershipId: string; account?: string; displayName?: string; departmentId?: string | null };
    role: MeetingParticipantRole;
    responseStatus: MeetingResponseStatus;
    attendanceStatus?: MeetingAttendanceStatus;
    respondedAt?: string | null;
    version: number;
}

export async function listMeetingParticipants(meetingId: string): Promise<{ items: MeetingParticipant[] }> {
    return authorizedRequest<{ items: MeetingParticipant[] }>(`v1/meetings/${encodeURIComponent(meetingId)}/participants`);
}

export async function addMeetingParticipant(meetingId: string, membershipId: string, role: MeetingParticipantRole = 'PARTICIPANT'): Promise<MeetingParticipant> {
    return authorizedRequest<MeetingParticipant>(`v1/meetings/${encodeURIComponent(meetingId)}/participants`, {
        method: 'POST',
        body: JSON.stringify({ membershipId, role }),
    });
}

export async function updateMeetingParticipant(meetingId: string, membershipId: string, input: { role?: MeetingParticipantRole; attendanceStatus?: MeetingAttendanceStatus; version: number }): Promise<MeetingParticipant> {
    return authorizedRequest<MeetingParticipant>(`v1/meetings/${encodeURIComponent(meetingId)}/participants/${encodeURIComponent(membershipId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
            ...(input.role ? { role: input.role } : {}),
            ...(input.attendanceStatus ? { attendanceStatus: input.attendanceStatus } : {}),
            version: input.version,
        }),
    });
}

export async function removeMeetingParticipant(meetingId: string, membershipId: string, version: number): Promise<void> {
    return authorizedRequest<void>(`v1/meetings/${encodeURIComponent(meetingId)}/participants/${encodeURIComponent(membershipId)}?version=${version}`, { method: 'DELETE' });
}

export async function respondMeetingInvitation(meetingId: string, responseStatus: MeetingResponseStatus, version: number): Promise<MeetingParticipant> {
    return authorizedRequest<MeetingParticipant>(`v1/meetings/${encodeURIComponent(meetingId)}/participants/me/response`, {
        method: 'PATCH',
        body: JSON.stringify({ responseStatus, version }),
    });
}

export interface MeetingMinutesContent {
    summary?: string;
    decisions?: string[];
    actionItems?: Array<{ title?: string; ownerMembershipId?: string; dueDate?: string | null }>;
    notes?: string | null;
}

export interface MeetingMinutes {
    id: string;
    meetingId: string;
    content: MeetingMinutesContent;
    status: 'DRAFT' | 'PUBLISHED';
    recorder?: { membershipId?: string; account?: string; displayName?: string } | null;
    publishedAt?: string | null;
    version: number;
}

export async function getMeetingMinutes(meetingId: string): Promise<MeetingMinutes | null> {
    return authorizedRequest<MeetingMinutes | null>(`v1/meetings/${encodeURIComponent(meetingId)}/minutes`);
}

export async function upsertMeetingMinutes(meetingId: string, content: MeetingMinutesContent, version?: number): Promise<MeetingMinutes> {
    return authorizedRequest<MeetingMinutes>(`v1/meetings/${encodeURIComponent(meetingId)}/minutes`, {
        method: 'PUT',
        body: JSON.stringify({
            content,
            ...(version ? { version } : {}),
        }),
    });
}

export async function publishMeetingMinutes(meetingId: string, version: number): Promise<MeetingMinutes> {
    return authorizedRequest<MeetingMinutes>(`v1/meetings/${encodeURIComponent(meetingId)}/minutes/publish`, {
        method: 'POST',
        body: JSON.stringify({ version }),
    });
}

export async function reopenMeetingMinutes(meetingId: string, version: number): Promise<MeetingMinutes> {
    return authorizedRequest<MeetingMinutes>(`v1/meetings/${encodeURIComponent(meetingId)}/minutes/reopen`, {
        method: 'POST',
        body: JSON.stringify({ version }),
    });
}

// ---------------------------------------------------------------------------
// 日报与周报（0.16.0）
// 注意：使用文档未提供该域的具体路径与请求体契约（本地 openapi.yaml 尚未同步到 0.16.0），
// 以下按 RESTful 惯例实现为 /work-reports 系列，如后端实际路径不同仅需调整本节。
// ---------------------------------------------------------------------------

export type WorkReportType = 'DAILY' | 'WEEKLY';
export type WorkReportStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

export interface WorkReport {
    id: string;
    type: WorkReportType;
    periodStart: string;
    periodEnd?: string | null;
    content?: string | null;
    status: WorkReportStatus;
    author?: { membershipId?: string; account?: string; displayName?: string } | null;
    reviewer?: { membershipId?: string; account?: string; displayName?: string } | null;
    reviewComment?: string | null;
    reviewedAt?: string | null;
    submittedAt?: string | null;
    createdAt?: string;
    updatedAt?: string;
    version: number;
}

export interface CreateWorkReportInput {
    type: WorkReportType;
    periodStart: string;
    content: string;
}

export interface ListWorkReportsParams {
    type?: WorkReportType;
    status?: WorkReportStatus;
    from?: string;
    to?: string;
}

export async function listWorkReports(params: ListWorkReportsParams = {}): Promise<CursorPage<WorkReport>> {
    const query = new URLSearchParams({ limit: '50' });
    if (params.type) query.set('type', params.type);
    if (params.status) query.set('status', params.status);
    if (params.from) query.set('from', params.from);
    if (params.to) query.set('to', params.to);
    return authorizedRequest<CursorPage<WorkReport>>(`v1/work-reports?${query}`);
}

export async function createWorkReport(input: CreateWorkReportInput): Promise<WorkReport> {
    return authorizedRequest<WorkReport>('v1/work-reports', {
        method: 'POST',
        body: JSON.stringify({
            type: input.type,
            periodStart: input.periodStart,
            content: input.content.trim(),
        }),
    });
}

export async function getWorkReport(reportId: string): Promise<WorkReport> {
    return authorizedRequest<WorkReport>(`v1/work-reports/${encodeURIComponent(reportId)}`);
}

export async function updateWorkReport(reportId: string, content: string, version: number): Promise<WorkReport> {
    return authorizedRequest<WorkReport>(`v1/work-reports/${encodeURIComponent(reportId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ content: content.trim(), version }),
    });
}

export async function deleteWorkReport(reportId: string, version: number): Promise<void> {
    return authorizedRequest<void>(`v1/work-reports/${encodeURIComponent(reportId)}?version=${version}`, { method: 'DELETE' });
}

export async function submitWorkReport(reportId: string, version: number): Promise<WorkReport> {
    return authorizedRequest<WorkReport>(`v1/work-reports/${encodeURIComponent(reportId)}/submit`, {
        method: 'POST',
        body: JSON.stringify({ version }),
    });
}

export async function withdrawWorkReport(reportId: string, version: number): Promise<WorkReport> {
    return authorizedRequest<WorkReport>(`v1/work-reports/${encodeURIComponent(reportId)}/withdraw`, {
        method: 'POST',
        body: JSON.stringify({ version }),
    });
}

export async function reviewWorkReport(reportId: string, approved: boolean, comment: string, version: number): Promise<WorkReport> {
    return authorizedRequest<WorkReport>(`v1/work-reports/${encodeURIComponent(reportId)}/${approved ? 'approve' : 'reject'}`, {
        method: 'POST',
        body: JSON.stringify({
            ...(comment.trim() ? { comment: comment.trim() } : {}),
            version,
        }),
    });
}