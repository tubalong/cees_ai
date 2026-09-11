export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://192.168.5.29:3000/api/';

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