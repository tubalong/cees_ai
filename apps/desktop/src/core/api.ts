import { toUserErrorMessage } from './user-error';

// export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/';
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://192.168.5.29:3000/api/';
// export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://132.232.159.186:3000/api/';
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
    documentSpec: Record<string, unknown> | null;
    fileObjectId: string | null;
    fileMimeType: string | null;
    effectivePermissions: string[];
}

interface CursorPage<T> {
    items: T[];
    nextCursor: string | null;
}

async function collectCursorPages<T>(pathForCursor: (cursor?: string) => string): Promise<CursorPage<T>> {
    const items: T[] = [];
    const visited = new Set<string>();
    let cursor: string | undefined;
    do {
        const page = await authorizedRequest<CursorPage<T>>(pathForCursor(cursor));
        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
        if (cursor && visited.has(cursor)) throw new Error('分页游标重复，无法继续加载数据');
        if (cursor) visited.add(cursor);
    } while (cursor);
    return { items, nextCursor: null };
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

/** 会话令牌的键；用于开机时的加密存储迁移与清理。 */
const SESSION_TOKEN_KEYS = [ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, PLATFORM_ACCESS_TOKEN_KEY, PLATFORM_REFRESH_TOKEN_KEY];

/**
 * 令牌存储策略（Electron 加固）。
 *
 * 桌面端由主进程 safeStorage（DPAPI / Keychain / libsecret）加密后落盘，
 * 不在 localStorage / sessionStorage 里留存——Web Storage 是明文，
 * 同源注入脚本可以一次性拿走长期有效的刷新令牌。
 *
 * 浏览器预览环境没有安全存储，保留原有 Web Storage 行为；
 * 「记住我」语义不变：不勾选时令牌只驻内存，关闭应用即需重新登录。
 */
const secureTokens = new Map<string, string>();
/** 已被显式要求持久化的键；未在此集合中的令牌只存在于内存。 */
const persistedTokens = new Set<string>();
let secureSessionHydrated = false;

/** 启动时把手机会话从加密存储解密到内存镜像；完成后同步读取才能命中。 */
export async function hydrateSecureSession(): Promise<void> {
    if (secureSessionHydrated) return;
    secureSessionHydrated = true;
    const store = window.cees?.secureStore;
    if (!store) return;
    try {
        const values = await store.getAll();
        for (const [key, value] of Object.entries(values)) {
            if (!SESSION_TOKEN_KEYS.includes(key)) continue;
            secureTokens.set(key, value);
            persistedTokens.add(key);
        }
    } catch {
        // 解密失败（密钥环变化、文件损坏）按未登录处理：用户重新登录即可。
    }
    // 迁移：旧版本把令牌写在 Web Storage，这里清掉，避免明文残留。
    for (const key of SESSION_TOKEN_KEYS) { localStorage.removeItem(key); sessionStorage.removeItem(key); }
}

function writeToken(key: string, value: string, persist: boolean): void {
    secureTokens.set(key, value);
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
    const store = window.cees?.secureStore;
    if (!store) {
        (persist ? localStorage : sessionStorage).setItem(key, value);
        return;
    }
    if (persist) { persistedTokens.add(key); void store.set(key, value); }
    else { persistedTokens.delete(key); void store.remove(key); }
}

function dropToken(key: string): void {
    secureTokens.delete(key);
    persistedTokens.delete(key);
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
    void window.cees?.secureStore?.remove(key);
}

/** 该令牌是否还应该继续持久化（刷新后写回时用同一策略，避免“记住我”被无意降级）。 */
function shouldPersistSession(): boolean {
    return window.cees?.secureStore ? persistedTokens.has(REFRESH_TOKEN_KEY) : Boolean(localStorage.getItem(REFRESH_TOKEN_KEY));
}

function shouldPersistPlatformSession(): boolean {
    return window.cees?.secureStore ? persistedTokens.has(PLATFORM_REFRESH_TOKEN_KEY) : Boolean(localStorage.getItem(PLATFORM_REFRESH_TOKEN_KEY));
}

export function hasStoredSession(): boolean {
    return Boolean(getStoredValue(ACCESS_TOKEN_KEY) && getStoredValue(REFRESH_TOKEN_KEY));
}

export function persistLogin(result: LoginResult, remember: boolean): void {
    clearPlatformSession();
    clearStorage(localStorage);
    clearStorage(sessionStorage);
    writeToken(ACCESS_TOKEN_KEY, result.accessToken, remember);
    writeToken(REFRESH_TOKEN_KEY, result.refreshToken, remember);
}

export function clearSession(): void {
    clearStorage(localStorage);
    clearStorage(sessionStorage);
    dropToken(ACCESS_TOKEN_KEY);
    dropToken(REFRESH_TOKEN_KEY);
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

export type KnowledgeSourceType = 'FILE_OBJECT' | 'DOCUMENT' | 'MESSAGE';

export type KnowledgeDocumentVisibilityScope = 'PRIVATE' | 'DEPARTMENT' | 'PROJECT' | 'TENANT';

export type KnowledgeBaseVisibilityScope = 'PRIVATE' | 'DEPARTMENT' | 'PROJECT' | 'TENANT';

export type KnowledgeBaseMemberPermission = 'READER' | 'EDITOR' | 'MANAGER';

export interface KnowledgeBaseSummary {
    id: string;
    tenantId: string;
    name: string;
    description: string | null;
    visibilityScope: KnowledgeBaseVisibilityScope;
    departmentId: string | null;
    projectId: string | null;
    memberCount: number;
    /** 当前用户对该库的成员等级；锚点人群与 read_all 恒 READER，manage_all 恒 MANAGER。 */
    myPermission: KnowledgeBaseMemberPermission;
    createdBy: string | null;
    updatedBy: string | null;
    version: number;
    createdAt: string;
    updatedAt: string;
}

export interface KnowledgeDocumentResult {
    id: string;
    tenantId: string;
    knowledgeBaseId: string;
    name: string;
    status: 'PENDING' | 'PARSING' | 'PARSED' | 'INDEXING' | 'READY' | 'FAILED';
    fileObjectId: string;
    versionNumber: number;
    currentVersionId: string;
    retryCount: number;
    lastError: string | null;
    visibilityScope: KnowledgeDocumentVisibilityScope;
    departmentId: string | null;
    projectId: string | null;
    createdBy: string | null;
    updatedBy: string | null;
    version: number;
    createdAt: string;
    updatedAt: string;
}

/** 转存目标库候选：当前用户达到 EDITOR 成员权限的知识库（块 7c）。 */
export async function listWritableKnowledgeBases(): Promise<{ items: KnowledgeBaseSummary[]; nextCursor: string | null }> {
    return authorizedRequest<{ items: KnowledgeBaseSummary[]; nextCursor: string | null }>('v1/knowledge-bases?permission=EDITOR&limit=100');
}

// ---------------------------------------------------------------------------
// 知识库管理（块 9）：库 CRUD、归属锚点与成员管理
// ---------------------------------------------------------------------------

export interface ListKnowledgeBasesParams {
    keyword?: string;
    limit?: number;
    cursor?: string;
    permission?: KnowledgeBaseMemberPermission;
}

export async function listKnowledgeBases(params: ListKnowledgeBasesParams = {}): Promise<CursorPage<KnowledgeBaseSummary>> {
    const query = new URLSearchParams({ limit: String(params.limit ?? 100) });
    if (params.keyword?.trim()) query.set('keyword', params.keyword.trim());
    if (params.cursor) query.set('cursor', params.cursor);
    if (params.permission) query.set('permission', params.permission);
    return authorizedRequest<CursorPage<KnowledgeBaseSummary>>(`v1/knowledge-bases?${query}`);
}

export interface CreateKnowledgeBaseInput {
    name: string;
    description?: string | null;
    visibilityScope?: KnowledgeBaseVisibilityScope;
    departmentId?: string;
    projectId?: string;
}

export async function createKnowledgeBase(input: CreateKnowledgeBaseInput): Promise<KnowledgeBaseSummary> {
    return authorizedRequest<KnowledgeBaseSummary>('v1/knowledge-bases', {
        method: 'POST',
        body: JSON.stringify({
            name: input.name.trim(),
            ...(input.description?.trim() ? { description: input.description.trim() } : {}),
            ...(input.visibilityScope ? { visibilityScope: input.visibilityScope } : {}),
            ...(input.departmentId ? { departmentId: input.departmentId } : {}),
            ...(input.projectId ? { projectId: input.projectId } : {}),
        }),
    });
}

export interface UpdateKnowledgeBaseInput {
    name?: string;
    description?: string | null;
    visibilityScope?: KnowledgeBaseVisibilityScope;
    /** 仅 DEPARTMENT 时使用；传 null 清除锚点。 */
    departmentId?: string | null;
    /** 仅 PROJECT 时使用；传 null 清除锚点。 */
    projectId?: string | null;
    version: number;
}

export async function updateKnowledgeBase(knowledgeBaseId: string, input: UpdateKnowledgeBaseInput): Promise<KnowledgeBaseSummary> {
    return authorizedRequest<KnowledgeBaseSummary>(`v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
            ...(input.name?.trim() ? { name: input.name.trim() } : {}),
            ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
            ...(input.visibilityScope !== undefined ? { visibilityScope: input.visibilityScope } : {}),
            ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
            ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
            version: input.version,
        }),
    });
}

export async function deleteKnowledgeBase(knowledgeBaseId: string, version: number): Promise<void> {
    return authorizedRequest<void>(`v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}?version=${version}`, { method: 'DELETE' });
}

export interface KnowledgeBaseMemberSummary {
    id: string;
    tenantId: string;
    knowledgeBaseId: string;
    membershipId: string;
    userId: string;
    account: string;
    displayName: string;
    permission: KnowledgeBaseMemberPermission;
    createdAt: string;
}

export async function listKnowledgeBaseMembers(knowledgeBaseId: string): Promise<CursorPage<KnowledgeBaseMemberSummary>> {
    // 契约未定义 limit 参数（后端固定每页最多 100 条），传递未知参数会被 DTO 白名单拒绝。
    return authorizedRequest<CursorPage<KnowledgeBaseMemberSummary>>(`v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/members`);
}

export async function addKnowledgeBaseMember(knowledgeBaseId: string, membershipId: string, permission: KnowledgeBaseMemberPermission): Promise<KnowledgeBaseMemberSummary> {
    return authorizedRequest<KnowledgeBaseMemberSummary>(`v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/members`, {
        method: 'POST',
        body: JSON.stringify({ membershipId, permission }),
    });
}

export async function updateKnowledgeBaseMember(knowledgeBaseId: string, membershipId: string, permission: KnowledgeBaseMemberPermission): Promise<KnowledgeBaseMemberSummary> {
    return authorizedRequest<KnowledgeBaseMemberSummary>(`v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/members/${encodeURIComponent(membershipId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ permission }),
    });
}

export async function removeKnowledgeBaseMember(knowledgeBaseId: string, membershipId: string): Promise<void> {
    return authorizedRequest<void>(`v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/members/${encodeURIComponent(membershipId)}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// 知识库文档管理：上传文件对象进解析索引队列、列表与失败重试
// ---------------------------------------------------------------------------

export interface ListKnowledgeDocumentsParams {
    keyword?: string;
    limit?: number;
    cursor?: string;
}

export async function listKnowledgeDocuments(knowledgeBaseId: string, params: ListKnowledgeDocumentsParams = {}): Promise<CursorPage<KnowledgeDocumentResult>> {
    const query = new URLSearchParams({ limit: String(params.limit ?? 100) });
    if (params.keyword?.trim()) query.set('keyword', params.keyword.trim());
    if (params.cursor) query.set('cursor', params.cursor);
    return authorizedRequest<CursorPage<KnowledgeDocumentResult>>(`v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/documents?${query}`);
}

/** 人工上传路径：关联已上传完成的文件对象创建文档，进入 PENDING 后由后台任务解析索引。 */
export async function uploadKnowledgeDocument(knowledgeBaseId: string, input: {
    fileObjectId: string;
    name?: string;
    visibilityScope: KnowledgeDocumentVisibilityScope;
}): Promise<KnowledgeDocumentResult> {
    return authorizedRequest<KnowledgeDocumentResult>(`v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/documents`, {
        method: 'POST',
        body: JSON.stringify({
            fileObjectId: input.fileObjectId,
            name: input.name?.trim() || undefined,
            visibilityScope: input.visibilityScope,
        }),
    });
}

/** 重新把处理失败的文档送入解析索引队列（仅 FAILED 状态可重试）。 */
export async function retryKnowledgeDocument(knowledgeBaseId: string, documentId: string): Promise<KnowledgeDocumentResult> {
    return authorizedRequest<KnowledgeDocumentResult>(`v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/documents/${encodeURIComponent(documentId)}/retry`, {
        method: 'POST',
    });
}

/** 删除文档：软删业务记录并异步清理全部版本的向量索引（需库内 EDITOR 及以上权限）。 */
export async function deleteKnowledgeDocument(knowledgeBaseId: string, documentId: string): Promise<void> {
    return authorizedRequest<void>(`v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' });
}

/** 对话数据转知识库：附件 / AI 生成文档 / 对话消息走统一转存端点（块 7c）。 */
export async function createKnowledgeDocument(knowledgeBaseId: string, input: {
    sourceType: KnowledgeSourceType;
    sourceId: string;
    name?: string;
    visibilityScope: KnowledgeDocumentVisibilityScope;
}): Promise<KnowledgeDocumentResult> {
    return authorizedRequest<KnowledgeDocumentResult>(`v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/documents`, {
        method: 'POST',
        body: JSON.stringify({
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            name: input.name?.trim() || undefined,
            visibilityScope: input.visibilityScope,
        }),
    });
}

export async function updateDocument(documentId: string, input: { content: string; version: number }): Promise<ManagedDocumentDetail> {
    return authorizedRequest<ManagedDocumentDetail>(`v1/documents/${encodeURIComponent(documentId)}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
    });
}

export async function exportDocument(
    documentId: string,
    format: 'docx' | 'pdf' | 'pptx',
    preferredName?: string,
    template: 'business-standard' | 'editorial-modern' | 'executive-dark' | 'product-story' | 'academic-clean' | 'minimal-mono' = 'editorial-modern',
): Promise<void> {
    const accessToken = getStoredValue(ACCESS_TOKEN_KEY);
    if (!accessToken) throw new Error('登录状态已失效，请重新登录');
    const suffix = format === 'docx' ? 'export' : `export/${format}`;
    const requestUrl = new URL(`v1/documents/${encodeURIComponent(documentId)}/${suffix}`, API_BASE_URL);
    if (format !== 'docx') requestUrl.searchParams.set('template', template);
    const response = await userFetch(requestUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
        const body = await response.json().catch(() => null) as ApiErrorBody | null;
        throw new Error(body?.message?.toString() || body?.error?.message || '导出失败');
    }
    const blob = await response.blob();
    const filename = resolveDownloadFilename(response.headers.get('Content-Disposition'), format, preferredName);
    const blobUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(blobUrl);
}

export async function downloadGeneratedDocumentFile(
    documentId: string,
    preferredName: string,
    extension: string,
): Promise<void> {
    const accessToken = getStoredValue(ACCESS_TOKEN_KEY);
    if (!accessToken) throw new Error('登录状态已失效，请重新登录');
    const response = await userFetch(new URL(`v1/documents/${encodeURIComponent(documentId)}/file`, API_BASE_URL), {
        headers: { Authorization: `Bearer ${accessToken}` },
        redirect: 'follow',
    });
    if (!response.ok) {
        const body = await response.json().catch(() => null) as ApiErrorBody | null;
        throw new Error(body?.message?.toString() || body?.error?.message || '文件下载失败');
    }
    const blobUrl = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = `${preferredName}.${extension}`;
    anchor.click();
    URL.revokeObjectURL(blobUrl);
}

/**
 * 取回已落盘生成文件的字节，供「另存为」使用。
 *
 * 与 downloadGeneratedDocumentFile 的区别：这里**不触发浏览器默认下载**，
 * 而是把字节交回调用方，由 Electron 主进程用系统保存对话框决定落盘位置。
 * 浏览器预览环境没有本机保存能力，调用方应先判断 window.cees.localSystem。
 */
export async function fetchGeneratedDocumentBytes(documentId: string): Promise<Uint8Array> {
    const accessToken = getStoredValue(ACCESS_TOKEN_KEY);
    if (!accessToken) throw new Error('登录状态已失效，请重新登录');
    const response = await userFetch(new URL(`v1/documents/${encodeURIComponent(documentId)}/file`, API_BASE_URL), {
        headers: { Authorization: `Bearer ${accessToken}` },
        redirect: 'follow',
    });
    if (!response.ok) {
        const body = await response.json().catch(() => null) as ApiErrorBody | null;
        throw new Error(body?.message?.toString() || body?.error?.message || '读取文件内容失败');
    }
    return new Uint8Array(await response.arrayBuffer());
}

/**
 * 计算下载文件名：优先使用服务端 Content-Disposition 携带的文档标题；当响应头不可读
 * （如未被 CORS 暴露）或只是通用兜底名（document.* / presentation.*）时，退回调用方
 * 已知的文档标题，确保用户始终下载到「按主题命名」的文件，而不是 document.pdf。
 */
export function resolveDownloadFilename(disposition: string | null, format: string, preferredName?: string): string {
    const fromHeader = filenameFromDisposition(disposition, format);
    const preferred = preferredName ? sanitizeDownloadName(preferredName) : '';
    if (preferred && isGenericDownloadName(fromHeader, format)) return `${preferred}.${format}`;
    return fromHeader;
}

/** 判定服务端返回的名字是否只是通用兜底名（document.* / presentation.*）。 */
export function isGenericDownloadName(name: string, format: string): boolean {
    const lower = name.trim().toLowerCase();
    return lower === `document.${format}` || lower === `presentation.${format}`;
}

/** 清理用户可见的下载文件名主名：与 api 侧一致地去除文件系统非法字符与控制符。 */
export function sanitizeDownloadName(title: string): string {
    return title
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\.+$/g, '')
        .slice(0, 120);
}

/**
 * 从 Content-Disposition 解析下载文件名，优先取 RFC 5987 的 `filename*=UTF-8''`
 * （可携带中文等非 ASCII 标题），退回 `filename="..."`，都缺失时用 `document.<format>`。
 * 需要服务端在 CORS 暴露 Content-Disposition，否则浏览器读不到此头。
 */
export function filenameFromDisposition(disposition: string | null, format: string): string {
    if (disposition) {
        const extended = /filename\*\s*=\s*utf-8''([^;]+)/i.exec(disposition);
        if (extended) {
            try { return decodeURIComponent(extended[1].trim()); } catch { /* 编码非法时退回 ASCII 分支 */ }
        }
        const basic = /filename\s*=\s*"([^"]*)"|filename\s*=\s*([^;]+)/i.exec(disposition);
        const candidate = (basic?.[1] ?? basic?.[2])?.trim();
        if (candidate) return candidate;
    }
    return `document.${format}`;
}

async function authorizedRequest<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const accessToken = getStoredValue(ACCESS_TOKEN_KEY);
    if (!accessToken) throw new Error('登录状态已失效，请重新登录');
    const response = await userFetch(new URL(path, API_BASE_URL), {
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
    const response = await userFetch(new URL(path, API_BASE_URL), {
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
            const persist = shouldPersistSession();
            writeToken(ACCESS_TOKEN_KEY, tokens.accessToken, persist);
            writeToken(REFRESH_TOKEN_KEY, tokens.refreshToken, persist);
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

async function userFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const controller = init?.signal ? undefined : new AbortController();
    let timedOut = false;
    const timeout = controller ? setTimeout(() => { timedOut = true; controller.abort(); }, 60_000) : undefined;
    try {
        return await fetch(input, controller ? { ...init, signal: controller.signal } : init);
    } catch (error) {
        throw new Error(timedOut ? '请求超时，请稍后重试' : toUserErrorMessage(error, '网络连接失败，请检查网络或服务是否已启动'));
    } finally {
        if (timeout) clearTimeout(timeout);
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
    if (Array.isArray(details) && typeof details[0] === 'string') return toUserErrorMessage(details[0]);
    const message = body.message ?? body.error?.message;
    if (Array.isArray(message)) return toUserErrorMessage(message[0], '请求失败，请稍后重试');
    return toUserErrorMessage(message, '请求失败，请稍后重试');
}

function getStoredValue(key: string): string | null {
    // 优先读内存镜像（可能来自加密存储），再回退 Web Storage（浏览器预览）。
    return secureTokens.get(key) ?? localStorage.getItem(key) ?? sessionStorage.getItem(key);
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
    clearPlatformStorage(localStorage);
    clearPlatformStorage(sessionStorage);
    writeToken(PLATFORM_ACCESS_TOKEN_KEY, result.accessToken, remember);
    writeToken(PLATFORM_REFRESH_TOKEN_KEY, result.refreshToken, remember);
}

export function clearPlatformSession(): void {
    clearPlatformStorage(localStorage);
    clearPlatformStorage(sessionStorage);
    dropToken(PLATFORM_ACCESS_TOKEN_KEY);
    dropToken(PLATFORM_REFRESH_TOKEN_KEY);
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
    const response = await userFetch(new URL(path, API_BASE_URL), {
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
            const persist = shouldPersistPlatformSession();
            writeToken(PLATFORM_ACCESS_TOKEN_KEY, tokens.accessToken, persist);
            writeToken(PLATFORM_REFRESH_TOKEN_KEY, tokens.refreshToken, persist);
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

export type DingTalkIntegrationStatus = 'ACTIVE' | 'DISABLED' | 'ERROR';
export type DingTalkSyncJobStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED';
export type DingTalkIntegrationMode = 'SELF_MANAGED_APP' | 'DWS_LOCAL';
export type DingTalkSyncSource = 'SELF_MANAGED_APP' | 'DWS_MCP';
export type DingTalkSyncScope = 'FULL_SCOPE' | 'VISIBLE_SCOPE';

export interface DingTalkIntegration {
    id: string;
    tenantId: string;
    mode: DingTalkIntegrationMode;
    corpId: string | null;
    appKey: string | null;
    authorizedByMembershipId: string | null;
    authorizedExternalUserId: string | null;
    authorizedProfile: string | null;
    grantedCapabilities: string[];
    status: DingTalkIntegrationStatus;
    lastVerifiedAt: string | null;
    lastSyncedAt: string | null;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    version: number;
    createdAt: string;
    updatedAt: string;
}

export interface CreateDingTalkIntegrationInput {
    corpId: string;
    appKey: string;
    appSecret: string;
}

export interface UpdateDingTalkIntegrationInput {
    appKey?: string;
    appSecret?: string;
    status?: Exclude<DingTalkIntegrationStatus, 'ERROR'>;
    version: number;
}

export interface DingTalkDepartment {
    id: string;
    externalDepartmentId: string;
    parentExternalDepartmentId: string | null;
    departmentId: string | null;
    name: string;
    displayOrder: number;
    isDeleted: boolean;
    lastSeenAt: string;
    createdAt: string;
    updatedAt: string;
}

export interface DingTalkUser {
    id: string;
    externalUserId: string;
    unionId: string | null;
    membershipId: string | null;
    name: string;
    title: string | null;
    jobNumber: string | null;
    departmentExternalIds: string[];
    active: boolean;
    admin: boolean;
    boss: boolean;
    isDeleted: boolean;
    lastSeenAt: string;
    createdAt: string;
    updatedAt: string;
}

export interface DingTalkSyncJob {
    id: string;
    integrationId: string;
    type: string;
    source: DingTalkSyncSource;
    scope: DingTalkSyncScope;
    authorizedByMembershipId: string | null;
    authorizedExternalUserId: string | null;
    status: DingTalkSyncJobStatus;
    departmentCount: number;
    userCount: number;
    errorCode: string | null;
    errorMessage: string | null;
    startedAt: string;
    completedAt: string | null;
    createdAt: string;
}

export interface DingTalkCursorParams {
    limit?: number;
    cursor?: string;
    includeDeleted?: boolean;
}

export async function getDingTalkIntegration(): Promise<DingTalkIntegration | null> {
    try {
        return await authorizedRequest<DingTalkIntegration>('v1/dingtalk/integration');
    } catch (error) {
        if (error instanceof Error && error.message.includes('尚未绑定钉钉企业')) return null;
        throw error;
    }
}

export async function createDingTalkIntegration(input: CreateDingTalkIntegrationInput): Promise<DingTalkIntegration> {
    return authorizedRequest<DingTalkIntegration>('v1/dingtalk/integration', {
        method: 'POST',
        body: JSON.stringify({
            corpId: input.corpId.trim(),
            appKey: input.appKey.trim(),
            appSecret: input.appSecret,
        }),
    });
}

export async function updateDingTalkIntegration(input: UpdateDingTalkIntegrationInput): Promise<DingTalkIntegration> {
    return authorizedRequest<DingTalkIntegration>('v1/dingtalk/integration', {
        method: 'PATCH',
        body: JSON.stringify({
            ...(input.appKey?.trim() ? { appKey: input.appKey.trim() } : {}),
            ...(input.appSecret ? { appSecret: input.appSecret } : {}),
            ...(input.status ? { status: input.status } : {}),
            version: input.version,
        }),
    });
}

export async function verifyDingTalkIntegration(): Promise<DingTalkIntegration> {
    return authorizedRequest<DingTalkIntegration>('v1/dingtalk/integration/verify', { method: 'POST' });
}

export async function syncDingTalkOrganization(): Promise<DingTalkSyncJob> {
    return authorizedRequest<DingTalkSyncJob>('v1/dingtalk/organization/sync', { method: 'POST' });
}

export interface DingTalkVisibleOrganizationSnapshotInput {
    corpId: string;
    externalUserId: string;
    externalUserName: string;
    profile: string;
    fetchedAt: string;
    capabilities: string[];
    departments: Array<{
        externalDepartmentId: string;
        parentExternalDepartmentId: string | null;
        name: string;
        displayOrder: number;
    }>;
    users: Array<{
        externalUserId: string;
        unionId: string | null;
        name: string;
        title: string | null;
        jobNumber: string | null;
        departmentExternalIds: string[];
        active: boolean;
        admin: boolean;
        boss: boolean;
    }>;
}

export async function importDingTalkVisibleOrganizationSnapshot(
    input: DingTalkVisibleOrganizationSnapshotInput,
): Promise<DingTalkSyncJob> {
    return authorizedRequest<DingTalkSyncJob>('v1/dingtalk/organization/snapshot', {
        method: 'POST',
        body: JSON.stringify(input),
    });
}

export async function listDingTalkDepartments(input: DingTalkCursorParams = {}): Promise<{ items: DingTalkDepartment[]; nextCursor: string | null }> {
    const query = new URLSearchParams({ limit: String(input.limit ?? 100), includeDeleted: String(input.includeDeleted ?? false) });
    if (input.cursor) query.set('cursor', input.cursor);
    return authorizedRequest<{ items: DingTalkDepartment[]; nextCursor: string | null }>(`v1/dingtalk/organization/departments?${query}`);
}

export async function listDingTalkUsers(input: DingTalkCursorParams = {}): Promise<{ items: DingTalkUser[]; nextCursor: string | null }> {
    const query = new URLSearchParams({ limit: String(input.limit ?? 100), includeDeleted: String(input.includeDeleted ?? false) });
    if (input.cursor) query.set('cursor', input.cursor);
    return authorizedRequest<{ items: DingTalkUser[]; nextCursor: string | null }>(`v1/dingtalk/organization/users?${query}`);
}

export async function listDingTalkSyncJobs(input: { limit?: number; cursor?: string } = {}): Promise<{ items: DingTalkSyncJob[]; nextCursor: string | null }> {
    const query = new URLSearchParams({ limit: String(input.limit ?? 20) });
    if (input.cursor) query.set('cursor', input.cursor);
    return authorizedRequest<{ items: DingTalkSyncJob[]; nextCursor: string | null }>(`v1/dingtalk/sync-jobs?${query}`);
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
    // 契约（openapi FileMetadata）：完成直传返回正式文件元数据，文件标识字段为 id。
    id: string;
    fileName?: string;
    sizeBytes?: number;
}

function readUploadSession(data: Record<string, unknown>): UploadSessionCreated {
    // 后端返回嵌套结构：upload: { method, url, headers }，fileId 为文件对象 ID；顶层字段为兼容回退。
    const nested = (data.upload ?? {}) as Record<string, unknown>;
    const uploadUrl = (nested.url ?? data.uploadUrl ?? data.putUrl ?? data.url) as string | undefined;
    if (!uploadUrl) throw new Error('上传会话响应缺少直传地址');
    const rawHeaders = (nested.headers ?? data.uploadHeaders ?? data.headers ?? data.requiredHeaders ?? {}) as Record<string, unknown>;
    const uploadHeaders: Record<string, string> = {};
    Object.entries(rawHeaders).forEach(([key, value]) => {
        if (typeof value === 'string') uploadHeaders[key] = value;
    });
    return {
        uploadSessionId: String(data.uploadSessionId ?? data.id ?? ''),
        fileObjectId: String(data.fileId ?? data.fileObjectId ?? ''),
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
    const response = await userFetch(url, { method: 'PUT', headers, body: blob });
    if (!response.ok) throw new Error(`文件上传失败，请稍后重试（状态码 ${response.status}）`);
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
    return completed.id || session.fileObjectId;
}

// ---------------------------------------------------------------------------
// AI 对话（0.19.0，服务端会话与 SSE 事件流）
// ---------------------------------------------------------------------------

export type ChatMode = 'standard' | 'ultra';

export interface Conversation { id: string; title: string; mode: ChatMode; visibility: 'PRIVATE'; version: number; createdAt: string; updatedAt: string; lastTurnAt?: string | null; }
export interface ConversationMessage { id: string; role: 'USER' | 'ASSISTANT' | 'TOOL'; content: string; createdAt: string; turnId?: string | null; toolCallId?: string | null; connectorContexts?: ConnectorContext[] | null; resources?: Array<{ id: string; resourceId?: string; type: 'IMAGE' | 'DOCUMENT'; url?: string | null; resourceUrl?: string | null }> | null; sources?: Array<{ id: string; title: string; url: string; domain: string; snippet: string; publishedAt?: string | null }> | null; citations?: Array<{ id: string; title: string; snippet: string; pageIndex?: number | null; knowledgeBaseId?: string | null; deletable?: boolean }> | null; }
export interface ConversationDetail { conversation: Conversation; messages: ConversationMessage[]; }
export interface Turn { id: string; conversationId: string; status: 'RECEIVED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'; mode: ChatMode; error?: Record<string, unknown> | null; createdAt: string; completedAt?: string | null; }
export interface ImageAccess { id: string; resourceId: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; sizeBytes: number; url: string; prompt?: string | null; model?: string | null; createdAt: string; }
/** 本轮实际生效的对话能力；autoEnabled 只包含服务端因意图识别自动启用的能力。 */
export interface TurnCapabilities { webSearch: boolean; knowledgeBase: boolean; autoEnabled: Array<'web_search' | 'knowledge_search'>; }
export interface PageAssistantContext {
    source: 'project-management' | 'finance-management' | 'legal-contracts' | 'knowledge-management' | 'organization-management' | 'hr-management';
    role: string;
    selected?: Record<string, string | number | boolean | null>;
    summary?: Record<string, string | number | boolean | null>;
}
export interface GenerationOptions {
    kind: 'image' | 'document';
    aspectRatio?: 'square' | 'landscape' | 'portrait';
    quality?: 'standard' | 'high';
    template?: 'business-standard' | 'editorial-modern' | 'executive-dark' | 'product-story' | 'academic-clean' | 'minimal-mono';
}
/** 写操作待确认预览；确认前不产生任何业务副作用。 */
export interface ToolResultConfirmation {
    draftId: string;
    toolName: string;
    title: string;
    fields: Array<{ label: string; value: string }>;
    expiresAt: string;
}

export type TurnStreamEvent =
    | { type: 'started'; seq: number; requestId: string; conversationId: string; turnId: string; mode: ChatMode; contextUsage: Record<string, unknown>; capabilities?: TurnCapabilities }
    | { type: 'status'; seq: number; phase: 'reasoning' | 'answering' | 'tool_executing' }
    | { type: 'content_delta'; seq: number; text: string }
    | { type: 'tool_call'; seq: number; toolCallId: string; name: string; arguments: Record<string, unknown> }
    | { type: 'tool_result'; seq: number; toolCallId: string; status: 'completed' | 'failed' | 'rejected' | 'awaiting_confirmation'; resourceId?: string | null; resourceUrl?: string | null; resource?: { id: string; type: 'IMAGE' | 'DOCUMENT' } | null; sources?: Array<{ id: string; title: string; url: string; domain: string; snippet: string; publishedAt?: string | null }>; citations?: Array<{ id: string; title: string; snippet: string; pageIndex?: number | null }>; confirmation?: ToolResultConfirmation | null; error?: { code: string; message: string } | null }
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

export interface ConnectorContext {
    provider: 'DINGTALK' | 'TENCENT_MEETING' | 'WECOM' | 'GITHUB' | 'LOCAL_SYSTEM';
    toolId: string;
    toolName: string;
    fetchedAt: string;
    data: Record<string, unknown>;
    riskLevel?: 'READ' | 'WRITE' | 'DESTRUCTIVE';
    confirmed?: boolean;
}

export interface DingTalkConnectorTool {
    toolId: string;
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

/**
 * 受控多步接力：同一次用户请求内已执行的连接器步骤摘要。
 * `resultDigest` 由连接器返回内容生成，属于不可信数据，服务端只允许用它抽取 ID 或字段。
 */
export interface ConnectorPreviousStep {
    toolId: string;
    argumentsDigest?: string;
    resultDigest?: string;
    status: 'SUCCESS' | 'FAILED' | 'REJECTED';
}

export interface DingTalkConnectorPlan {
    calls: Array<{ toolId: string; arguments: Record<string, unknown> }>;
    followUpMayBeNeeded?: boolean;
}

export async function planDingTalkConnectorQueries(
    query: string,
    tools: DingTalkConnectorTool[],
    previousSteps: ConnectorPreviousStep[] = [],
): Promise<DingTalkConnectorPlan> {
    return authorizedRequest<DingTalkConnectorPlan>('v1/assistant/connectors/dingtalk/plan', {
        method: 'POST',
        body: JSON.stringify({ query, tools, ...(previousSteps.length ? { previousSteps } : {}) }),
    });
}

export interface TencentMeetingConnectorTool {
    toolId: string;
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    riskLevel: 'READ' | 'WRITE' | 'DESTRUCTIVE';
    requiresConfirmation: boolean;
}

export interface TencentMeetingConnectorPlan {
    calls: Array<{ toolId: string; arguments: Record<string, unknown> }>;
    followUpMayBeNeeded?: boolean;
}

export async function planTencentMeetingConnectorQueries(
    query: string,
    tools: TencentMeetingConnectorTool[],
    previousSteps: ConnectorPreviousStep[] = [],
): Promise<TencentMeetingConnectorPlan> {
    return authorizedRequest<TencentMeetingConnectorPlan>('v1/assistant/connectors/tencent-meeting/plan', {
        method: 'POST',
        body: JSON.stringify({ query, tools, ...(previousSteps.length ? { previousSteps } : {}) }),
    });
}

export interface WeComConnectorTool {
    toolId: string;
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    riskLevel: 'READ' | 'WRITE' | 'DESTRUCTIVE';
    requiresConfirmation: boolean;
}

export interface WeComConnectorPlan {
    calls: Array<{ toolId: string; arguments: Record<string, unknown> }>;
    followUpMayBeNeeded?: boolean;
}

export async function planWeComConnectorQueries(
    query: string,
    tools: WeComConnectorTool[],
    previousSteps: ConnectorPreviousStep[] = [],
): Promise<WeComConnectorPlan> {
    return authorizedRequest<WeComConnectorPlan>('v1/assistant/connectors/wecom/plan', {
        method: 'POST',
        body: JSON.stringify({ query, tools, ...(previousSteps.length ? { previousSteps } : {}) }),
    });
}

export interface GitHubConnectorTool {
    toolId: string;
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    riskLevel: 'READ' | 'WRITE' | 'DESTRUCTIVE';
    requiresConfirmation: boolean;
}

export interface GitHubConnectorPlan {
    calls: Array<{ toolId: string; arguments: Record<string, unknown> }>;
    followUpMayBeNeeded?: boolean;
}

export async function planGitHubConnectorQueries(
    query: string,
    tools: GitHubConnectorTool[],
    previousSteps: ConnectorPreviousStep[] = [],
): Promise<GitHubConnectorPlan> {
    return authorizedRequest<GitHubConnectorPlan>('v1/assistant/connectors/github/plan', {
        method: 'POST',
        body: JSON.stringify({ query, tools, ...(previousSteps.length ? { previousSteps } : {}) }),
    });
}

export type ConnectorRoutingProvider = 'DINGTALK' | 'TENCENT_MEETING' | 'WECOM' | 'GITHUB';

/** 参与连接器语义路由的一级目录项；只描述能回答哪类问题，不含工具名、参数或凭据。 */
export interface ConnectorRoutingCandidate {
    provider: ConnectorRoutingProvider;
    displayName: string;
    capabilitySummary: string;
    routingExamples?: string[];
    state: 'NOT_INSTALLED' | 'AUTH_REQUIRED' | 'PROFILE_REQUIRED' | 'READY' | 'ERROR';
    toolCount?: number;
}

export interface ConnectorRoutingResult {
    providers: ConnectorRoutingProvider[];
    clarification: string | null;
    reason: string;
}

/**
 * 连接器语义路由：只决定本轮该试哪些连接器，不执行任何外部调用、不接收凭据。
 * clarification 非空时不得再调用任何连接器规划或执行接口，只把提示交给本轮对话让模型反问。
 */
export async function routeAssistantConnector(
    query: string,
    connectors: ConnectorRoutingCandidate[],
): Promise<ConnectorRoutingResult> {
    return authorizedRequest<ConnectorRoutingResult>('v1/assistant/connectors/route', {
        method: 'POST',
        body: JSON.stringify({ query, connectors }),
    });
}

export interface GitHubOAuthConfig {
    clientId: string;
    authorizationEndpoint: string;
    scope: string;
    exchangePath: string;
}

export interface GitHubOAuthExchangeInput {
    code: string;
    codeVerifier: string;
    redirectUri: string;
}

export interface GitHubOAuthTokens {
    accessToken: string;
    tokenType: string;
    expiresIn: number | null;
    refreshToken: string | null;
    scope: string | null;
}

export async function getGitHubOAuthConfig(): Promise<GitHubOAuthConfig> {
    return authorizedRequest<GitHubOAuthConfig>('v1/assistant/connectors/github/oauth/config');
}

export async function exchangeGitHubOAuthCode(input: GitHubOAuthExchangeInput): Promise<GitHubOAuthTokens> {
    return authorizedRequest<GitHubOAuthTokens>('v1/assistant/connectors/github/oauth/exchange', {
        method: 'POST',
        body: JSON.stringify(input),
    });
}

export function getAccessTokenForConnector(): string {
    const accessToken = getStoredValue(ACCESS_TOKEN_KEY);
    if (!accessToken) throw new Error('登录状态已失效，请重新登录');
    return accessToken;
}

async function streamSse(path: string, init: RequestInit, onEvent: (event: TurnStreamEvent) => void, retry = true): Promise<void> {
    const accessToken = getStoredValue(ACCESS_TOKEN_KEY);
    if (!accessToken) throw new Error('登录状态已失效，请重新登录');
    const response = await userFetch(new URL(path, API_BASE_URL), { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, ...init.headers } });
    if (response.status === 401 && retry) { await refreshTokens(); return streamSse(path, init, onEvent, false); }
    if (!response.ok) { const error = new Error(getErrorMessage(await readBody(response))); (error as Error & { status?: number }).status = response.status; throw error; }
    if (!response.body) throw new Error('服务器未返回事件流');
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
    const consume = (chunk: string) => { const parsed = parseSseFrames(buffer += chunk); buffer = parsed.rest; for (const event of parsed.events) onEvent(event); };
    try { while (true) { const { value, done } = await reader.read(); if (done) { consume(decoder.decode()); if (buffer.trim()) throw new Error('事件流意外中断'); break; } consume(decoder.decode(value, { stream: true })); } } finally { reader.releaseLock(); }
}

export function createTurn(conversationId: string, input: { content: string; mode: ChatMode; imageFileIds?: string[]; fileIds?: string[]; connectorContexts?: ConnectorContext[]; assistantContext?: PageAssistantContext; generationOptions?: GenerationOptions; knowledgeBaseEnabled?: boolean; webSearchEnabled?: boolean; connectorRoutingHint?: string | null }, idempotencyKey: string, onEvent: (event: TurnStreamEvent) => void, signal?: AbortSignal): Promise<void> { return streamSse(`v1/conversations/${encodeURIComponent(conversationId)}/turns`, { method: 'POST', body: JSON.stringify({ content: input.content, mode: input.mode, ...(input.imageFileIds?.length ? { imageFileIds: input.imageFileIds } : {}), ...(input.fileIds?.length ? { fileIds: input.fileIds } : {}), ...(input.connectorContexts?.length ? { connectorContexts: input.connectorContexts } : {}), ...(input.assistantContext ? { assistantContext: input.assistantContext } : {}), ...(input.generationOptions ? { generationOptions: input.generationOptions } : {}), ...(input.knowledgeBaseEnabled ? { knowledgeBaseEnabled: true } : {}), ...(input.webSearchEnabled ? { webSearchEnabled: true } : {}), ...(input.connectorRoutingHint ? { connectorRoutingHint: input.connectorRoutingHint } : {}) }), signal, headers: { 'Idempotency-Key': idempotencyKey } }, onEvent); }
export function replayTurnEvents(conversationId: string, turnId: string, afterSeq: number, onEvent: (event: TurnStreamEvent) => void, signal?: AbortSignal): Promise<void> { return streamSse(`v1/conversations/${encodeURIComponent(conversationId)}/turns/${encodeURIComponent(turnId)}/events?afterSeq=${afterSeq}`, { method: 'GET', signal }, onEvent); }
export async function cancelTurn(conversationId: string, turnId: string): Promise<Turn> { return authorizedRequest<Turn>(`v1/conversations/${encodeURIComponent(conversationId)}/turns/${encodeURIComponent(turnId)}/cancel`, { method: 'POST' }); }

/** 写操作草稿的处理结果；summary 是可直接展示给用户的中文说明。 */
export interface ActionDraftResolution {
    draftId: string;
    status: 'PENDING_CONFIRMATION' | 'EXECUTED' | 'FAILED' | 'REJECTED' | 'EXPIRED';
    summary: string;
    resource?: { type: 'IMAGE' | 'DOCUMENT'; id: string } | null;
}

/**
 * 确认并执行写操作草稿。只提交 draftId：参数快照存在服务端，
 * 客户端无法在确认时替换业务参数（服务端会重新鉴权并重新校验参数）。
 */
export async function confirmActionDraft(draftId: string): Promise<ActionDraftResolution> {
    return authorizedRequest<ActionDraftResolution>(`v1/assistant/action-drafts/${encodeURIComponent(draftId)}/confirm`, { method: 'POST' });
}

/** 取消写操作草稿；取消后不可再确认，需重新发起对话。 */
export async function cancelActionDraft(draftId: string): Promise<ActionDraftResolution> {
    return authorizedRequest<ActionDraftResolution>(`v1/assistant/action-drafts/${encodeURIComponent(draftId)}/cancel`, { method: 'POST' });
}

/** 待确认草稿的展示项；不含参数快照，确认时仍由服务端取快照。 */
export interface PendingActionDraft {
    draftId: string;
    toolName: string;
    title: string;
    fields: Array<{ label: string; value: string }>;
    expiresAt: string;
    conversationId: string;
    createdAt: string;
}

/**
 * 拉取当前成员仍未决策的写操作草稿。
 *
 * 为什么需要它：确认卡片此前只随流式事件到达，刷新页面即消失，而服务端草稿仍在等待确认；
 * 用户于是看不到待办、只会重复发起（表现为「一次只能建一个」）。列表让待办常驻可见。
 */
export async function listAssistantActionDrafts(): Promise<{ items: PendingActionDraft[] }> {
    return authorizedRequest<{ items: PendingActionDraft[] }>('v1/assistant/action-drafts');
}

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

export type DashboardHomepageCard = { key: string; span: 'FULL' | 'HALF' | 'THIRD'; payload: any; link?: string; empty?: 'NEW_TENANT' | 'NO_DATA' | null };
export type DashboardHomepage = {
    archetype: { skeleton: 'EXECUTIVE' | 'MANAGER' | 'EMPLOYEE'; domains: Array<'FINANCE' | 'LEGAL' | 'HR' | 'PROJECT'>; reason: string[] };
    cards: DashboardHomepageCard[];
    alerts: Array<{ code: string; severity: 'HIGH' | 'MEDIUM' | 'LOW'; title: string; detail: string; link?: string }>;
    generatedAt: string;
};

export async function getDashboardHomepage(): Promise<DashboardHomepage> {
    return authorizedRequest<DashboardHomepage>('v1/dashboard/home');
}

export type FinanceLedgerRow = {
    rowNumber: number; occurredOn: string; direction: 'INCOME' | 'EXPENSE'; amount: number;
    currency: string; categoryCode?: string | null; categoryName?: string | null; departmentId?: string | null;
    projectId?: string | null; counterparty?: string | null; summary?: string | null; voucherNo: string;
};

export type FinanceLedgerImport = {
    id: string; fileName: string; status: string; rowCount: number; importedCount: number; skippedCount: number; errorCount: number;
    errors: Array<{ rowNumber: number; message: string }>;
    /** 该批次的台账期间；导入历史用于核对批次覆盖的时间范围。 */
    periodStart: string;
    periodEnd: string;
    /** 原始上传文件的文件对象 ID；未选择留档时为 null。 */
    sourceFileObjectId?: string | null;
    /** 批次创建时间；导入历史按此倒序展示。 */
    createdAt?: string;
    finishedAt?: string | null;
};

export type FinanceLedgerEntry = FinanceLedgerRow & { id: string };

export async function createFinanceLedgerImport(input: {
    fileName: string; format: 'XLSX' | 'CSV'; periodStart: string; periodEnd: string;
    sourceFileObjectId?: string;
    rows: FinanceLedgerRow[];
}): Promise<FinanceLedgerImport> {
    return authorizedRequest<FinanceLedgerImport>('v1/finance/ledger-imports', { method: 'POST', body: JSON.stringify(input) });
}

/** 导入历史（按创建时间倒序）；回滚以批次为粒度，因此必须先能看到批次。 */
export async function listFinanceLedgerImports(limit = 20, cursor?: string): Promise<CursorPage<FinanceLedgerImport>> {
    return requestLedgerImportPage(limit, cursor);
}

async function requestLedgerImportPage(limit: number, cursor?: string): Promise<CursorPage<FinanceLedgerImport>> {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set('cursor', cursor);
    return authorizedRequest<CursorPage<FinanceLedgerImport>>(`v1/finance/ledger-imports?${query.toString()}`);
}

/** 收支明细；direction/dateFrom/dateTo 均可选，用于台账核对。 */
export async function listFinanceLedgerEntries(query: {
    limit?: number; cursor?: string; direction?: 'INCOME' | 'EXPENSE';
    dateFrom?: string; dateTo?: string; category?: string;
} = {}): Promise<CursorPage<FinanceLedgerEntry>> {
    const params = new URLSearchParams({ limit: String(query.limit ?? 20) });
    for (const key of ['cursor', 'direction', 'dateFrom', 'dateTo', 'category'] as const) {
        const value = query[key];
        if (value) params.set(key, String(value));
    }
    return authorizedRequest<CursorPage<FinanceLedgerEntry>>(`v1/finance/ledger-entries?${params.toString()}`);
}

/** 回滚整个导入批次：批次内所有明细一并作废，并重算受影响日期的快照。 */
export async function rollbackFinanceLedgerImport(importId: string): Promise<void> {
    await authorizedRequest<unknown>(`v1/finance/ledger-imports/${encodeURIComponent(importId)}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// 项目与项目成员（0.11.0）
// ---------------------------------------------------------------------------

export type ProjectStatus = 'PLANNING' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED' | 'ARCHIVED';
export type ProjectMemberRole = 'OWNER' | 'MANAGER' | 'MEMBER';

export interface ProjectSummary {
    id: string;
    /** 服务端按企业时区年份自动分配，格式 PRJ-<年>-<序号>；创建后不可修改。 */
    code: string;
    name: string;
    description?: string | null;
    departmentId?: string | null;
    status: ProjectStatus;
    owner?: { membershipId?: string; account?: string; displayName?: string } | null;
    /** project.manage_all 跨项目访问时可能为 null。 */
    currentMemberRole?: ProjectMemberRole | null;
    memberCount?: number;
    taskCount?: number;
    /** 首次启动时间：系统在项目从 PLANNING 转为 ACTIVE 时写入。 */
    startedAt?: string | null;
    completedAt?: string | null;
    /** 关闭时间：项目被取消或归档时系统写入。 */
    closedAt?: string | null;
    completionSummary?: string | null;
    createdAt?: string;
    updatedAt?: string;
    version: number;
}

export interface CreateProjectInput {
    name: string;
    description?: string;
    departmentId?: string | null;
    ownerMembershipId?: string;
    /** 初始项目成员；负责人由服务端自动加入，需要 project.member.manage 权限。 */
    memberMembershipIds?: string[];
}

export interface UpdateProjectInput {
    name?: string;
    description?: string | null;
    departmentId?: string | null;
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
            name: input.name.trim(),
            ...(input.description?.trim() ? { description: input.description.trim() } : {}),
            ...(input.departmentId ? { departmentId: input.departmentId } : {}),
            ...(input.ownerMembershipId ? { ownerMembershipId: input.ownerMembershipId } : {}),
            ...(input.memberMembershipIds?.length ? { memberMembershipIds: input.memberMembershipIds } : {}),
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
            ...(input.name?.trim() ? { name: input.name.trim() } : {}),
            ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
            ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
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

export interface DingTalkMappingRequest {
    activationExpiresInDays?: number;
    createMissingDepartments?: boolean;
    createMissingMembers?: boolean;
}

export interface DingTalkMappingDepartmentPreview {
    dingtalkDepartmentId: string;
    externalDepartmentId: string;
    name: string;
    path: string;
    action: 'MATCH_EXISTING' | 'CREATE' | 'CONFLICT' | 'SKIP';
    departmentId: string | null;
    candidateDepartmentIds: string[];
    reason: string;
}

export interface DingTalkMappingUserPreview {
    dingtalkUserId: string;
    externalUserId: string;
    name: string;
    departmentPaths: string[];
    action: 'MATCH_EXISTING' | 'CREATE' | 'CONFLICT' | 'SKIP';
    membershipId: string | null;
    candidateMembershipIds: string[];
    suggestedAccount: string;
    reason: string;
}

export interface DingTalkMappingPreview {
    activationExpiresInDays: number;
    departments: DingTalkMappingDepartmentPreview[];
    users: DingTalkMappingUserPreview[];
    summary: {
        departmentMatchedCount: number;
        departmentCreateCount: number;
        departmentConflictCount: number;
        userMatchedCount: number;
        userCreateCount: number;
        userConflictCount: number;
    };
}

export interface DingTalkRoleAssignment {
    roleId: string;
    dingtalkUserIds: string[];
}

export interface DingTalkMappingDepartmentResolution {
    dingtalkDepartmentId: string;
    action: 'BIND_EXISTING' | 'CREATE' | 'SKIP';
    departmentId?: string | null;
}

export interface DingTalkMappingUserResolution {
    dingtalkUserId: string;
    action: 'BIND_EXISTING' | 'CREATE' | 'SKIP';
    membershipId?: string | null;
    account?: string | null;
}

export interface DingTalkMappingCredential {
    dingtalkUserId: string;
    membershipId: string;
    displayName: string;
    account: string;
    departmentId: string | null;
    tenantCode: string;
    roleIds: string[];
    roleCodes: string[];
    activationToken: string;
    activationExpiresAt: string;
}

export interface DingTalkMappingResult {
    preview: DingTalkMappingPreview;
    credentials: DingTalkMappingCredential[];
    summary: DingTalkMappingPreview['summary'] & { departmentSkippedCount: number; userSkippedCount: number };
}

export async function previewDingTalkMapping(input: DingTalkMappingRequest = {}): Promise<DingTalkMappingPreview> {
    return authorizedRequest<DingTalkMappingPreview>('v1/dingtalk/organization/mapping/preview', {
        method: 'POST',
        body: JSON.stringify(input),
    });
}

export async function applyDingTalkMapping(input: DingTalkMappingRequest & {
    departmentResolutions?: DingTalkMappingDepartmentResolution[];
    userResolutions?: DingTalkMappingUserResolution[];
    roleAssignments: DingTalkRoleAssignment[];
}): Promise<DingTalkMappingResult> {
    return authorizedRequest<DingTalkMappingResult>('v1/dingtalk/organization/mapping/apply', {
        method: 'POST',
        body: JSON.stringify(input),
    });
}

export type AssignmentPolicyDomain = 'TASK' | 'MEETING' | 'WORK_REPORT' | 'PROJECT' | 'DOCUMENT';
export type AssignmentPolicyLevel = 'TENANT' | 'PROJECT';
export type AssignmentPolicyFallbackMode = 'NONE' | 'PROJECT_MEMBERS' | 'TENANT_MEMBERS';

export interface AssignmentCandidatePool {
    membershipIds: string[];
    departmentIds: string[];
    projectIds: string[];
}

export interface AssignmentPolicy {
    id: string;
    tenantId: string;
    projectId: string | null;
    domain: AssignmentPolicyDomain;
    level: AssignmentPolicyLevel;
    name: string;
    description: string | null;
    candidatePool: AssignmentCandidatePool;
    skipOnLeave: boolean;
    fallbackMode: AssignmentPolicyFallbackMode;
    enabled: boolean;
    version: number;
    createdAt: string;
    updatedAt: string;
}

export interface AssignmentPolicyResolveInput {
    domain: AssignmentPolicyDomain;
    projectId?: string;
    context?: { sourceType: string; sourceId: string };
    availabilityWindow?: { startAt: string; endAt: string };
}

export interface AssignmentPolicyResolveResult {
    matchedPolicyId: string | null;
    domain: AssignmentPolicyDomain;
    level: AssignmentPolicyLevel;
    candidates: string[];
    skippedOnLeave: string[];
    leaveFilterApplied: boolean;
    fallbackMode: AssignmentPolicyFallbackMode;
    sourceTrace: {
        policyId: string | null;
        projectId: string | null;
        domain: AssignmentPolicyDomain;
        level: AssignmentPolicyLevel;
    };
    resolvedAt: string;
}

export interface CreateAssignmentPolicyInput {
    domain: AssignmentPolicyDomain;
    level: AssignmentPolicyLevel;
    projectId?: string;
    name: string;
    description?: string | null;
    candidatePool: AssignmentCandidatePool;
    skipOnLeave: boolean;
    fallbackMode: AssignmentPolicyFallbackMode;
    enabled?: boolean;
}

export interface UpdateAssignmentPolicyInput {
    name?: string;
    description?: string | null;
    candidatePool?: AssignmentCandidatePool;
    skipOnLeave?: boolean;
    fallbackMode?: AssignmentPolicyFallbackMode;
    enabled?: boolean;
    version: number;
}

export async function listAssignmentPolicies(domain?: AssignmentPolicyDomain, projectId?: string): Promise<CursorPage<AssignmentPolicy>> {
    const query = new URLSearchParams({ limit: '100' });
    if (domain) query.set('domain', domain);
    if (projectId) query.set('projectId', projectId);
    return authorizedRequest<CursorPage<AssignmentPolicy>>(`v1/assignment/policies?${query}`);
}

export async function getAssignmentPolicy(policyId: string): Promise<AssignmentPolicy> {
    return authorizedRequest<AssignmentPolicy>(`v1/assignment/policies/${encodeURIComponent(policyId)}`);
}

export async function createAssignmentPolicy(input: CreateAssignmentPolicyInput): Promise<AssignmentPolicy> {
    return authorizedRequest<AssignmentPolicy>('v1/assignment/policies', {
        method: 'POST',
        body: JSON.stringify({
            ...input,
            name: input.name.trim(),
            description: input.description?.trim() || null,
            candidatePool: {
                membershipIds: [...new Set(input.candidatePool.membershipIds)],
                departmentIds: [...new Set(input.candidatePool.departmentIds)],
                projectIds: [...new Set(input.candidatePool.projectIds)],
            },
            enabled: input.enabled ?? true,
        }),
    });
}

export async function updateAssignmentPolicy(policyId: string, input: UpdateAssignmentPolicyInput): Promise<AssignmentPolicy> {
    return authorizedRequest<AssignmentPolicy>(`v1/assignment/policies/${encodeURIComponent(policyId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
            ...(input.name?.trim() ? { name: input.name.trim() } : {}),
            ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
            ...(input.candidatePool ? {
                candidatePool: {
                    membershipIds: [...new Set(input.candidatePool.membershipIds)],
                    departmentIds: [...new Set(input.candidatePool.departmentIds)],
                    projectIds: [...new Set(input.candidatePool.projectIds)],
                },
            } : {}),
            ...(input.skipOnLeave !== undefined ? { skipOnLeave: input.skipOnLeave } : {}),
            ...(input.fallbackMode !== undefined ? { fallbackMode: input.fallbackMode } : {}),
            ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
            version: input.version,
        }),
    });
}

export async function deleteAssignmentPolicy(policyId: string, version: number): Promise<void> {
    return authorizedRequest<void>(`v1/assignment/policies/${encodeURIComponent(policyId)}?version=${version}`, { method: 'DELETE' });
}

export async function resolveAssignmentPolicy(input: AssignmentPolicyResolveInput): Promise<AssignmentPolicyResolveResult> {
    return authorizedRequest<AssignmentPolicyResolveResult>('v1/assignment/policies/resolve', {
        method: 'POST',
        body: JSON.stringify(input),
    });
}

export type HrProfileStatus = 'ACTIVE' | 'SUSPENDED' | 'TERMINATED' | 'ON_LEAVE';
export type HrLeaveUnit = 'DAY' | 'HALF_DAY' | 'HOUR';
export type HrRequestStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type HrAttendanceStatus = 'NORMAL' | 'LATE' | 'EARLY_LEAVE' | 'ABSENT' | 'LEAVE' | 'OVERTIME' | 'EXCEPTION' | 'CORRECTED';
export type HrEmployeeChangeType = 'ONBOARD' | 'PROBATION' | 'TRANSFER' | 'PROMOTION' | 'DEMOTION' | 'RESIGNATION' | 'TERMINATION';
export type HrEmployeeChangeStatus = HrRequestStatus | 'EFFECTIVE';

export interface HrProfile {
    id: string; membershipId: string; employeeNo?: string | null; displayName: string; departmentId?: string | null;
    position?: string | null; employmentType?: string | null; managerMembershipId?: string | null;
    entryDate?: string | null; leaveDate?: string | null; phone?: string | null; email?: string | null;
    idType?: string | null; idNumber?: string | null; emergencyContactName?: string | null;
    emergencyContactPhone?: string | null; educationLevel?: string | null; costCenter?: string | null;
    jobLevel?: string | null; probationEndDate?: string | null; regularDate?: string | null;
    workLocation?: string | null; status: HrProfileStatus; version: number; createdAt: string; updatedAt: string;
}

export interface HrLeaveType { id: string; code: string; name: string; unit: HrLeaveUnit; paid: boolean; defaultDays?: number | null; enabled: boolean; version: number; }
export interface HrLeaveBalance { id: string; membershipId: string; leaveTypeId: string; year: number; totalDays: number; usedDays: number; pendingDays: number; remainingDays: number; unit: HrLeaveUnit; version: number; }
export interface HrLeaveYearAllocation { year: number; days: number }
export interface HrLeaveRequest { id: string; membershipId: string; leaveTypeId: string; startAt: string; endAt: string; durationDays: number; yearAllocations: HrLeaveYearAllocation[]; reason?: string | null; status: HrRequestStatus; reviewedBy?: string | null; reviewedAt?: string | null; reviewComment?: string | null; version: number; createdAt: string; updatedAt: string; }
export interface HrAttendanceRecord { id: string; membershipId: string; workDate: string; checkInAt?: string | null; checkOutAt?: string | null; status: HrAttendanceStatus; source: 'MANUAL' | 'IMPORT' | 'DINGTALK'; note?: string | null; reviewedBy?: string | null; reviewedAt?: string | null; version: number; }
export interface HrOvertimeRequest { id: string; membershipId: string; startAt: string; endAt: string; durationHours: number; reason: string; status: HrRequestStatus; reviewedBy?: string | null; reviewedAt?: string | null; reviewComment?: string | null; version: number; createdAt: string; }
export interface HrEmployeeChange { id: string; membershipId: string; type: HrEmployeeChangeType; effectiveDate: string; fromDepartmentId?: string | null; toDepartmentId?: string | null; fromPosition?: string | null; toPosition?: string | null; fromManagerMembershipId?: string | null; toManagerMembershipId?: string | null; reason?: string | null; status: HrEmployeeChangeStatus; reviewedBy?: string | null; reviewedAt?: string | null; reviewComment?: string | null; version: number; createdAt: string; }

export interface HrProfileInput {
    membershipId?: string; employeeNo?: string | null; departmentId?: string | null; position?: string | null;
    employmentType?: string | null; managerMembershipId?: string | null; entryDate?: string | null;
    phone?: string | null; email?: string | null; idType?: string | null; idNumber?: string | null;
    emergencyContactName?: string | null; emergencyContactPhone?: string | null; educationLevel?: string | null;
    costCenter?: string | null; jobLevel?: string | null; probationEndDate?: string | null; regularDate?: string | null;
    workLocation?: string | null; status?: HrProfileStatus; version?: number;
}

export async function listHrProfiles(keyword?: string): Promise<CursorPage<HrProfile>> {
    return collectCursorPages((cursor) => {
        const query = new URLSearchParams({ limit: '100' });
        if (keyword) query.set('keyword', keyword);
        if (cursor) query.set('cursor', cursor);
        return `v1/hr/profiles?${query}`;
    });
}
export async function createHrProfile(input: HrProfileInput & { membershipId: string }): Promise<HrProfile> { return authorizedRequest<HrProfile>('v1/hr/profiles', { method: 'POST', body: JSON.stringify(input) }); }
export async function updateHrProfile(membershipId: string, input: HrProfileInput & { version: number }): Promise<HrProfile> { return authorizedRequest<HrProfile>(`v1/hr/profiles/${encodeURIComponent(membershipId)}`, { method: 'PATCH', body: JSON.stringify(input) }); }
export async function listHrLeaveTypes(): Promise<{ items: HrLeaveType[] }> { return authorizedRequest<{ items: HrLeaveType[] }>('v1/hr/leave-types'); }
export async function createHrLeaveType(input: Omit<HrLeaveType, 'id' | 'version'>): Promise<HrLeaveType> { return authorizedRequest<HrLeaveType>('v1/hr/leave-types', { method: 'POST', body: JSON.stringify(input) }); }
export async function updateHrLeaveType(id: string, input: Partial<Omit<HrLeaveType, 'id'>> & { version: number }): Promise<HrLeaveType> { return authorizedRequest<HrLeaveType>(`v1/hr/leave-types/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }); }
export async function deleteHrLeaveType(id: string, version: number): Promise<void> { return authorizedRequest<void>(`v1/hr/leave-types/${encodeURIComponent(id)}?version=${version}`, { method: 'DELETE' }); }
export async function listHrLeaveBalances(year?: number): Promise<CursorPage<HrLeaveBalance>> { return collectCursorPages((cursor) => { const query = new URLSearchParams({ limit: '100' }); if (year) query.set('year', String(year)); if (cursor) query.set('cursor', cursor); return `v1/hr/leave-balances?${query}`; }); }
export async function adjustHrLeaveBalance(input: { membershipId: string; leaveTypeId: string; year: number; deltaDays: number; reason: string }): Promise<HrLeaveBalance> { return authorizedRequest<HrLeaveBalance>('v1/hr/leave-balances/adjust', { method: 'POST', body: JSON.stringify(input) }); }
export async function listHrLeaveRequests(status?: HrRequestStatus): Promise<CursorPage<HrLeaveRequest>> { return collectCursorPages((cursor) => `v1/hr/leave-requests?limit=100${status ? `&status=${status}` : ''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`); }
export async function createHrLeaveRequest(input: { leaveTypeId: string; startAt: string; endAt: string; durationDays?: number; reason?: string | null }): Promise<HrLeaveRequest> { return authorizedRequest<HrLeaveRequest>('v1/hr/leave-requests', { method: 'POST', body: JSON.stringify(input) }); }
export async function reviewHrLeaveRequest(id: string, decision: 'APPROVE' | 'REJECT', version: number, comment?: string): Promise<HrLeaveRequest> { return authorizedRequest<HrLeaveRequest>(`v1/hr/leave-requests/${encodeURIComponent(id)}/review`, { method: 'POST', body: JSON.stringify({ decision, version, comment }) }); }
export async function withdrawHrLeaveRequest(id: string, version: number): Promise<HrLeaveRequest> { return authorizedRequest<HrLeaveRequest>(`v1/hr/leave-requests/${encodeURIComponent(id)}/withdraw`, { method: 'POST', body: JSON.stringify({ version }) }); }
export async function cancelHrLeaveRequest(id: string, version: number, reason?: string): Promise<HrLeaveRequest> { return authorizedRequest<HrLeaveRequest>(`v1/hr/leave-requests/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify({ version, reason }) }); }
export async function listHrAttendanceRecords(): Promise<CursorPage<HrAttendanceRecord>> { return collectCursorPages((cursor) => `v1/hr/attendance-records?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`); }
export async function createHrAttendanceRecord(input: { membershipId: string; workDate: string; checkInAt?: string | null; checkOutAt?: string | null; status: HrAttendanceStatus; note?: string | null }): Promise<HrAttendanceRecord> { return authorizedRequest<HrAttendanceRecord>('v1/hr/attendance-records', { method: 'POST', body: JSON.stringify(input) }); }
export async function importHrAttendanceRecords(records: Array<{ membershipId: string; workDate: string; checkInAt?: string | null; checkOutAt?: string | null; status: HrAttendanceStatus; note?: string | null }>): Promise<{ total: number; imported: number; failed: number; failures: Array<{ index: number; code: string; message: string }> }> { return authorizedRequest('v1/hr/attendance-records/import', { method: 'POST', body: JSON.stringify({ records }) }); }
export async function updateHrAttendanceRecord(id: string, input: { checkInAt?: string | null; checkOutAt?: string | null; status?: HrAttendanceStatus; note?: string | null; version: number }): Promise<HrAttendanceRecord> { return authorizedRequest<HrAttendanceRecord>(`v1/hr/attendance-records/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }); }
export async function reviewHrAttendanceRecord(id: string, decision: 'APPROVE' | 'REJECT', version: number, comment?: string): Promise<HrAttendanceRecord> { return authorizedRequest<HrAttendanceRecord>(`v1/hr/attendance-records/${encodeURIComponent(id)}/review`, { method: 'POST', body: JSON.stringify({ decision, version, comment }) }); }
export async function listHrOvertimeRequests(): Promise<CursorPage<HrOvertimeRequest>> { return collectCursorPages((cursor) => `v1/hr/overtime-requests?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`); }
export async function createHrOvertimeRequest(input: { startAt: string; endAt: string; durationHours: number; reason: string }): Promise<HrOvertimeRequest> { return authorizedRequest<HrOvertimeRequest>('v1/hr/overtime-requests', { method: 'POST', body: JSON.stringify(input) }); }
export async function reviewHrOvertimeRequest(id: string, decision: 'APPROVE' | 'REJECT', version: number, comment?: string): Promise<HrOvertimeRequest> { return authorizedRequest<HrOvertimeRequest>(`v1/hr/overtime-requests/${encodeURIComponent(id)}/review`, { method: 'POST', body: JSON.stringify({ decision, version, comment }) }); }
export async function cancelHrOvertimeRequest(id: string, version: number): Promise<HrOvertimeRequest> { return authorizedRequest<HrOvertimeRequest>(`v1/hr/overtime-requests/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify({ version }) }); }
export async function listHrEmployeeChanges(): Promise<CursorPage<HrEmployeeChange>> { return collectCursorPages((cursor) => `v1/hr/employee-changes?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`); }
export async function createHrEmployeeChange(input: { membershipId: string; type: HrEmployeeChangeType; effectiveDate: string; fromDepartmentId?: string | null; toDepartmentId?: string | null; fromPosition?: string | null; toPosition?: string | null; fromManagerMembershipId?: string | null; toManagerMembershipId?: string | null; reason?: string | null }): Promise<HrEmployeeChange> { return authorizedRequest<HrEmployeeChange>('v1/hr/employee-changes', { method: 'POST', body: JSON.stringify(input) }); }
export async function reviewHrEmployeeChange(id: string, decision: 'APPROVE' | 'REJECT', version: number, comment?: string): Promise<HrEmployeeChange> { return authorizedRequest<HrEmployeeChange>(`v1/hr/employee-changes/${encodeURIComponent(id)}/review`, { method: 'POST', body: JSON.stringify({ decision, version, comment }) }); }
export async function cancelHrEmployeeChange(id: string, version: number): Promise<HrEmployeeChange> { return authorizedRequest<HrEmployeeChange>(`v1/hr/employee-changes/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify({ version }) }); }
export async function getHrHeadcountReport(): Promise<{ asOf: string; total: number; byDepartment: Array<{ departmentId: string; departmentName: string; headcount: number }> }> { return authorizedRequest('v1/hr/reports/headcount'); }
export async function getHrLeaveSummaryReport(year: number): Promise<{ year: number; totalRequestedDays: number; totalApprovedDays: number; byLeaveType: Array<{ leaveTypeId: string; leaveTypeName: string; requestedDays: number; approvedDays: number }> }> { return authorizedRequest(`v1/hr/reports/leave-summary?year=${year}`); }
export async function getHrAttendanceSummaryReport(dateFrom: string, dateTo: string): Promise<{ dateFrom: string; dateTo: string; normalDays: number; lateCount: number; earlyLeaveCount: number; absentDays: number; leaveDays: number }> { return authorizedRequest(`v1/hr/reports/attendance-summary?dateFrom=${dateFrom}&dateTo=${dateTo}`); }
export async function getHrOvertimeSummaryReport(dateFrom: string, dateTo: string): Promise<{ dateFrom: string; dateTo: string; totalHours: number; byMember: Array<{ membershipId: string; displayName: string; overtimeHours: number }> }> { return authorizedRequest(`v1/hr/reports/overtime-summary?dateFrom=${dateFrom}&dateTo=${dateTo}`); }

export type FinanceExpenseStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN' | 'CANCELLED' | 'PAID';
export type FinancePaymentMethod = 'BANK_TRANSFER' | 'CASH' | 'CORPORATE_CARD' | 'OTHER';

export interface FinanceExpenseCategory {
    id: string; tenantId: string; code: string; name: string; description?: string | null;
    enabled: boolean; version: number; createdAt: string; updatedAt: string;
}

export interface FinanceExpenseItemInput {
    categoryId: string; description: string; amount: number; taxAmount?: number; occurredAt: string;
    merchantName?: string | null; invoiceNumber?: string | null; invoiceType?: string | null;
    projectId?: string | null; departmentId?: string | null; remark?: string | null;
}

export interface FinanceExpenseItem extends FinanceExpenseItemInput {
    id: string; reportId: string; taxAmount: number; sortOrder: number; version: number; createdAt: string;
}

export interface FinanceExpenseAttachment {
    id: string; reportId: string; itemId?: string | null; fileObjectId: string;
    originalName: string; mimeType: string; sizeBytes: number; createdAt: string;
}

export interface FinanceExpenseStatusHistory {
    id: string; reportId: string; fromStatus?: FinanceExpenseStatus | null; toStatus: FinanceExpenseStatus;
    actorMembershipId: string; comment?: string | null; createdAt: string;
}

export interface FinanceExpenseReport {
    id: string; tenantId: string; reportNo: string; requesterMembershipId: string; requesterDepartmentId?: string | null;
    title: string; description?: string | null; currency: string; totalAmount: number; status: FinanceExpenseStatus;
    submittedAt?: string | null; reviewedBy?: string | null; reviewedAt?: string | null; reviewComment?: string | null;
    paidBy?: string | null; paidAt?: string | null; paymentMethod?: FinancePaymentMethod | null;
    paymentReference?: string | null; paymentComment?: string | null; cancelledAt?: string | null;
    cancellationReason?: string | null; items: FinanceExpenseItem[]; attachments: FinanceExpenseAttachment[];
    statusHistory: FinanceExpenseStatusHistory[]; version: number; createdAt: string; updatedAt: string;
}

export interface FinanceExpenseReportInput {
    title: string; description?: string | null; currency?: string; items: FinanceExpenseItemInput[]; attachmentIds?: string[];
}

export interface FinanceExpenseSummary {
    currency: string; reportCount: number; submittedAmount: number; approvedAmount: number; paidAmount: number;
    pendingApprovalCount: number; pendingApprovalAmount: number; pendingPaymentCount: number; pendingPaymentAmount: number;
    byCategory: Array<{ categoryId: string; categoryName: string; amount: number }>;
}

export interface FinanceExpenseReportFilters {
    keyword?: string; status?: FinanceExpenseStatus; requesterMembershipId?: string; departmentId?: string;
    projectId?: string; categoryId?: string; dateFrom?: string; dateTo?: string;
}

export interface FinanceProjectSpend {
    projectId: string; currency: string; submittedAmount: number; approvedAmount: number; paidAmount: number;
}

export async function listFinanceExpenseCategories(): Promise<{ items: FinanceExpenseCategory[] }> {
    return authorizedRequest('v1/finance/expense-categories');
}
export async function createFinanceExpenseCategory(input: { code: string; name: string; description?: string | null; enabled?: boolean }): Promise<FinanceExpenseCategory> {
    return authorizedRequest('v1/finance/expense-categories', { method: 'POST', body: JSON.stringify(input) });
}
export async function updateFinanceExpenseCategory(id: string, input: { code?: string; name?: string; description?: string | null; enabled?: boolean; version: number }): Promise<FinanceExpenseCategory> {
    return authorizedRequest(`v1/finance/expense-categories/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
}
export async function deleteFinanceExpenseCategory(id: string, version: number): Promise<void> {
    return authorizedRequest(`v1/finance/expense-categories/${encodeURIComponent(id)}?version=${version}`, { method: 'DELETE' });
}
export async function listFinanceExpenseReports(filters: FinanceExpenseReportFilters = {}): Promise<CursorPage<FinanceExpenseReport>> {
    return collectCursorPages((cursor) => {
        const query = new URLSearchParams({ limit: '100' });
        if (filters.keyword?.trim()) query.set('keyword', filters.keyword.trim());
        if (filters.status) query.set('status', filters.status);
        if (filters.requesterMembershipId) query.set('requesterMembershipId', filters.requesterMembershipId);
        if (filters.departmentId) query.set('departmentId', filters.departmentId);
        if (filters.projectId) query.set('projectId', filters.projectId);
        if (filters.categoryId) query.set('categoryId', filters.categoryId);
        if (filters.dateFrom) query.set('dateFrom', filters.dateFrom);
        if (filters.dateTo) query.set('dateTo', filters.dateTo);
        if (cursor) query.set('cursor', cursor);
        return `v1/finance/expense-reports?${query}`;
    });
}
export async function getFinanceExpenseReport(id: string): Promise<FinanceExpenseReport> {
    return authorizedRequest(`v1/finance/expense-reports/${encodeURIComponent(id)}`);
}
export async function createFinanceExpenseReport(input: FinanceExpenseReportInput): Promise<FinanceExpenseReport> {
    return authorizedRequest('v1/finance/expense-reports', { method: 'POST', body: JSON.stringify(input) });
}
export async function updateFinanceExpenseReport(id: string, input: FinanceExpenseReportInput & { version: number }): Promise<FinanceExpenseReport> {
    return authorizedRequest(`v1/finance/expense-reports/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
}
export async function deleteFinanceExpenseReport(id: string, version: number): Promise<void> {
    return authorizedRequest(`v1/finance/expense-reports/${encodeURIComponent(id)}?version=${version}`, { method: 'DELETE' });
}
export async function submitFinanceExpenseReport(id: string, version: number): Promise<FinanceExpenseReport> {
    return authorizedRequest(`v1/finance/expense-reports/${encodeURIComponent(id)}/submit`, { method: 'POST', body: JSON.stringify({ version }) });
}
export async function withdrawFinanceExpenseReport(id: string, version: number, reason?: string): Promise<FinanceExpenseReport> {
    return authorizedRequest(`v1/finance/expense-reports/${encodeURIComponent(id)}/withdraw`, { method: 'POST', body: JSON.stringify({ version, reason }) });
}
export async function cancelFinanceExpenseReport(id: string, version: number, reason?: string): Promise<FinanceExpenseReport> {
    return authorizedRequest(`v1/finance/expense-reports/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify({ version, reason }) });
}
export async function reviewFinanceExpenseReport(id: string, input: { decision: 'APPROVE' | 'REJECT'; comment?: string | null; version: number }): Promise<FinanceExpenseReport> {
    return authorizedRequest(`v1/finance/expense-reports/${encodeURIComponent(id)}/review`, { method: 'POST', body: JSON.stringify(input) });
}
export async function markFinanceExpenseReportPaid(id: string, input: { paidAt: string; paymentMethod: FinancePaymentMethod; paymentReference: string; comment?: string | null; version: number }): Promise<FinanceExpenseReport> {
    return authorizedRequest(`v1/finance/expense-reports/${encodeURIComponent(id)}/mark-paid`, { method: 'POST', body: JSON.stringify(input) });
}
export async function getFinanceExpenseSummary(dateFrom: string, dateTo: string): Promise<FinanceExpenseSummary> {
    return authorizedRequest(`v1/finance/reports/expense-summary?dateFrom=${dateFrom}&dateTo=${dateTo}`);
}
export async function getFinanceProjectSpend(projectId: string, dateFrom?: string, dateTo?: string, currency = 'CNY'): Promise<FinanceProjectSpend> {
    const query = new URLSearchParams({ projectId, currency });
    if (dateFrom) query.set('dateFrom', dateFrom);
    if (dateTo) query.set('dateTo', dateTo);
    return authorizedRequest(`v1/finance/reports/project-spend?${query}`);
}

export type LegalContractStatus = 'DRAFT' | 'ACTIVE' | 'PENDING_RENEWAL' | 'EXPIRED' | 'TERMINATED' | 'ARCHIVED';
export type LegalContractType = 'PURCHASE' | 'SALES' | 'SERVICE' | 'EMPLOYMENT' | 'NDA' | 'LEASE' | 'OTHER';

export interface LegalContractAttachment {
    id: string; fileObjectId: string; originalName: string; mimeType: string; sizeBytes: number; createdAt: string;
}
export interface LegalContractStatusHistory {
    id: string; fromStatus?: LegalContractStatus | null; toStatus: LegalContractStatus;
    actorMembershipId?: string | null; comment?: string | null; createdAt: string;
}
export interface LegalContract {
    id: string; tenantId: string; contractNo: string; name: string; counterparty: string; type: LegalContractType;
    amount?: number | null; currency: string; startDate: string; endDate?: string | null; signedAt?: string | null;
    status: LegalContractStatus; description?: string | null; ownerMembershipId: string;
    departmentId?: string | null; projectId?: string | null; renewalReminderDays: number;
    activatedAt?: string | null; terminatedAt?: string | null; terminationReason?: string | null; archivedAt?: string | null;
    attachments: LegalContractAttachment[]; statusHistory: LegalContractStatusHistory[];
    version: number; createdAt: string; updatedAt: string;
}
export interface LegalContractInput {
    contractNo?: string; name: string; counterparty: string; type: LegalContractType; amount?: number | null;
    currency?: string; startDate: string; endDate?: string | null; signedAt?: string | null; description?: string | null;
    ownerMembershipId: string; departmentId?: string | null; projectId?: string | null;
    renewalReminderDays?: number; attachmentIds?: string[];
}
export interface LegalContractFilters {
    keyword?: string; status?: LegalContractStatus; type?: LegalContractType; ownerMembershipId?: string; cursor?: string;
    departmentId?: string; projectId?: string; currency?: string; endDateFrom?: string; endDateTo?: string;
    expiringWithinDays?: number;
}
export interface LegalContractSummary {
    asOf: string; expiringWithinDays: number; totalCount: number; draftCount: number; activeCount: number;
    pendingRenewalCount: number; expiringCount: number; expiredCount: number; terminatedCount: number; archivedCount: number;
    amountsByCurrency: Array<{ currency: string; activeAmount: number; expiringAmount: number }>;
}

export async function listLegalContracts(filters: LegalContractFilters = {}): Promise<CursorPage<LegalContract>> {
    const query = new URLSearchParams({ limit: '100' });
    Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && String(value).trim()) query.set(key, String(value));
    });
    return authorizedRequest(`v1/legal/contracts?${query}`);
}
export async function createLegalContract(input: LegalContractInput): Promise<LegalContract> {
    return authorizedRequest('v1/legal/contracts', { method: 'POST', body: JSON.stringify(input) });
}
export async function updateLegalContract(id: string, input: Partial<LegalContractInput> & { version: number }): Promise<LegalContract> {
    return authorizedRequest(`v1/legal/contracts/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
}
export async function deleteLegalContract(id: string, version: number): Promise<void> {
    return authorizedRequest(`v1/legal/contracts/${encodeURIComponent(id)}?version=${version}`, { method: 'DELETE' });
}
export async function activateLegalContract(id: string, version: number, comment?: string): Promise<LegalContract> {
    return legalContractAction(id, 'activate', { version, comment });
}
export async function markLegalContractPendingRenewal(id: string, version: number, comment?: string): Promise<LegalContract> {
    return legalContractAction(id, 'mark-pending-renewal', { version, comment });
}
export async function renewLegalContract(id: string, input: { newEndDate: string; renewalReminderDays?: number; comment?: string; version: number }): Promise<LegalContract> {
    return legalContractAction(id, 'renew', input);
}
export async function terminateLegalContract(id: string, input: { effectiveDate: string; reason: string; version: number }): Promise<LegalContract> {
    return legalContractAction(id, 'terminate', input);
}
export async function archiveLegalContract(id: string, version: number, comment?: string): Promise<LegalContract> {
    return legalContractAction(id, 'archive', { version, comment });
}
export async function getLegalContractSummary(expiringWithinDays = 30): Promise<LegalContractSummary> {
    return authorizedRequest(`v1/legal/reports/contract-summary?expiringWithinDays=${expiringWithinDays}`);
}
function legalContractAction(id: string, action: string, body: unknown): Promise<LegalContract> {
    return authorizedRequest(`v1/legal/contracts/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: JSON.stringify(body) });
}
